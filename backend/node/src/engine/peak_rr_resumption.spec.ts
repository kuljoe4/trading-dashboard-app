jest.mock('@nestjs/typeorm', () => ({
  InjectRepository: () => () => {},
  getRepositoryToken: (e: any) => e?.name || String(e),
}));

import { PositionTrackerService } from './positionTracker';
import { EngineBroadcasterService } from './engine-broadcaster.service';
import { Trade } from '../models/Trade';
import { SessionConfig } from '../models/SessionConfig';

describe('Peak RR Resumption and Hydration Tests', () => {
  let positionTracker: PositionTrackerService;
  let engineBroadcaster: EngineBroadcasterService;

  const mockRiskEngine: any = {
    computeSl: jest.fn(),
    computePositionSize: jest.fn(),
  };
  const mockSignalEngine: any = {};
  const mockOrderManager: any = {
    checkExitSignals: jest.fn().mockReturnValue({ exitTriggered: false }),
    applyFilters: jest.fn((sym, p) => ({ price: p })),
    isRatcheting: jest.fn().mockReturnValue(false),
  };
  const mockTickerCache: any = {
    getPrice: jest.fn().mockReturnValue(null),
  };
  const mockKlineStore: any = {};
  const mockSessionState: any = {
    setActiveTrades: jest.fn(),
  };
  const mockEventEmitter: any = {
    emit: jest.fn(),
  };

  const defaultConfig: SessionConfig = {
    paper_mode: true,
    live_rr_sequence: [1.5, 2.5, 3.5],
    exit_rr_sequence: [0, 1.0, 2.0],
  } as any;

  beforeEach(() => {
    jest.clearAllMocks();
    mockTickerCache.getPrice.mockReturnValue(null);
    mockOrderManager.checkExitSignals.mockReturnValue({ exitTriggered: false });
    mockOrderManager.isRatcheting.mockReturnValue(false);
    positionTracker = new PositionTrackerService(
      mockRiskEngine,
      mockSignalEngine,
      mockOrderManager,
      mockTickerCache,
      mockKlineStore,
      mockSessionState,
      mockEventEmitter,
    );

    engineBroadcaster = new EngineBroadcasterService(
      mockTickerCache,
      mockSessionState,
      {} as any,
      { calculateAnalytics: jest.fn().mockReturnValue(null) } as any,
      { broadcast: jest.fn() } as any,
      {} as any,
      mockRiskEngine,
      positionTracker,
    );
  });

  describe('hydrateMaxRr & addTrade', () => {
    it('coerces string decimal max_rr_achieved from DB to number', () => {
      const trade: Trade = {
        id: 't-1',
        symbol: 'BTCUSDT',
        direction: 'LONG',
        entry_price: 100,
        initial_sl: 90,
        current_sl: 90,
        qty: 1,
        status: 'OPEN',
        max_rr_achieved: '2.40000000' as any,
        rr_sequence_index: -1,
      } as any;

      positionTracker.addTrade(trade);
      expect(typeof trade.max_rr_achieved).toBe('number');
      expect(trade.max_rr_achieved).toBe(2.4);
    });

    it('floors max_rr_achieved from milestone index when resumed with 0', () => {
      const trade: Trade = {
        id: 't-2',
        symbol: 'ETHUSDT',
        direction: 'LONG',
        entry_price: 100,
        initial_sl: 90,
        current_sl: 100,
        qty: 1,
        status: 'OPEN',
        max_rr_achieved: 0,
        rr_sequence_index: 1, // Milestone index 1 corresponds to live_rr 2.5
        live_rr_sequence: [1.5, 2.5, 3.5],
      } as any;

      positionTracker.addTrade(trade);
      expect(trade.max_rr_achieved).toBe(2.5);
    });

    it('floors max_rr_achieved from locked SL in profit when resumed with 0', () => {
      const trade: Trade = {
        id: 't-3',
        symbol: 'SOLUSDT',
        direction: 'LONG',
        entry_price: 100,
        initial_sl: 90, // Risk = 10
        current_sl: 115, // Locked profit = 15 = 1.5R
        qty: 1,
        status: 'OPEN',
        max_rr_achieved: 0,
        rr_sequence_index: -1,
      } as any;

      positionTracker.addTrade(trade);
      expect(trade.max_rr_achieved).toBe(1.5);
    });

    it('floors max_rr_achieved from current ticker price in profit', () => {
      mockTickerCache.getPrice.mockReturnValue(118); // Live profit = 18 = 1.8R

      const trade: Trade = {
        id: 't-4',
        symbol: 'ADAUSDT',
        direction: 'LONG',
        entry_price: 100,
        initial_sl: 90,
        current_sl: 90,
        qty: 1,
        status: 'OPEN',
        max_rr_achieved: 0,
        rr_sequence_index: -1,
      } as any;

      positionTracker.addTrade(trade);
      expect(trade.max_rr_achieved).toBe(1.8);
    });
  });

  describe('reconcileMilestoneFromSl', () => {
    it('reconciles max_rr_achieved to milestone RR even if rr_sequence_index is unchanged', () => {
      const trade: Trade = {
        id: 't-5',
        symbol: 'DOGEUSDT',
        direction: 'LONG',
        entry_price: 100,
        initial_sl: 90, // Risk = 10
        current_sl: 110, // exit_rr_sequence[1] = 1.0 => SL at 110
        qty: 1,
        status: 'OPEN',
        max_rr_achieved: 0,
        rr_sequence_index: 1, // Already set to 1 in DB
        live_rr_sequence: [1.5, 2.5, 3.5],
        exit_rr_sequence: [0, 1.0, 2.0],
      } as any;

      const bestIndex = positionTracker.reconcileMilestoneFromSl(trade, 110, defaultConfig);
      expect(bestIndex).toBe(1);
      expect(trade.max_rr_achieved).toBe(2.5);
    });
  });

  describe('EngineBroadcasterService serialization', () => {
    it('outputs both max_rr and max_rr_achieved as numbers in serializeTrade and serializeTickTrade', () => {
      const trade: Trade = {
        id: 't-6',
        symbol: 'AVAXUSDT',
        direction: 'LONG',
        entry_price: 100,
        initial_sl: 90,
        current_sl: 100,
        qty: 1,
        status: 'OPEN',
        max_rr_achieved: 2.5,
        rr_sequence_index: 1,
      } as any;

      const serialized = engineBroadcaster.serializeTrade(trade, defaultConfig, 105);
      expect(serialized.max_rr).toBe(2.5);
      expect(serialized.max_rr_achieved).toBe(2.5);

      const tickSerialized = engineBroadcaster.serializeTickTrade(trade, defaultConfig, 105, 5, 0.5);
      expect(tickSerialized.max_rr).toBe(2.5);
      expect(tickSerialized.max_rr_achieved).toBe(2.5);
    });

    it('serializes hydrated peakRrSwitchHits in serializeStrategyGateStates even before strategyGateStates is populated', () => {
      mockSessionState.config = {
        strategy_label: 'Momentum Strategy',
        tp_mode: 'exp_rr_seq_switch',
        peak_rr_switch_threshold: 3.0,
        peak_rr_switch_count: 1,
        live_rr_sequence: [1.5, 2.5],
        exit_rr_sequence: [0, 1.0],
        switched_live_rr_sequence: [2.0, 4.0],
        switched_exit_rr_sequence: [1.0, 2.5],
      };
      mockSessionState.strategyGateStates = new Map();

      const resumedTrade: Trade = {
        id: 't-switch-1',
        symbol: 'BTCUSDT',
        strategy_label: 'Momentum Strategy',
        direction: 'LONG',
        entry_price: 100,
        initial_sl: 90,
        current_sl: 110,
        qty: 1,
        status: 'OPEN',
        max_rr_achieved: '3.20000000' as any,
        rr_sequence_index: 1,
      } as any;

      positionTracker.addTrade(resumedTrade);

      expect(positionTracker.peakRrSwitchHits.get('Momentum Strategy')).toBe(1);
      expect(positionTracker.tradePeakRrSwitchHandled.has('t-switch-1')).toBe(true);
      // Milestone index 1 in switched_live_rr_sequence is 4.0R, so max_rr_achieved floors to 4.0R
      expect(resumedTrade.max_rr_achieved).toBe(4.0);

      const serializedGates = engineBroadcaster.serializeStrategyGateStates();
      expect(serializedGates['Momentum Strategy']?.peakRrSwitchHits).toBe(1);
    });

    it('hydrates peakRrSwitchHits during reconcileMilestoneFromSl when SL lock proves switch threshold was crossed', () => {
      const switchConfig: SessionConfig = {
        strategy_label: 'Momentum Strategy',
        tp_mode: 'exp_rr_seq_switch',
        peak_rr_switch_threshold: 2.0,
        peak_rr_switch_count: 1,
        live_rr_sequence: [1.0, 2.0],
        exit_rr_sequence: [0.0, 0.5],
        switched_live_rr_sequence: [1.5, 3.0],
        switched_exit_rr_sequence: [0.5, 2.0],
      } as any;

      const trade: Trade = {
        id: 't-recon-switch',
        symbol: 'SOLUSDT',
        strategy_label: 'Momentum Strategy',
        direction: 'LONG',
        entry_price: 100,
        initial_sl: 90, // Risk = 10
        current_sl: 120, // Locked 2.0R profit => hits peak_rr_switch_threshold (2.0R) and matches switched_exit_rr_sequence[1] = 2.0R
        qty: 1,
        status: 'OPEN',
        max_rr_achieved: 0,
        rr_sequence_index: -1,
      } as any;

      const idx = positionTracker.reconcileMilestoneFromSl(trade, 120, switchConfig);
      expect(positionTracker.peakRrSwitchHits.get('Momentum Strategy')).toBe(1);
      expect(idx).toBe(1);
      expect(trade.max_rr_achieved).toBe(3.0);
    });
  });

  describe('Regression: gradual sub-0.1R ticks, override early return, and post-entry candle hydration', () => {
    it('emits TRADE_UPDATED cumulatively when gradual < 0.1R ticks cross 0.1R thresholds', async () => {
      const trade: Trade = {
        id: 't-gradual-1',
        symbol: 'BTCUSDT',
        direction: 'LONG',
        entry_price: 100,
        initial_sl: 90, // Risk = 10 -> each +0.4 price is +0.04R
        current_sl: 90,
        qty: 1,
        status: 'OPEN',
        max_rr_achieved: 0,
        rr_sequence_index: -1,
      } as any;

      positionTracker.addTrade(trade);
      mockEventEmitter.emit.mockClear();

      // 0.04R, 0.08R -> no TRADE_UPDATED yet (< 0.1R cumulative)
      await positionTracker.checkRrSequenceAdjustments('BTCUSDT', 100.4, defaultConfig);
      await positionTracker.checkRrSequenceAdjustments('BTCUSDT', 100.8, defaultConfig);
      const updatesBeforeThreshold = mockEventEmitter.emit.mock.calls.filter((c: any[]) => c[0] === 'trade.updated');
      expect(updatesBeforeThreshold.length).toBe(0);
      expect(trade.max_rr_achieved).toBeCloseTo(0.08, 6);

      // 0.12R -> crosses 0.1R from lastEmitted (0), emits TRADE_UPDATED once
      await positionTracker.checkRrSequenceAdjustments('BTCUSDT', 101.2, defaultConfig);
      let tradeUpdates = mockEventEmitter.emit.mock.calls.filter((c: any[]) => c[0] === 'trade.updated');
      expect(tradeUpdates.length).toBe(1);
      expect(trade.max_rr_achieved).toBeCloseTo(0.12, 6);

      // 0.17R -> only +0.05R above 0.12R, no new emit yet
      await positionTracker.checkRrSequenceAdjustments('BTCUSDT', 101.7, defaultConfig);
      tradeUpdates = mockEventEmitter.emit.mock.calls.filter((c: any[]) => c[0] === 'trade.updated');
      expect(tradeUpdates.length).toBe(1);

      // 0.23R -> +0.11R above lastEmitted (0.12R), emits second TRADE_UPDATED
      await positionTracker.checkRrSequenceAdjustments('BTCUSDT', 102.3, defaultConfig);
      tradeUpdates = mockEventEmitter.emit.mock.calls.filter((c: any[]) => c[0] === 'trade.updated');
      expect(tradeUpdates.length).toBe(2);
      expect(trade.max_rr_achieved).toBeCloseTo(0.23, 6);
    });

    it('continues updating max_rr_achieved and emitting TRADE_UPDATED even when exit signal override returns early', async () => {
      mockTickerCache.getPrice.mockReturnValue(110);
      mockOrderManager.checkExitSignals.mockImplementation((_sym: string, t: any) => {
        t.exit_signals_status = {
          ema_cross: {
            threshold_is_price: true,
            threshold: 105, // current PnL > threshold PnL triggers override
          },
        };
        return { exitTriggered: false };
      });

      const overrideConfig: SessionConfig = {
        ...defaultConfig,
        exit_signals_override_ratchet: true,
        trailing_stop_enabled: true,
        trailing_stop_type: 'pct',
        trailing_stop_distance_pct: 1.0,
      } as any;

      const trade: Trade = {
        id: 't-override-1',
        symbol: 'ETHUSDT',
        direction: 'LONG',
        entry_price: 100,
        initial_sl: 90,
        current_sl: 0,
        qty: 1,
        status: 'OPEN',
        max_rr_achieved: 1.0,
        rr_sequence_index: -1,
      } as any;

      positionTracker.addTrade(trade);
      mockEventEmitter.emit.mockClear();

      // Price pushes to 115 (+1.5R) while exit-signal override is active
      mockTickerCache.getPrice.mockReturnValue(115);
      await positionTracker.checkRrSequenceAdjustments('ETHUSDT', 115, overrideConfig);
      expect(trade.max_rr_achieved).toBeCloseTo(1.5, 6);

      // Price pushes to 125 (+2.5R) on trailing check while override is still active
      mockTickerCache.getPrice.mockReturnValue(125);
      await positionTracker.checkTrailingStop('ETHUSDT', 125, overrideConfig);
      expect(trade.max_rr_achieved).toBeCloseTo(2.5, 6);

      const tradeUpdates = mockEventEmitter.emit.mock.calls.filter((c: any[]) => c[0] === 'trade.updated');
      expect(tradeUpdates.length).toBe(2);
    });

    it('floors max_rr_achieved from strictly post-entry klines on restart while ignoring pre-entry wicks', () => {
      const entryTs = new Date('2026-11-26T00:10:00Z');
      mockTickerCache.getPrice.mockReturnValue(105); // Reverted to +0.5R at restart
      mockKlineStore.getRawCandles = jest.fn().mockImplementation((_sym: string, tf: string) => {
        if (tf === '1m') {
          return [
            { time: entryTs.getTime() - 60000, high: 150, low: 95, close: 100 }, // Pre-entry candle MUST be ignored
            { time: entryTs.getTime() + 60000, high: 122, low: 101, close: 112 }, // Post-entry spike to +2.2R
            { time: entryTs.getTime() + 120000, high: 115, low: 104, close: 105 },
          ];
        }
        return [];
      });

      const trade: Trade = {
        id: 't-kline-1',
        symbol: 'SOLUSDT',
        direction: 'LONG',
        entry_price: 100,
        initial_sl: 90, // Risk = 10
        current_sl: 90,
        qty: 1,
        status: 'OPEN',
        max_rr_achieved: 0.4,
        rr_sequence_index: -1,
        entry_ts: entryTs,
      } as any;

      positionTracker.addTrade(trade);
      expect(trade.max_rr_achieved).toBeCloseTo(2.2, 6);
    });
  });
});
