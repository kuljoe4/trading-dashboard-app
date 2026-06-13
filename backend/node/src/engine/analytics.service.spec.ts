import { AnalyticsService } from './analytics.service';
import { TradeEntity } from '../models/entities/Trade.entity';

describe('AnalyticsService', () => {
  let service: AnalyticsService;

  beforeEach(() => {
    service = new AnalyticsService();
  });

  it('calculates cumulative PnL correctly', () => {
    const trades = [
      { pnl: 10, status: 'CLOSED', exit_ts: new Date('2023-01-01T10:00:00Z') },
      { pnl: -5, status: 'CLOSED', exit_ts: new Date('2023-01-01T11:00:00Z') },
      { pnl: 20, status: 'CLOSED', exit_ts: new Date('2023-01-01T12:00:00Z') },
    ] as TradeEntity[];

    const result = service.calculateAnalytics(trades, 100);

    expect(result.cumulativePnL).toHaveLength(3);
    expect(result.cumulativePnL[0].pnl).toBe(10);
    expect(result.cumulativePnL[1].pnl).toBe(5);
    expect(result.cumulativePnL[2].pnl).toBe(25);
    expect(result.totalTrades).toBe(3);
    expect(result.overallWinRate).toBeCloseTo(66.67, 1);
    expect(result.avgWin).toBe(15); // (10 + 20) / 2
    expect(result.avgLoss).toBe(5);  // |-5| / 1
    expect(result.avgWinLossRatio).toBe(3); // 15 / 5
  });

  it('calculates max drawdown correctly', () => {
    const trades = [
      { pnl: 100, status: 'CLOSED', exit_ts: new Date('2023-01-01T10:00:00Z') },
      { pnl: -50, status: 'CLOSED', exit_ts: new Date('2023-01-01T11:00:00Z') },
      { pnl: -20, status: 'CLOSED', exit_ts: new Date('2023-01-01T12:00:00Z') },
      { pnl: 10, status: 'CLOSED', exit_ts: new Date('2023-01-01T13:00:00Z') },
    ] as TradeEntity[];

    const result = service.calculateAnalytics(trades, 1000);

    expect(result.maxDrawdown).toBe(70);
    // Peak was 1100. Drawdown was 70. 70 / 1100 = ~6.36%
    expect(result.maxDrawdownPct).toBeCloseTo(6.36, 1);
  });

  it('calculates time of day performance correctly (UTC)', () => {
    const trades = [
      { pnl: 10, status: 'CLOSED', exit_ts: new Date('2023-01-01T10:30:00Z') },
      { pnl: 20, status: 'CLOSED', exit_ts: new Date('2023-01-01T10:45:00Z') },
      { pnl: -5, status: 'CLOSED', exit_ts: new Date('2023-01-01T15:00:00Z') },
    ] as TradeEntity[];

    const result = service.calculateAnalytics(trades);

    const hour10 = result.timeOfDay.find(t => t.hour === 10);
    const hour15 = result.timeOfDay.find(t => t.hour === 15);

    expect(hour10?.total).toBe(2);
    expect(hour10?.pnl).toBe(30);
    expect(hour15?.total).toBe(1);
    expect(hour15?.pnl).toBe(-5);
  });
});
