import { Test, TestingModule } from '@nestjs/testing';
import { SessionLifecycleService } from './session-lifecycle.service';
import { SessionStateService } from './session_state.service';
import { OrderManagerService } from './orderManager';
import { MarketFeedService } from './market_feed.service';
import { MomentumScannerService } from './momentum_scanner.service';
import { PositionTrackerService } from './positionTracker';
import { MonitoringService } from './monitoring.service';
import { AuditLogService } from '../trading/audit-log.service';
import { BroadcastService } from './broadcast.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ENGINE_CONSTANTS } from '../models/constants';

describe('Chronos: UDS Keepalive Failure Recovery', () => {
  let service: SessionLifecycleService;
  let mockBinanceClient: any;
  let mockWs: any;

  const sessionStateMock = {
    reset: jest.fn(),
    updateRateLimit: jest.fn(),
    isRateLimited: jest.fn().mockReturnValue(false),
    isBanned: jest.fn().mockReturnValue(false),
    realTimePositions: new Map(),
    activeTrades: [],
    binanceRateLimit: { used_1m: 0, limit: 2400 },
    binanceOrderLimit: { used_10s: 0, used_1m: 0 },
    apiStatus: { isBanned: false, banUntil: null },
  };

  beforeEach(async () => {
    jest.useFakeTimers();

    mockWs = {
      on: jest.fn(),
      disconnect: jest.fn(),
      pingServer: jest.fn(),
    };

    mockBinanceClient = {
      restAPI: {
        startUserDataStream: jest.fn().mockResolvedValue({
          data: () => Promise.resolve({ listenKey: 'test-listen-key' }),
        }),
        keepaliveUserDataStream: jest.fn(),
        closeUserDataStream: jest.fn().mockResolvedValue({}),
      },
      websocketStreams: {
        connect: jest.fn().mockResolvedValue(mockWs),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SessionLifecycleService,
        { provide: SessionStateService, useValue: sessionStateMock },
        { provide: OrderManagerService, useValue: { setBinanceClient: jest.fn(), isRatcheting: jest.fn().mockReturnValue(false), isBanned: jest.fn().mockReturnValue(false) } },
        { provide: MarketFeedService, useValue: { start: jest.fn(), stop: jest.fn() } },
        { provide: MomentumScannerService, useValue: { start: jest.fn(), stop: jest.fn() } },
        { provide: PositionTrackerService, useValue: { addTrade: jest.fn(), activeList: jest.fn().mockReturnValue([]), isEntering: jest.fn().mockReturnValue(false), isClosing: jest.fn().mockReturnValue(false) } },
        { provide: MonitoringService, useValue: { getMetrics: jest.fn().mockReturnValue({ application: {} }), recordUdsPing: jest.fn(), setUdsStatus: jest.fn(), incrementApiRequests: jest.fn() } },
        { provide: AuditLogService, useValue: { log: jest.fn() } },
        { provide: BroadcastService, useValue: { broadcast: jest.fn(), setWsBroadcaster: jest.fn() } },
        { provide: EventEmitter2, useValue: { emit: jest.fn() } },
        { provide: "SettingsRepository", useValue: { findOne: jest.fn().mockResolvedValue({}), update: jest.fn().mockResolvedValue({}) } },
      ],
    }).compile();

    service = module.get<SessionLifecycleService>(SessionLifecycleService);
    (service as any).running = true;
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  it('should proactively rebuild UDS stream when keepalive throws -1125 listenKey expired error', async () => {
    // 1. Establish the initial user data stream
    await service.startUserDataStream(mockBinanceClient);

    expect((service as any).listenKey).toBe('test-listen-key');
    expect(mockBinanceClient.websocketStreams.connect).toHaveBeenCalledTimes(1);

    // 2. Mock keepalive request to fail with a -1125 ListenKey does not exist error
    const expiredError = new Error('This listenKey does not exist.');
    (expiredError as any).code = -1125;
    mockBinanceClient.restAPI.keepaliveUserDataStream.mockRejectedValue(expiredError);

    // Spy on startUserDataStream to verify proactive recovery call
    const startUdsSpy = jest.spyOn(service, 'startUserDataStream');

    // 3. Fast-forward fake timers to trigger the keep-alive interval callback
    await jest.advanceTimersByTimeAsync(ENGINE_CONSTANTS.USER_DATA_KEEPALIVE_MS);

    // 4. Verify that keepaliveUserDataStream was called and threw
    expect(mockBinanceClient.restAPI.keepaliveUserDataStream).toHaveBeenCalled();

    // 5. Verify startUserDataStream was invoked to rebuild the stream (which connects again)
    expect(startUdsSpy).toHaveBeenCalledWith(mockBinanceClient, true);
    // Total connections should now be 2 (initial + rebuild)
    expect(mockBinanceClient.websocketStreams.connect).toHaveBeenCalledTimes(2);
  });

  it('should NOT rebuild UDS stream on other non-expiry keepalive errors', async () => {
    await service.startUserDataStream(mockBinanceClient);

    const genericError = new Error('Network timeout');
    (genericError as any).code = -1001;
    mockBinanceClient.restAPI.keepaliveUserDataStream.mockRejectedValue(genericError);

    const startUdsSpy = jest.spyOn(service, 'startUserDataStream');

    await jest.advanceTimersByTimeAsync(ENGINE_CONSTANTS.USER_DATA_KEEPALIVE_MS);

    expect(mockBinanceClient.restAPI.keepaliveUserDataStream).toHaveBeenCalled();
    // Should NOT call startUserDataStream for non-expiry errors
    expect(startUdsSpy).not.toHaveBeenCalledWith(mockBinanceClient, true);
    expect(mockBinanceClient.websocketStreams.connect).toHaveBeenCalledTimes(1);
  });
});
