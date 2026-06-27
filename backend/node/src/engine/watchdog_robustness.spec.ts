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
            addTrade: jest.fn(),
            reconcileMilestoneFromSl: jest.fn((trade, slPrice, config) => {
              if (Number(slPrice) === 50000) trade.rr_sequence_index = 0;
              return trade.rr_sequence_index;
            }),
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
    const trades = [{
      symbol: 'BTCUSDT',
      binance_order_id: '123',
      updated_at: new Date(Date.now() - 60000),
    }] as Trade[];

    (positionTracker.activeList as jest.Mock).mockReturnValue(trades);
    (orderManager.fetchPosition as jest.Mock).mockResolvedValue({ symbol: 'BTCUSDT', positionAmt: '1.0' });
    (orderManager.fetchOpenOrders as jest.Mock).mockResolvedValue([]); // No SL found

    await service.protectionWatchdog(true, { paper_mode: false } as any);

    expect(orderManager.fetchPosition).toHaveBeenCalledWith('BTCUSDT', { forceFresh: false });
    expect(orderManager.placeStopLoss).toHaveBeenCalled();
  });

  it('should trigger NUCLEAR OPTION if unprotected for > 2 minutes', async () => {
    const eventEmitter = module.get<EventEmitter2>(EventEmitter2);
    const trades = Array(6).fill(null).map((_, i) => ({
      id: `test-uuid-${i}`,
      symbol: `BTCUSDT_${i}`,
      binance_order_id: `123_${i}`,
      qty: 1.0,
      updated_at: new Date(Date.now() - 150000), // 150s ago (> 120s)
    })) as Trade[];

    (positionTracker.activeList as jest.Mock).mockReturnValue(trades);
    (orderManager.fetchAllPositions as jest.Mock).mockResolvedValue(trades.map(t => ({ symbol: t.symbol, positionAmt: '1.0' })));
    (orderManager.fetchOpenOrders as jest.Mock).mockResolvedValue([]); // No SL found in batch or fresh

    await service.protectionWatchdog(true, { paper_mode: false } as any);

    // Should emit closure event instead of calling orderManager directly
    expect(eventEmitter.emit).toHaveBeenCalledWith('trade.exchange_close', expect.objectContaining({
      symbol: 'BTCUSDT_0',
      exitPrice: 0,
      reason: 'WATCHDOG_NUCLEAR_CLOSE'
    }));
    expect(orderManager.placeStopLoss).not.toHaveBeenCalled(); // Close instead of repair
  });

  it('should reconcile rr_sequence_index when adopting untracked SL', async () => {
    const trade = {
      symbol: 'BTCUSDT',
      direction: 'LONG',
      qty: 1.0,
      entry_price: 50000,
      initial_sl: 49000,
      current_sl: 49000,
      rr_sequence_index: -1,
      binance_order_id: 'entry_123',
      updated_at: new Date(Date.now() - 60000),
    } as Trade;

    const config = {
      paper_mode: false,
      exit_rr_sequence: [0, 1.0, 2.0], // 0 = Breakeven
    };

    (positionTracker.activeList as jest.Mock).mockReturnValue([trade]);
    (orderManager.fetchPosition as jest.Mock).mockResolvedValue({ symbol: 'BTCUSDT', positionAmt: '1.0' });

    // Exchange has SL at 50000 (Breakeven, index 0)
    (orderManager.fetchOpenOrders as jest.Mock).mockResolvedValue([
      { symbol: 'BTCUSDT', orderId: 'sl_999', type: 'STOP_MARKET', stopPrice: '50000', quantity: '1.0', reduceOnly: true }
    ]);

    await service.protectionWatchdog(true, config as any);

    expect(trade.binance_stop_order_id).toBe('sl_999');
    expect(trade.current_sl).toBe(50000);
    expect(trade.rr_sequence_index).toBe(0); // Successfully reconciled index 0
    expect(positionTracker.addTrade).toHaveBeenCalledWith(trade);
  });
});
