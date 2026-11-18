import { SessionStateService } from './session_state.service';
import { SessionConfig } from '../models/SessionConfig';
import { Trade } from '../models/Trade';

describe('SessionStateService PnL Aggregation', () => {
  let service: SessionStateService;

  beforeEach(() => {
    service = new SessionStateService();
  });

  it('should correctly aggregate totalPnl from both OPEN and CLOSED trades during reset', () => {
    const config = {
        strategy_label: 'Test Strategy',
        paper_starting_balance: 10000,
        trading_mode: 'paper'
    } as SessionConfig;

    const sessionId = 'session-123';

    const trades: Trade[] = [
      {
        id: 'trade-closed-1',
        sessionId: 'session-123',
        status: 'CLOSED',
        pnl: 50.5,
        strategy_label: 'Test Strategy'
      } as Trade,
      {
        id: 'trade-closed-2',
        sessionId: 'session-123',
        status: 'CLOSED_SL',
        pnl: -20.2,
        strategy_label: 'Test Strategy'
      } as Trade,
      {
        id: 'trade-open-1',
        sessionId: 'session-123',
        status: 'OPEN',
        pnl: -0.4, // Realized fee
        strategy_label: 'Test Strategy'
      } as Trade,
      {
        id: 'trade-open-2',
        sessionId: 'session-123',
        status: 'OPEN',
        pnl: 5.1, // Realized funding
        strategy_label: 'Test Strategy'
      } as Trade,
      {
        id: 'trade-other-session',
        sessionId: 'other-session',
        status: 'CLOSED',
        pnl: 100,
        strategy_label: 'Test Strategy'
      } as Trade
    ];

    // Reset with history containing mixed trades
    // Note: SessionStateService.reset signature is (config, initialHistory, currentBalance, sessionId, initialOpen)
    // In our case, we pass all trades as initialHistory and separately as initialOpen for open ones if needed,
    // but the code actually does [...initialHistory, ...initialOpen] and filters by sessionId.

    const history = trades.filter(t => t.status !== 'OPEN');
    const openTrades = trades.filter(t => t.status === 'OPEN');

    service.reset(config, history, 10000, sessionId, openTrades);

    // Expected totalPnl = 50.5 + (-20.2) + (-0.4) + 5.1 = 35.0
    expect(service.stats.totalPnl).toBe(35.0);

    // Win rate check: 1 win out of 2 closed non-reconciliation trades
    expect(service.stats.hitCount).toBe(1);
    expect(service.stats.entryCount).toBe(4); // 4 trades in session-123

    // Strategy-specific stats check (only closed trades are stored in cachedClosedTradesStats)
    const strategyStats = service.cachedClosedTradesStats['Test Strategy'];
    expect(strategyStats).toBeDefined();
    expect(strategyStats.pnl).toBe(30.3);
    expect(strategyStats.count).toBe(2);
    expect(strategyStats.hits).toBe(1);
  });

  it('should coerce PostgreSQL string decimal PnL values without producing NaN or 0 on resumed sessions', () => {
    const config = {
      strategy_label: 'Decimal Strategy',
      paper_starting_balance: 10000,
      trading_mode: 'paper'
    } as SessionConfig;

    const sessionId = 'session-decimal-1';
    const history: Trade[] = [
      {
        id: 'pg-closed-1',
        sessionId,
        status: 'CLOSED_TP',
        pnl: '12.34500000' as unknown as number,
        strategy_label: 'Decimal Strategy'
      } as Trade,
      {
        id: 'pg-closed-2',
        sessionId,
        status: 'CLOSED_SL',
        pnl: '-4.20000000' as unknown as number,
        strategy_label: 'Decimal Strategy'
      } as Trade
    ];
    const openTrades: Trade[] = [
      {
        id: 'pg-open-1',
        sessionId,
        status: 'OPEN',
        pnl: '1.50000000' as unknown as number,
        strategy_label: 'Decimal Strategy'
      } as Trade
    ];

    service.reset(config, history, 10000, sessionId, openTrades);

    expect(service.stats.totalPnl).toBe(9.645);
    expect(service.cachedClosedTradesStats['Decimal Strategy'].pnl).toBe(8.145);

    service.addClosedTrade({
      id: 'pg-closed-3',
      sessionId,
      status: 'CLOSED',
      pnl: '3.10000000' as unknown as number,
      strategy_label: 'Decimal Strategy'
    } as Trade);

    expect(service.cachedClosedTradesStats['Decimal Strategy'].pnl).toBe(11.245);

    service.rollbackClosedTrade({
      id: 'pg-closed-3',
      sessionId,
      status: 'CLOSED',
      pnl: '3.10000000' as unknown as number,
      strategy_label: 'Decimal Strategy'
    } as Trade);

    expect(service.cachedClosedTradesStats['Decimal Strategy'].pnl).toBe(8.145);
  });
});
