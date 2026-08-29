import { PositionTrackerService } from './positionTracker';
import { Trade } from '../models/Trade';
import { SessionConfig } from '../models/SessionConfig';
import { ENGINE_EVENTS } from './events';

describe('PositionTrackerService', () => {
  let service: PositionTrackerService;
  let mockRiskEngine: any;
  let mockSignalEngine: any;
  let mockOrderManager: any;
  let mockTickerCache: any;
  let mockKlineStore: any;
  let mockEventEmitter: any;

  beforeEach(() => {
    mockRiskEngine = {};
    mockSignalEngine = {};
    mockOrderManager = {
      updateStopLoss: jest.fn().mockImplementation((trade, newSl) => Promise.resolve({ success: true, price: newSl })),
      applyFilters: jest.fn().mockImplementation((symbol, price, qty) => ({ price, qty })),
      isRatcheting: jest.fn().mockReturnValue(false),
      closeTrade: jest.fn(),
      checkExitSignals: jest.fn(),
    };
    mockTickerCache = {};
    mockKlineStore = {};
    mockEventEmitter = {
      emit: jest.fn(),
    };

    service = new PositionTrackerService(
      mockRiskEngine,
      mockSignalEngine,
      mockOrderManager,
      mockTickerCache,
      mockKlineStore,
      {
        setActiveTrades: jest.fn(),
      } as any,
      mockEventEmitter
    );
  });

  it('logs the finalized trade exit reason after exchange recovery', async () => {
    mockOrderManager.closeTrade.mockResolvedValue({
      exitOccurred: true,
      trade: {
        symbol: 'BTCUSDT',
        pnl: 12.34,
        pnl_pct: 1.23,
        exit_price: 100,
        exit_reason: 'SL_HIT_INITIAL_SL',
      } as Trade,
    });

    service.addTrade({
      symbol: 'BTCUSDT',
      status: 'OPEN',
      risk_usdt: 10,
    } as Trade);

    await service.closeTrade('BTCUSDT', 100, 'EXCHANGE_SYNC', {} as SessionConfig, false, true);

    const logCall = mockEventEmitter.emit.mock.calls.find((call: [string, unknown]) => call[0] === ENGINE_EVENTS.LOG_MESSAGE);
    expect(logCall?.[1]?.msg).toContain('Reason=SL_HIT_INITIAL_SL');
    expect(logCall?.[1]?.msg).not.toContain('Reason=EXCHANGE_SYNC');
  });

  describe('checkRrSequenceAdjustments', () => {
    it('calls orderManager.updateStopLoss when SL ratchets', async () => {
      const trade = {
        symbol: 'BTCUSDT',
        direction: 'LONG',
        entry_price: 50000,
        initial_sl: 49000,
        current_sl: 49000,
        status: 'OPEN',
        max_rr_achieved: 0,
        sl_adjustments: [],
      } as unknown as Trade;

      const config = {
        live_rr_sequence: [1.0, 2.0],
        exit_rr_sequence: [0.0, 1.0], // 0.0 means BE, 1.0 means lock 1R
      } as SessionConfig;

      service.addTrade(trade);

      // 1. Price hits 1.1R (51100) -> Milestone 0 (BE)
      await service.checkRrSequenceAdjustments('BTCUSDT', 51100, config);

      expect(trade.current_sl).toBe(50000); // Entry price (BE)
      expect(mockOrderManager.updateStopLoss).toHaveBeenCalledWith(trade, 50000, 49000);

      // 2. Price hits 2.1R (52100) -> Milestone 1 (1R)
      await service.checkRrSequenceAdjustments('BTCUSDT', 52100, config);

      expect(trade.current_sl).toBe(51000); // 1R profit
      expect(mockOrderManager.updateStopLoss).toHaveBeenCalledWith(trade, 51000, 50000);
    });

    it('does not ratchet SL if price moves back', async () => {
      const trade = {
        symbol: 'BTCUSDT',
        direction: 'LONG',
        entry_price: 50000,
        initial_sl: 49000,
        current_sl: 50000, // already at BE
        status: 'OPEN',
        max_rr_achieved: 1.5,
        sl_adjustments: [],
      } as unknown as Trade;

      const config = {
        live_rr_sequence: [1.0, 2.0],
        exit_rr_sequence: [0.0, 1.0],
      } as SessionConfig;

      service.addTrade(trade);
      (service as any).rrSequenceIndex.set('BTCUSDT', 0); // Already at milestone 0

      // Price drops to 50500 (0.5R)
      await service.checkRrSequenceAdjustments('BTCUSDT', 50500, config);

      expect(trade.current_sl).toBe(50000); // No change
      expect(mockOrderManager.updateStopLoss).not.toHaveBeenCalled();
    });

    it('caps the SL adjustment if it is too close to the current market price (Trailing Guard)', async () => {
      const trade = {
        symbol: 'BTCUSDT',
        direction: 'LONG',
        entry_price: 50000,
        initial_sl: 49000,
        current_sl: 49000,
        status: 'OPEN',
        max_rr_achieved: 0,
        sl_adjustments: [],
      } as unknown as Trade;

      const config = {
        live_rr_sequence: [1.0],
        exit_rr_sequence: [0.0], // target BE
      } as SessionConfig;

      service.addTrade(trade);

      // Price hits 1.1R (51100), but then flash drops to 50005.
      // Milestone 0 target is 50000 (BE).
      // Buffer is 50005 * 0.0003 = 15.0015.
      // Cap should be 50005 - 15.0015 = 49989.9985.
      // Since 49989.9985 is NOT greater than current_sl (49000) by enough to move, we need a better test case.

      // Let's use a tighter SL or higher target.
      // Target: 50500. Market: 50510.
      // Buffer: 50510 * 0.0003 = 15.153.
      // Cap: 50510 - 15.153 = 50494.847.

      const trade2 = {
        symbol: 'ETHUSDT',
        direction: 'LONG',
        entry_price: 2000,
        initial_sl: 1900,
        current_sl: 1900,
        status: 'OPEN',
        max_rr_achieved: 0,
        sl_adjustments: [],
      } as unknown as Trade;

      const config2 = {
        live_rr_sequence: [1.0],
        exit_rr_sequence: [0.5], // target 2050
      } as SessionConfig;

      service.addTrade(trade2);

      // Market at 2110 (1.1R). Target SL = 2050.
      // But if market suddenly at 2055.
      // Buffer = 2055 * 0.0003 = 0.6165.
      // Cap = 2055 - 0.6165 = 2054.3835.

      // Update max_rr first by calling with high price
      await service.checkRrSequenceAdjustments('ETHUSDT', 2110, config2);
      // current_sl should be 2050.
      expect(trade2.current_sl).toBe(2050);

      // Now milestone 2: target 2080. Market at 2081.
      const config3 = {
        live_rr_sequence: [1.0, 1.5],
        exit_rr_sequence: [0.5, 0.8], // M1: 2050, M2: 2080
      } as SessionConfig;

      // Reset milestone index to allow re-trigger if needed, but easier to just use new milestone.
      // M2 (1.5R) = 2000 + 100 * 1.5 = 2150.
      // If market hits 2150, target SL = 2080.
      // If market then at 2081.
      // Buffer = 2081 * 0.0003 = 0.6243.
      // Cap = 2081 - 0.6243 = 2080.3757.
      // Wait, 2080 is BELOW 2080.3757, so it's fine.

      // We want newSl (2080) >= currentPrice (2081) - buffer (0.6) -> 2080 >= 2080.4 -> True.
      // In this case, newSl becomes 2080.3757.

      await service.checkRrSequenceAdjustments('ETHUSDT', 2155, config3); // Hits M2
      // Market drops to 2081.
      // Actually checkRrSequenceAdjustments uses currentPrice for both milestone check and buffer.
      // So if currentPrice is 2081, it won't hit M2 (2150).

      // Correct test:
      // Long Entry: 2000. Risk: 100.
      // M1 (1.0R): 2100. Exit RR: 0.9R -> 2090.
      // Market at 2101.
      // Buffer: 2101 * 0.0003 = 0.63.
      // Cap: 2101 - 0.63 = 2100.37.
      // Since 2090 < 2100.37, no cap.

      // Market at 2100.1
      // Target: 2099.9 (Exit RR 0.999R)
      // Buffer: 2100.1 * 0.0003 = 0.63.
      // Cap: 2100.1 - 0.63 = 2099.47.
      // Target 2099.9 > 2099.47 -> Capped!

      const trade3 = {
        symbol: 'SOLUSDT',
        direction: 'LONG',
        entry_price: 100,
        initial_sl: 90,
        current_sl: 90,
        qty: 1,
        status: 'OPEN',
        max_rr_achieved: 0,
        sl_adjustments: [],
      } as unknown as Trade;

      const config4 = {
        live_rr_sequence: [1.0],
        exit_rr_sequence: [0.999], // Target 109.99
      } as SessionConfig;

      service.addTrade(trade3);
      await service.checkRrSequenceAdjustments('SOLUSDT', 110.1, config4);

      // currentPrice = 110.1.
      // Buffer = 110.1 * 0.0003 = 0.03303.
      // Cap = 110.1 - 0.03303 = 110.06697.
      // Target newSl = 100 + 10 * 0.999 = 109.99.
      // 109.99 < 110.06697. NO CAP.

      // Let's use a HUGE buffer or a VERY tight target.
      // Target 110.08. Market 110.1.
      // Cap 110.06697.
      // 110.08 > 110.06697 -> CAPPED to 110.06697.

      const config5 = {
        live_rr_sequence: [1.0],
        exit_rr_sequence: [1.008], // Target 110.08
      } as SessionConfig;

      const trade4 = {
        symbol: 'ADAUSDT',
        direction: 'LONG',
        entry_price: 100,
        initial_sl: 90,
        current_sl: 90,
        qty: 1,
        status: 'OPEN',
        max_rr_achieved: 0,
        sl_adjustments: [],
      } as unknown as Trade;

      service.addTrade(trade4);
      await service.checkRrSequenceAdjustments('ADAUSDT', 110.1, config5);

      expect(trade4.current_sl).toBeCloseTo(110.06697, 5);
      expect(mockOrderManager.updateStopLoss).toHaveBeenCalledWith(trade4, expect.closeTo(110.06697, 5), 90);
    });

    it('updates max_rr_achieved on every tick even without milestones', async () => {
      const trade = {
        symbol: 'RR_TEST',
        direction: 'LONG',
        entry_price: 100,
        initial_sl: 90,
        current_sl: 90,
        status: 'OPEN',
        max_rr_achieved: 0,
      } as unknown as Trade;

      const config = {
        live_rr_sequence: [2.0],
        exit_rr_sequence: [1.0],
      } as SessionConfig;

      service.addTrade(trade);

      // Price at 1.5R (115). No milestone hit (requires 2.0R).
      await service.checkRrSequenceAdjustments('RR_TEST', 115, config);

      expect(trade.max_rr_achieved).toBe(1.5);
      expect(trade.current_sl).toBe(90); // No ratchet
    });

    it('sets risk_usdt to 0 when SL ratchets to breakeven or better', async () => {
      const trade = {
        symbol: 'RISK_BE',
        direction: 'LONG',
        entry_price: 100,
        initial_sl: 90,
        current_sl: 90,
        qty: 10,
        status: 'OPEN',
        max_rr_achieved: 0,
        risk_usdt: 100,
      } as unknown as Trade;

      const config = {
        live_rr_sequence: [1.0],
        exit_rr_sequence: [0.0], // target breakeven
      } as SessionConfig;

      service.addTrade(trade);
      expect(service.totalRisk()).toBe(100);

      // Hit milestone 1 (1.0R = 110) -> Ratchet to BE (100)
      await service.checkRrSequenceAdjustments('RISK_BE', 110, config);

      expect(trade.current_sl).toBe(100);
      // Risk should now be released
      expect(trade.risk_usdt).toBe(0);
      expect(service.totalRisk()).toBe(0);
    });

    it('caps the SHORT SL adjustment if it is too close to the current market price', async () => {
      const trade = {
        symbol: 'SHORTY',
        direction: 'SHORT',
        entry_price: 100,
        initial_sl: 110,
        current_sl: 110,
        qty: 1,
        status: 'OPEN',
        max_rr_achieved: 0,
        sl_adjustments: [],
      } as unknown as Trade;

      // Milestone 1: market at 90 (1.0R).
      // Target SL: entry - risk * 0.9 = 100 - 10 * 0.9 = 91.
      const config = {
        live_rr_sequence: [1.0],
        exit_rr_sequence: [0.9],
      } as SessionConfig;

      service.addTrade(trade);

      // Market at 89.9. Target 91. Buffer 89.9 * 0.0003 = 0.02697.
      // Cap = 89.9 + 0.02697 = 89.92697.
      // 91 > 89.92697, so NO CAP.

      // Target 89.8. Market 89.9.
      // Buffer 0.02697.
      // Cap 89.92697.
      // 89.8 < 89.92697 -> CAPPED to 89.92697.

      const config2 = {
        live_rr_sequence: [1.0],
        exit_rr_sequence: [1.02], // Target 100 - 10 * 1.02 = 89.8
      } as SessionConfig;

      await service.checkRrSequenceAdjustments('SHORTY', 89.9, config2);

      expect(trade.current_sl).toBeCloseTo(89.92697, 5);
      expect(mockOrderManager.updateStopLoss).toHaveBeenCalledWith(trade, expect.closeTo(89.92697, 5), 110);
    });
  });

  describe('totalRisk', () => {
    it('should correctly calculate O(1) total risk including pending risk', () => {
      const trade1 = {
        symbol: 'BTCUSDT',
        direction: 'LONG',
        entry_price: 100,
        initial_sl: 90,
        current_sl: 90,
        qty: 10,
        status: 'OPEN',
      } as unknown as Trade;

      service.addTrade(trade1);
      expect(service.totalRisk()).toBe(100);

      // Add pending risk
      service.setEntering('ETHUSDT', true, 50);
      expect(service.totalRisk()).toBe(150);

      // Update pending risk for same symbol
      service.setEntering('ETHUSDT', true, 75);
      expect(service.totalRisk()).toBe(175);

      // Add another pending risk
      service.setEntering('SOLUSDT', true, 25);
      expect(service.totalRisk()).toBe(200);

      // Remove one pending risk
      service.setEntering('ETHUSDT', false);
      expect(service.totalRisk()).toBe(125);

      // Remove another pending risk
      service.setEntering('SOLUSDT', false);
      expect(service.totalRisk()).toBe(100);

      // Defensive: remove non-existent pending risk
      service.setEntering('XRPUSDT', false);
      expect(service.totalRisk()).toBe(100);
    });

    it('should correctly recalculate total risk from map', () => {
      const trade1 = {
        symbol: 'BTCUSDT',
        direction: 'LONG',
        entry_price: 100,
        initial_sl: 90,
        current_sl: 90,
        qty: 10,
        status: 'OPEN',
      } as unknown as Trade;
      service.addTrade(trade1);

      service.setEntering('ETHUSDT', true, 50);

      // Manually mess up the internal counters to test recalculation
      (service as any)._totalRisk = 0;
      (service as any)._pendingRiskTotal = 0;
      expect(service.totalRisk()).toBe(0);

      service.recalculateTotalRisk();
      expect(service.totalRisk()).toBe(150);
    });

    it('updates risk_usdt on quantity sync using initial_sl', () => {
       const trade = {
         symbol: 'QTY_SYNC_TEST',
         direction: 'LONG',
         entry_price: 100,
         initial_sl: 80, // 20 points risk
         current_sl: 95, // Ratcheted to almost entry
         qty: 10,
         status: 'OPEN',
         risk_usdt: 200,
       } as unknown as Trade;

       service.addTrade(trade);
       expect(service.totalRisk()).toBe(200);

       // Qty halved to 5. Risk should be (100 - 80) * 5 = 100.
       // If it wrongly used current_sl (95), risk would be (100 - 95) * 5 = 25.
       service.handleQuantitySync({ symbol: 'QTY_SYNC_TEST', qty: 5 });

       expect(trade.qty).toBe(5);
       expect(trade.risk_usdt).toBe(100);
       expect(service.totalRisk()).toBe(100);
    });
  });

  describe('checkExitConditions with lock_sl action', () => {
    it('should lock SL instead of closing when lock_sl action is configured', async () => {
      const trade = {
        symbol: 'LOCK_SL_TEST',
        direction: 'LONG',
        entry_price: 100,
        initial_sl: 95,
        current_sl: 95,
        qty: 1,
        status: 'OPEN',
        risk_usdt: 5,
        updated_at: new Date(),
        exit_signals_status: {}
      } as any;
      service.addTrade(trade);

      const config = {
        exit_signals: ['ema_close_fast'],
        exit_signal_actions: {
          ema_close_fast: 'lock_sl'
        },
        exit_signal_logic: 'any',
        trailing_guard_buffer_pct: 0.1
      } as any;

      mockOrderManager.checkExitSignals.mockReturnValue({
        exitTriggered: true,
        exitSignalType: 'ema_close_fast'
      });

      // Mock signal status as populated by checkExitSignals
      trade.exit_signals_status = {
        ema_close_fast: {
          fired: true,
          active: true,
          value: 99.5, // EMA value
          threshold_is_price: true
        }
      };

      mockOrderManager.applyFilters.mockReturnValue({ price: 99.5 });
      mockOrderManager.updateStopLoss.mockResolvedValue({ success: true, price: 99.5 });

      const result = service.checkExitConditions('LOCK_SL_TEST', 100, config);

      // Result should be null because it didn't trigger a close event
      expect(result).toBeNull();
      expect(trade.status).toBe('OPEN');

      // But updateStopLoss should have been triggered asynchronously
      await new Promise(resolve => setTimeout(resolve, 50));
      expect(mockOrderManager.updateStopLoss).toHaveBeenCalledWith(trade, 99.5, 95);
    });

    it('should close position if close action is configured', async () => {
      const trade = {
        symbol: 'CLOSE_TEST',
        direction: 'LONG',
        entry_price: 100,
        initial_sl: 95,
        current_sl: 95,
        qty: 1,
        status: 'OPEN',
        risk_usdt: 5,
        updated_at: new Date(),
        exit_signals_status: {}
      } as any;
      service.addTrade(trade);

      const config = {
        exit_signals: ['ema_close_slow'],
        exit_signal_actions: {
          ema_close_slow: 'close'
        },
        exit_signal_logic: 'any'
      } as any;

      mockOrderManager.checkExitSignals.mockReturnValue({
        exitTriggered: true,
        exitSignalType: 'ema_close_slow'
      });

      trade.exit_signals_status = {
        ema_close_slow: {
          fired: true,
          active: true,
          value: 98,
          threshold_is_price: true
        }
      };

      const result = service.checkExitConditions('CLOSE_TEST', 100, config);

      expect(result).not.toBeNull();
      expect(result?.exitOccurred).toBe(true);
      expect(result?.exitType).toBe('CLOSED_SIGNAL');
    });
  });

  describe('checkTrailingStop', () => {
    it('should move SL up for LONG trade when price improves', async () => {
      const trade = {
        symbol: 'TRAIL_LONG',
        direction: 'LONG',
        entry_price: 100,
        current_sl: 98,
        qty: 1,
        status: 'OPEN',
        risk_usdt: 2,
        updated_at: new Date()
      } as any;
      service.addTrade(trade);

      const config = {
        trailing_stop_enabled: true,
        trailing_stop_distance_pct: 1.0, // 1% = .00 distance
        trailing_guard_buffer_pct: 0.05
      } as any;

      mockOrderManager.applyFilters.mockReturnValue({ price: 104 }); // Price 105 - 1% = 104
      mockOrderManager.updateStopLoss.mockResolvedValue({ success: true, price: 104 });

      await service.checkTrailingStop('TRAIL_LONG', 105, config);

      expect(mockOrderManager.updateStopLoss).toHaveBeenCalledWith(trade, 104, 98);
      expect(trade.current_sl).toBe(104);
    });

    it('should move SL down for SHORT trade when price improves', async () => {
      const trade = {
        symbol: 'TRAIL_SHORT',
        direction: 'SHORT',
        entry_price: 100,
        current_sl: 102,
        qty: 1,
        status: 'OPEN',
        risk_usdt: 2,
        updated_at: new Date()
      } as any;
      service.addTrade(trade);

      const config = {
        trailing_stop_enabled: true,
        trailing_stop_distance_pct: 1.0, // 1% = .00 distance
      } as any;

      mockOrderManager.applyFilters.mockReturnValue({ price: 96 }); // Price 95 + 1% = 96
      mockOrderManager.updateStopLoss.mockResolvedValue({ success: true, price: 96 });

      await service.checkTrailingStop('TRAIL_SHORT', 95, config);

      expect(mockOrderManager.updateStopLoss).toHaveBeenCalledWith(trade, 96, 102);
      expect(trade.current_sl).toBe(96);
    });

    it('sets risk_usdt to 0 and decrements totalRisk when trailing stop ratchets to breakeven or better', async () => {
      const trade = {
        symbol: 'TRAIL_BE',
        direction: 'LONG',
        entry_price: 100,
        initial_sl: 90,
        current_sl: 90,
        qty: 10,
        status: 'OPEN',
        risk_usdt: 100,
        updated_at: new Date()
      } as any;
      service.addTrade(trade);
      expect(service.totalRisk()).toBe(100);

      const config = {
        trailing_stop_enabled: true,
        trailing_stop_distance_pct: 1.0,
        trailing_guard_buffer_pct: 0.05
      } as any;

      // Price moves from 100 to 110. Trailing stop prospective is 110 - 1% = 109 (which is above entry 100)
      mockOrderManager.applyFilters.mockReturnValue({ price: 109 });
      mockOrderManager.updateStopLoss.mockResolvedValue({ success: true, price: 109 });

      await service.checkTrailingStop('TRAIL_BE', 110, config);

      expect(trade.current_sl).toBe(109);
      expect(trade.risk_usdt).toBe(0);
      expect(service.totalRisk()).toBe(0);
    });
  });

  describe('refreshTradeRisk and SL override in profit', () => {
    it('releases risk locks (risk_usdt = 0) when current_sl = 0 and initial_sl > 0 for LONG and SHORT trades', () => {
      const longTrade = {
        symbol: 'LONG_NO_SL',
        direction: 'LONG',
        entry_price: 50000,
        initial_sl: 49000,
        current_sl: 0,
        qty: 0.1,
        status: 'OPEN',
        risk_usdt: 100,
        sl_adjustments: [{ reason: 'OVERRIDE' }],
      } as unknown as Trade;

      service.addTrade(longTrade);
      expect(longTrade.risk_usdt).toBe(0);

      const shortTrade = {
        symbol: 'SHORT_NO_SL',
        direction: 'SHORT',
        entry_price: 50000,
        initial_sl: 51000,
        current_sl: 0,
        qty: 0.1,
        status: 'OPEN',
        risk_usdt: 100,
        sl_adjustments: [{ reason: 'OVERRIDE' }],
      } as unknown as Trade;

      service.addTrade(shortTrade);
      expect(shortTrade.risk_usdt).toBe(0);
      expect(service.totalRisk()).toBe(0);
    });

    it('removes SL and releases risk locks when handleExitSignalOverrideIfNeeded is triggered in profit', async () => {
      const trade = {
        symbol: 'OVERRIDE_TEST',
        direction: 'LONG',
        entry_price: 50000,
        initial_sl: 49000,
        current_sl: 49000,
        qty: 0.1,
        status: 'OPEN',
        risk_usdt: 100,
        binance_stop_order_id: '12345',
        exit_signals_status: {
          supertrend: {
            fired: true,
            active: true,
            threshold: 51000,
            threshold_is_price: true,
          },
        },
      } as any;

      service.addTrade(trade);
      expect(service.totalRisk()).toBe(100);

      mockTickerCache.getPrice = jest.fn().mockReturnValue(52000); // Active price 52000 > threshold 51000

      const config = {
        exit_signals_override_ratchet: true,
        scan_interval: '1m',
        paper_mode: true,
      } as SessionConfig;

      const overridden = await service.handleExitSignalOverrideIfNeeded(trade, config);

      expect(overridden).toBe(true);
      expect(trade.current_sl).toBe(0);
      expect(trade.risk_usdt).toBe(0);
      expect(service.totalRisk()).toBe(0);
    });

    it('releases risk locks on estimated PnL breakeven when release_risk_on_est_pnl_be option is enabled', () => {
      const trade = {
        symbol: 'EST_PNL_TEST',
        direction: 'LONG',
        entry_price: 100,
        initial_sl: 90,
        current_sl: 90, // SL still at 90 (below entry)
        qty: 10,
        status: 'OPEN',
        risk_usdt: 100,
      } as unknown as Trade;

      service.addTrade(trade);
      expect(trade.risk_usdt).toBe(100);

      const config = {
        release_risk_on_est_pnl_be: true,
      } as SessionConfig;

      // Exit signal threshold is 105 (estimated exit floor PnL = +50 above breakeven 0)
      trade.exit_signals_status = {
        ema_cross: {
          fired: true,
          active: true,
          threshold: 105,
          threshold_is_price: true,
          remaining_delay: 0,
          label: 'EMA Cross',
          value: 105,
          unit: 'USDT',
        },
      };
      service.refreshTradeRisk(trade, false, 105, config);

      expect(trade.risk_usdt).toBe(0);
      expect(service.totalRisk()).toBe(0);

      // Estimated PnL drops back to -50 (below breakeven 0)
      trade.exit_signals_status = {
        ema_cross: {
          fired: true,
          active: true,
          threshold: 95,
          threshold_is_price: true,
          remaining_delay: 0,
          label: 'EMA Cross',
          value: 95,
          unit: 'USDT',
        },
      };
      service.refreshTradeRisk(trade, false, 95, config);

      expect(trade.risk_usdt).toBe(100);
      expect(service.totalRisk()).toBe(100);
    });
  });
});
