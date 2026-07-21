import { SessionStateService } from './session_state.service';
import { Trade } from '../models/Trade';
import { SessionConfig } from '../models/SessionConfig';

describe('SessionStateService Rollback and Data Integrity', () => {
  let sessionState: SessionStateService;

  beforeEach(() => {
    sessionState = new SessionStateService();
    const config = {
      paper_mode: true,
      trading_mode: 'paper',
      strategy_label: 'Test Strategy'
    } as SessionConfig;

    sessionState.reset(config, [], 10000);
  });

  it('should fully and consistently revert all global/strategy stats, tracking sets, and P&L maps on rollback', () => {
    const trade = {
      id: 'trade-test-1',
      symbol: 'BTCUSDT',
      strategy_label: 'Test Strategy',
      pnl: 150.0,
      status: 'CLOSED_SIGNAL',
      is_reconciliation: false,
    } as Trade;

    // 1. Initially, stats should be empty/zeroed out
    expect(sessionState.stats.entryCount).toBe(0);
    expect(sessionState.stats.hitCount).toBe(0);
    expect(sessionState.stats.totalPnl).toBe(0);

    // 2. Simulate closing a winning trade
    sessionState.updateStatsOnEntry(trade.id);
    sessionState.updateStatsOnClose(true, trade.pnl, false, trade.id);
    sessionState.addClosedTrade(trade);

    // Assert stats updated correctly
    expect(sessionState.stats.entryCount).toBe(1);
    expect(sessionState.stats.hitCount).toBe(1);
    expect(sessionState.stats.totalPnl).toBe(150.0);

    const strategyStats = sessionState.cachedClosedTradesStats['Test Strategy'];
    expect(strategyStats).toBeDefined();
    expect(strategyStats.count).toBe(1);
    expect(strategyStats.hits).toBe(1);
    expect(strategyStats.pnl).toBe(150.0);

    // Verify tracking sets/maps are populated (using any casts to inspect private properties)
    const stateAny = sessionState as any;
    expect(stateAny.countedGlobalEntries.has(trade.id)).toBe(true);
    expect(stateAny.countedGlobalHits.has(trade.id)).toBe(true);
    expect(stateAny.countedStrategyEntries.has(trade.id)).toBe(true);
    expect(stateAny.countedStrategyHits.has(trade.id)).toBe(true);
    expect(stateAny.appliedGlobalPnL.get(trade.id)).toBe(150.0);
    expect(stateAny.appliedStrategyPnL.get(trade.id)).toBe(150.0);

    // 3. Rollback the closed trade
    sessionState.rollbackClosedTrade(trade);

    // 4. Assert all stats and tracking collections are fully reverted
    expect(sessionState.stats.entryCount).toBe(0);
    expect(sessionState.stats.hitCount).toBe(0);
    expect(sessionState.stats.totalPnl).toBe(0);

    expect(strategyStats.count).toBe(0);
    expect(strategyStats.hits).toBe(0);
    expect(strategyStats.pnl).toBe(0);

    expect(stateAny.countedGlobalEntries.has(trade.id)).toBe(false);
    expect(stateAny.countedGlobalHits.has(trade.id)).toBe(false);
    expect(stateAny.countedStrategyEntries.has(trade.id)).toBe(false);
    expect(stateAny.countedStrategyHits.has(trade.id)).toBe(false);
    expect(stateAny.appliedGlobalPnL.has(trade.id)).toBe(false);
    expect(stateAny.appliedStrategyPnL.has(trade.id)).toBe(false);

    expect(sessionState.closedTrades).toHaveLength(0);
  });
});
