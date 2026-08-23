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
  });
});
