jest.mock('@nestjs/typeorm', () => ({
  InjectRepository: () => () => {},
  getRepositoryToken: (e: any) => e?.name || String(e),
}));

import { KlineStoreService } from './kline_store.service';
import { EngineBroadcasterService } from './engine-broadcaster.service';
import { OrderManagerService } from './orderManager';
import { scannerResultsFingerprint, scannerVariantsFingerprint } from './scanner-fingerprint';
import { SessionConfig } from '../models/SessionConfig';
import { Trade } from '../models/Trade';

describe('Condition Widgets Live Update & Broadcast Fidelity (Railway Host)', () => {
  describe('1. KlineStoreService.syncLivePrice', () => {
    let klineStore: KlineStoreService;

    beforeEach(() => {
      klineStore = new KlineStoreService({} as any);
    });

    it('updates forming candle close, high, and low across cached intervals from live ticker price', async () => {
      await klineStore.upsertCandle('BTCUSDT', '1m', {
        t: 1000,
        o: '100',
        h: '102',
        l: '99',
        c: '101',
        q: '50000',
      });
      await klineStore.upsertCandle('BTCUSDT', '5m', {
        t: 1000,
        o: '100',
        h: '102',
        l: '99',
        c: '101',
        q: '50000',
      });

      klineStore.syncLivePrice('BTCUSDT', 105.5);

      const candles1m = klineStore.getRawCandles('BTCUSDT', '1m');
      expect(candles1m[candles1m.length - 1].close).toBe(105.5);
      expect(candles1m[candles1m.length - 1].high).toBe(105.5);
      expect(candles1m[candles1m.length - 1].low).toBe(99);

      klineStore.syncLivePrice('BTCUSDT', 97.25);
      expect(candles1m[candles1m.length - 1].close).toBe(97.25);
      expect(candles1m[candles1m.length - 1].high).toBe(105.5);
      expect(candles1m[candles1m.length - 1].low).toBe(97.25);
    });
  });

  describe('2. EngineBroadcasterService mid-fidelity & _sig_json freshness', () => {
    let broadcaster: EngineBroadcasterService;
    let mockSessionState: any;
    let mockBroadcastService: any;

    beforeEach(() => {
      mockSessionState = {
        listenerCount: 1,
        closedTrades: [],
        getBalance: jest.fn().mockReturnValue(1000),
        stats: { totalTrades: 0, wins: 0, losses: 0, totalPnl: 0 },
      };
      mockBroadcastService = { broadcast: jest.fn() };
      broadcaster = new EngineBroadcasterService(
        { getPrice: jest.fn().mockReturnValue(102) } as any,
        { activeList: jest.fn().mockReturnValue([]), totalRisk: jest.fn().mockReturnValue(0) } as any,
        { canEnter: jest.fn().mockReturnValue({ canEnter: true }) } as any,
        { calculateAnalytics: jest.fn().mockReturnValue(null) } as any,
        { calculateVariantStats: jest.fn().mockReturnValue({}) } as any,
        { getSummary: jest.fn().mockReturnValue({}) } as any,
        mockBroadcastService,
        mockSessionState,
      );
    });

    it('preserves _sig_json and exit_signals_status for StrategyDetailView (mid-fidelity) while stripping for Dashboard (low-fidelity)', () => {
      const config = new SessionConfig();
      const trade: Partial<Trade> = {
        id: 't1',
        symbol: 'BTCUSDT',
        direction: 'LONG',
        entry_price: 100,
        qty: 1,
        current_sl: 95,
        initial_sl: 95,
        strategy_label: 'Momentum Strategy',
        exit_signals_status: {
          rsi_overbought: {
            fired: false,
            active: true,
            value: 64.2,
            threshold: 70,
            live_price: 102,
          } as any,
        },
      };

      const serialized = broadcaster.serializeTickTrade(
        trade as Trade,
        102,
        2,
        0.4,
        config,
        undefined,
        0,
        'NONE',
      );

      expect(JSON.parse(serialized._sig_json!).rsi_overbought.value).toBe(64.2);
      expect(JSON.parse(serialized._sig_json!).rsi_overbought.live_price).toBe(102);

      const rawTick = { type: 'tick', trades: [serialized] };

      // StrategyDetailView client (mid-fidelity)
      const strategyClient = {
        focusMode: true,
        focusStrategyLabel: 'Momentum Strategy',
        focusTradeId: null,
      };
      const midTick = broadcaster.getFidelityTick(rawTick, strategyClient);
      expect(midTick.trades[0]._sig_json).toBeDefined();
      expect(JSON.parse(midTick.trades[0]._sig_json).rsi_overbought.value).toBe(64.2);

      // Dashboard client (low-fidelity)
      const lowClient = { focusMode: false };
      const lowTick = broadcaster.getFidelityTick(rawTick, lowClient);
      expect(lowTick.trades[0]._sig_json).toBeUndefined();
    });

    it('re-serializes _sig_json when exit_signals_status changes on subsequent ticks', () => {
      const config = new SessionConfig();
      const trade: any = {
        id: 't1',
        symbol: 'BTCUSDT',
        direction: 'LONG',
        entry_price: 100,
        qty: 1,
        current_sl: 95,
        initial_sl: 95,
        strategy_label: 'Momentum Strategy',
        _sig_json: JSON.stringify({ rsi_overbought: { value: 50, threshold: 70 } }),
        exit_signals_status: {
          rsi_overbought: { value: 68.5, threshold: 70, live_price: 104 },
        },
      };

      const serialized = broadcaster.serializeTickTrade(
        trade as Trade,
        104,
        4,
        0.8,
        config,
        undefined,
        0,
        'NONE',
      );
      expect(JSON.parse(serialized._sig_json!).rsi_overbought.value).toBe(68.5);
    });
  });

  describe('3. OrderManagerService.checkExitSignals rich detail preservation', () => {
    it('retains live_price, closed_value, ref_high, ref_low, prevFast, prevSlow on exit_signals_status', () => {
      const mockSignalEngine = {
        getRequiredWarmup: jest.fn().mockReturnValue(10),
        checkEntry: jest.fn().mockReturnValue({
          allFired: false,
          firedSignals: [],
          details: {
            htf_breakout: {
              fired: false,
              metric: 'HTF Breakout',
              value: 101.5,
              threshold: 102.0,
              unit: 'price',
              description: 'Breakout check',
              threshold_is_price: true,
              live_price: 101.5,
              closed_value: 101.1,
              ref_high: 102.0,
              ref_low: 98.5,
              evaluated_at_ms: 123456789,
            },
          },
        }),
      };
      const mockKlineStore = {
        getRawCandles: jest.fn().mockReturnValue(new Array(20).fill({ time: 1000, close: 101.5 })),
      };
      const orderManager = new OrderManagerService(
        mockSignalEngine as any,
        {} as any,
        { getPrice: jest.fn().mockReturnValue(101.5) } as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        undefined,
        mockKlineStore as any,
      );

      const trade: any = {
        id: 't1',
        symbol: 'BTCUSDT',
        direction: 'LONG',
        entry_price: 100,
        qty: 1,
        entry_ts: new Date(Date.now() - 60000),
      };
      const config = Object.assign(new SessionConfig(), {
        use_exit_signals: true,
        exit_signals: ['htf_breakout'],
        exit_signal_logic: 'ANY',
      });

      orderManager.checkExitSignals('BTCUSDT', trade, config, '5m');

      expect(trade.exit_signals_status).toBeDefined();
      expect(trade.exit_signals_status.htf_breakout.live_price).toBe(101.5);
      expect(trade.exit_signals_status.htf_breakout.closed_value).toBe(101.1);
      expect(trade.exit_signals_status.htf_breakout.ref_high).toBe(102.0);
      expect(trade.exit_signals_status.htf_breakout.ref_low).toBe(98.5);
      expect(trade.exit_signals_status.htf_breakout.evaluated_at_ms).toBe(123456789);
    });
  });

  describe('4. Scanner & Variant Fingerprinting', () => {
    it('detects changes in variant condition values and live_price', () => {
      const base = [{
        symbol: 'BTCUSDT',
        direction: 'LONG',
        score: 80,
        price: 100,
        pct: 1.5,
        signalResult: {
          allFired: false,
          firedSignals: [],
          details: { rsi: { value: 55, threshold: 70, live_price: 100 } },
        },
      }];
      const var1 = [{
        strategy_label: 'Scalp Variant',
        opportunities: [{
          symbol: 'ETHUSDT',
          direction: 'LONG',
          score: 85,
          price: 2000,
          pct: 2.1,
          signalResult: {
            allFired: false,
            firedSignals: [],
            details: { htf_breakout: { value: 2000, threshold: 2010, live_price: 2000 } },
          },
        }],
      }];
      const var2 = [{
        strategy_label: 'Scalp Variant',
        opportunities: [{
          symbol: 'ETHUSDT',
          direction: 'LONG',
          score: 85,
          price: 2000,
          pct: 2.1,
          signalResult: {
            allFired: false,
            firedSignals: [],
            details: { htf_breakout: { value: 2000, threshold: 2010, live_price: 2005 } },
          },
        }],
      }];

      const fp1 = `${scannerResultsFingerprint(base)}|${scannerVariantsFingerprint(var1)}`;
      const fp2 = `${scannerResultsFingerprint(base)}|${scannerVariantsFingerprint(var2)}`;
      expect(fp1).not.toBe(fp2);
    });
  });
});
