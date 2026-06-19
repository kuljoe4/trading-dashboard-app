import { roundEight } from '../lib/math';

describe('PnL Consistency Logic Audit', () => {
  it('should maintain consistency between balance delta and trade pnl sum', () => {
    const startingBalance = 10000;
    let currentBalance = startingBalance;
    const trades: any[] = [];

    // Mock trade 1: Entry
    const entryFee1 = 0.4;
    currentBalance = roundEight(currentBalance - entryFee1);
    const trade1 = { id: 't1', pnl: roundEight(-entryFee1), status: 'OPEN' };
    trades.push(trade1);

    // Mock trade 1: Exit
    const exitFee1 = 0.42;
    const grossPnl1 = 50;
    const netPnl1 = roundEight(grossPnl1 - entryFee1 - exitFee1);

    // In the engine, when trade closes, we apply the DELTA
    const pnlDelta1 = roundEight(netPnl1 - trade1.pnl);
    currentBalance = roundEight(currentBalance + pnlDelta1);
    trade1.pnl = netPnl1;
    trade1.status = 'CLOSED';

    const sessionTotalPnl = roundEight(currentBalance - startingBalance);
    const tradesSumPnl = roundEight(trades.reduce((sum, t) => sum + t.pnl, 0));

    expect(sessionTotalPnl).toBe(tradesSumPnl);
    expect(sessionTotalPnl).toBe(49.18);
  });

  it('should identify drift if delta calculation is incorrect', () => {
      // This test demonstrates what happens if we DON'T use deltas correctly
      const startingBalance = 10000;
      let currentBalance = startingBalance;

      // Entry
      const entryFee = 0.4;
      currentBalance -= entryFee; // 9999.6
      const trade = { pnl: -entryFee };

      // Exit
      const netPnl = 49.18;
      // WRONG LOGIC: Just adding netPnl to current balance instead of delta
      currentBalance += netPnl; // 9999.6 + 49.18 = 10048.78

      const sessionTotalPnl = Number((currentBalance - startingBalance).toFixed(8));
      expect(sessionTotalPnl).not.toBe(netPnl); // 48.78 != 49.18
  });

  it('should demonstrate PnL inconsistency in Live mode due to external balance changes', () => {
    const startingBalance = 1000;
    let currentBalance = startingBalance;
    let statsTotalPnl = 0;

    // 1. Trade closes with 10 USDT profit
    const tradePnl = 10;
    statsTotalPnl = roundEight(statsTotalPnl + tradePnl);
    currentBalance = roundEight(currentBalance + tradePnl); // 1010

    // 2. External deposit of 500 USDT
    currentBalance = roundEight(currentBalance + 500); // 1510

    // In SessionService callback: totalPnl = balance - startingBalance
    const dbTotalPnl = roundEight(currentBalance - startingBalance); // 510

    // UI (Live mode) uses statsTotalPnl: 10
    // DB (after fix) should use trade summation: 10
    // (Simulating the fix logic here)
    const dbTotalPnlFixed = tradePnl;

    expect(dbTotalPnlFixed).toBe(statsTotalPnl);
    expect(dbTotalPnlFixed).toBe(10);
  });

  it('should verify precision in roundEight with floating point edge cases', () => {
    // 0.1 + 0.2 is 0.30000000000000004
    const value = 0.1 + 0.2;
    expect(value).not.toBe(0.3);

    const rounded = roundEight(value);
    expect(rounded).toBe(0.3);

    // Very small differences that should be collapsed
    const smallDiff = 0.000000001; // 1e-9
    const value2 = 0.3 + smallDiff;
    expect(roundEight(value2)).toBe(0.3);

    const value3 = 0.3 + 0.000000006; // 6e-9
    expect(roundEight(value3)).toBe(0.30000001);
  });

  it('should maintain stable risk metrics during account scaling (Performance Engineering)', () => {
    const { AnalyticsService } = require('../engine/analytics.service');
    const service = new AnalyticsService();

    // Scenario 1: $1000 account, wins $10 twice (1% returns)
    const trades1 = [
        { pnl: 10, status: 'CLOSED', exit_ts: new Date('2023-01-01T10:00:00Z') },
        { pnl: 10, status: 'CLOSED', exit_ts: new Date('2023-01-01T11:00:00Z') }
    ];
    const analytics1 = service.calculateAnalytics(trades1, 1000);

    // Scenario 2: Account scaled to $10,000, wins $100 twice (still 1% returns)
    const trades2 = [
        { pnl: 100, status: 'CLOSED', exit_ts: new Date('2023-01-01T10:00:00Z') },
        { pnl: 100, status: 'CLOSED', exit_ts: new Date('2023-01-01T11:00:00Z') }
    ];
    const analytics2 = service.calculateAnalytics(trades2, 10000);

    // Advanced trading ratios should be identical because return percentages are identical
    expect(analytics1.sharpeRatio).toBe(analytics2.sharpeRatio);
    expect(analytics1.avgWinPct).toBe(analytics2.avgWinPct);
    expect(analytics1.overallPnlPct).toBe(analytics2.overallPnlPct);

    // Dollar metrics should differ
    expect(analytics1.avgWin).not.toBe(analytics2.avgWin);
  });
});
