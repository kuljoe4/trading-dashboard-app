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

  beforeEach(() => {
    mockRiskEngine = {};
    mockSignalEngine = {};
    mockOrderManager = {
      updateStopLoss: jest.fn().mockResolvedValue(undefined),
    };
    mockTickerCache = {};
    mockKlineStore = {};

    service = new PositionTrackerService(
      mockRiskEngine,
      mockSignalEngine,
      mockOrderManager,
      mockTickerCache,
      mockKlineStore
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
      expect(mockOrderManager.updateStopLoss).toHaveBeenCalledWith(trade, 50000);

      // 2. Price hits 2.1R (52100) -> Milestone 1 (1R)
      await service.checkRrSequenceAdjustments('BTCUSDT', 52100, config);

      expect(trade.current_sl).toBe(51000); // 1R profit
      expect(mockOrderManager.updateStopLoss).toHaveBeenCalledWith(trade, 51000);
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
});
