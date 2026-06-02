import { TradingSessionService } from './trading_session.service';
import { Trade } from '../models/Trade';

describe('PnL Inconsistency Verification', () => {
  let service: TradingSessionService;
  let mockSessionState: any;

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
    };

    service = new TradingSessionService(
      { getPrice: () => 101 } as any,
      {} as any,
      {} as any,
      {} as any,
      { activeList: () => [], totalRisk: () => 0, activeCount: () => 0 } as any,
      {} as any,
      {} as any,
      {} as any,
      { recordHotLoop: jest.fn(), getMetrics: jest.fn().mockReturnValue({}) } as any,
      { calculateAnalytics: () => ({ maxDrawdown: 0, maxDrawdownPct: 0, overallWinRate: 0, cumulativePnL: [] }) } as any,
      { setWsBroadcaster: jest.fn(), broadcast: jest.fn() } as any,
      mockSessionState,
      { emit: jest.fn() } as any
    );
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

    // Trigger broadcastTick
    (service as any).broadcastTick();

    const broadcastSpy = (service as any).broadcastService.broadcast;
    const tickData = broadcastSpy.mock.calls.find((call: any) => call[0] === 'tick')[1];

    expect(trade.pnl).toBe(91.96);
    expect(tickData.total_pnl).toBe(91.96);
    expect(trade.pnl).toBe(tickData.total_pnl);
  });
});
