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

  it('calculates Sharpe and Sortino ratios correctly using return-based metrics', () => {
    // Return-based Sharpe: stdDev of percentage returns
    // trades: [100, 100, 100, 100] on 10000 starting balance
    // Returns: 1%, 0.99%, 0.98%, 0.97% ... approx 1%
    const trades = [
      { pnl: 100, status: 'CLOSED', exit_ts: new Date('2023-01-01T10:00:00Z') },
      { pnl: 100, status: 'CLOSED', exit_ts: new Date('2023-01-01T11:00:00Z') },
    ] as TradeEntity[];

    const result = service.calculateAnalytics(trades, 10000);

    // Mean approx 1%, stdDev approx 0.005% => Sharpe should be high
    expect(result.sharpeRatio).toBeGreaterThan(10);
    expect(result.sortinoRatio).toBe(0);
  });

  it('calculates return-based averages correctly', () => {
    const trades = [
      { pnl: 100, status: 'CLOSED', exit_ts: new Date('2023-01-01T10:00:00Z') }, // 1% of 10000
      { pnl: -50, status: 'CLOSED', exit_ts: new Date('2023-01-01T11:00:00Z') }, // -0.495% of 10100
    ] as TradeEntity[];

    const result = service.calculateAnalytics(trades, 10000);

    expect(result.avgWinPct).toBe(1.0);
    expect(result.avgLossPct).toBeCloseTo(0.5, 2);
    expect(result.expectancyPct).toBeCloseTo(0.25, 2); // (1 - 0.5) / 2
  });

  it('calculates risk width buckets and hold time correctly', () => {
    const trades = [
      // Tight bucket: SL dist = 0.5%
      { pnl: 10, status: 'CLOSED', entry_price: 100, initial_sl: 99.5, entry_ts: new Date('2023-01-01T10:00:00Z'), exit_ts: new Date('2023-01-01T10:05:00Z') },
      // Medium bucket: SL dist = 1.0%
      { pnl: -5, status: 'CLOSED', entry_price: 100, initial_sl: 99.0, entry_ts: new Date('2023-01-01T11:00:00Z'), exit_ts: new Date('2023-01-01T11:15:00Z') },
      // Wide bucket: SL dist = 2.0%
      { pnl: 30, status: 'CLOSED', entry_price: 100, initial_sl: 98.0, entry_ts: new Date('2023-01-01T12:00:00Z'), exit_ts: new Date('2023-01-01T13:00:00Z') },
    ] as TradeEntity[];

    const result = service.calculateAnalytics(trades, 10000);

    expect(result.riskWidthBuckets).toBeDefined();
    expect(result.riskWidthBuckets).toHaveLength(3);

    const tight = result.riskWidthBuckets!.find(b => b.label.includes('Tight'));
    const medium = result.riskWidthBuckets!.find(b => b.label.includes('Medium'));
    const wide = result.riskWidthBuckets!.find(b => b.label.includes('Wide'));

    expect(tight?.tradesCount).toBe(1);
    expect(tight?.avgDurationMs).toBe(5 * 60 * 1000); // 5 minutes
    expect(tight?.winRate).toBe(100);

    expect(medium?.tradesCount).toBe(1);
    expect(medium?.avgDurationMs).toBe(15 * 60 * 1000); // 15 minutes
    expect(medium?.winRate).toBe(0);

    expect(wide?.tradesCount).toBe(1);
    expect(wide?.avgDurationMs).toBe(60 * 60 * 1000); // 60 minutes
    expect(wide?.winRate).toBe(100);
  });
});
