import { TradingSessionService } from './trading_session.service';
import { Trade } from '../models/Trade';
import { EngineBroadcasterService } from './engine-broadcaster.service';

describe('PnL Inconsistency Verification', () => {
  let service: TradingSessionService;
  let mockSessionState: any;
  let broadcaster: EngineBroadcasterService;

  beforeEach(() => {
    mockSessionState = {
      balancePaper: 10000,
      balanceLive: 10000,
      closedTrades: [],
      stats: { entryCount: 0, hitCount: 0 },
      statsVersion: 0,
      listenerCount: 1, // Ensure broadcast proceeds
      getBalance: (paper: boolean) => paper ? mockSessionState.balancePaper : mockSessionState.balanceLive,
      addClosedTrade: (t: Trade) => { mockSessionState.closedTrades.push(t); },
      updateStatsOnClose: jest.fn(),
      cachedClosedTradesStats: {},
      getBinanceRateLimit: jest.fn().mockReturnValue({}),
      isRateLimited: jest.fn().mockReturnValue(false),
      isEcoMode: jest.fn().mockReturnValue(false),
      updateRateLimit: jest.fn(),
    };

    const tickerCache = { getPrice: () => 101 };
    const broadcastService = { setWsBroadcaster: jest.fn(), broadcast: jest.fn() };
    broadcaster = new EngineBroadcasterService(
      tickerCache as any,
      mockSessionState,
      { recordHotLoop: jest.fn(), getMetrics: jest.fn().mockReturnValue({}) } as any,
      { calculateAnalytics: () => ({}) } as any,
      broadcastService as any,
      {} as any
    );

    service = new TradingSessionService(
      tickerCache as any,
      {} as any,
      {} as any,
      {} as any,
      { activeList: () => [], totalRisk: () => 0, activeCount: () => 0 } as any,
      {} as any,
      {} as any,
      {} as any,
      { recordHotLoop: jest.fn(), getMetrics: jest.fn().mockReturnValue({}) } as any,
      { calculateAnalytics: () => ({ maxDrawdown: 0, maxDrawdownPct: 0, overallWinRate: 0, cumulativePnL: [] }) } as any,
      broadcastService as any,
      mockSessionState,
      {} as any,
      broadcaster,
      {} as any,
      { emit: jest.fn() } as any
    );

    (service as any).config = { paper_mode: true };
  });

  it('should verify that individual trade PnL accounts for fees and matches session PnL', async () => {
    const trade: Trade = {
      id: 'test-1',
      symbol: 'BTCUSDT',
      direction: 'LONG',
      entry_price: 100,
      qty: 100,
      status: 'OPEN',
      realized_fee: 8.04,
      strategy_label: 'Momentum Strategy'
    } as any;

    (service as any).positionTracker = {
       activeList: () => [trade],
       activeCount: () => 1,
       totalRisk: () => 0
    };

    (service as any).tickerCache = { getPrice: () => 101 };

    mockSessionState.balanceLive = 10000 + 91.96;

    // Trigger tick via broadcaster
    broadcaster.broadcastTick(
      [trade],
      (service as any).config,
      (service as any).getStrategyConfigs(),
      false,
      () => [],
      () => ({})
    );

    const broadcastSpy = (service as any).broadcastService.broadcast;
    const tickData = broadcastSpy.mock.calls.find((call: any) => call[0] === 'tick')[1];

    expect(trade.pnl).toBe(91.96);
    expect(tickData.total_pnl).toBe(91.96);
    expect(trade.pnl).toBe(tickData.total_pnl);
  });
});
