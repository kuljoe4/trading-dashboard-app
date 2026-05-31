import { TradingSessionService } from './trading_session.service';
import { Trade } from '../models/Trade';

describe('PnL Inconsistency Reproduction', () => {
  let service: TradingSessionService;
  let mockTickerCache: any;
  let mockPositionTracker: any;
  let mockAnalyticsService: any;
  let mockMonitoringService: any;
  let mockOrderManager: any;
  let mockMarketFeed: any;
  let mockMomentumScanner: any;

  beforeEach(() => {
    mockTickerCache = { getPrice: jest.fn() };
    mockPositionTracker = {
      activeList: jest.fn().mockReturnValue([]),
      activeCount: jest.fn().mockReturnValue(0),
      totalRisk: jest.fn().mockReturnValue(0),
      setTradeUpdateCallback: jest.fn()
    };
    mockAnalyticsService = { calculateAnalytics: jest.fn().mockReturnValue({
      maxDrawdown: 0, maxDrawdownPct: 0, overallWinRate: 0, cumulativePnL: []
    }) };
    mockMonitoringService = { getMetrics: jest.fn().mockReturnValue({}), recordHotLoop: jest.fn(), recordMainLoop: jest.fn() };
    mockOrderManager = { setBinanceClient: jest.fn() };
    mockMarketFeed = { setCandeCloseCallback: jest.fn(), start: jest.fn(), stop: jest.fn() };
    mockMomentumScanner = { start: jest.fn(), stop: jest.fn() };

    service = new TradingSessionService(
      mockTickerCache,
      {} as any,
      {} as any,
      { canEnter: () => ({ canEnter: true, reason: '' }) } as any,
      mockPositionTracker,
      mockOrderManager,
      mockMarketFeed,
      mockMomentumScanner,
      mockMonitoringService,
      mockAnalyticsService,
    );
  });

  it('demonstrates PnL divergence due to exchange fees', async () => {
    const startingBalance = 1000;
    const config: any = {
      paper_mode: false,
      trading_mode: 'live',
      live_starting_balance: startingBalance,
    };

    // Initialize session
    await service.start(config, null, 'session-123', [], startingBalance);

    // Mock a trade that closed with $10 profit but incurred $1 fee
    // Gross PnL = $10. Net balance change = $9.
    const trade = {
      id: 'trade-1',
      symbol: 'BTCUSDT',
      pnl: 10, // Gross PnL (as calculated by OrderManager)
    } as Trade;

    // Simulate updateBalance with fee-deducted balance from Binance
    const fee = 1;
    const newBalance = startingBalance + trade.pnl - fee; // 1000 + 10 - 1 = 1009

    // We override fetchBinanceBalance to return 1009
    (service as any).fetchBinanceBalance = jest.fn().mockResolvedValue(newBalance);

    await (service as any).updateBalance(trade);

    // Now check the engine's totalPnl calculation (it should be 9)
    // We need to trigger broadcastTick or access the logic
    (service as any).listenerCount = 1; // Enable broadcasting
    let capturedTick: any;
    service.setWsBroadcaster((data) => {
      if (data.type === 'tick') capturedTick = data;
    });

    (service as any).broadcastTick();

    expect(capturedTick.balance).toBe(1009);
    expect(capturedTick.total_pnl).toBe(9); // 1009 - 1000

    // Compare with the sum of trades PnL (which is 10)
    const sumOfTradesPnl = trade.pnl;
    expect(capturedTick.total_pnl).not.toBe(sumOfTradesPnl);

    console.log(`Engine totalPnl: ${capturedTick.total_pnl}`);
    console.log(`Sum of trades PnL: ${sumOfTradesPnl}`);
    console.log(`Divergence (Fee): ${sumOfTradesPnl - capturedTick.total_pnl}`);
  });
});
