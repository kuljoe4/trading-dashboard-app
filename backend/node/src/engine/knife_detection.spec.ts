import { Test, TestingModule } from '@nestjs/testing';
import { SignalEngineService } from './signalEngine';
import { PositionTrackerService } from './positionTracker';
import { KlineStoreService } from './kline_store.service';
import { RiskEngineService } from './riskEngine';
import { OrderManagerService } from './orderManager';
import { TickerCacheService } from './ticker_cache.service';
import { SessionStateService } from './session_state.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { SessionConfig } from '../models/SessionConfig';
import { Trade } from '../models/Trade';

describe('Knife Catch Signal & Trailing Engine (PERF Verified)', () => {
  let signalEngine: SignalEngineService;
  let positionTracker: PositionTrackerService;
  let klineStore: KlineStoreService;
  let orderManager: jest.Mocked<OrderManagerService>;

  beforeEach(async () => {
    const mockKlineStore = {
      getRawCandles: jest.fn(),
      getLookbackExtremes: jest.fn(),
    };

    const mockRiskEngine = {
      computeSl: jest.fn(),
      computePositionSize: jest.fn(),
    };

    const mockOrderManager = {
      updateStopLoss: jest.fn().mockResolvedValue({ success: true, price: 99.5 }),
      applyFilters: jest.fn().mockImplementation((sym, p) => ({ price: p })),
      isRatcheting: jest.fn().mockReturnValue(false),
      checkExitSignals: jest.fn().mockReturnValue({ exitTriggered: false }),
    };

    const mockTickerCache = {
      getPrice: jest.fn().mockReturnValue(100),
    };

    const mockSessionState = {
      setActiveTrades: jest.fn(),
      stats: {},
    };

    const mockEventEmitter = {
      emit: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SignalEngineService,
        PositionTrackerService,
        { provide: KlineStoreService, useValue: mockKlineStore },
        { provide: RiskEngineService, useValue: mockRiskEngine },
        { provide: OrderManagerService, useValue: mockOrderManager },
        { provide: TickerCacheService, useValue: mockTickerCache },
        { provide: SessionStateService, useValue: mockSessionState },
        { provide: EventEmitter2, useValue: mockEventEmitter },
      ],
    }).compile();

    signalEngine = module.get<SignalEngineService>(SignalEngineService);
    positionTracker = module.get<PositionTrackerService>(PositionTrackerService);
    klineStore = module.get<KlineStoreService>(KlineStoreService);
    orderManager = module.get(OrderManagerService);
  });

  describe('SignalEngineService.knifeCatchSignal', () => {
    it('should fire LONG knife catch on falling price plunges with lower wick rejection', () => {
      const config: Partial<SessionConfig> = {
        enabled_signals: ['knife_catch'],
        signal_params: {
          knife_lookback: 2,
          knife_roc_threshold_pct: 2.5,
          knife_wick_rejection_pct: 0.2,
        },
      };

      // Simulated 5-candle dataset so warmup requirement (2+2=4 candles) is satisfied
      const mockCandles = [
        { time: 1000, open: 100, high: 101, low: 99, close: 100, volume: 1000 },
        { time: 2000, open: 100, high: 101, low: 99, close: 100, volume: 1000 },
        { time: 3000, open: 100, high: 101, low: 99, close: 100, volume: 1000 },
        { time: 4000, open: 100, high: 100, low: 96, close: 96, volume: 1500 },
        { time: 5000, open: 96, high: 97, low: 94, close: 95, volume: 2000 }, // candle range=3 (97-94), lower wick=1 (95-94) -> 33% lower wick
      ];

      (klineStore.getRawCandles as jest.Mock).mockReturnValue(mockCandles);

      const result = signalEngine.checkEntry('BTCUSDT', config as SessionConfig, '1m', 'LONG', 'entry');

      expect(result.allFired).toBe(true);
      expect(result.firedSignals).toContain('knife_catch');
      expect(result.details?.knife_catch.value).toBe(5.0);
    });

    it('should reject LONG knife catch if ROC is insufficient or lower wick is weak', () => {
      const config: Partial<SessionConfig> = {
        enabled_signals: ['knife_catch'],
        signal_params: {
          knife_lookback: 3,
          knife_roc_threshold_pct: 5.0, // Needs >= 5% drop
          knife_wick_rejection_pct: 0.2,
        },
      };

      const mockCandles = [
        { time: 1000, open: 100, high: 101, low: 99, close: 100, volume: 1000 },
        { time: 2000, open: 100, high: 100, low: 98, close: 98, volume: 1500 },
        { time: 3000, open: 98, high: 98, low: 97, close: 97, volume: 2000 }, // Only -3% drop
      ];

      (klineStore.getRawCandles as jest.Mock).mockReturnValue(mockCandles);

      const result = signalEngine.checkEntry('BTCUSDT', config as SessionConfig, '1m', 'LONG', 'entry');

      expect(result.allFired).toBe(false);
    });
  });

  describe('PositionTrackerService.checkKnifeTrailingStop', () => {
    it('should trail stop loss tightly for knife catch trades when price improves', async () => {
      const config: Partial<SessionConfig> = {
        knife_trailing_enabled: true,
        knife_trailing_distance_pct: 0.5, // 0.5% tight trailing
        knife_auto_ratchet_be_rr: 10.0, // Set high so auto-ratchet doesn't interfere in this test
        knife_auto_ratchet_lock_rr: 10.0,
        trailing_guard_buffer_pct: 0.05,
      };

      const trade: Trade = {
        id: 'knife-1',
        symbol: 'BTCUSDT',
        direction: 'LONG',
        entry_price: 100,
        qty: 1,
        initial_sl: 98,
        current_sl: 98,
        is_knife: true,
        status: 'OPEN',
        pnl: 2,
        realized_fee: 0,
        funding_fee: 0,
        risk_usdt: 2,
        entry_signal_confidence: 1,
        max_rr_achieved: 1.0,
        rr_sequence_index: -1,
      };

      positionTracker.addTrade(trade);

      // Price moves up from 100 to 102 (0.5% trail behind 102 is 101.49)
      await positionTracker.checkKnifeTrailingStop(trade, 102, config as SessionConfig);

      expect(orderManager.updateStopLoss).toHaveBeenCalledWith(trade, 101.49, 98);
      expect(trade.current_sl).toBe(99.5); // Reflected from updateStopLoss mock response
    });

    it('should auto-ratchet knife catch trade to breakeven when BE R:R threshold is reached', async () => {
      const config: Partial<SessionConfig> = {
        knife_trailing_enabled: true,
        knife_trailing_distance_pct: 2.0, // Wider trailing so auto-ratchet fires first
        knife_auto_ratchet_be_rr: 0.5,
      };

      const trade: Trade = {
        id: 'knife-2',
        symbol: 'BTCUSDT',
        direction: 'LONG',
        entry_price: 100,
        qty: 1,
        initial_sl: 98, // Risk = 2
        current_sl: 98,
        is_knife: true,
        status: 'OPEN',
        pnl: 1,
        realized_fee: 0,
        funding_fee: 0,
        risk_usdt: 2,
        entry_signal_confidence: 1,
        max_rr_achieved: 0.5,
        rr_sequence_index: -1,
      };

      positionTracker.addTrade(trade);

      // Price moves to 101 (Reward = 1, Live RR = 0.5)
      await positionTracker.checkKnifeTrailingStop(trade, 101, config as SessionConfig);

      // Should ratchet SL to entry price (100)
      expect(orderManager.updateStopLoss).toHaveBeenCalledWith(trade, 100, 98);
    });
  });
});
