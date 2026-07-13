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

  it('recommends an optimal RR based on MFE sweep', () => {
    const trades: Partial<TradeEntity>[] = [];

    for (let i = 0; i < 20; i++) {
      trades.push({
        status: 'CLOSED',
        exit_ts: new Date(),
        max_rr_achieved: 2.2,
        risk_usdt: 10,
        initial_risk_usdt: 10,
        pnl: -10,
        is_reconciliation: false
      });
    }

    for (let i = 0; i < 10; i++) {
        trades.push({
            status: 'CLOSED',
            exit_ts: new Date(),
            max_rr_achieved: 1.1,
            risk_usdt: 10,
            initial_risk_usdt: 10,
            pnl: -10,
            is_reconciliation: false
        });
    }

    const result = service.calculateRrOptimization(trades as TradeEntity[]);

    expect(result.status).toBe('OPTIMAL');
    expect(result.sampleSize).toBe(30);
    expect(result.recommendedRr).toBeGreaterThan(0);
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
    // curve[0] is the 0.1R threshold
    expect(result.curve[0].threshold).toBe(0.1);
    expect(result.curve[0].scratches).toBe(30);
    expect(result.curve[0].wins).toBe(0);
  });
});
