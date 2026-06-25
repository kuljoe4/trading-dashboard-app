import { EngineBroadcasterService } from './engine-broadcaster.service';
import { Trade } from '../models/Trade';
import { SessionConfig } from '../models/SessionConfig';

describe('EngineBroadcasterService BOLT Optimizations', () => {
  let service: EngineBroadcasterService;
  let tickerCache: any;
  let sessionState: any;
  let monitoringService: any;
  let analyticsService: any;
  let broadcastService: any;
  let variantAnalytics: any;
  let riskEngine: any;
  let positionTracker: any;

  beforeEach(() => {
    tickerCache = { getPrice: jest.fn() };
    sessionState = { listenerCount: 1, closedTrades: [], getBalance: jest.fn().mockReturnValue(10000), stats: {}, apiStatus: {}, statsVersion: 1, cachedClosedTradesStats: {} };
    monitoringService = { getMetrics: jest.fn().mockReturnValue({}) };
    analyticsService = { calculateAnalytics: jest.fn().mockReturnValue({}) };
    broadcastService = { broadcast: jest.fn() };
    variantAnalytics = {};
    riskEngine = { canEnter: jest.fn().mockReturnValue({ reason: 'OK' }) };
    positionTracker = { activeList: jest.fn().mockReturnValue([]), totalRisk: jest.fn().mockReturnValue(0) };

    service = new EngineBroadcasterService(
      tickerCache,
      sessionState,
      monitoringService,
      analyticsService,
      broadcastService,
      variantAnalytics,
      riskEngine,
      positionTracker
    );
  });

  describe('serializeTickTrade', () => {
    it('should correctly serialize a trade into TickTradeDto', () => {
      const trade = new Trade();
      trade.id = 't1';
      trade.symbol = 'BTCUSDT';
      trade.entry_price = 50000;
      trade.qty = 0.1;
      trade.direction = 'LONG';
      trade.current_sl = 49000;
      trade.realized_fee = 2;
      trade._sig_json = '{"s1":true}';

      const config = { strategy_label: 'Test' } as SessionConfig;
      const current = 51000;
      const pnl = 100;
      const rr = 1.0;

      const result = service.serializeTickTrade(trade, config, current, pnl, rr);

      expect(result.id).toBe('t1');
      expect(result.pnl).toBe(100);
      expect(result.rr).toBe(1);
      expect(result.pnl_pct).toBe(2); // ((51000-50000)/50000) * 100
      expect(result._sig_json).toBe('{"s1":true}');
      expect(result._thin).toBe(true);
    });
  });

  describe('broadcastTick delta tracking', () => {
    it('should reuse objects in lastSentTrades if no significant change occurred', () => {
      const trade = new Trade();
      trade.id = 't1';
      trade.symbol = 'BTCUSDT';
      trade.entry_price = 50000;
      trade.qty = 0.1;
      trade.direction = 'LONG';
      trade.risk_usdt = 100;
      trade.current_sl = 49000;
      trade._sig_json = '{}';

      tickerCache.getPrice.mockReturnValue(50000);

      // 1. Initial broadcast (heartbeat)
      (service as any).lastTickTime = Date.now() - 20000;
      service.broadcastTick([trade], {} as any, [], false, () => [], () => ({}));

      const firstTick = broadcastService.broadcast.mock.calls[0][1];
      expect(firstTick.trades).toHaveLength(1);
      const firstTradeObj = firstTick.trades[0];

      // 2. Second broadcast - NO SIGNIFICANT CHANGE
      broadcastService.broadcast.mockClear();
      (service as any).lastTickTime = Date.now();
      (service as any).lastTickData = { ...firstTick, total_pnl: 0 };
      sessionState.getBalance.mockReturnValue(10000);
      sessionState.gateState = 'max_trades'; // Trigger broadcast

      service.broadcastTick([trade], {} as any, [], false, () => [], () => ({}));
      const secondTick = broadcastService.broadcast.mock.calls[0][1];

      expect(secondTick.trades).toHaveLength(0);

      // 3. Third broadcast with significant price change
      tickerCache.getPrice.mockReturnValue(51000);
      service.broadcastTick([trade], {} as any, [], false, () => [], () => ({}));

      const thirdTick = broadcastService.broadcast.mock.calls[1][1];
      expect(thirdTick.trades).toHaveLength(1);
      expect(thirdTick.trades[0]).not.toBe(firstTradeObj);
    });

    it('should prune closed trades from lastSentTrades', () => {
        const trade1 = new Trade(); trade1.id = 't1'; trade1.symbol = 'BTC'; trade1._sig_json = '{}';
        const trade2 = new Trade(); trade2.id = 't2'; trade2.symbol = 'ETH'; trade2._sig_json = '{}';

        tickerCache.getPrice.mockReturnValue(100);
        // Force heartbeat to ensure it broadcasts
        (service as any).lastTickTime = 0;

        service.broadcastTick([trade1, trade2], {} as any, [], false, () => [], () => ({}));
        expect((service as any).lastSentTrades.size).toBe(2);

        // Second broadcast with only trade1 - trigger broadcast via heartbeat
        (service as any).lastTickTime = 0;
        service.broadcastTick([trade1], {} as any, [], false, () => [], () => ({}));
        expect((service as any).lastSentTrades.size).toBe(1);
        expect((service as any).lastSentTrades.has('t2')).toBe(false);
    });
  });

  describe('getFidelityTick', () => {
    it('should skip stripping if trade is already _thin and not in focus', () => {
      const thinTrade = { id: 't1', symbol: 'BTC', _thin: true, extra: 'should stay' };
      const payload = { type: 'tick', trades: [thinTrade] };
      const client = { focusMode: false };

      const result = service.getFidelityTick(payload, client);
      expect(result.trades[0]).toBe(thinTrade);
      expect(result.trades[0].extra).toBe('should stay');
    });

    it('should perform stripping if trade is NOT thin', () => {
        const fatTrade = { id: 't1', symbol: 'BTC', strategy_config: {} };
        const payload = { type: 'tick', trades: [fatTrade] };
        const client = { focusMode: false };

        const result = service.getFidelityTick(payload, client);
        expect(result.trades[0].strategy_config).toBeUndefined();
        expect(result.trades[0]._thin).toBe(true);
      });
  });
});
