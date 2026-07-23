import { Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { BinanceRequestQueue } from './binanceClientFactory';

describe('BinanceRequestQueue Shared State', () => {
  let logger: Logger;
  let eventEmitter: EventEmitter2;
  let settingsRepository: any;

  let sessionState: any;

  beforeEach(() => {
    logger = {
      debug: jest.fn(),
      error: jest.fn(),
      fatal: jest.fn(),
      log: jest.fn(),
      verbose: jest.fn(),
      warn: jest.fn(),
    } as any;
    eventEmitter = {
      emit: jest.fn(),
    } as any;
    settingsRepository = {
      update: jest.fn().mockResolvedValue({}),
    } as any;
    sessionState = {
        binanceOrderLimit: {
            used_10s: 0,
            limit_10s: 100,
            used_1m: 0,
            limit_1m: 1000
        }
    } as any;

    // Reset static members via any cast if necessary or just rely on the fact they are shared
    (BinanceRequestQueue as any).lastRequestTs = 0;
    (BinanceRequestQueue as any).currentWeight1m = 0;
    (BinanceRequestQueue as any).adaptiveDelayMs = 0;
  });

  it('should share state between multiple instances', async () => {
    const queue1 = new BinanceRequestQueue(logger, eventEmitter, settingsRepository, sessionState);
    const queue2 = new BinanceRequestQueue(logger, eventEmitter, settingsRepository, sessionState);

    const headers = {
      get: (name: string) => (name === 'X-MBX-USED-WEIGHT-1M' ? '2000' : null),
    };

    queue1.updateWeightFromHeaders(headers);

    // Expect queue2 to see the updated state through static members
    expect((BinanceRequestQueue as any).currentWeight1m).toBe(2000);
    // SRE Update: 2000/2400 = 0.83 (> 0.75) => 1000ms delay
    expect((BinanceRequestQueue as any).adaptiveDelayMs).toBe(1000);
  });

  it('should log structured telemetry on execution', async () => {
    const queue = new BinanceRequestQueue(logger, eventEmitter, settingsRepository, sessionState);
    const successFn = jest.fn().mockResolvedValue('ok');

    await queue.add(successFn, 'test-success');

    expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining('Dispatching: test-success'));
    // SRE: High-Fidelity Structured Telemetry Logging uses standardized [Telemetry] format
    expect(logger.log).toHaveBeenCalledWith(expect.stringContaining('[Telemetry] test-success executed'));
  });

  it('should shed load (reject) non-critical calls when weight is > 75%', async () => {
    const queue = new BinanceRequestQueue(logger, eventEmitter, settingsRepository, sessionState);

    // Set weight to 80% (1920/2400)
    const headers = { get: (name: string) => (name === 'X-MBX-USED-WEIGHT-1M' ? '2000' : null) };
    queue.updateWeightFromHeaders(headers);

    const nonCriticalFn = jest.fn().mockResolvedValue('ok');
    const criticalFn = jest.fn().mockResolvedValue('ok');

    // Non-critical should be rejected
    await expect(queue.add(nonCriticalFn, 'ticker24hrPriceChangeStatistics')).rejects.toThrow('Load shedding active');

    // Critical should proceed
    await expect(queue.add(criticalFn, 'newOrder')).resolves.toBe('ok');
  });

  it('should enter safe cooldown and emit event on IP ban (418)', async () => {
    const queue = new BinanceRequestQueue(logger, eventEmitter, settingsRepository, sessionState);

    // RESEARCH: Verify that we NO LONGER call process.exit(1)
    let exitCalled = false;
    const mockExit = jest.spyOn(process, 'exit').mockImplementation(() => {
        exitCalled = true;
        return undefined as never;
    });

    const failingFn = async () => {
      const err = new Error('IP banned (418)');
      throw err;
    };

    try {
      await queue.add(failingFn, 'test-ban');
    } catch (e) {
      // expected error from failingFn
    }

    expect(logger.fatal).toHaveBeenCalledWith(expect.stringContaining('BAN status (IP banned (418))'));
    expect(exitCalled).toBe(false);
    expect(eventEmitter.emit).toHaveBeenCalledWith('binance.api_limit_reached', expect.objectContaining({
      type: 'BAN'
    }));

    // Verify cooldown is set (10 minutes = 600,000ms)
    const lastRequest = (BinanceRequestQueue as any).lastRequestTs;
    expect(lastRequest).toBeGreaterThan(Date.now() + 500000);

    mockExit.mockRestore();
  });

  it('should emit recovery event when ban cooldown expires', async () => {
    const queue = new BinanceRequestQueue(logger, eventEmitter, settingsRepository, sessionState);

    // 1. Manually trigger a ban state
    (BinanceRequestQueue as any).lastRequestTs = Date.now() + 5000;
    (BinanceRequestQueue as any).currentWeight1m = 9999;
    (BinanceRequestQueue as any).windowStartTs = Date.now() - 65000; // Force rollover eligibility

    // 2. Mock time to just after the cooldown
    const now = Date.now() + 6000;

    // 3. Trigger rollover
    (queue as any).executeRollover(now);

    // 4. Verify recovery event
    expect(eventEmitter.emit).toHaveBeenCalledWith('binance.api_limit_cleared');
    expect(logger.log).toHaveBeenCalledWith(expect.stringContaining('Terminal Lock lifted'));
  });
});
