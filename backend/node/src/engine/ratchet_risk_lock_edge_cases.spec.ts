import { PositionTrackerService } from './positionTracker';
import { Trade } from '../models/Trade';
import { SessionConfig } from '../models/SessionConfig';

describe('Ratchet Catch-up & Risk Lock Release Edge Cases', () => {
  let tracker: PositionTrackerService;
  let mockRiskEngine: any;
  let mockSignalEngine: any;
  let mockOrderManager: any;
  let mockTickerCache: any;
  let mockKlineStore: any;
  let mockSessionState: any;
  let mockEventEmitter: any;

  beforeEach(() => {
    mockRiskEngine = {};
    mockSignalEngine = {};
    mockOrderManager = {
      isRatcheting: jest.fn().mockReturnValue(false),
      applyFilters: jest.fn().mockImplementation((sym, price) => ({ price })),
      updateStopLoss: jest.fn().mockResolvedValue({ success: true, price: 100 }),
    };
    mockTickerCache = {
      getPrice: jest.fn().mockReturnValue(105),
    };
    mockKlineStore = {};
    mockSessionState = {
      setActiveTrades: jest.fn(),
    };
    mockEventEmitter = {
      emit: jest.fn(),
    };

    tracker = new PositionTrackerService(
      mockRiskEngine,
      mockSignalEngine,
      mockOrderManager,
      mockTickerCache,
      mockKlineStore,
      mockSessionState,
      mockEventEmitter,
    );
  });

  describe('checkRrSequenceAdjustments Catch-up Ratcheting', () => {
    it('should catch up and ratchet SL to breakeven if milestone index is already set but current_sl is still at initial SL', async () => {
      const trade: Partial<Trade> = {
        id: 't-123',
        symbol: 'BTCUSDT',
        direction: 'LONG',
        entry_price: 100,
        initial_sl: 95,
        current_sl: 95, // Still at initial SL (behind breakeven)
        qty: 1,
        status: 'OPEN',
        max_rr_achieved: 1.2, // Achieved milestone 0 (0.5R)
        rr_sequence_index: 0, // Milestone 0 reached previously or from DB
        live_rr_sequence: [0.5, 1.0, 2.0],
        exit_rr_sequence: [0.0, 0.5, 1.0], // 0.0 is breakeven
      };

      tracker.addTrade(trade as Trade);

      const config: Partial<SessionConfig> = {
        live_rr_sequence: [0.5, 1.0, 2.0],
        exit_rr_sequence: [0.0, 0.5, 1.0],
        trailing_guard_buffer_pct: 0.1,
      };

      await tracker.checkRrSequenceAdjustments('BTCUSDT', 106, config as SessionConfig);

      // Verify that updateStopLoss was called to ratchet SL to breakeven (100)
      expect(mockOrderManager.updateStopLoss).toHaveBeenCalled();
      expect(trade.current_sl).toBe(100);
      expect(trade.risk_usdt).toBe(0); // Risk lock released at breakeven
    });
  });

  describe('refreshTradeRisk Edge Cases', () => {
    it('should release risk lock when current_sl is at breakeven', () => {
      const trade: Partial<Trade> = {
        symbol: 'ETHUSDT',
        direction: 'LONG',
        entry_price: 3000,
        initial_sl: 2900,
        current_sl: 3000, // Breakeven
        qty: 0.1,
        risk_usdt: 10,
      };

      tracker.refreshTradeRisk(trade as Trade, true);

      expect(trade.risk_usdt).toBe(0);
      expect(trade.risk_lock_reason).toBe('SL_AT_BREAKEVEN');
    });

    it('should NOT release risk lock when first milestone is 0.1R and current_sl remains below entry', () => {
      const trade: Partial<Trade> = {
        symbol: 'MILESTONE_01R',
        direction: 'LONG',
        entry_price: 100,
        initial_sl: 90,
        current_sl: 95, // Ratcheted to 95 (-0.5R, below entry 100)
        qty: 1,
        risk_usdt: 10,
        rr_sequence_index: 0, // First milestone (0.1R) reached!
        max_rr_achieved: 0.15,
        live_rr_sequence: [0.1, 0.5, 1.0],
        exit_rr_sequence: [-0.5, 0.0, 0.5],
      };

      tracker.refreshTradeRisk(trade as Trade, true);

      // Lock MUST NOT be released because SL (95) is $5 below entry (100)
      expect(trade.risk_usdt).toBe(5);
      expect(trade.risk_lock_reason).toBe('SL_BELOW_ENTRY');
    });

    it('should release risk lock when milestone ratchets current_sl to breakeven or above', () => {
      const trade: Partial<Trade> = {
        symbol: 'MILESTONE_BE',
        direction: 'LONG',
        entry_price: 100,
        initial_sl: 90,
        current_sl: 100, // Ratcheted to breakeven (100)
        qty: 1,
        risk_usdt: 10,
        rr_sequence_index: 0,
        max_rr_achieved: 0.5,
        live_rr_sequence: [0.5, 1.0],
        exit_rr_sequence: [0.0, 0.5],
      };

      tracker.refreshTradeRisk(trade as Trade, true);

      expect(trade.risk_usdt).toBe(0);
      expect(trade.risk_lock_reason).toBe('SL_AT_BREAKEVEN');
    });

    it('should release risk lock when current_sl is 0 (removed in profit)', () => {
      const trade: Partial<Trade> = {
        symbol: 'ETHUSDT',
        direction: 'LONG',
        entry_price: 3000,
        initial_sl: 2900,
        current_sl: 0, // SL removed in profit
        qty: 0.1,
        risk_usdt: 10,
        rr_sequence_index: 0, // Milestone reached
      };

      tracker.refreshTradeRisk(trade as Trade, true);

      expect(trade.risk_usdt).toBe(0);
    });

    it('should release risk lock when release_risk_on_est_pnl_be is active and estimated floor exit PnL is at or above breakeven', () => {
      const trade: Partial<Trade> = {
        symbol: 'SOLUSDT',
        direction: 'LONG',
        entry_price: 100,
        initial_sl: 90,
        current_sl: 100, // SL ratcheted to breakeven (est exit floor PnL = 0)
        qty: 1,
        risk_usdt: 10,
      };

      const config: Partial<SessionConfig> = {
        release_risk_on_est_pnl_be: true,
      };

      // Live mark price is 110
      tracker.refreshTradeRisk(trade as Trade, true, 110, config as SessionConfig);

      expect(trade.risk_usdt).toBe(0);
    });

    it('should re-lock risk when trade pulls back and estimated floor exit PnL is underwater', () => {
      const trade: Partial<Trade> = {
        symbol: 'SOLUSDT',
        direction: 'LONG',
        entry_price: 100,
        initial_sl: 90,
        current_sl: 90, // Underwater SL (-10)
        qty: 1,
        risk_usdt: 0, // Currently released
      };

      const config: Partial<SessionConfig> = {
        release_risk_on_est_pnl_be: true,
      };

      // Live mark price pulls back to 95 (-$5 loss)
      tracker.refreshTradeRisk(trade as Trade, true, 95, config as SessionConfig);

      expect(trade.risk_usdt).toBe(10); // Re-locked initial risk
    });

    it('should release risk lock early when estPnl meets custom positive or negative release_risk_est_pnl_min_usdt threshold', () => {
      // 1. Positive threshold (+5 USDT) triggered by exit signal before physical SL moves above entry
      const tradePos: Partial<Trade> = {
        symbol: 'BTCUSDT',
        direction: 'LONG',
        entry_price: 100,
        initial_sl: 90,
        current_sl: 90, // SL still at -10
        qty: 1,
        risk_usdt: 10,
        exit_signals_status: {
          ema_cross: { fired: false, active: true, label: 'EMA Cross', value: 107, unit: 'USDT', threshold_is_price: true, threshold: 106, remaining_delay: 0 }, // estPnl = +6
        },
      };
      const cfgPos: Partial<SessionConfig> = {
        release_risk_on_est_pnl_be: true,
        release_risk_est_pnl_min_usdt: 5,
      };
      tracker.refreshTradeRisk(tradePos as Trade, true, 107, cfgPos as SessionConfig);
      expect(tradePos.risk_usdt).toBe(0);
      expect(tradePos.risk_lock_reason).toBe('EST_PNL_THRESHOLD');

      // If signal threshold drops so estPnl (+3) < configured +5 while SL is still underwater, risk re-locks
      tradePos.exit_signals_status = {
        ema_cross: { fired: false, active: true, label: 'EMA Cross', value: 104, unit: 'USDT', threshold_is_price: true, threshold: 103, remaining_delay: 0 }, // estPnl = +3
      };
      tracker.refreshTradeRisk(tradePos as Trade, true, 104, cfgPos as SessionConfig);
      expect(tradePos.risk_usdt).toBe(10);
      expect(tradePos.risk_lock_reason).toBe('SL_BELOW_ENTRY');

      // 2. Negative threshold (-2 USDT) releases risk once ratcheted SL narrows floor loss to -1.5 USDT
      const tradeNeg: Partial<Trade> = {
        symbol: 'ETHUSDT',
        direction: 'LONG',
        entry_price: 100,
        initial_sl: 90,
        current_sl: 98.5, // estPnl = -1.5 (>= -2 threshold)
        qty: 1,
        risk_usdt: 1.5,
      };
      const cfgNeg: Partial<SessionConfig> = {
        release_risk_on_est_pnl_be: true,
        release_risk_est_pnl_min_usdt: -2,
      };
      tracker.refreshTradeRisk(tradeNeg as Trade, true, 101, cfgNeg as SessionConfig);
      expect(tradeNeg.risk_usdt).toBe(0);
      expect(tradeNeg.risk_lock_reason).toBe('EST_PNL_THRESHOLD');
    });

    it('should evaluate estimated risk release in R:R using immutable initial risk', () => {
      const trade: Partial<Trade> = {
        symbol: 'RR_RELEASE',
        direction: 'LONG',
        entry_price: 100,
        initial_sl: 90,
        current_sl: 90,
        qty: 2,
        initial_risk_usdt: 20,
        risk_usdt: 20,
        exit_signals_status: {
          ema_cross: { fired: false, active: true, label: 'EMA Cross', value: 105, unit: 'price', threshold_is_price: true, threshold: 105, remaining_delay: 0 },
        },
      };
      const config: Partial<SessionConfig> = {
        release_risk_on_est_pnl_be: true,
        release_risk_est_pnl_mode: 'rr',
        release_risk_est_pnl_min_rr: 0.5,
      };

      tracker.refreshTradeRisk(trade as Trade, true, 106, config as SessionConfig);
      expect(trade.est_pnl_to_realize).toBe(10);
      expect(trade.risk_usdt).toBe(0);
      expect(trade.risk_lock_reason).toBe('EST_PNL_RR_THRESHOLD');

      trade.exit_signals_status = {
        ema_cross: { fired: false, active: true, label: 'EMA Cross', value: 104, unit: 'price', threshold_is_price: true, threshold: 104, remaining_delay: 0 },
      };
      tracker.refreshTradeRisk(trade as Trade, true, 106, config as SessionConfig);
      expect(trade.est_pnl_to_realize).toBe(8);
      expect(trade.risk_usdt).toBe(20);
    });

    it('should release risk lock when rr_sequence_index >= 0 even if exchange rounding placed current_sl 1 tick below entry', () => {
      const trade: Partial<Trade> = {
        symbol: 'ADAUSDT',
        direction: 'LONG',
        entry_price: 1.0000,
        initial_sl: 0.9500,
        current_sl: 0.9999, // 1 tick below entry due to exchange floor rounding
        qty: 100,
        risk_usdt: 5.0,
        rr_sequence_index: 0, // Milestone 0 (breakeven) reached
      };

      tracker.refreshTradeRisk(trade as Trade, true);

      expect(trade.risk_usdt).toBe(0);
    });

    it('should not degrade current_sl when trailing guard buffer caps new target SL below current_sl', async () => {
      const trade: Partial<Trade> = {
        id: 't-guard',
        symbol: 'BTCUSDT',
        direction: 'LONG',
        entry_price: 100,
        initial_sl: 90,
        current_sl: 99.5, // Already ratcheted close to entry
        qty: 1,
        status: 'OPEN',
        max_rr_achieved: 1.5,
        rr_sequence_index: 0,
        live_rr_sequence: [0.5, 1.0],
        exit_rr_sequence: [0.0, 0.5],
      };

      tracker.addTrade(trade as Trade);

      // Market drops near SL to 99.8 with 0.5% buffer (buffer = 0.499)
      // Capped SL = 99.8 - 0.499 = 99.301, which is BELOW current_sl (99.5)
      const config: Partial<SessionConfig> = {
        live_rr_sequence: [0.5, 1.0],
        exit_rr_sequence: [0.0, 0.5],
        trailing_guard_buffer_pct: 0.5,
      };

      await tracker.checkRrSequenceAdjustments('BTCUSDT', 99.8, config as SessionConfig);

      // Verify that updateStopLoss was NOT called to lower SL
      expect(mockOrderManager.updateStopLoss).not.toHaveBeenCalled();
      expect(trade.current_sl).toBe(99.5);
    });
  });
});
