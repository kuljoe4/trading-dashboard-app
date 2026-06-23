import { Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { BinanceRequestQueue } from './binanceClientFactory';

describe('BinanceRequestQueue Shared State', () => {
  let logger: Logger;
  let eventEmitter: EventEmitter2;

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

    // Reset static members via any cast if necessary or just rely on the fact they are shared
    (BinanceRequestQueue as any).lastRequestTs = 0;
    (BinanceRequestQueue as any).currentWeight1m = 0;
    (BinanceRequestQueue as any).adaptiveDelayMs = 0;
  });

  it('should share state between multiple instances', async () => {
    const queue1 = new BinanceRequestQueue(logger, eventEmitter);
    const queue2 = new BinanceRequestQueue(logger, eventEmitter);

    const headers = {
      get: (name: string) => (name === 'X-MBX-USED-WEIGHT-1M' ? '2000' : null),
    };

    queue1.updateWeightFromHeaders(headers);

    // Expect queue2 to see the updated state through static members
    expect((BinanceRequestQueue as any).currentWeight1m).toBe(2000);
    expect((BinanceRequestQueue as any).adaptiveDelayMs).toBe(500); // 2000/2400 > 0.8
  });

  it('should log dispatch and completion', async () => {
    const queue = new BinanceRequestQueue(logger, eventEmitter);
    const successFn = jest.fn().mockResolvedValue('ok');

    await queue.add(successFn, 'test-success');

    expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining('Dispatching: test-success'));
    expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining('Completed: test-success'));
  });

  it('should call process.exit(1) on IP ban (418)', async () => {
    const queue = new BinanceRequestQueue(logger, eventEmitter);
    let exitCalledWith: any = null;
    const mockExit = jest.spyOn(process, 'exit').mockImplementation((code?: string | number | null | undefined) => {
        exitCalledWith = code;
        return undefined as never;
    });

    const failingFn = async () => {
      const err = new Error('IP banned');
      (err as any).response = { status: 418 };
      throw err;
    };

    try {
      await queue.add(failingFn, 'test-ban');
    } catch (e) {
      // expected error from failingFn
    }

    expect(logger.fatal).toHaveBeenCalledWith(expect.stringContaining('IP BANNED (418)'));
    expect(exitCalledWith).toBe(1);
    mockExit.mockRestore();
  });
});
