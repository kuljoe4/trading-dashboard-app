import { SignalEngineService } from './signalEngine';
import { KlineStoreService, Candle } from './kline_store.service';

const createCandle = (open: number, high: number, low: number, close: number): Candle => ({
  time: Date.now(),
  open,
  high,
  low,
  close,
  volume: 100,
});

describe('Engulfing First Candle', () => {
  let klineStore: jest.Mocked<KlineStoreService>;
  let service: any;

  beforeEach(() => {
    klineStore = { getRawCandles: jest.fn() } as any;
    service = new SignalEngineService(klineStore as any);
  });

  it('should REJECT if curr is the second candle to engulf', () => {
    const candles = [
      createCandle(105, 106, 101, 102), // idx 0: bearish 1
      createCandle(102, 104, 100, 101), // idx 1: bearish 2 (streak ends here, aggregateHigh = 106)
      createCandle(101, 107, 100, 106.5), // idx 2: bullish 1: ALREADY engulfed (close 106.5 > 106) -> FIRST SIGNAL CANDLE
      createCandle(106.5, 108, 106, 107.5), // idx 3: bullish 2: ALSO above 106 -> SECOND SIGNAL CANDLE
      createCandle(107.5, 109, 107, 108), // idx 4: live candle
    ];
    klineStore.getRawCandles.mockReturnValue(candles);
    const config = { enabled_signals: ['engulfing'], engulfing_mode: 'close_range', signal_params: { engulfing_lookback: 3, engulfing_streak: 2, engulfing_sequential: false } };

    const result = service.engulfingSignal('BTCUSDT', config, '1m', 'LONG', 'entry', candles);

    // We expect it to be false because bullish 1 already engulfed the streak.
    expect(result.fired).toBe(false);
  });
});
