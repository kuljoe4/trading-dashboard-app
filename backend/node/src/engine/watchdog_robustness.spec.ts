import { Test, TestingModule } from '@nestjs/testing';
import { MaintenanceService } from './maintenance.service';
import { PositionTrackerService } from './positionTracker';
import { OrderManagerService } from './orderManager';
import { TickerCacheService } from './ticker_cache.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Trade } from '../models/Trade';

describe('Watchdog Robustness', () => {
  let service: MaintenanceService;
  let positionTracker: PositionTrackerService;
  let orderManager: OrderManagerService;
  let module: TestingModule;

  beforeEach(async () => {
    module = await Test.createTestingModule({
      providers: [
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
            placeStopLoss: jest.fn(),
            cancelBinanceOrder: jest.fn(),
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

  it('should skip audit during the 45s cooldown window', async () => {
    const trade = {
      symbol: 'BTCUSDT',
      binance_order_id: '123',
      updated_at: new Date(Date.now() - 10000), // 10s ago
    } as Trade;

    (positionTracker.activeList as jest.Mock).mockReturnValue([trade]);

    await service.protectionWatchdog(true, { paper_mode: false } as any);

    expect(orderManager.fetchAllPositions).not.toHaveBeenCalled();
  });

  it('should perform audit after cooldown window', async () => {
    const trade = {
      symbol: 'BTCUSDT',
      binance_order_id: '123',
      updated_at: new Date(Date.now() - 60000), // 60s ago
    } as Trade;

    (positionTracker.activeList as jest.Mock).mockReturnValue([trade]);
    // Small trade set (<= 5) uses targeted audit (fetchPosition) instead of bulk (fetchAllPositions)
    (orderManager.fetchPosition as jest.Mock).mockResolvedValue({ symbol: 'BTCUSDT', positionAmt: '1.0', entryPrice: '50000' });
    (orderManager.fetchOpenOrders as jest.Mock).mockResolvedValue([]); // No SL found

    await service.protectionWatchdog(true, { paper_mode: false } as any);

    expect(orderManager.fetchPosition).toHaveBeenCalledWith('BTCUSDT', { forceFresh: true });
    expect(orderManager.placeStopLoss).toHaveBeenCalled();
  });

  it('should trigger NUCLEAR OPTION if unprotected for > 2 minutes', async () => {
    const eventEmitter = module.get<EventEmitter2>(EventEmitter2);
    const trade = {
      id: 'test-uuid',
      symbol: 'BTCUSDT',
      binance_order_id: '123',
      qty: 1.0,
      updated_at: new Date(Date.now() - 150000), // 150s ago (> 120s)
    } as Trade;

    (positionTracker.activeList as jest.Mock).mockReturnValue([trade]);
    // Small trade set (<= 5) uses targeted audit (fetchPosition) instead of bulk (fetchAllPositions)
    (orderManager.fetchPosition as jest.Mock).mockResolvedValue({ symbol: 'BTCUSDT', positionAmt: '1.0', entryPrice: '50000' });
    (orderManager.fetchOpenOrders as jest.Mock).mockResolvedValue([]); // No SL found in targeted or fresh audit

    await service.protectionWatchdog(true, { paper_mode: false } as any);

    // Should emit closure event instead of calling orderManager directly
    expect(eventEmitter.emit).toHaveBeenCalledWith('trade.exchange_close', {
      symbol: 'BTCUSDT',
      exitPrice: 0,
      reason: 'WATCHDOG_NUCLEAR_CLOSE'
    });
    expect(orderManager.placeStopLoss).not.toHaveBeenCalled(); // Close instead of repair
  });
});
