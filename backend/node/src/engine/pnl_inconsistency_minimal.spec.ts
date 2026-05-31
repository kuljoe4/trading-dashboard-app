import { TradingSessionService } from './trading_session.service';
import { Trade } from '../models/Trade';

describe('PnL Inconsistency Minimal Reproduction', () => {
  let service: TradingSessionService;
  let mockPositionTracker: any;

  beforeEach(() => {
    mockPositionTracker = {
      activeList: jest.fn().mockReturnValue([]),
      activeCount: jest.fn().mockReturnValue(0),
      totalRisk: jest.fn().mockReturnValue(0),
      setTradeUpdateCallback: jest.fn()
    };

    service = new TradingSessionService(
      { getPrice: jest.fn() } as any,
      {} as any,
      { checkEntry: jest.fn() } as any,
      { canEnter: () => ({ canEnter: true, reason: '' }) } as any,
      mockPositionTracker,
      { setBinanceClient: jest.fn() } as any,
      { setCandeCloseCallback: jest.fn(), start: jest.fn(), stop: jest.fn(), updateWatchlist: jest.fn() } as any,
      { start: jest.fn(), stop: jest.fn() } as any,
      { getMetrics: jest.fn().mockReturnValue({}), recordHotLoop: jest.fn(), recordMainLoop: jest.fn() } as any,
      { calculateAnalytics: jest.fn().mockReturnValue({
        maxDrawdown: 0, maxDrawdownPct: 0, overallWinRate: 0, cumulativePnL: []
      }) } as any,
    );
  });

  afterEach(async () => {
    await service.stop();
  });

  it('proves that engine totalPnl includes fees while individual trade.pnl does not', async () => {
    const startingBalance = 1000;
    const config: any = {
      paper_mode: false,
      trading_mode: 'live',
      live_starting_balance: startingBalance,
      hot_loop_interval_ms: 100000,
      main_loop_interval_ms: 100000,
    };

    // Initialize session with a mock binanceClient
    const mockBinanceClient = { restAPI: { accountApi: { futuresAccountBalanceV2: jest.fn() } } };
    await service.start(config, mockBinanceClient, 'session-123', [], startingBalance);

    // Mock a trade that closed with $10 profit but incurred $1 fee
    const trade = {
      id: 'trade-1',
      symbol: 'BTCUSDT',
      pnl: 10, // Gross PnL
    } as Trade;

    // Simulate updateBalance with fee-deducted balance from Binance
    const fee = 1;
    const newBalance = startingBalance + trade.pnl - fee; // 1009

    (service as any).fetchBinanceBalance = jest.fn().mockResolvedValue(newBalance);
    await (service as any).updateBalance(trade);

    // Trigger tick broadcast
    (service as any).listenerCount = 1;
    let capturedTick: any;
    service.setWsBroadcaster((data) => {
      if (data.type === 'tick') capturedTick = data;
    });

    (service as any).broadcastTick();

    expect(capturedTick.balance).toBe(1009);
    expect(capturedTick.total_pnl).toBe(9); // Correct: net PnL

    // Divergence: trade.pnl (10) != total_pnl (9)
    expect(trade.pnl).toBe(10);
    expect(capturedTick.total_pnl).toBe(9);
  });
});
