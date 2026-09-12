import { SessionStateService } from './session_state.service';
import { ENGINE_EVENTS } from './events';

describe('Rate Limit Surge & High Weight Spike Warning Spec', () => {
  let sessionState: SessionStateService;
  let mockEventEmitter: any;

  beforeEach(() => {
    mockEventEmitter = {
      emit: jest.fn(),
    };

    sessionState = new SessionStateService(mockEventEmitter);
    sessionState.binanceRateLimit = { used_1m: 0, limit: 2400 };
  });

  it('1. should emit warning log and alert when weight reaches 80%+ 3 times in a minute', () => {
    const limit = 2400;
    const highWeight = 2000; // 83.3% of 2400

    // First 2 occurrences
    sessionState.updateRateLimit(highWeight, limit);
    sessionState.updateRateLimit(highWeight, limit);

    expect(mockEventEmitter.emit).not.toHaveBeenCalledWith(ENGINE_EVENTS.ALERT, expect.anything());

    // 3rd occurrence
    sessionState.updateRateLimit(highWeight, limit);

    expect(mockEventEmitter.emit).toHaveBeenCalledWith(
      ENGINE_EVENTS.LOG_MESSAGE,
      expect.objectContaining({
        msg: expect.stringContaining('High API Weight Spike detected! Used weight reached 83.3%'),
        level: 'warn',
      }),
    );

    expect(mockEventEmitter.emit).toHaveBeenCalledWith(
      ENGINE_EVENTS.ALERT,
      expect.objectContaining({
        level: 'warning',
        title: 'High API Weight Spike',
      }),
    );
  });

  it('2. should emit surge warning log and alert when REST call count exceeds 30 in 10s', () => {
    for (let i = 0; i < 30; i++) {
      sessionState.recordRestRequest();
    }

    expect(mockEventEmitter.emit).not.toHaveBeenCalledWith(
      ENGINE_EVENTS.ALERT,
      expect.objectContaining({ title: 'REST API Surge Warning' }),
    );

    // 31st call
    sessionState.recordRestRequest();

    expect(mockEventEmitter.emit).toHaveBeenCalledWith(
      ENGINE_EVENTS.LOG_MESSAGE,
      expect.objectContaining({
        msg: expect.stringContaining('Rapid REST API call surge detected (31 calls in 10s)'),
        level: 'warn',
      }),
    );

    expect(mockEventEmitter.emit).toHaveBeenCalledWith(
      ENGINE_EVENTS.ALERT,
      expect.objectContaining({
        level: 'warning',
        title: 'REST API Surge Warning',
      }),
    );
  });
});
