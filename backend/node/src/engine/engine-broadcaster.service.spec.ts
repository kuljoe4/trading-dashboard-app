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
      expect(result.est_pnl_source).toBe('sl');
    });

    it('should identify a signal as the est_pnl_source if it has a higher qualifying P&L', () => {
      const trade = new Trade();
      trade.id = 't1';
      trade.symbol = 'BTCUSDT';
      trade.entry_price = 50000;
      trade.qty = 0.1;
      trade.direction = 'LONG';
      trade.current_sl = 49000; // P&L at SL: -100
      trade.exit_signals_status = {
        ema_close: {
          fired: true,
          active: true,
          label: 'EMA Close',
          value: 50500,
          unit: 'USD',
          threshold_is_price: true,
          threshold: 50500, // P&L at threshold: +50
          remaining_delay: 0,
        }
      };

      const config = { strategy_label: 'Test' } as SessionConfig;
      const current = 51000;
      const pnl = 100; // current P&L is +100
      const rr = 1.0;

      const result = service.serializeTickTrade(trade, config, current, pnl, rr);

      expect(result.est_pnl_to_realize).toBe(50);
      expect(result.est_pnl_source).toBe('signal:ema_close');
    });
  });

  describe('risk_usdt serialization (SL breakeven release)', () => {
    const buildTrade = (overrides: Partial<Trade> = {}) => {
      const t = new Trade();
      t.id = 't1';
      t.symbol = 'BTCUSDT';
      t.entry_price = 50000;
      t.qty = 0.1;
      t.direction = 'LONG';
      t.current_sl = 49000;
      t.initial_sl = 49000;
      t.initial_risk_usdt = 100;
      Object.assign(t, overrides);
      return t;
    };
    const config = { strategy_label: 'Test' } as SessionConfig;

    it('serializeTrade includes risk_usdt (full fidelity)', () => {
      const t = buildTrade({ risk_usdt: 100 });
      const out: any = (service as any).serializeTrade(t, config, 51000);
      expect(out.risk_usdt).toBe(100);
      expect(out.initial_risk_usdt).toBe(100);
    });

    it('serializeTrade serializes a released (0) risk_usdt without falling back to initial', () => {
      // At breakeven, PositionTracker.refreshTradeRisk sets risk_usdt = 0.
      // The released state MUST be preserved (0), not overwritten by initial_risk_usdt.
      const t = buildTrade({ current_sl: 50000, risk_usdt: 0 });
      const out: any = (service as any).serializeTrade(t, config, 51000);
      expect(out.risk_usdt).toBe(0);
    });

    it('serializeTickTrade includes risk_usdt', () => {
      const t = buildTrade({ risk_usdt: 0 });
      const out = service.serializeTickTrade(t, config, 51000, 100, 1);
      expect(out.risk_usdt).toBe(0);
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
    it('should strip _sig_json from thin trades for low-fidelity clients', () => {
      const thinTrade = { id: 't1', symbol: 'BTC', _thin: true, _sig_json: '{"s1":true}', extra: 'should stay' };
      const payload = { type: 'tick', trades: [thinTrade] };
      const client = { focusMode: false };

      const result = service.getFidelityTick(payload, client);
      expect(result.trades[0]._sig_json).toBeUndefined();
      expect(result.trades[0].extra).toBe('should stay');
    });

    it('should perform stripping of _sig_json and strategy_config if trade is NOT thin', () => {
      const fatTrade = { id: 't1', symbol: 'BTC', _sig_json: '{"s1":true}', strategy_config: {} };
      const payload = { type: 'tick', trades: [fatTrade] };
      const client = { focusMode: false };

      const result = service.getFidelityTick(payload, client);
      expect(result.trades[0].strategy_config).toBeUndefined();
      expect(result.trades[0]._sig_json).toBeUndefined();
      expect(result.trades[0]._thin).toBe(true);
    });

    it('should preserve full trade including _sig_json if client is focused on that specific trade ID', () => {
      const trade = { id: 't1', symbol: 'BTC', _sig_json: '{"s1":true}', strategy_config: { k: 'v' } };
      const payload = { type: 'tick', trades: [trade] };
      const client = { focusMode: true, focusTradeId: 't1' };

      const result = service.getFidelityTick(payload, client);
      expect(result.trades[0]._sig_json).toBe('{"s1":true}');
      expect(result.trades[0].strategy_config).toEqual({ k: 'v' });
    });
  });

  describe('serializeStrategyGateStates & paused_strategies optimizations', () => {
    it('should return frozen EMPTY_OBJECT when strategyGateStates is empty', () => {
      sessionState.strategyGateStates = new Map();
      const result = service.serializeStrategyGateStates();
      expect(result).toEqual({});
      expect(Object.isFrozen(result)).toBe(true);
    });

    it('should correctly format strategy gate states when map is populated', () => {
      sessionState.strategyGateStates = new Map([
        ['Strategy A', { gateState: 'max_trades', gateReason: 'Limit reached', isAdaptiveTightened: true }],
        ['Strategy B', { gateState: null, gateReason: null, isAdaptiveTightened: false }],
      ]);

      const result = service.serializeStrategyGateStates();
      expect(result).toEqual({
        'Strategy A': { gateState: 'max_trades', gateReason: 'Limit reached', isAdaptiveTightened: true },
        'Strategy B': { gateState: null, gateReason: null, isAdaptiveTightened: false },
      });
    });

    it('should return frozen EMPTY_ARRAY when pausedStrategies is empty in broadcastTick', () => {
      sessionState.pausedStrategies = new Set();
      (service as any).lastTickTime = 0; // force broadcast
      service.broadcastTick([], {} as any, [], false, () => [], () => ({}));

      const broadcastPayload = broadcastService.broadcast.mock.calls[0][1];
      expect(broadcastPayload.paused_strategies).toEqual([]);
      expect(Object.isFrozen(broadcastPayload.paused_strategies)).toBe(true);
    });

    it('benchmark: serializeStrategyGateStates 1,000,000 calls', () => {
      sessionState.strategyGateStates = new Map([
        ['Strategy 1', { gateState: 'max_trades', gateReason: 'Limit', isAdaptiveTightened: false }],
        ['Strategy 2', { gateState: 'sl_guard', gateReason: 'Stop loss hit', isAdaptiveTightened: true }],
      ]);

      const iterations = 1000000;
      const start = performance.now();
      for (let i = 0; i < iterations; i++) {
        service.serializeStrategyGateStates();
      }
      const end = performance.now();
      const totalMs = end - start;
      console.log(`[BENCHMARK] serializeStrategyGateStates ${iterations} calls: ${totalMs.toFixed(2)}ms (${((totalMs / iterations) * 1000000).toFixed(2)}ns/call)`);
      expect(totalMs).toBeGreaterThan(0);
    });
  });

  describe('realizedPnl broadcastTick O(1) optimization', () => {
    it('should correctly calculate total_pnl using pre-accumulated sessionState.stats.totalPnl without looping', () => {
      const closedTrades: any[] = [];
      let expectedPnlSum = 0;
      for (let i = 0; i < 50; i++) {
        const pnlVal = 10.5;
        closedTrades.push({ id: `ct_${i}`, pnl: pnlVal, symbol: 'BTCUSDT' });
        expectedPnlSum += pnlVal;
      }

      sessionState.closedTrades = closedTrades;
      sessionState.stats = { entryCount: 50, hitCount: 50, totalPnl: expectedPnlSum };
      sessionState.getBalance.mockReturnValue(10000);
      (service as any).lastTickTime = 0; // force broadcast

      service.broadcastTick([], { paper_mode: true, paper_starting_balance: 10000 } as any, [], false, () => [], () => ({}));

      const broadcastPayload = broadcastService.broadcast.mock.calls[0][1];
      expect(broadcastPayload.total_pnl).toBe(525);
    });

    it('benchmark: broadcastTick realizedPnl optimization across 10,000 ticks with 500 closed trades', () => {
      const closedTrades: any[] = [];
      for (let i = 0; i < 500; i++) {
        closedTrades.push({ id: `t_${i}`, pnl: 2.5, symbol: 'SOLUSDT' });
      }

      sessionState.closedTrades = closedTrades;
      sessionState.stats = { entryCount: 500, hitCount: 500, totalPnl: 1250 };
      sessionState.getBalance.mockReturnValue(11250);

      const iterations = 10000;
      const start = performance.now();
      for (let i = 0; i < iterations; i++) {
        (service as any).lastTickTime = 0; // force broadcast
        service.broadcastTick([], { paper_mode: true, paper_starting_balance: 10000 } as any, [], false, () => [], () => ({}));
      }
      const totalMs = performance.now() - start;

      console.log(`[BENCHMARK] broadcastTick O(1) realizedPnl ${iterations} ticks (500 trades each): ${totalMs.toFixed(2)}ms (${(totalMs / iterations).toFixed(4)}ms/tick)`);
      expect(totalMs).toBeGreaterThan(0);
    });
  });
});
