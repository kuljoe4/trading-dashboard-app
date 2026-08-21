import { Test, TestingModule } from '@nestjs/testing';
import { SignalEngineService } from './signalEngine';
import { KlineStoreService } from './kline_store.service';
import { SessionConfig } from '../models/SessionConfig';

describe('SignalEngineService - ema_dual_cross (Debug & Edge Case Verification)', () => {
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
      high: p + 0.1,
      low: p - 0.1,
      close: p,
      volume: 100,
    }));
  };

  it('should fire LONG entry on the exact live candle where fast EMA crosses above slow EMA', () => {
    // 30 candles where price is 100 (fast EMA = 100, slow EMA = 100)
    // Then a sudden surge on the current live candle to 110
    // Fast EMA(5) will rise faster to ~101.66 than Slow EMA(10) ~100.90
    const prices = [...Array(30).fill(100), 110];
    const candles = mockCandles(prices);
    (klineStore.getRawCandles as jest.Mock).mockReturnValue(candles);

    const config = new SessionConfig();
    config.enabled_signals = ['ema_dual_cross'];
    config.signal_params = {
      entry_ema_fast: 5,
      entry_ema_slow: 10,
    };

    const result = service.checkEntry('BTCUSDT', config, '1m', 'LONG', 'entry');
    expect(result.allFired).toBe(true);
    expect(result.details?.ema_dual_cross.fired).toBe(true);
  });

  it('should reset to FALSE on the subsequent candle if fast EMA remains above slow EMA without a new crossover', () => {
    // Candle 1: 100 (flat)
    // Candle 31 (closed): 110 (crossover occurred here)
    // Candle 32 (live): 110 (fast EMA is still above slow EMA, but NO NEW CROSSOVER occurred)
    const prices = [...Array(30).fill(100), 110, 110];
    const candles = mockCandles(prices);
    (klineStore.getRawCandles as jest.Mock).mockReturnValue(candles);

    const config = new SessionConfig();
    config.enabled_signals = ['ema_dual_cross'];
    config.signal_params = {
      entry_ema_fast: 5,
      entry_ema_slow: 10,
    };

    const result = service.checkEntry('BTCUSDT', config, '1m', 'LONG', 'entry');
    expect(result.allFired).toBe(false);
    expect(result.details?.ema_dual_cross.fired).toBe(false);
  });

  it('should re-trigger LONG entry if fast EMA dips below slow EMA and crosses above again (Whipsaw scenario)', () => {
    // Crossover 1 at candle 31 (110)
    // Pullback at candle 32 (90) -> Fast EMA dips below Slow EMA
    // Re-crossover at candle 33 (120) -> Fast EMA crosses Slow EMA again!
    const prices = [...Array(30).fill(100), 110, 90, 120];
    const candles = mockCandles(prices);
    (klineStore.getRawCandles as jest.Mock).mockReturnValue(candles);

    const config = new SessionConfig();
    config.enabled_signals = ['ema_dual_cross'];
    config.signal_params = {
      entry_ema_fast: 5,
      entry_ema_slow: 10,
    };

    const result = service.checkEntry('BTCUSDT', config, '1m', 'LONG', 'entry');
    expect(result.allFired).toBe(true);
    expect(result.details?.ema_dual_cross.fired).toBe(true);
  });

  it('should fire SHORT entry on the exact live candle where fast EMA crosses below slow EMA', () => {
    // 30 candles where price is 100
    // Drop on current live candle to 90
    const prices = [...Array(30).fill(100), 90];
    const candles = mockCandles(prices);
    (klineStore.getRawCandles as jest.Mock).mockReturnValue(candles);

    const config = new SessionConfig();
    config.enabled_signals = ['ema_dual_cross'];
    config.signal_params = {
      entry_ema_fast: 5,
      entry_ema_slow: 10,
    };

    const result = service.checkEntry('BTCUSDT', config, '1m', 'SHORT', 'entry');
    expect(result.allFired).toBe(true);
    expect(result.details?.ema_dual_cross.fired).toBe(true);
  });
});
