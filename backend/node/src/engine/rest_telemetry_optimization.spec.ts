import { Test, TestingModule } from '@nestjs/testing';
import { MaintenanceService } from './maintenance.service';
import { PositionTrackerService } from './positionTracker';
import { OrderManagerService } from './orderManager';
import { TickerCacheService } from './ticker_cache.service';
import { SessionStateService } from './session_state.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { MonitoringService } from './monitoring.service';
import { SessionConfig } from '../models/SessionConfig';
import { Trade } from '../models/Trade';
import { SignalEngineService } from './signalEngine';
import { MarketFeedService } from './market_feed.service';
import { BroadcastService } from './broadcast.service';
import { AuditLogService } from '../trading/audit-log.service';
import { OrderFilterService } from './order-filter.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Settings as SettingsEntity } from '../models/entities/Settings.entity';

describe('REST Telemetry & Watchdog Cache Optimization', () => {
  let maintenanceService: MaintenanceService;
  let orderManager: OrderManagerService;
  let sessionState: SessionStateService;
  let positionTracker: PositionTrackerService;
  let monitoringService: MonitoringService;

  beforeEach(async () => {
    const mockOrderManager = {
      isBanned: jest.fn().mockReturnValue(false),
      getBinanceRateLimit: jest.fn().mockReturnValue({ used_weight_1m: 100, limit: 2400 }),
      fetchAllPositions: jest.fn().mockResolvedValue([]),
      fetchAllOpenOrders: jest.fn().mockResolvedValue([]),
      fetchPosition: jest.fn(),
      fetchOpenOrders: jest.fn(),
      seedRealTimePosition: jest.fn(),
      isRatcheting: jest.fn().mockReturnValue(false),
    };

    const mockPositionTracker = {
      activeList: jest.fn().mockReturnValue([]),
      isEntering: jest.fn().mockReturnValue(false),
      isClosing: jest.fn().mockReturnValue(false),
      recalculateTotalRisk: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MaintenanceService,
        SessionStateService,
        MonitoringService,
        { provide: OrderManagerService, useValue: mockOrderManager },
        { provide: PositionTrackerService, useValue: mockPositionTracker },
        { provide: TickerCacheService, useValue: { getTicker: jest.fn() } },
        { provide: EventEmitter2, useValue: { emit: jest.fn() } },
      ],
    }).compile();

    maintenanceService = module.get<MaintenanceService>(MaintenanceService);
    orderManager = module.get<OrderManagerService>(OrderManagerService);
    sessionState = module.get<SessionStateService>(SessionStateService);
    positionTracker = module.get<PositionTrackerService>(PositionTrackerService);
    monitoringService = module.get<MonitoringService>(MonitoringService);
  });

  it('should use zero-weight targeted cache audit in protectionWatchdog when all audited symbols are cached in UDS', async () => {
    // 8 active trades (> 5 trades threshold)
    const mockTrades: Partial<Trade>[] = Array.from({ length: 8 }, (_, i) => ({
      id: `trade-${i + 1}`,
      symbol: `SYM_${i + 1}USDT`,
      binance_order_id: `ord-${i + 1}`,
      binance_stop_order_id: `sl-${i + 1}`,
      qty: 1.0,
      direction: 'LONG',
      entry_price: 100,
      current_sl: 98,
      updated_at: new Date(Date.now() - 60000), // 60s ago (> 45s threshold)
    }));

    (positionTracker.activeList as jest.Mock).mockReturnValue(mockTrades);

    // Populate UDS real-time position and order caches for all 8 symbols
    for (const trade of mockTrades) {
      sessionState.realTimePositions.set(trade.symbol!, { amount: trade.qty!, entryPrice: trade.entry_price! });
      sessionState.realTimeOrders.set(trade.symbol!, [
        {
          orderId: trade.binance_stop_order_id,
          symbol: trade.symbol,
          type: 'STOP_MARKET',
          closePosition: true,
          stopPrice: '98',
          origQty: '1.0',
        },
      ]);

      (orderManager.fetchPosition as jest.Mock).mockImplementation((symbol: string) => {
        const cached = sessionState.realTimePositions.get(symbol);
        return Promise.resolve(cached ? { symbol, positionAmt: String(cached.amount), entryPrice: String(cached.entryPrice) } : null);
      });

      (orderManager.fetchOpenOrders as jest.Mock).mockImplementation((symbol: string) => {
        const cached = sessionState.realTimeOrders.get(symbol);
        return Promise.resolve(cached || []);
      });
    }

    const config = { paper_mode: false } as SessionConfig;
    await maintenanceService.protectionWatchdog(true, config);

    // Verify zero bulk REST calls were made because UDS cache was complete
    expect(orderManager.fetchAllPositions).not.toHaveBeenCalled();
    expect(orderManager.fetchAllOpenOrders).not.toHaveBeenCalled();
  });

  it('should fallback to bulk REST audit in protectionWatchdog when UDS cache is missing for an audited symbol', async () => {
    const mockTrades: Partial<Trade>[] = Array.from({ length: 8 }, (_, i) => ({
      id: `trade-${i + 1}`,
      symbol: `SYM_${i + 1}USDT`,
      binance_order_id: `ord-${i + 1}`,
      binance_stop_order_id: `sl-${i + 1}`,
      qty: 1.0,
      direction: 'LONG',
      entry_price: 100,
      current_sl: 98,
      updated_at: new Date(Date.now() - 60000),
    }));

    (positionTracker.activeList as jest.Mock).mockReturnValue(mockTrades);

    // Populate cache for only 7 out of 8 symbols (SYM_8USDT missing from order cache)
    for (let i = 0; i < 7; i++) {
      const trade = mockTrades[i];
      sessionState.realTimePositions.set(trade.symbol!, { amount: trade.qty!, entryPrice: trade.entry_price! });
      sessionState.realTimeOrders.set(trade.symbol!, []);
    }

    const config = { paper_mode: false } as SessionConfig;
    await maintenanceService.protectionWatchdog(true, config);

    // Verify fallback to bulk audit occurred
    expect(orderManager.fetchAllPositions).toHaveBeenCalled();
    expect(orderManager.fetchAllOpenOrders).toHaveBeenCalled();
  });

  it('should clear stale orders from sessionState.realTimeOrders in fetchAllOpenOrders when orders close', async () => {
    sessionState.realTimeOrders.set('BTCUSDT', [{ orderId: '101', symbol: 'BTCUSDT' }]);
    sessionState.realTimeOrders.set('ETHUSDT', [{ orderId: '102', symbol: 'ETHUSDT' }]);

    const mockBinanceClient = {
      restAPI: {
        currentAllOpenOrders: jest.fn().mockResolvedValue({
          data: () => Promise.resolve([{ orderId: '101', symbol: 'BTCUSDT' }]),
          headers: {},
        }),
        currentAllAlgoOpenOrders: jest.fn().mockResolvedValue({
          data: () => Promise.resolve([]),
          headers: {},
        }),
      },
    };

    const omModule: TestingModule = await Test.createTestingModule({
      providers: [
        OrderManagerService,
        SessionStateService,
        MonitoringService,
        { provide: SignalEngineService, useValue: {} },
        { provide: MarketFeedService, useValue: {} },
        { provide: TickerCacheService, useValue: {} },
        { provide: PositionTrackerService, useValue: positionTracker },
        { provide: BroadcastService, useValue: {} },
        { provide: AuditLogService, useValue: {} },
        { provide: EventEmitter2, useValue: { emit: jest.fn() } },
        { provide: getRepositoryToken(SettingsEntity), useValue: { findOne: jest.fn(), update: jest.fn() } },
        { provide: OrderFilterService, useValue: {} },
      ],
    }).compile();

    const omInstance = omModule.get<OrderManagerService>(OrderManagerService);
    const omSessionState = omModule.get<SessionStateService>(SessionStateService);
    omSessionState.realTimeOrders.set('BTCUSDT', [{ orderId: '101', symbol: 'BTCUSDT' }]);
    omSessionState.realTimeOrders.set('ETHUSDT', [{ orderId: '102', symbol: 'ETHUSDT' }]);

    await omInstance.setBinanceClient(mockBinanceClient as any, false);
    const result = await omInstance.fetchAllOpenOrders();

    expect(result).toHaveLength(1);
    expect(omSessionState.realTimeOrders.get('BTCUSDT')).toHaveLength(1);
    // ETHUSDT orders closed on exchange -> realTimeOrders cleared
    expect(omSessionState.realTimeOrders.get('ETHUSDT')).toEqual([]);
  });

  it('should correctly record REST telemetry in MonitoringService without duplicate increments', () => {
    monitoringService.recordRestCall('positionInformationV3', 85, 12, 'ok');

    const metrics = monitoringService.getMetrics();
    expect(metrics.application.api_requests_total).toBe(1);
    expect(metrics.application.api_requests_breakdown['positionInformationV3']).toBe(1);
    expect(metrics.application.rest_telemetry_logs).toHaveLength(1);
    expect(metrics.application.rest_telemetry_logs[0].label).toBe('positionInformationV3');
  });
});
