import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { SessionLifecycleService } from './session-lifecycle.service';
import { SessionStateService } from './session_state.service';
import { OrderManagerService } from './orderManager';
import { PositionTrackerService } from './positionTracker';
import { MarketFeedService } from './market_feed.service';
import { MomentumScannerService } from './momentum_scanner.service';
import { MonitoringService } from './monitoring.service';
import { AuditLogService } from '../trading/audit-log.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Settings as SettingsEntity } from '../models/entities/Settings.entity';
import { ENGINE_EVENTS } from './events';
import { Trade } from '../models/Trade';

describe('Chronos: Startup Race Condition Protection', () => {
  let sessionLifecycleService: SessionLifecycleService;
  let sessionState: SessionStateService;
  let positionTracker: PositionTrackerService;
  let eventEmitter: EventEmitter2;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SessionLifecycleService,
        SessionStateService,
        { provide: OrderManagerService, useValue: { setBinanceClient: jest.fn(), getTakerFeeRate: jest.fn().mockReturnValue(0.0004), isRatcheting: jest.fn() } },
        { provide: MarketFeedService, useValue: { start: jest.fn(), stop: jest.fn(), fetchExchangeInfo: jest.fn() } },
        { provide: MomentumScannerService, useValue: { start: jest.fn(), stop: jest.fn() } },
        { provide: PositionTrackerService, useValue: { activeList: jest.fn().mockReturnValue([]), addTrade: jest.fn(), recalculateTotalRisk: jest.fn(), totalRisk: jest.fn() } },
        { provide: MonitoringService, useValue: { incrementApiRequests: jest.fn(), setUdsStatus: jest.fn(), recordUdsPing: jest.fn(), getMetrics: jest.fn().mockReturnValue({ application: {} }) } },
        { provide: AuditLogService, useValue: { log: jest.fn() } },
        { provide: getRepositoryToken(SettingsEntity), useValue: { findOne: jest.fn().mockResolvedValue({}), update: jest.fn() } },
        EventEmitter2,
      ],
    }).compile();

    sessionLifecycleService = module.get<SessionLifecycleService>(SessionLifecycleService);
    sessionState = module.get<SessionStateService>(SessionStateService);
    positionTracker = module.get<PositionTrackerService>(PositionTrackerService);
    eventEmitter = module.get<EventEmitter2>(EventEmitter2);

    sessionState.activeTrades = [];
  });

  it('GAP: should buffer and replay UDS events that arrive during startup reconciliation', async () => {
    const symbol = 'BTCUSDT';
    const trade = {
      id: 'trade-startup-race',
      symbol,
      qty: 1.0,
      entry_price: 50000,
      status: 'OPEN'
    } as Trade;

    // 1. Start buffering (happens at the beginning of startSession)
    sessionLifecycleService.startBuffering();

    // 2. Simulate a UDS event arriving WHILE we are doing REST reconciliation
    // (In a real scenario, this would come from the WebSocket message handler)
    const accountUpdate = {
      e: 'ACCOUNT_UPDATE',
      a: {
        m: 'ORDER',
        B: [],
        P: [{ s: symbol, pa: '0.8', ep: '50000' }] // Qty reduced from 1.0 to 0.8
      }
    };

    // This call should BUFFER instead of processing immediately
    const handleAccountUpdateSpy = jest.spyOn(sessionLifecycleService, 'handleAccountUpdate');
    (sessionLifecycleService as any).userDataWs = { on: jest.fn() }; // Mock WS

    // Simulate message arriving at the low-level listener
    // We manually push to buffer to simulate the behavior of the listener we modified
    (sessionLifecycleService as any).eventBuffer.push(accountUpdate);
    (sessionLifecycleService as any).isBuffering = true;

    expect(handleAccountUpdateSpy).not.toHaveBeenCalled();
    expect((sessionLifecycleService as any).eventBuffer.length).toBe(1);

    // 3. Engine starts and trades are added (happens in tradingSessionService.start)
    sessionState.activeTrades = [trade];
    positionTracker.activeList = jest.fn().mockReturnValue([trade]);

    // 4. Replay buffer (happens at the end of startSession)
    await sessionLifecycleService.replayBuffer();

    // 5. Verification: The buffered event should have been replayed and processed
    expect(handleAccountUpdateSpy).toHaveBeenCalledWith(accountUpdate);

    // Quantity should be updated to 0.8 from the replayed UDS event
    expect(trade.qty).toBe(0.8);
  });
});
