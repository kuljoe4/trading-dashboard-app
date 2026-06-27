import { Test, TestingModule } from '@nestjs/testing';
import { SignalEngineService } from './signalEngine';
import { KlineStoreService } from './kline_store.service';
import { SessionConfig } from '../models/SessionConfig';

describe('SignalEngineService - ema_dual_close', () => {
  let service: SignalEngineService;
  let klineStore: KlineStoreService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SignalEngineService,
        {
          provide: KlineStoreService,
          useValue: {
            getRawCandles: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<SignalEngineService>(SignalEngineService);
    klineStore = module.get<KlineStoreService>(KlineStoreService);
  });

  const mockCandles = (prices: number[]) => {
    return prices.map((p, i) => ({
      time: i * 60000,
      open: p,
      high: p + 1,
      low: p - 1,
      close: p,
      volume: 100,
    }));
  };

  it('should fire LONG entry if price is above both EMAs', () => {
    // Provide 40 candles to satisfy 2*period warmup (period=10 -> 20 candles)
    const prices = Array(40).fill(10).map((v, i) => v + i);
    const candles = mockCandles(prices);
    (klineStore.getRawCandles as jest.Mock).mockReturnValue(candles);

    const config = new SessionConfig();
    config.enabled_signals = ['ema_dual_close'];
    config.signal_params = {
      entry_ema_fast: 5,
      entry_ema_slow: 10,
    };

    const result = service.checkEntry('BTCUSDT', config, '1m', 'LONG', 'entry');
    expect(result.allFired).toBe(true);
    expect(result.firedSignals).toContain('ema_dual_close');
    expect(result.details?.ema_dual_close.fired).toBe(true);
  });

  it('should NOT fire LONG entry if price is between EMAs', () => {
    // Price was 100 for a long time, then jumps to 110.
    // EMA(5) will move faster towards 110 than EMA(10).
    // If we then drop to 105, 105 might be below EMA(5) but above EMA(10).
    const prices = [...Array(30).fill(100), 110, 110, 110, 105];
    const candles = mockCandles(prices);
    (klineStore.getRawCandles as jest.Mock).mockReturnValue(candles);

    const config = new SessionConfig();
    config.enabled_signals = ['ema_dual_close'];
    config.signal_params = {
      entry_ema_fast: 5,
      entry_ema_slow: 20,
    };

    const result = service.checkEntry('BTCUSDT', config, '1m', 'LONG', 'entry');
    expect(result.allFired).toBe(false);
  });

  it('should fire SHORT entry if price is below both EMAs', () => {
    const prices = Array(40).fill(100).map((v, i) => v - i);
    const candles = mockCandles(prices);
    (klineStore.getRawCandles as jest.Mock).mockReturnValue(candles);

    const config = new SessionConfig();
    config.enabled_signals = ['ema_dual_close'];
    config.signal_params = {
      entry_ema_fast: 5,
      entry_ema_slow: 10,
    };

    const result = service.checkEntry('BTCUSDT', config, '1m', 'SHORT', 'entry');
    expect(result.allFired).toBe(true);
    expect(result.details?.ema_dual_close.fired).toBe(true);
  });

  it('should fire LONG exit if price crosses below either EMA in the last COMPLETED candle', () => {
    // Price 100 for a long time, then we drop to 90 (completed), then 90 again (live).
    // Both EMAs will be > 90 for the completed candle.
    const prices = [...Array(40).fill(100), 90, 90];
    const candles = mockCandles(prices);
    (klineStore.getRawCandles as jest.Mock).mockReturnValue(candles);

    const config = new SessionConfig();
    config.enabled_signals = ['ema_dual_close'];
    config.signal_params = {
      exit_ema_fast: 5,
      exit_ema_slow: 10,
    };

    const result = service.checkEntry('BTCUSDT', config, '1m', 'LONG', 'exit');
    expect(result.allFired).toBe(true);
  });

  it('should NOT fire exit based on mid-candle (live) crossing', () => {
    // Price 100 (completed), then 90 (live).
    // The completed candle (100) is still above EMAs, so no exit should fire.
    const prices = [...Array(41).fill(100), 90];
    const candles = mockCandles(prices);
    (klineStore.getRawCandles as jest.Mock).mockReturnValue(candles);

    const config = new SessionConfig();
    config.enabled_signals = ['ema_dual_close'];
    config.signal_params = {
      exit_ema_fast: 5,
      exit_ema_slow: 10,
    };

    const result = service.checkEntry('BTCUSDT', config, '1m', 'LONG', 'exit');
    expect(result.allFired).toBe(false);
  });
});
