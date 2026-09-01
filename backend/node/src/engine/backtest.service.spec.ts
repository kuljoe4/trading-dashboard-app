import { BacktestEngineService, BacktestTickData } from './backtest.service';
import { SessionConfig } from '../models/SessionConfig';

describe('BacktestEngineService Unit & Performance Tests', () => {
  let service: BacktestEngineService;

  beforeEach(() => {
    service = new BacktestEngineService();
  });

  it('should return empty metrics result when market data is empty or non-USDT', () => {
    const config = new SessionConfig();
    const result = service.runBacktest(config, {});

    expect(result.total_trades).toBe(0);
    expect(result.initial_balance).toBe(10000);
    expect(result.final_balance).toBe(10000);
    expect(result.total_pnl).toBe(0);
  });

  it('should correctly simulate entries, peak RR ratcheting, and stop loss exits', () => {
    const config = new SessionConfig();
    config.scan_pct_threshold = 2.0;
    config.risk_pct_per_trade = 2.0; // $200 risk on $10,000 balance
    config.sl_distance_pct = 2.0; // 2% SL distance
    config.live_rr_sequence = [1.0, 2.0];
    config.exit_rr_sequence = [0.0, 1.0]; // Milestone 1: move to BE (0R), Milestone 2: move to +1R

    const baseTs = 1700000000000;
    const marketData: Record<string, BacktestTickData[]> = {
      BTCUSDT: [
        // Candle 0: Entry trigger (+3% move) -> Entry at 103
        { time: baseTs, open: 100, high: 103.5, low: 99.5, close: 103, volume: 1000000 },
        // Candle 1: Price pushes up to 105.1 -> Peak RR >= 1.0 -> SL moves to 103 (Entry Price / BE)
        { time: baseTs + 60000, open: 103, high: 105.1, low: 102.8, close: 105, volume: 1200000 },
        // Candle 2: Pullback to 102.5 -> Hits BE SL at 103
        { time: baseTs + 120000, open: 105, high: 105.2, low: 102.5, close: 103, volume: 900000 },
      ],
    };

    const result = service.runBacktest(config, marketData, 10000);

    expect(result.total_trades).toBe(1);
    const trade = result.trades[0];
    expect(trade.symbol).toBe('BTCUSDT');
    expect(trade.side).toBe('LONG');
    expect(trade.entry_price).toBe(103);
    expect(trade.rr_sequence_index).toBe(0);
    expect(trade.risk_lock_reason).toBe('SL_AT_BREAKEVEN');
    expect(trade.exit_price).toBe(103);
    expect(trade.pnl).toBe(0);
  });

  it('should benchmark performance for high-frequency tick simulations (100,000 ticks)', () => {
    const config = new SessionConfig();
    config.scan_pct_threshold = 1.5;

    const baseTs = 1700000000000;
    const ticks: BacktestTickData[] = [];
    let price = 100;

    for (let i = 0; i < 100000; i++) {
      const change = (i % 7 === 0 ? 1.8 : -0.2);
      const open = price;
      price = open * (1 + change / 100);
      const high = Math.max(open, price) * 1.002;
      const low = Math.min(open, price) * 0.998;
      ticks.push({
        time: baseTs + i * 60000,
        open,
        high,
        low,
        close: price,
        volume: 500000 + i,
      });
    }

    const marketData = { ETHUSDT: ticks };
    const startMs = Date.now();
    const result = service.runBacktest(config, marketData, 10000);
    const elapsedMs = Date.now() - startMs;

    expect(result.total_trades).toBeGreaterThan(0);
    expect(elapsedMs).toBeLessThan(1000); // Must execute 100,000 ticks under 1 second
  });
});
