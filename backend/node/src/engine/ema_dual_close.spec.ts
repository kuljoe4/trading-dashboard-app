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

  it('should fire LONG entry if fast EMA is above slow EMA', () => {
    // Provide 40 candles to satisfy 2*period warmup (period=10 -> 20 candles)
    // Trending up: Fast EMA > Slow EMA
    const prices = Array(60).fill(10).map((v, i) => v + i);
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

  it('should NOT fire LONG entry if fast EMA is below slow EMA', () => {
    // Trending down: Fast EMA < Slow EMA
    const prices = Array(60).fill(100).map((v, i) => v - i);
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

  it('should fire SHORT entry if fast EMA is below slow EMA', () => {
    const prices = Array(60).fill(100).map((v, i) => v - i);
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

  it('should fire LONG exit if fast EMA crosses below slow EMA in the last COMPLETED candle', () => {
    // Price 100 for a long time, then we drop to 80 (completed), then 80 again (live).
    // Fast EMA will pull below Slow EMA.
    const prices = [...Array(80).fill(100), 80, 80, 80, 80, 80, 80];
    const candles = mockCandles(prices);
    (klineStore.getRawCandles as jest.Mock).mockReturnValue(candles);

    const config = new SessionConfig();
    config.enabled_signals = ['ema_dual_close'];
    config.exit_signals = ['ema_dual_close'];
    config.signal_params = {
      exit_ema_fast: 5,
      exit_ema_slow: 20,
    };

    const result = service.checkEntry('BTCUSDT', config, '1m', 'LONG', 'exit');
    expect(result.allFired).toBe(true);
  });

  it('should NOT fire exit based on mid-candle (live) crossing', () => {
    // Price 100 (completed), then 90 (live).
    // The completed candle (100) is still above EMAs, so no exit should fire.
    const prices = [...Array(61).fill(100), 90];
    const candles = mockCandles(prices);
    (klineStore.getRawCandles as jest.Mock).mockReturnValue(candles);

    const config = new SessionConfig();
    config.enabled_signals = ['ema_dual_close'];
    config.exit_signals = ['ema_dual_close'];
    config.signal_params = {
      exit_ema_fast: 5,
      exit_ema_slow: 10,
    };

    const result = service.checkEntry('BTCUSDT', config, '1m', 'LONG', 'exit');
    expect(result.allFired).toBe(false);
  });
});
