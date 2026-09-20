import { ExitEstimationService } from './exit_estimation.service';
import { KlineStoreService, Candle } from './kline_store.service';
import { Trade } from '../models/Trade';
import { SessionConfig } from '../models/SessionConfig';

describe('ExitEstimationService Bolt Performance & Parity Benchmark', () => {
  let service: ExitEstimationService;
  let klineStore: jest.Mocked<KlineStoreService>;

  beforeEach(() => {
    klineStore = {
      getRawCandles: jest.fn(),
      getLookbackExtremes: jest.fn(),
    } as any;

    service = new ExitEstimationService(klineStore);
  });

  const generateCandles = (count: number): Candle[] => {
    const candles: Candle[] = [];
    for (let i = 0; i < count; i++) {
      const price = 100 + Math.sin(i / 10) * 10 + (i * 0.1);
      candles.push({
        time: i * 60000,
        open: price - 0.2,
        high: price + 0.5,
        low: price - 0.5,
        close: price,
        volume: 1000 + i,
      });
    }
    return candles;
  };

  const createTrade = (): Trade => ({
    id: 'trade-bench-1',
    symbol: 'BTCUSDT',
    direction: 'LONG',
    entry_price: 100,
    qty: 1,
    initial_sl: 95,
    current_sl: 95,
    initial_risk_usdt: 5,
    risk_usdt: 5,
    status: 'OPEN',
    pnl: 0,
    entry_ts: new Date(),
  } as Trade);

  it('benchmark: calculateMACDHistogramSeries performance across 50,000 iterations', () => {
    const candles = generateCandles(200);

    // Warmup
    for (let i = 0; i < 100; i++) {
      service.calculateMACDHistogramSeries(candles, 12, 26, 9);
    }

    const iterations = 50000;
    const startTime = performance.now();

    let lastHistLen = 0;
    for (let i = 0; i < iterations; i++) {
      const hist = service.calculateMACDHistogramSeries(candles, 12, 26, 9);
      lastHistLen = hist.length;
    }

    const endTime = performance.now();
    const durationMs = endTime - startTime;
    const nsPerCall = (durationMs / iterations) * 1000000;

    console.log(`[BENCHMARK] calculateMACDHistogramSeries (${iterations} iterations): ${durationMs.toFixed(2)}ms`);
    console.log(`[BENCHMARK] Time per call: ${nsPerCall.toFixed(2)}ns`);

    expect(lastHistLen).toBeGreaterThan(0);
    expect(durationMs).toBeLessThan(10000); // Sanity guard
  });

  it('benchmark: estimateExitSignal breakout_hl performance across 50,000 iterations', () => {
    const candles = generateCandles(100);
    const trade = createTrade();
    const config = new SessionConfig();
    config.signal_params = { scan_lookback: 10 };

    const iterations = 50000;
    const startTime = performance.now();

    for (let i = 0; i < iterations; i++) {
      service.estimateExitSignal('breakout_hl', trade, config, '1m', candles, {});
    }

    const endTime = performance.now();
    const durationMs = endTime - startTime;
    const nsPerCall = (durationMs / iterations) * 1000000;

    console.log(`[BENCHMARK] estimateExitSignal breakout_hl (${iterations} iterations): ${durationMs.toFixed(2)}ms`);
    console.log(`[BENCHMARK] Time per call: ${nsPerCall.toFixed(2)}ns`);

    expect(durationMs).toBeLessThan(5000);
  });

  it('benchmark: estimateExitMonitoring performance across 50,000 iterations', () => {
    const candles = generateCandles(100);
    const trade = createTrade();
    const config = new SessionConfig();
    config.exit_signals = ['ema_dual_cross', 'supertrend', 'macd_impulse', 'breakout_hl'];
    config.exit_signal_logic = 'all';

    const signalDetails = {
      ema_dual_cross: { fired: false, value: 101, threshold: 102, status: 'approaching' },
      supertrend: { fired: false, threshold: 98, status: 'approaching' },
      macd_impulse: { fired: false, status: 'approaching' },
      breakout_hl: { fired: false, status: 'approaching' },
    };

    const iterations = 50000;
    const startTime = performance.now();

    let compState = '';
    for (let i = 0; i < iterations; i++) {
      const comp = service.estimateExitMonitoring(trade, config, '1m', candles, signalDetails);
      compState = comp.state;
    }

    const endTime = performance.now();
    const durationMs = endTime - startTime;
    const nsPerCall = (durationMs / iterations) * 1000000;

    console.log(`[BENCHMARK] estimateExitMonitoring (${iterations} iterations): ${durationMs.toFixed(2)}ms`);
    console.log(`[BENCHMARK] Time per call: ${nsPerCall.toFixed(2)}ns`);

    expect(compState).toBeDefined();
    expect(durationMs).toBeLessThan(10000);
  });
});
