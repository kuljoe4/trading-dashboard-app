import { Test, TestingModule } from '@nestjs/testing';
import { SessionLifecycleService } from './session-lifecycle.service';
import { SessionStateService } from './session_state.service';
import { OrderManagerService } from './orderManager';
import { MarketFeedService } from './market_feed.service';
import { MomentumScannerService } from './momentum_scanner.service';
import { PositionTrackerService } from './positionTracker';
import { MonitoringService } from './monitoring.service';
import { AuditLogService } from '../trading/audit-log.service';
import { RiskEngineService } from './riskEngine';
import { BroadcastService } from './broadcast.service';
import { EventEmitter2 } from '@nestjs/event-emitter';

/**
 * Tests that the User Data Stream (UDS) connects and that incoming
 * `ACCOUNT_UPDATE` WS messages drive real-time account balance updates
 * into SessionState and the frontend (`balance_update` broadcast).
 *
 * Two guarantees are covered:
 *   1. After `startUserDataStream`, the socket is marked connected.
 *   2. A simulated UDS `ACCOUNT_UPDATE` event updates the live balance
 *      (zero-weight path — no REST polling) and is broadcast to the UI.
 */
describe('SessionLifecycleService - UDS connect + balance from events', () => {
  let service: SessionLifecycleService;
  let broadcastService: BroadcastService;

  const mockWs = {
    on: jest.fn(),
    disconnect: jest.fn(),
    pingServer: jest.fn(),
  };

  const mockBinanceClient = {
    restAPI: {
      startUserDataStream: jest.fn().mockResolvedValue({
        data: () => Promise.resolve({ listenKey: 'test-listen-key' })
      }),
      keepaliveUserDataStream: jest.fn().mockResolvedValue({}),
      closeUserDataStream: jest.fn().mockResolvedValue({}),
    },
    websocketStreams: {
      connect: jest.fn().mockResolvedValue(mockWs),
    },
  };

  const sessionStateMock = {
    reset: jest.fn(),
    updateRateLimit: jest.fn(),
    isRateLimited: jest.fn().mockReturnValue(false),
    isBanned: jest.fn().mockReturnValue(false),
    realTimePositions: new Map(),
    activeTrades: [],
    binanceRateLimit: { used_1m: 0, limit: 2400 },
    // balance fields are assigned by handleAccountUpdate at runtime
  };

  beforeEach(async () => {
    jest.useFakeTimers();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SessionLifecycleService,
        { provide: SessionStateService, useValue: sessionStateMock },
        { provide: OrderManagerService, useValue: { setBinanceClient: jest.fn(), isRatcheting: jest.fn().mockReturnValue(false) } },
        { provide: MarketFeedService, useValue: { start: jest.fn(), stop: jest.fn() } },
        { provide: MomentumScannerService, useValue: { start: jest.fn(), stop: jest.fn() } },
        { provide: PositionTrackerService, useValue: { addTrade: jest.fn(), activeList: jest.fn().mockReturnValue([]), isEntering: jest.fn().mockReturnValue(false), isClosing: jest.fn().mockReturnValue(false) } },
        { provide: MonitoringService, useValue: { getMetrics: jest.fn(), recordUdsPing: jest.fn(), setUdsStatus: jest.fn(), incrementApiRequests: jest.fn() } },
        { provide: AuditLogService, useValue: { log: jest.fn() } },
        { provide: BroadcastService, useValue: { broadcast: jest.fn(), setWsBroadcaster: jest.fn() } },
        { provide: EventEmitter2, useValue: { emit: jest.fn() } },
        { provide: "SettingsRepository", useValue: { findOne: jest.fn().mockResolvedValue({}), update: jest.fn().mockResolvedValue({}) } },
      ],
    }).compile();

    service = module.get<SessionLifecycleService>(SessionLifecycleService);
    broadcastService = module.get<BroadcastService>(BroadcastService);

    (service as any).running = true;
    // Reset mutable balance fields on the shared mock between tests
    delete (sessionStateMock as any).balanceLive;
    delete (sessionStateMock as any).balancePaper;
    delete (sessionStateMock as any).lastExchangeBalance;
    delete (sessionStateMock as any).lastUdsBalanceUpdate;
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
    sessionStateMock.realTimePositions = new Map();
    sessionStateMock.activeTrades = [];
  });

  /** Helper: register the UDS socket, then grab the 'message' handler. */
  async function connectAndGetMessageHandler() {
    await (service as any).startUserDataStream(mockBinanceClient);
    const messageCall = mockWs.on.mock.calls.find((c: any[]) => c[0] === 'message');
    if (!messageCall) throw new Error('No "message" handler registered on WS');
    return messageCall[1] as (payload: any) => Promise<void>;
  }

  it('marks UDS as connected and sets monitoring status after startUserDataStream', async () => {
    await (service as any).startUserDataStream(mockBinanceClient);

    expect((service as any).isUdsConnected).toBe(true);
    expect(mockBinanceClient.websocketStreams.connect).toHaveBeenCalledWith({
      stream: 'test-listen-key',
    });
    expect(
      (service as any).monitoringService.setUdsStatus,
    ).toHaveBeenCalledWith('CONNECTED');
  });

  it('updates live balance and broadcasts it on an incoming ACCOUNT_UPDATE', async () => {
    const handleMessage = await connectAndGetMessageHandler();

    const before = (service as any).sessionState.balanceLive;
    expect(before).toBeUndefined(); // not set yet pre-event

    const accountUpdate = {
      e: 'ACCOUNT_UPDATE',
      a: {
        m: 'ORDER',
        B: [{ a: 'USDT', wb: '1234.56', cw: '1234.56', bc: '10.00' }],
        P: [],
      },
    };

    await handleMessage(accountUpdate);

    // Zero-weight balance sync: balanceLive / lastExchangeBalance updated from event
    expect((service as any).sessionState.balanceLive).toBe(1234.56);
    expect((service as any).sessionState.lastExchangeBalance).toBe(1234.56);
    expect(
      typeof (service as any).sessionState.lastUdsBalanceUpdate,
    ).toBe('number');

    // Frontend broadcast must fire
    expect(broadcastService.broadcast).toHaveBeenCalledWith('balance_update', {
      balance: 1234.56,
    });
  });

  it('ignores non-USDT balances in ACCOUNT_UPDATE', async () => {
    const handleMessage = await connectAndGetMessageHandler();

    await handleMessage({
      e: 'ACCOUNT_UPDATE',
      a: {
        m: 'ORDER',
        B: [{ a: 'BNB', wb: '5.0', cw: '5.0', bc: '0.0' }],
        P: [],
      },
    });

    expect((service as any).sessionState.balanceLive).toBeUndefined();
    expect(broadcastService.broadcast).not.toHaveBeenCalledWith(
      'balance_update',
      expect.anything(),
    );
  });
});

/**
 * Proves the zero-weight UDS balance path is NOT a one-time startup seed but a
 * live source of truth used by the risk engine throughout the session/trade
 * lifecycle.
 *
 * We use the REAL `SessionStateService` (so `getBalance()` is real) and the REAL
 * `RiskEngineService` (so `canEnter` is real). A mid-session `ACCOUNT_UPDATE`
 * must change `getBalance()` and therefore flip the `canEnter` decision — with
 * NO REST `fetchBinanceBalance` call involved.
 */
describe('SessionLifecycleService - live UDS balance drives risk engine during session', () => {
  let service: SessionLifecycleService;
  let sessionState: SessionStateService;
  let riskEngine: RiskEngineService;
  let broadcastService: BroadcastService;

  const mockWs = {
    on: jest.fn(),
    disconnect: jest.fn(),
    pingServer: jest.fn(),
  };

  const mockBinanceClient = {
    restAPI: {
      startUserDataStream: jest.fn().mockResolvedValue({
        data: () => Promise.resolve({ listenKey: 'live-listen-key' }),
      }),
      keepaliveUserDataStream: jest.fn().mockResolvedValue({}),
      closeUserDataStream: jest.fn().mockResolvedValue({}),
    },
    websocketStreams: {
      connect: jest.fn().mockResolvedValue(mockWs),
    },
  };

  // Config that gates purely on total SL risk % of balance.
  const riskConfig = {
    max_open_trades: 5,
    max_open_trades_per_symbol: 1,
    max_total_risk_pct: 4,
    risk_pct_per_trade: 1,
    total_sl_guard_usdt: 200,
  } as any;

  beforeEach(async () => {
    jest.useFakeTimers();
    sessionState = new SessionStateService();
    riskEngine = new RiskEngineService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SessionLifecycleService,
        { provide: SessionStateService, useValue: sessionState },
        { provide: OrderManagerService, useValue: { setBinanceClient: jest.fn(), isRatcheting: jest.fn().mockReturnValue(false) } },
        { provide: MarketFeedService, useValue: { start: jest.fn(), stop: jest.fn() } },
        { provide: MomentumScannerService, useValue: { start: jest.fn(), stop: jest.fn() } },
        { provide: PositionTrackerService, useValue: { addTrade: jest.fn(), activeList: jest.fn().mockReturnValue([]), isEntering: jest.fn().mockReturnValue(false), isClosing: jest.fn().mockReturnValue(false) } },
        { provide: MonitoringService, useValue: { getMetrics: jest.fn(), recordUdsPing: jest.fn(), setUdsStatus: jest.fn(), incrementApiRequests: jest.fn() } },
        { provide: AuditLogService, useValue: { log: jest.fn() } },
        { provide: BroadcastService, useValue: { broadcast: jest.fn(), setWsBroadcaster: jest.fn() } },
        { provide: EventEmitter2, useValue: { emit: jest.fn() } },
        { provide: "SettingsRepository", useValue: { findOne: jest.fn().mockResolvedValue({}), update: jest.fn().mockResolvedValue({}) } },
      ],
    }).compile();

    service = module.get<SessionLifecycleService>(SessionLifecycleService);
    broadcastService = module.get<BroadcastService>(BroadcastService);
    (service as any).running = true;
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  async function connectAndGetMessageHandler() {
    await (service as any).startUserDataStream(mockBinanceClient);
    const messageCall = mockWs.on.mock.calls.find((c: any[]) => c[0] === 'message');
    if (!messageCall) throw new Error('No "message" handler registered on WS');
    return messageCall[1] as (payload: any) => Promise<void>;
  }

  it('reflects a mid-session ACCOUNT_UPDATE in getBalance() without any REST call', async () => {
    const handleMessage = await connectAndGetMessageHandler();

    // Simulate a startup seed already in place (e.g. 2000 USDT).
    sessionState.balanceLive = 2000;
    sessionState.balancePaper = 2000;
    expect(sessionState.getBalance(false)).toBe(2000);

    // Mid-session: balance drops to 1500 via a UDS event (e.g. a fill/funding).
    const restSpy = jest.spyOn(service as any, 'fetchBinanceBalance');
    await handleMessage({
      e: 'ACCOUNT_UPDATE',
      a: { m: 'ORDER', B: [{ a: 'USDT', wb: '1500', cw: '1500', bc: '-500' }], P: [] },
    });

    // Live balance is now the UDS value, surfaced through the real getBalance().
    expect(sessionState.balanceLive).toBe(1500);
    expect(sessionState.getBalance(false)).toBe(1500);
    expect(broadcastService.broadcast).toHaveBeenCalledWith('balance_update', { balance: 1500 });
    // Critical: the live update path must NOT trigger a REST balance fetch.
    expect(restSpy).not.toHaveBeenCalled();
  });

  it('feeds the live UDS balance into riskEngine.canEnter, flipping the entry decision', async () => {
    const handleMessage = await connectAndGetMessageHandler();

    // 50 USDT of SL risk already on the book.
    const totalSlUsed = 50;
    sessionState.balanceLive = 2000;

    // At 2000 USDT: 50/2000 = 2.5% total risk + 1% prospective = 3.5% < 4% ceiling -> allowed.
    const allowedAtHigh = riskEngine.canEnter([], [], sessionState.getBalance(false), 'BTCUSDT', riskConfig, totalSlUsed);
    expect(allowedAtHigh.canEnter).toBe(true);

    // Mid-session balance crash to 1000 USDT via UDS (no REST).
    await handleMessage({
      e: 'ACCOUNT_UPDATE',
      a: { m: 'ORDER', B: [{ a: 'USDT', wb: '1000', cw: '1000', bc: '-1000' }], P: [] },
    });
    expect(sessionState.getBalance(false)).toBe(1000);

    // At 1000 USDT: 50/1000 = 5% total risk + 1% prospective = 6% > 4% ceiling -> blocked.
    const blockedAtLow = riskEngine.canEnter([], [], sessionState.getBalance(false), 'BTCUSDT', riskConfig, totalSlUsed);
    expect(blockedAtLow.canEnter).toBe(false);
    expect(blockedAtLow.reason).toMatch(/Risk ceiling/i);
  });
});
