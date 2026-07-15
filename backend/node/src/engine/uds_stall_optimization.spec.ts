import { OrderFilterService } from './order-filter.service';
import { BroadcastService } from './broadcast.service';
import { Test, TestingModule } from '@nestjs/testing';
import { SessionLifecycleService } from './session-lifecycle.service';
import { SessionStateService } from './session_state.service';
import { OrderManagerService } from './orderManager';
import { MarketFeedService } from './market_feed.service';
import { MomentumScannerService } from './momentum_scanner.service';
import { PositionTrackerService } from './positionTracker';
import { MonitoringService } from './monitoring.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AuditLogService } from '../trading/audit-log.service';

describe('UDS Stall Optimization', () => {
  let service: SessionLifecycleService;
  let positionTracker: PositionTrackerService;
  let monitoringService: MonitoringService;

  const mockWs = {
    on: jest.fn(),
    disconnect: jest.fn(),
    pingServer: jest.fn(),
  };

  const mockBinanceClient = {
    restAPI: {
      startUserDataStream: jest.fn().mockResolvedValue({
        data: () => Promise.resolve({ listenKey: 'test-key' })
      }),
      keepaliveUserDataStream: jest.fn().mockResolvedValue({}),
      closeUserDataStream: jest.fn().mockResolvedValue({}),
      getCurrentPositionMode: jest.fn().mockResolvedValue({
        data: () => Promise.resolve({ dualSidePosition: false })
      }),
      futuresAccountBalanceV2: jest.fn().mockResolvedValue({
        data: () => Promise.resolve([{ asset: 'USDT', balance: '100' }])
      }),
    },
    websocketStreams: {
      connect: jest.fn().mockResolvedValue(mockWs),
    },
  };

  beforeEach(async () => {
    jest.useFakeTimers();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        { provide: OrderFilterService, useValue: { applyFilters: jest.fn((sym, val) => val), checkLeverageBracket: jest.fn(() => ({ isAllowed: true, maxNotional: 1000000 })) } },
        { provide: BroadcastService, useValue: { broadcast: jest.fn(), setWsBroadcaster: jest.fn() } },
        SessionLifecycleService,
        { provide: SessionStateService, useValue: { reset: jest.fn(), updateRateLimit: jest.fn(), isRateLimited: jest.fn().mockReturnValue(false), isBanned: jest.fn().mockReturnValue(false), realTimePositions: new Map(), activeTrades: [], binanceRateLimit: { used_1m: 0, limit: 2400 } } },
        { provide: OrderManagerService, useValue: { setBinanceClient: jest.fn(), isRatcheting: jest.fn().mockReturnValue(false) } },
        { provide: MarketFeedService, useValue: { start: jest.fn(), stop: jest.fn() } },
        { provide: MomentumScannerService, useValue: { start: jest.fn(), stop: jest.fn() } },
        { provide: PositionTrackerService, useValue: { addTrade: jest.fn(), activeList: jest.fn().mockReturnValue([]), isEntering: jest.fn().mockReturnValue(false), isClosing: jest.fn().mockReturnValue(false) } },
        { provide: MonitoringService, useValue: { getMetrics: jest.fn(), recordUdsPing: jest.fn(), setUdsStatus: jest.fn(), incrementApiRequests: jest.fn() } },
        { provide: AuditLogService, useValue: { log: jest.fn() } },
        { provide: EventEmitter2, useValue: { emit: jest.fn() } },
        { provide: "SettingsRepository", useValue: { findOne: jest.fn().mockResolvedValue({}), update: jest.fn().mockResolvedValue({}) } }
      ],
    }).compile();

    service = module.get<SessionLifecycleService>(SessionLifecycleService);
    positionTracker = module.get<PositionTrackerService>(PositionTrackerService);
    monitoringService = module.get<MonitoringService>(MonitoringService);

    (service as any).running = true;
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('should NOT reconnect if idle and last ping is 150s', async () => {
    // Manually trigger startUserDataStream to initialize intervals
    await (service as any).startUserDataStream(mockBinanceClient);

    // The spy should be created AFTER the first call if we want to count only future calls,
    // OR we can just check the total calls.
    const startSpy = jest.spyOn(service as any, 'startUserDataStream');

    jest.spyOn(positionTracker, 'activeList').mockReturnValue([]);
    jest.spyOn(monitoringService, 'getMetrics').mockReturnValue({
      application: {
        exchange_uds_status: 'LAGGING',
        last_uds_ping_sec: 150,
      }
    } as any);

    // Trigger the interval
    jest.advanceTimersByTime(60000);

    // Should NOT have been called again
    expect(startSpy).not.toHaveBeenCalled();
  });

  it('should reconnect if HAS active trades and last ping is 350s', async () => {
    await (service as any).startUserDataStream(mockBinanceClient);
    const startSpy = jest.spyOn(service as any, 'startUserDataStream');

    jest.spyOn(positionTracker, 'activeList').mockReturnValue([{ id: 'trade-1' }] as any);
    jest.spyOn(monitoringService, 'getMetrics').mockReturnValue({
      application: {
        exchange_uds_status: 'LAGGING',
        last_uds_ping_sec: 350,
      }
    } as any);

    jest.advanceTimersByTime(60000);

    expect(startSpy).toHaveBeenCalledTimes(1);
  });

  it('should reconnect if idle but last ping exceeds MAX_IDLE_SILENCE (650s)', async () => {
    await (service as any).startUserDataStream(mockBinanceClient);
    const startSpy = jest.spyOn(service as any, 'startUserDataStream');

    jest.spyOn(positionTracker, 'activeList').mockReturnValue([]);
    jest.spyOn(monitoringService, 'getMetrics').mockReturnValue({
      application: {
        exchange_uds_status: 'LAGGING',
        last_uds_ping_sec: 650,
      }
    } as any);

    jest.advanceTimersByTime(60000);

    expect(startSpy).toHaveBeenCalledTimes(1);
  });

  it('should call pingServer on every check if UDS is connected', async () => {
    await (service as any).startUserDataStream(mockBinanceClient);
    const ws = (service as any).userDataWs;
    const pingSpy = jest.spyOn(ws, 'pingServer');

    jest.spyOn(monitoringService, 'getMetrics').mockReturnValue({
      application: {
        exchange_uds_status: 'CONNECTED',
        last_uds_ping_sec: 10,
      }
    } as any);

    jest.advanceTimersByTime(60000);
    expect(pingSpy).toHaveBeenCalled();
  });
});
