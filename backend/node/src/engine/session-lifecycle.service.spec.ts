import { SessionLifecycleService } from './session-lifecycle.service';
import { SessionStateService } from './session_state.service';
import { SessionConfig } from '../models/SessionConfig';
import { EventEmitter2 } from '@nestjs/event-emitter';

describe('SessionLifecycleService Paper Balance Preservation', () => {
  let service: SessionLifecycleService;
  let sessionState: SessionStateService;
  let mockOrderManager: any;
  let mockMarketFeed: any;
  let mockMomentumScanner: any;
  let mockPositionTracker: any;
  let mockMonitoringService: any;
  let mockAuditLog: any;
  let eventEmitter: EventEmitter2;
  let mockSettingsRepo: any;

  beforeEach(() => {
    sessionState = new SessionStateService();
    mockOrderManager = { setBinanceClient: jest.fn() };
    mockMarketFeed = {};
    mockMomentumScanner = {};
    mockPositionTracker = {};
    mockMonitoringService = {};
    mockAuditLog = { log: jest.fn() };
    eventEmitter = new EventEmitter2();
    mockSettingsRepo = {};

    service = new SessionLifecycleService(
      sessionState,
      mockOrderManager,
      mockMarketFeed as any,
      mockMomentumScanner as any,
      mockPositionTracker as any,
      mockMonitoringService as any,
      mockAuditLog as any,
      eventEmitter,
      mockSettingsRepo as any
    );
  });

  it('should update both live and paper balances if session is in paper mode', () => {
    // Arrange: config is paper mode
    const config = new SessionConfig();
    config.paper_mode = true;
    config.trading_mode = 'paper';
    sessionState.reset(config, [], 10000);

    sessionState.balanceLive = 10000;
    sessionState.balancePaper = 10000;

    // Act: simulate UDS account update event with new balance 10500
    const mockEvent = {
      a: {
        m: 'ORDER',
        B: [{ a: 'USDT', wb: '10500', bc: '500' }],
        P: []
      }
    };
    service.handleAccountUpdate(mockEvent as any);

    // Assert: both balances are updated
    expect(sessionState.balanceLive).toBe(10500);
    expect(sessionState.balancePaper).toBe(10500);
  });

  it('should update live balance but preserve paper balance if session is in live/testnet mode', () => {
    // Arrange: config is live/testnet (paper_mode = false)
    const config = new SessionConfig();
    config.paper_mode = false;
    config.trading_mode = 'live';
    sessionState.reset(config, [], 10000);

    sessionState.balanceLive = 10000;
    sessionState.balancePaper = 8888; // Some custom paper balance we want to preserve

    // Act: simulate UDS account update event with new balance 10500
    const mockEvent = {
      a: {
        m: 'ORDER',
        B: [{ a: 'USDT', wb: '10500', bc: '500' }],
        P: []
      }
    };
    service.handleAccountUpdate(mockEvent as any);

    // Assert: live balance is updated, paper balance is preserved
    expect(sessionState.balanceLive).toBe(10500);
    expect(sessionState.balancePaper).toBe(8888);
  });
});
