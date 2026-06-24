import { Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { BinanceRequestQueue } from './binanceClientFactory';

describe('BinanceRequestQueue Shared State', () => {
  let logger: Logger;
  let eventEmitter: EventEmitter2;
  let settingsRepository: any;

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

    // Reset static members via any cast if necessary or just rely on the fact they are shared
    (BinanceRequestQueue as any).lastRequestTs = 0;
    (BinanceRequestQueue as any).currentWeight1m = 0;
    (BinanceRequestQueue as any).adaptiveDelayMs = 0;
  });

  it('should share state between multiple instances', async () => {
    const queue1 = new BinanceRequestQueue(logger, eventEmitter, settingsRepository);
    const queue2 = new BinanceRequestQueue(logger, eventEmitter, settingsRepository);

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
    const queue = new BinanceRequestQueue(logger, eventEmitter, settingsRepository);
    const successFn = jest.fn().mockResolvedValue('ok');

    await queue.add(successFn, 'test-success');

    expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining('Dispatching: test-success'));
    // SRE: High-Fidelity Structured Telemetry Logging uses standardized [Telemetry] format
    expect(logger.log).toHaveBeenCalledWith(expect.stringContaining('[Telemetry] test-success executed'));
  });

  it('should shed load (reject) non-critical calls when weight is > 75%', async () => {
    const queue = new BinanceRequestQueue(logger, eventEmitter, settingsRepository);

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
    const queue = new BinanceRequestQueue(logger, eventEmitter, settingsRepository);

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

    expect(logger.fatal).toHaveBeenCalledWith(expect.stringContaining('IP BANNED (418)'));
    expect(exitCalled).toBe(false);
    expect(eventEmitter.emit).toHaveBeenCalledWith('binance.api_limit_reached', expect.objectContaining({
      type: 'BAN'
    }));

    // Verify cooldown is set (10 minutes = 600,000ms)
    const lastRequest = (BinanceRequestQueue as any).lastRequestTs;
    expect(lastRequest).toBeGreaterThan(Date.now() + 500000);

    mockExit.mockRestore();
  });
});
