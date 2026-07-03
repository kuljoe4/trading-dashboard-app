import { SessionStateService } from './session_state.service';
import { SessionConfig } from '../models/SessionConfig';
import { Trade } from '../models/Trade';

describe('SessionStateService PnL Restart Consistency', () => {
  let service: SessionStateService;

  beforeEach(() => {
    service = new SessionStateService();
  });

  it('should include PnL of resumed open trades in totalPnl stats', () => {
    const config = new SessionConfig();
    config.strategy_label = 'Momentum Strategy';
    const sessionId = 'session-123';

    // Terminal trade (history)
    const closedTrade = {
      id: 't1',
      sessionId,
      pnl: 10.5,
      status: 'CLOSED',
      strategy_label: 'Momentum Strategy'
    } as any;

    // Resumed open trade with realized fees
    const openTrade = {
      id: 't2',
      sessionId,
      pnl: -2.0, // Entry fee
      status: 'OPEN',
      strategy_label: 'Momentum Strategy'
    } as any;

    // Update reset call to include initialOpen
    service.reset(config, [closedTrade], 10000, sessionId, [openTrade]);

    // FIX: totalPnl should only sum closed trades. Open trades will be added when they close.
    // Expected: 10.5
    expect(service.stats.totalPnl).toBe(10.5);
  });
});
