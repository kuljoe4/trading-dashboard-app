import { Test, TestingModule } from '@nestjs/testing';
import { PositionTrackerService } from './positionTracker';
import { OrderManagerService } from './orderManager';
import { MaintenanceService } from './maintenance.service';
import { TickerCacheService } from './ticker_cache.service';
import { RiskEngineService } from './riskEngine';
import { SignalEngineService } from './signalEngine';
import { KlineStoreService } from './kline_store.service';
import { SessionStateService } from './session_state.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Trade } from '../models/Trade';
import { SessionConfig } from '../models/SessionConfig';

describe('SL Integrity (Chronos Audit)', () => {
  let positionTracker: PositionTrackerService;
  let maintenanceService: MaintenanceService;
  let orderManager: OrderManagerService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PositionTrackerService,
        MaintenanceService,
        {
          provide: OrderManagerService,
          useValue: {
            updateStopLoss: jest.fn(),
            applyFilters: jest.fn((s, p, q) => ({ price: p, qty: q })),
            isRatcheting: jest.fn().mockReturnValue(false),
            fetchPosition: jest.fn(),
            fetchOpenOrders: jest.fn(),
            cancelBinanceOrder: jest.fn(),
            getBinanceRateLimit: jest.fn().mockReturnValue({ used_weight_1m: 0, limit: 2400 }),
            isBanned: jest.fn().mockReturnValue(false),
            seedRealTimePosition: jest.fn(),
          },
        },
        {
          provide: TickerCacheService,
          useValue: { getPrice: jest.fn() },
        },
        {
          provide: EventEmitter2,
          useValue: { emit: jest.fn() },
        },
        { provide: RiskEngineService, useValue: {} },
        { provide: SignalEngineService, useValue: {} },
        { provide: KlineStoreService, useValue: {} },
        { provide: SessionStateService, useValue: { realTimePositions: new Map(), realTimeOrders: new Map() } },
      ],
    }).compile();

    positionTracker = module.get<PositionTrackerService>(PositionTrackerService);
    maintenanceService = module.get<MaintenanceService>(MaintenanceService);
    orderManager = module.get<OrderManagerService>(OrderManagerService);
  });

  describe('SL Ratchet Atomicity', () => {
    it('should NOT commit milestone index if exchange update fails', async () => {
      const trade = {
        symbol: 'BTCUSDT',
        direction: 'LONG',
        entry_price: 50000,
        initial_sl: 49000,
        current_sl: 49000,
        qty: 1.0,
        rr_sequence_index: -1,
        max_rr_achieved: 0,
        status: 'OPEN',
      } as Trade;

      const config = {
        live_rr_sequence: [1.0], // Milestone at 1.0 RR (51000)
        exit_rr_sequence: [0.5], // Move SL to 0.5 RR (50500)
        trailing_guard_buffer_pct: 0.01,
      } as SessionConfig;

      // Use addTrade to ensure internal maps are initialized correctly
      positionTracker.addTrade(trade);

      // Current price is at 1.0 RR (51000)
      const currentPrice = 51000;

      // Exchange update FAILS
      (orderManager.updateStopLoss as jest.Mock).mockResolvedValue({ success: false });

      await positionTracker.checkRrSequenceAdjustments(trade.symbol, currentPrice, config);

      // EXPECTATION: Local state remains at -1 because exchange failed
      expect(trade.rr_sequence_index).toBe(-1);
      // @ts-ignore
      expect(positionTracker.rrSequenceIndex.get(trade.symbol)).toBe(-1);
      expect(trade.current_sl).toBe(49000);
    });
  });

  describe('Orphan SL Purge', () => {
    it('should cancel orphan SL orders found on exchange', async () => {
      const trade = {
        id: 'trade-123',
        symbol: 'BTCUSDT',
        binance_order_id: 'ent-123',
        binance_stop_order_id: 'sl-tracked',
        qty: 1.0,
        updated_at: new Date(Date.now() - 60000), // Force audit
      } as Trade;

      // @ts-ignore
      jest.spyOn(positionTracker, 'activeList').mockReturnValue([trade]);
      (orderManager.fetchPosition as jest.Mock).mockResolvedValue({ symbol: 'BTCUSDT', positionAmt: '1.0' });

      // Exchange has TWO SL orders: one tracked, one orphan
      const exchangeOrders = [
        { orderId: 'sl-tracked', type: 'STOP_MARKET', stopPrice: '49000', origQty: '1.0', reduceOnly: true },
        { orderId: 'sl-orphan', type: 'STOP_MARKET', stopPrice: '48000', origQty: '1.0', reduceOnly: true },
      ];
      (orderManager.fetchOpenOrders as jest.Mock).mockResolvedValue(exchangeOrders);

      await maintenanceService.protectionWatchdog(true, { paper_mode: false } as any);

      // EXPECTATION: Watchdog should have cancelled the orphan
      expect(orderManager.cancelBinanceOrder).toHaveBeenCalledWith('BTCUSDT', 'sl-orphan', 'standard');
    });
  });
});
