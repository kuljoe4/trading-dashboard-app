import { OrderFilterService } from './order-filter.service';
import { BroadcastService } from './broadcast.service';
import { Test, TestingModule } from '@nestjs/testing';
import { SessionStateService } from './session_state.service';
import { MaintenanceService } from './maintenance.service';
import { PositionTrackerService } from './positionTracker';
import { OrderManagerService } from './orderManager';
import { TickerCacheService } from './ticker_cache.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Trade } from '../models/Trade';

describe('Watchdog Quantity Parity', () => {
  let service: MaintenanceService;
  let positionTracker: PositionTrackerService;
  let orderManager: OrderManagerService;
  let module: TestingModule;

  beforeEach(async () => {
    module = await Test.createTestingModule({
      providers: [
        { provide: OrderFilterService, useValue: { applyFilters: jest.fn((sym, val) => val), checkLeverageBracket: jest.fn(() => ({ isAllowed: true, maxNotional: 1000000 })) } },
        { provide: BroadcastService, useValue: { broadcast: jest.fn(), setWsBroadcaster: jest.fn() } },
        { provide: SessionStateService, useValue: { isBanned: jest.fn().mockReturnValue(false), setActiveTrades: jest.fn(), realTimePositions: new Map(), config: { trailing_guard_buffer_pct: 0.5 } } },
        MaintenanceService,
        {
          provide: PositionTrackerService,
          useValue: {
            activeList: jest.fn(),
            isEntering: jest.fn().mockReturnValue(false),
            isClosing: jest.fn().mockReturnValue(false),
            recalculateTotalRisk: jest.fn(),
          },
        },
        {
          provide: OrderManagerService,
          useValue: {
            fetchAllPositions: jest.fn(),
            fetchOpenOrders: jest.fn(),
            fetchPosition: jest.fn(),
            isRatcheting: jest.fn().mockReturnValue(false),
            isBanned: jest.fn().mockReturnValue(false),
            placeStopLoss: jest.fn(),
            cancelBinanceOrder: jest.fn().mockResolvedValue(true),
            closeTrade: jest.fn(),
            getBinanceRateLimit: jest.fn().mockReturnValue({ used_weight_1m: 0, limit: 2400 }),
            fetchAllOpenOrders: jest.fn().mockResolvedValue([]),
            seedRealTimePosition: jest.fn(),
          },
        },
        {
          provide: TickerCacheService,
          useValue: {
            getPrice: jest.fn(),
          },
        },
        {
          provide: EventEmitter2,
          useValue: {
            emit: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<MaintenanceService>(MaintenanceService);
    positionTracker = module.get<PositionTrackerService>(PositionTrackerService);
    orderManager = module.get<OrderManagerService>(OrderManagerService);
  });

  it('should trigger SL replacement if exchange SL quantity does not match position quantity', async () => {
    const trade = {
      symbol: 'BTCUSDT',
      binance_order_id: '123',
      binance_stop_order_id: 'sl_999',
      qty: 0.5, // Current engine assumes 0.5
      updated_at: new Date(Date.now() - 60000), // > 45s ago
    } as Trade;

    (positionTracker.activeList as jest.Mock).mockReturnValue([trade]);

    // Exchange says position is actually 0.5 (matches trade.qty for this test case)
    (orderManager.fetchPosition as jest.Mock).mockResolvedValue({
      symbol: 'BTCUSDT',
      positionAmt: '0.5',
      entryPrice: '50000'
    });

    // But exchange SL order has a different quantity (e.g., 0.1)
    const slOrder = {
      orderId: 'sl_999',
      symbol: 'BTCUSDT',
      type: 'STOP_MARKET',
      origQty: '0.1', // MISMATCH! Position is 0.5, but SL only protects 0.1
      reduceOnly: 'true',
      stopPrice: '49000'
    };

    (orderManager.fetchOpenOrders as jest.Mock).mockResolvedValue([slOrder]);

    await service.protectionWatchdog(true, { paper_mode: false } as any);

    // Current implementation will NOT call these because it only checks for the presence of matchingOrder
    expect(orderManager.cancelBinanceOrder).toHaveBeenCalledWith('BTCUSDT', 'sl_999', 'standard');
    expect(orderManager.placeStopLoss).toHaveBeenCalled();
  });

  it('should NOT trigger SL replacement if quantity matches', async () => {
    const trade = {
      symbol: 'BTCUSDT',
      binance_order_id: '123',
      binance_stop_order_id: 'sl_999',
      qty: 0.5,
      updated_at: new Date(Date.now() - 60000),
    } as Trade;

    (positionTracker.activeList as jest.Mock).mockReturnValue([trade]);
    (orderManager.fetchPosition as jest.Mock).mockResolvedValue({
      symbol: 'BTCUSDT',
      positionAmt: '0.5',
      entryPrice: '50000'
    });

    const slOrder = {
      orderId: 'sl_999',
      symbol: 'BTCUSDT',
      type: 'STOP_MARKET',
      origQty: '0.5', // MATCH
      reduceOnly: 'true',
      stopPrice: '49000'
    };

    (orderManager.fetchOpenOrders as jest.Mock).mockResolvedValue([slOrder]);

    await service.protectionWatchdog(true, { paper_mode: false } as any);

    expect(orderManager.cancelBinanceOrder).not.toHaveBeenCalled();
    expect(orderManager.placeStopLoss).not.toHaveBeenCalled();
  });
});
