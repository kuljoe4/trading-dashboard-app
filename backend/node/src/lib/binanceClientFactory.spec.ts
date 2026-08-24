import { BinanceClientFactory } from './binanceClientFactory';
import { Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';

describe('BinanceClientFactory', () => {
  let factory: BinanceClientFactory;
  let logger: Logger;
  let eventEmitter: EventEmitter2;
  let settingsRepository: any;

  beforeEach(() => {
    logger = {
      debug: jest.fn(),
      error: jest.fn(),
      log: jest.fn(),
    } as any;
    eventEmitter = new EventEmitter2();
    settingsRepository = {
      update: jest.fn().mockResolvedValue({}),
      findOne: jest.fn(),
    } as any;

    factory = new BinanceClientFactory(eventEmitter, {} as any, settingsRepository);
  });

  it('should be defined', () => {
    expect(factory).toBeDefined();
  });

  it('genericRequest should enqueue and execute a task', async () => {
    const mockTask = jest.fn().mockResolvedValue('success');
    const result = await factory.genericRequest(mockTask, 'test-task');

    expect(result).toBe('success');
    expect(mockTask).toHaveBeenCalled();
  });

  it('genericRequest should update weight if response has headers', async () => {
    const emitSpy = jest.spyOn(eventEmitter, 'emit');
    const mockResponse = {
      ok: true,
      headers: {
        get: (name: string) => name === 'X-MBX-USED-WEIGHT-1M' ? '500' : null
      },
      json: jest.fn().mockResolvedValue({ data: 'ok' })
    };
    const mockTask = jest.fn().mockResolvedValue(mockResponse);

    await factory.genericRequest(mockTask, 'test-weight-task');

    // Verify that the weight update event was emitted
    expect(emitSpy).toHaveBeenCalledWith('binance.weight_update', 500);
  });

  it('genericRequest should throw error and trigger ban handling when response is HTTP 418 / 429', async () => {
    const emitSpy = jest.spyOn(eventEmitter, 'emit');
    const mockBanResponse = {
      ok: false,
      status: 418,
      statusText: 'IP Banned',
      headers: {
        get: (name: string) => name === 'X-MBX-USED-WEIGHT-1M' ? '2400' : null
      },
      clone: () => ({
        text: jest.fn().mockResolvedValue('IP banned until 1718000000000')
      })
    };
    const mockTask = jest.fn().mockResolvedValue(mockBanResponse);

    await expect(factory.genericRequest(mockTask, 'test-ban-task')).rejects.toThrow('HTTP 418');

    // Verify ban event was emitted
    expect(emitSpy).toHaveBeenCalledWith('binance.api_limit_reached', expect.objectContaining({
      type: 'BAN',
      message: expect.stringContaining('HTTP 418')
    }));
  });
});
