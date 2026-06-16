import { PositionTrackerService } from './positionTracker';
import { Trade } from '../models/Trade';
import { SessionConfig } from '../models/SessionConfig';

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
      updateStopLoss: jest.fn().mockResolvedValue(undefined),
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
      {} as any,
      mockEventEmitter
    );
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
  });

  describe('totalRisk', () => {
    it('should correctly calculate O(1) total risk including pending risk', () => {
      const trade1 = {
        symbol: 'BTCUSDT',
        risk_usdt: 100,
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
        risk_usdt: 100,
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
  });
});
