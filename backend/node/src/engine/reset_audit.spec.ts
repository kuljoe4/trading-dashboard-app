import { SessionStateService } from './session_state.service';
import { Trade } from '../models/Trade';
import { SessionConfig } from '../models/SessionConfig';

describe('SessionStateService: Reset Audit', () => {
  let service: SessionStateService;

  beforeEach(() => {
    service = new SessionStateService();
  });

  it('should NOT double-count PnL if a trade is present in both initialHistory and initialOpen', () => {
    const overlappingTrade = {
      id: 'shared-id',
      symbol: 'BTCUSDT',
      pnl: 10,
      status: 'CLOSED',
      sessionId: 'sess-1'
    } as Trade;

    const config = { strategy_label: 'Test' } as SessionConfig;

    // reset(config, initialHistory, currentBalance, sessionId, initialOpen)
    service.reset(config, [overlappingTrade], 1000, 'sess-1', [overlappingTrade]);

    // If flawed, totalPnl will be 20. If correct, it will be 10.
    expect(service.stats.totalPnl).toBe(10);
  });
});
