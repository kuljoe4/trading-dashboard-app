import { SessionStateService } from './session_state.service';
import { TradingSessionService } from './trading_session.service';
import { SessionConfig } from '../models/SessionConfig';
import { Trade } from '../models/Trade';
import { roundEight } from '../lib/math';

describe('PnL Reporting Alignment (Two-Tier)', () => {
  let sessionState: SessionStateService;
  let tradingSessionService: TradingSessionService;

  beforeEach(() => {
    sessionState = new SessionStateService();
    tradingSessionService = new TradingSessionService(
      {} as any, {} as any, {} as any, {} as any,
      { activeList: () => sessionState.activeTrades, activeCount: () => sessionState.activeTrades.length, totalRisk: () => 0, recalculateTotalRisk: jest.fn() } as any,
      {} as any, {} as any, {} as any,
      { recordHotLoop: jest.fn(), recordMainLoop: jest.fn() } as any,
      {} as any, {} as any, {} as any,
      { setWsBroadcaster: jest.fn(), broadcast: jest.fn() } as any,
      sessionState,
      { calculateVariantStats: jest.fn().mockReturnValue({}) } as any,
      { serializeTrade: (t: any) => {
          const direction = t.direction || 'LONG';
          const entry = t.entry_price || 0;
          const mark = t.mark_price || entry;
          const marketPnl = roundEight(direction === 'LONG' ? (mark - entry) * t.qty : (entry - mark) * t.qty);
          const netPnl = roundEight(marketPnl - (t.realized_fee || 0) - (t.funding_fee || 0));
          return { ...t, market_pnl: marketPnl, net_pnl: netPnl };
      }, minimize: jest.fn(), getLastTickData: jest.fn(), getLastRiskResult: jest.fn(), getLastAnalyticsResult: jest.fn() } as any,
      {} as any, {} as any, {} as any,
      { emit: jest.fn() } as any
    );
  });

  it('should report header total_pnl as strictly CLOSED while active trades show tiered Market vs Net', async () => {
    const config = new SessionConfig();
    config.paper_mode = false;
    config.trading_mode = 'live';
    config.live_starting_balance = 1000;

    sessionState.reset(config, [], 1000, 'session-1');
    (tradingSessionService as any).config = config;
    (tradingSessionService as any).running = true;

    // Simulate an open trade with a 1 USDT fee, just opened (price hasn't moved)
    const openTrade: Partial<Trade> = {
      id: 'trade-1',
      symbol: 'BTCUSDT',
      status: 'OPEN',
      pnl: 0, // Engine PnL for open trade is Market Gain
      realized_fee: 1,
      entry_price: 50000,
      mark_price: 50000,
      qty: 0.1,
      direction: 'LONG'
    };

    sessionState.activeTrades = [openTrade as Trade];
    sessionState.balanceLive = 999;

    let status = tradingSessionService.getStatus();

    // Header should be 0 (Closed Only)
    expect(status.total_pnl).toBe(0);

    // Active trade breakdown
    const serialized = status.activeTrades[0];
    expect(serialized.market_pnl).toBe(0); // Price move is 0
    expect(serialized.net_pnl).toBe(-1); // Market (0) - Fee (1)
  });
});
