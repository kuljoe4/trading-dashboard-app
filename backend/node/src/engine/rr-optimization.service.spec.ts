import { RrOptimizationService } from './rr-optimization.service';
import { TradeEntity } from '../models/entities/Trade.entity';

describe('RrOptimizationService', () => {
  let service: RrOptimizationService;

  beforeEach(() => {
    service = new RrOptimizationService();
  });

  it('returns INSUFFICIENT_DATA status for small sample sizes', () => {
    const trades = Array(10).fill({
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
});
