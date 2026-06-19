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

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MaintenanceService,
        {
          provide: PositionTrackerService,
          useValue: {
            activeList: jest.fn(),
          },
        },
        {
          provide: OrderManagerService,
          useValue: {
            fetchAllPositions: jest.fn().mockResolvedValue([]),
            fetchOpenOrders: jest.fn().mockResolvedValue([]),
            fetchAllOpenOrders: jest.fn().mockResolvedValue([]),
            fetchAllOpenAlgoOrders: jest.fn().mockResolvedValue([]),
            isRatcheting: jest.fn().mockReturnValue(false),
            placeStopLoss: jest.fn().mockResolvedValue({ orderId: '777' }),
            cancelBinanceOrder: jest.fn().mockResolvedValue(true),
            closeTrade: jest.fn().mockResolvedValue({ exitOccurred: true }),
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
    (orderManager.fetchAllPositions as jest.Mock).mockResolvedValue([{ symbol: 'BTCUSDT', positionAmt: '1.0' }]);
    (orderManager.fetchAllOpenOrders as jest.Mock).mockResolvedValue([]);
    (orderManager.fetchAllOpenAlgoOrders as jest.Mock).mockResolvedValue([]); // No SL found

    await service.protectionWatchdog(true, { paper_mode: false } as any);

    expect(orderManager.fetchAllPositions).toHaveBeenCalled();
    expect(orderManager.placeStopLoss).toHaveBeenCalled();
  });

  it('should trigger NUCLEAR OPTION if unprotected for > 2 minutes', async () => {
    const trade = {
      symbol: 'BTCUSDT',
      binance_order_id: '123',
      updated_at: new Date(Date.now() - 150000), // 150s ago (> 120s)
    } as Trade;

    (positionTracker.activeList as jest.Mock).mockReturnValue([trade]);
    (orderManager.fetchAllPositions as jest.Mock).mockResolvedValue([{ symbol: 'BTCUSDT', positionAmt: '1.0' }]);
    (orderManager.fetchAllOpenOrders as jest.Mock).mockResolvedValue([]);
    (orderManager.fetchAllOpenAlgoOrders as jest.Mock).mockResolvedValue([]); // No SL found

    await service.protectionWatchdog(true, { paper_mode: false } as any);

    expect(orderManager.closeTrade).toHaveBeenCalledWith(
      'BTCUSDT',
      trade,
      0,
      'WATCHDOG_NUCLEAR_CLOSE',
      false,
      false
    );
    expect(orderManager.placeStopLoss).not.toHaveBeenCalled(); // Close instead of repair
  });
});
