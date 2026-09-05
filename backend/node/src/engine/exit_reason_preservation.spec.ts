import { Test, TestingModule } from '@nestjs/testing';
import { OrderManagerService } from './orderManager';
import { SessionStateService } from './session_state.service';
import { TickerCacheService } from './ticker_cache.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { OrderFilterService } from './order-filter.service';
import { MarketFeedService } from './market_feed.service';
import { AuditLogService } from '../trading/audit-log.service';
import { SignalEngineService } from './signalEngine';
import { MonitoringService } from './monitoring.service';
import { PositionTrackerService } from './positionTracker';
import { BroadcastService } from './broadcast.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Settings as SettingsEntity } from '../models/entities/Settings.entity';
import { Trade } from '../models/Trade';
import { EXIT_REASONS } from '../models/constants';

describe('Exit Reason Preservation and Dynamic Signal Resolution', () => {
  let orderManager: OrderManagerService;
  let mockBinanceClient: any;
  let mockSessionState: any;

  beforeEach(async () => {
    mockBinanceClient = {
      restAPI: {
        newOrder: jest.fn(),
        cancelBinanceOrder: jest.fn(),
        positionInformationV3: jest.fn(),
        queryOrder: jest.fn(),
        accountTradeList: jest.fn(),
      },
    };

    mockSessionState = {
      realTimePositions: new Map(),
      setActiveTrades: jest.fn(),
      realTimeOrders: new Map(),
      isRateLimited: jest.fn().mockReturnValue(false),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrderManagerService,
        {
          provide: SignalEngineService,
          useValue: {
            checkEntry: jest.fn(),
            calculateIndicators: jest.fn(),
          },
        },
        {
          provide: MonitoringService,
          useValue: {
            incrementApiRequests: jest.fn(),
            setUdsStatus: jest.fn(),
          },
        },
        {
          provide: PositionTrackerService,
          useValue: {
            activeList: jest.fn(),
            getInFlightEntry: jest.fn(),
            closeTrade: jest.fn(),
            isClosing: jest.fn().mockReturnValue(false),
            recalculateTotalRisk: jest.fn(),
          },
        },
        {
          provide: BroadcastService,
          useValue: {
            broadcast: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(SettingsEntity),
          useValue: {
            findOne: jest.fn(),
            update: jest.fn(),
          },
        },
        {
          provide: SessionStateService,
          useValue: mockSessionState,
        },
        {
          provide: TickerCacheService,
          useValue: {
            getPrice: jest.fn().mockReturnValue(100),
            getTicker: jest.fn().mockReturnValue({ mark_price: 100, price: 100 }),
          },
        },
        {
          provide: EventEmitter2,
          useValue: {
            emit: jest.fn(),
          },
        },
        {
          provide: OrderFilterService,
          useValue: {
            applyFilters: jest.fn((sym, price, qty) => ({ price, qty })),
            checkLeverageBracket: jest.fn().mockReturnValue({ isAllowed: true }),
          },
        },
        {
          provide: MarketFeedService,
          useValue: {
            getSymbolFilters: jest.fn().mockReturnValue({ stepSize: 0.001, pricePrecision: 2, qtyPrecision: 3 }),
          },
        },
        {
          provide: AuditLogService,
          useValue: {
            log: jest.fn().mockResolvedValue(null),
          },
        },
      ],
    }).compile();

    orderManager = module.get<OrderManagerService>(OrderManagerService);
    (orderManager as any).binanceClient = mockBinanceClient;
    (orderManager as any).paperMode = false;
  });

  describe('shouldUpgradeExitReason', () => {
    it('should not allow downgrading a highly specific reason to a generic reason', () => {
      const shouldUpgrade = (orderManager as any).shouldUpgradeExitReason.bind(orderManager);

      // Specific -> Generic
      expect(shouldUpgrade('SL_HIT_M1', 'EXCHANGE_SL_OR_MANUAL')).toBe(false);
      expect(shouldUpgrade('SIGNAL_EMA_CLOSE', 'EXCHANGE_SL_OR_MANUAL')).toBe(false);
      expect(shouldUpgrade('SL_HIT_BREAKEVEN', 'EXCHANGE_SYNC_RECOVERY')).toBe(false);
      expect(shouldUpgrade('MANUAL_CLOSE', 'EXCHANGE_SYNC')).toBe(false);
    });

    it('should allow upgrading a generic reason to a highly specific reason', () => {
      const shouldUpgrade = (orderManager as any).shouldUpgradeExitReason.bind(orderManager);

      // Generic -> Specific
      expect(shouldUpgrade('EXCHANGE_SL_OR_MANUAL', 'SL_HIT_M1')).toBe(true);
      expect(shouldUpgrade('EXCHANGE_SYNC', 'SIGNAL_EMA_CLOSE')).toBe(true);
      expect(shouldUpgrade('EXCHANGE_SYNC_RECOVERY', 'SL_HIT_BREAKEVEN')).toBe(true);
    });

    it('should keep the current reason when both are specific', () => {
      const shouldUpgrade = (orderManager as any).shouldUpgradeExitReason.bind(orderManager);

      // Specific -> Specific (e.g. SL_HIT_M1 vs SL_HIT_INITIAL_SL)
      expect(shouldUpgrade('SL_HIT_M1', 'SL_HIT_INITIAL_SL')).toBe(false);
    });
  });

  describe('recoverClosingContext with signal indicators', () => {
    it('should dynamically construct indicator-specific exit reason when clientOrderId starts with sig-', async () => {
      const trade: Trade = {
        id: 'trade-uuid-3',
        symbol: 'BTCUSDT',
        direction: 'LONG',
        qty: 1,
        entry_price: 50000,
        initial_sl: 49000,
        current_sl: 49000,
        status: 'OPEN',
        exit_signals_status: {
          'ema_close_fast': { fired: true, active: true, description: 'EMA fast crossover fired' }
        }
      } as any;

      mockBinanceClient.restAPI.queryOrder.mockResolvedValue({
        data: () => Promise.resolve({
          orderId: '99999999',
          status: 'FILLED',
          avgPrice: '49800',
          type: 'MARKET',
          clientOrderId: 'sig-trade-uuid-3',
        }),
      });

      const recovery = await orderManager.recoverClosingContext('BTCUSDT', trade, 49800, '99999999');

      expect(recovery.reason).toBe('SIGNAL_EMA_CLOSE_FAST');
    });

    it('should retain existing specific trade.exit_reason if no exit_signals_status entry is active/fired', async () => {
      const trade: Trade = {
        id: 'trade-uuid-4',
        symbol: 'BTCUSDT',
        direction: 'LONG',
        qty: 1,
        entry_price: 50000,
        initial_sl: 49000,
        current_sl: 49000,
        status: 'OPEN',
        exit_reason: 'SIGNAL_MACD_PBC',
        exit_signals_status: {}
      } as any;

      mockBinanceClient.restAPI.queryOrder.mockResolvedValue({
        data: () => Promise.resolve({
          orderId: '88888888',
          status: 'FILLED',
          avgPrice: '49700',
          type: 'MARKET',
          clientOrderId: 'sig-trade-uuid-4',
        }),
      });

      const recovery = await orderManager.recoverClosingContext('BTCUSDT', trade, 49700, '88888888');

      expect(recovery.reason).toBe('SIGNAL_MACD_PBC');
    });
  });

  describe('recoverClosingContext with price proximity', () => {
    it('should recover specific milestone Stop Loss based on price proximity when order type is MARKET/generic', async () => {
      const trade: Trade = {
        id: 'trade-uuid-prox-1',
        symbol: 'BTCUSDT',
        direction: 'LONG',
        qty: 1,
        entry_price: 50000,
        initial_sl: 49000,
        current_sl: 49500, // Adjusted to BREAKEVEN/milestone
        status: 'OPEN',
        sl_adjustments: [
          { price: 49500, reason: 'BREAKEVEN', timestamp: Date.now() }
        ]
      } as any;

      mockBinanceClient.restAPI.queryOrder.mockResolvedValue({
        data: () => Promise.resolve({
          orderId: '77777777',
          status: 'FILLED',
          avgPrice: '49501', // Extremely close to 49500 (within 0.5% threshold)
          type: 'MARKET', // Generic type
        }),
      });

      const recovery = await orderManager.recoverClosingContext('BTCUSDT', trade, 49501, '77777777');

      expect(recovery.reason).toBe('SL_HIT_BREAKEVEN');
    });

    it('should recover initial Stop Loss based on price proximity when order type is MARKET/generic', async () => {
      const trade: Trade = {
        id: 'trade-uuid-prox-2',
        symbol: 'BTCUSDT',
        direction: 'LONG',
        qty: 1,
        entry_price: 50000,
        initial_sl: 49000,
        current_sl: 49000,
        status: 'OPEN',
        sl_adjustments: []
      } as any;

      mockBinanceClient.restAPI.queryOrder.mockResolvedValue({
        data: () => Promise.resolve({
          orderId: '77777778',
          status: 'FILLED',
          avgPrice: '48995', // Close to 49000
          type: 'MARKET',
        }),
      });

      const recovery = await orderManager.recoverClosingContext('BTCUSDT', trade, 48995, '77777778');

      expect(recovery.reason).toBe('SL_HIT_INITIAL_SL');
    });

    it('should recover Take Profit based on price proximity when order type is MARKET/generic', async () => {
      const trade: Trade = {
        id: 'trade-uuid-prox-3',
        symbol: 'BTCUSDT',
        direction: 'LONG',
        qty: 1,
        entry_price: 50000,
        initial_sl: 49000,
        current_sl: 49000,
        status: 'OPEN',
        tp_price: 52000,
      } as any;

      mockBinanceClient.restAPI.queryOrder.mockResolvedValue({
        data: () => Promise.resolve({
          orderId: '77777779',
          status: 'FILLED',
          avgPrice: '51999', // Close to 52000
          type: 'MARKET',
        }),
      });

      const recovery = await orderManager.recoverClosingContext('BTCUSDT', trade, 51999, '77777779');

      expect(recovery.reason).toBe(EXIT_REASONS.TP_HIT);
    });

    it('should return SL_HIT_BREAKEVEN when order type is STOP and sl_adjustments indicates BREAKEVEN without trailing stop enabled', async () => {
      const trade: Trade = {
        id: 'trade-uuid-be-1',
        symbol: 'ZROUSDT',
        direction: 'LONG',
        qty: 10,
        entry_price: 1.15,
        initial_sl: 1.0414,
        current_sl: 1.1586,
        status: 'OPEN',
        sl_adjustments: [
          { price: 1.1586, reason: 'BREAKEVEN', timestamp: Date.now() }
        ]
      } as any;

      mockBinanceClient.restAPI.queryOrder.mockResolvedValue({
        data: () => Promise.resolve({
          orderId: '3000002157353725',
          status: 'FILLED',
          avgPrice: '1.1586',
          type: 'STOP',
          stopPrice: '1.1586',
        }),
      });

      const recovery = await orderManager.recoverClosingContext('ZROUSDT', trade, 1.1586, '3000002157353725');

      expect(recovery.reason).toBe('SL_HIT_BREAKEVEN');
      expect(recovery.reason).not.toBe(EXIT_REASONS.TRAILING_STOP);
    });

    it('should return TRAILING_STOP when sl_adjustments indicates TRAILING_STOP', async () => {
      const trade: Trade = {
        id: 'trade-uuid-ts-1',
        symbol: 'ZROUSDT',
        direction: 'LONG',
        qty: 10,
        entry_price: 1.15,
        initial_sl: 1.0414,
        current_sl: 1.18,
        status: 'OPEN',
        sl_adjustments: [
          { price: 1.18, reason: 'TRAILING_STOP', timestamp: Date.now() }
        ]
      } as any;

      mockBinanceClient.restAPI.queryOrder.mockResolvedValue({
        data: () => Promise.resolve({
          orderId: '3000002157353726',
          status: 'FILLED',
          avgPrice: '1.18',
          type: 'STOP',
          stopPrice: '1.18',
        }),
      });

      const recovery = await orderManager.recoverClosingContext('ZROUSDT', trade, 1.18, '3000002157353726');

      expect(recovery.reason).toBe(EXIT_REASONS.TRAILING_STOP);
    });
  });

  describe('closeTrade integration', () => {
    it('should preserve SL_HIT_M1 reason and CLOSED_SL status instead of downgrading to EXCHANGE_SL_OR_MANUAL', async () => {
      const trade: Trade = {
        id: 'trade-uuid-5',
        symbol: 'BTCUSDT',
        direction: 'LONG',
        qty: 1,
        entry_price: 50000,
        initial_sl: 49000,
        current_sl: 49050,
        status: 'OPEN',
        binance_order_id: 'entry-order-5',
        binance_stop_order_id: '111111',
        sl_adjustments: [
          { price: 49050, reason: 'M1', timestamp: Date.now() }
        ],
        close_attempts: 0,
      } as any;

      // Simulate localOnly external closure (e.g. from WS event)
      mockBinanceClient.restAPI.queryOrder.mockResolvedValue({
        data: () => Promise.resolve({
          orderId: '111111',
          status: 'FILLED',
          avgPrice: '49050',
          type: 'MARKET', // Causes generic EXCHANGE_SL_OR_MANUAL in queryOrder recovery
        }),
      });

      const result = await orderManager.closeTrade('BTCUSDT', trade, 49050, 'SL_HIT_M1', false, true);

      expect(result.exitOccurred).toBe(true);
      expect(result.trade.exit_reason).toBe('SL_HIT_M1');
      expect(result.trade.status).toBe('CLOSED_SL');
    });
  });
});
