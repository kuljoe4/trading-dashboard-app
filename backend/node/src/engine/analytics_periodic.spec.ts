import { AnalyticsService } from './analytics.service';
import { TradeEntity } from '../models/entities/Trade.entity';

describe('AnalyticsService Periodic Stats', () => {
  let service: AnalyticsService;

  beforeEach(() => {
    service = new AnalyticsService();
  });

  it('calculates daily, weekly, and monthly PnL correctly', () => {
    const now = new Date();

    // Trade today
    const trade1 = { pnl: 100, status: 'CLOSED', exit_ts: new Date(now) } as TradeEntity;

    // Trade yesterday (same week, same month)
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const trade2 = { pnl: 50, status: 'CLOSED', exit_ts: yesterday } as TradeEntity;

    // Trade 10 days ago (different week, same month)
    const tenDaysAgo = new Date(now);
    tenDaysAgo.setDate(tenDaysAgo.getDate() - 10);
    const trade3 = { pnl: 200, status: 'CLOSED', exit_ts: tenDaysAgo } as TradeEntity;

    // Trade 40 days ago (different month)
    const fortyDaysAgo = new Date(now);
    fortyDaysAgo.setDate(fortyDaysAgo.getDate() - 40);
    const trade4 = { pnl: 500, status: 'CLOSED', exit_ts: fortyDaysAgo } as TradeEntity;

    const result = service.calculateAnalytics([trade1, trade2, trade3, trade4], 10000);

    // Trade 1 is daily.
    // Daily PnL should be 100.
    expect(result.periodic.daily.pnl).toBe(100);

    // Trade 1 and 2 are in the same week (assuming yesterday is same week)
    // Actually, startOfWeek depends on the current day.
    // Let's check if they are same week manually for the test to be robust.
    const startOfWeek = new Date(now);
    const day = startOfWeek.getDay();
    const diff = startOfWeek.getDate() - day + (day === 0 ? -6 : 1);
    startOfWeek.setDate(diff);
    startOfWeek.setHours(0,0,0,0);

    let expectedWeekly = 100;
    if (yesterday.getTime() >= startOfWeek.getTime()) expectedWeekly += 50;
    if (tenDaysAgo.getTime() >= startOfWeek.getTime()) expectedWeekly += 200;

    expect(result.periodic.weekly.pnl).toBe(expectedWeekly);

    // Monthly
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    let expectedMonthly = 100 + 50 + 200; // trade 1, 2, 3
    expect(result.periodic.monthly.pnl).toBe(expectedMonthly);
  });

  it('generates daily and weekly history buckets', () => {
    const now = new Date();
    const t1 = { pnl: 10, status: 'CLOSED', exit_ts: new Date('2023-01-01T10:00:00Z') } as TradeEntity;
    const t2 = { pnl: 20, status: 'CLOSED', exit_ts: new Date('2023-01-01T15:00:00Z') } as TradeEntity;
    const t3 = { pnl: -5, status: 'CLOSED', exit_ts: new Date('2023-01-02T10:00:00Z') } as TradeEntity;

    const result = service.calculateAnalytics([t1, t2, t3], 1000);

    expect(result.periodicHistory.daily).toHaveLength(2);
    expect(result.periodicHistory.daily[0].label).toBe('2023-01-01');
    expect(result.periodicHistory.daily[0].pnl).toBe(30);
    expect(result.periodicHistory.daily[1].label).toBe('2023-01-02');
    expect(result.periodicHistory.daily[1].pnl).toBe(-5);

    expect(result.periodicHistory.weekly).toHaveLength(2);
    // 2023-01-01 was a Sunday.
    // In my logic: weekDate.setDate(weekDate.getDate() - (weekDate.getDay() === 0 ? 6 : weekDate.getDay() - 1));
    // For Sunday (0), it subtracts 6. So Week starts on 2022-12-26 (Monday).
    expect(result.periodicHistory.weekly[0].label).toBe('Week of 2022-12-26');
    expect(result.periodicHistory.weekly[0].pnl).toBe(30);
    expect(result.periodicHistory.weekly[1].label).toBe('Week of 2023-01-02');
    expect(result.periodicHistory.weekly[1].pnl).toBe(-5);
  });
});
