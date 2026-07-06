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

    // DATA-PNL: totalPnl must include BOTH terminal and OPEN trades (realized portion)
    // Expected: 10.5 (closed) + (-2.0) (open realized fees) = 8.5
    expect(service.stats.totalPnl).toBe(8.5);
  });
});
