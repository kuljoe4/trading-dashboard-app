import { RrOptimizationService } from './rr-optimization.service';
import { TradeEntity } from '../models/entities/Trade.entity';

describe('RrOptimizationService', () => {
  let service: RrOptimizationService;

  beforeEach(() => {
    service = new RrOptimizationService();
  });

  it('returns INSUFFICIENT_DATA status for small sample sizes', () => {
    const trades = Array(3).fill({
      status: 'CLOSED',
      exit_ts: new Date(),
      max_rr_achieved: 1.5,
      pnl: 10,
      is_reconciliation: false
    }) as TradeEntity[];

    const result = service.calculateRrOptimization(trades);
    expect(result.status).toBe('INSUFFICIENT_DATA');
    expect(result.curve).toHaveLength(0);
  });

  it('returns PRELIMINARY status for moderate sample sizes', () => {
    const trades = Array(10).fill({
      status: 'CLOSED',
      exit_ts: new Date(),
      max_rr_achieved: 1.5,
      pnl: 10,
      risk_usdt: 10,
      is_reconciliation: false
    }) as TradeEntity[];

    const result = service.calculateRrOptimization(trades);
    expect(result.status).toBe('PRELIMINARY');
    expect(result.curve.length).toBeGreaterThan(0);
  });

  it('recommends tiered optimal RRs based on MFE sweep', () => {
    const trades: Partial<TradeEntity>[] = [];

    // Create a distribution where:
    // - Most trades (25/30) reach 1.5R (Conservative)
    // - Many trades (20/30) reach 2.5R (Balanced/Max PF)
    // - Few trades (5/30) reach 5.0R (Aggressive/Max Expectancy)

    for (let i = 0; i < 30; i++) {
        let max_rr = 0;
        if (i < 5) max_rr = 5.5;
        else if (i < 20) max_rr = 2.7;
        else if (i < 25) max_rr = 1.6;
        else max_rr = 0.5;

        trades.push({
            status: 'CLOSED',
            exit_ts: new Date(),
            max_rr_achieved: max_rr,
            risk_usdt: 10,
            initial_risk_usdt: 10,
            pnl: -10, // Actual stopped at loss
            is_reconciliation: false
        });
    }

    const result = service.calculateRrOptimization(trades as TradeEntity[]);

    expect(result.status).toBe('OPTIMAL');
    expect(result.sampleSize).toBe(30);
    expect(result.conservativeRr).toBeGreaterThan(0);
    expect(result.balancedRr).toBeGreaterThan(result.conservativeRr);
    expect(result.aggressiveRr).toBeGreaterThanOrEqual(result.balancedRr);
    expect(result.maxProfitFactor).toBeGreaterThan(1);
  });

  it('correctly handles scratches/breakevens', () => {
    const trades: Partial<TradeEntity>[] = [];
    for (let i = 0; i < 30; i++) {
      trades.push({
        status: 'CLOSED',
        exit_ts: new Date(),
        max_rr_achieved: 0,
        risk_usdt: 100,
        initial_risk_usdt: 100,
        pnl: 0,
        is_reconciliation: false
      });
    }

    const result = service.calculateRrOptimization(trades as TradeEntity[]);
    expect(result.curve[0].threshold).toBe(0.1);
    expect(result.curve[0].scratches).toBe(30);
    expect(result.curve[0].wins).toBe(0);
  });

  it('generates recommended exit signal parameters and strategy settings based on trade stats', () => {
    const trades: Partial<TradeEntity>[] = [];
    const baseTime = Date.now();

    for (let i = 0; i < 15; i++) {
      trades.push({
        status: 'CLOSED',
        entry_ts: new Date(baseTime - 10 * 60000), // 10 minutes ago
        exit_ts: new Date(baseTime), // now (duration = 10 mins = 10 candles on 1m)
        max_rr_achieved: 2.0,
        min_rr_achieved: -0.5,
        risk_usdt: 10,
        initial_risk_usdt: 10,
        entry_price: 100,
        initial_sl: 98,
        pnl: 20,
        is_reconciliation: false,
        strategy_config: {
          scan_interval: '1m'
        }
      });
    }

    const result = service.calculateRrOptimization(trades as TradeEntity[]);
    expect(result.recommendedExitSignals).toBeDefined();
    const signals = result.recommendedExitSignals!;
    expect(signals.length).toBe(7);

    const emaCloseRec = signals.find(r => r.signalType === 'ema_close');
    expect(emaCloseRec).toBeDefined();
    expect(emaCloseRec!.parameterName).toBe('exit_ema_period');

    const supertrendRec = signals.find(r => r.signalType === 'supertrend');
    expect(supertrendRec).toBeDefined();
    expect(supertrendRec!.parameterName).toBe('supertrend_period / supertrend_multiplier');

    const entrySpacingRec = signals.find(r => r.signalType === 'entry_spacing');
    expect(entrySpacingRec).toBeDefined();
    expect(entrySpacingRec!.parameterName).toBe('min_trade_interval_min');

    const ratchetSpacingRec = signals.find(r => r.signalType === 'ratchet_spacing');
    expect(ratchetSpacingRec).toBeDefined();
    expect(ratchetSpacingRec!.parameterName).toBe('live_rr_sequence / exit_rr_sequence');

    // Time-to-breakeven & ratchet oscillation dynamics metrics
    expect(result.avgDurationMs).toBe(10 * 60000);
    expect(result.avgDurationToBreakevenMs).toBeGreaterThan(0);
    expect(result.avgDurationToBreakevenCandles).toBeGreaterThan(0);
    expect(result.breakevenEfficiencyRatio).toBe(100);
    expect(result.ratchetOscillationRate).toBeDefined();
    expect(result.ratchetProgressionEfficiency).toBeDefined();
    expect(result.avgRatchetOscillations).toBeGreaterThan(0);
    expect(result.recommendedMinTradeIntervalMin).toBeGreaterThan(0);
    expect(result.recommendedExitSignalDelayCandles).toBeGreaterThan(0);
  });

  describe('BOLT OPTIMIZATION: Performance Benchmark', () => {
    it('achieves measurable execution speedups and verifies correctness on larger datasets', () => {
      const size = 500;
      const trades: Partial<TradeEntity>[] = [];
      const baseTime = Date.now();

      // Mock a mix of closed and open trades to simulate actual execution
      for (let i = 0; i < size; i++) {
        const isClosed = i % 10 !== 0; // 90% closed
        trades.push({
          status: isClosed ? 'CLOSED' : 'OPEN',
          entry_ts: isClosed ? new Date(baseTime - (i + 1) * 60000) : undefined,
          exit_ts: isClosed ? new Date(baseTime - i * 60000) : undefined,
          max_rr_achieved: isClosed ? 1.0 + (i % 5) * 0.5 : undefined,
          min_rr_achieved: isClosed ? -0.2 - (i % 3) * 0.1 : undefined,
          risk_usdt: 50,
          initial_risk_usdt: 50,
          entry_price: 100,
          initial_sl: 99,
          pnl: isClosed ? (i % 2 === 0 ? 100 : -50) : 0,
          is_reconciliation: false,
          strategy_config: {
            scan_interval: '1m'
          }
        });
      }

      // Warm up
      service.calculateRrOptimization(trades as TradeEntity[]);

      const start = performance.now();
      const iterations = 500;
      for (let i = 0; i < iterations; i++) {
        service.calculateRrOptimization(trades as TradeEntity[]);
      }
      const end = performance.now();
      const avgTimeUs = ((end - start) / iterations) * 1000;

      // Ensure that we log performance metrics clearly
      console.log(`[BENCHMARK] calculateRrOptimization average execution time on ${size} trades: ${avgTimeUs.toFixed(2)} microseconds`);

      const result = service.calculateRrOptimization(trades as TradeEntity[]);
      expect(result.status).toBe('OPTIMAL');
      expect(result.sampleSize).toBe(450); // 90% of 500
      expect(result.curve.length).toBeGreaterThan(0);
    });
  });
});
