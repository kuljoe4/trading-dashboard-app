import { SessionStateService } from './session_state.service';
import { SessionConfig } from '../models/SessionConfig';
import { Trade } from '../models/Trade';

describe('SessionStateService PnL Double-Counting Repro', () => {
  let service: SessionStateService;

  beforeEach(() => {
    service = new SessionStateService();
  });

  it('should not double-count entry fees when an open trade is resumed and then closed', () => {
    const config = new SessionConfig();
    config.strategy_label = 'Momentum Strategy';
    const sessionId = 'session-123';

    // Resumed open trade with realized fees (negative PnL)
    const openTrade: Trade = {
      id: 't1',
      symbol: 'BTCUSDT',
      sessionId,
      pnl: -2.0, // Initial entry fee
      status: 'OPEN',
      strategy_label: 'Momentum Strategy',
      qty: 1,
      entry_price: 100
    } as any;

    // Reset session with this open trade
    service.reset(config, [], 10000, sessionId, [openTrade]);

    // Currently, reset includes open trade PnL in totalPnl
    // Let's see what it is now
    const initialTotalPnl = service.stats.totalPnl;
    console.log(`Initial totalPnl: ${initialTotalPnl}`);

    // Simulate trade closing with a final Net PnL of +10.0 (Profit - Fee)
    const finalNetPnl = 10.0;
    openTrade.pnl = finalNetPnl;
    openTrade.status = 'CLOSED';

    service.updateStatsOnClose(true, finalNetPnl);

    console.log(`Final totalPnl: ${service.stats.totalPnl}`);

    // If it double-counts, it will be initialTotalPnl + finalNetPnl = -2.0 + 10.0 = 8.0
    // It SHOULD be just 10.0 (the total Net PnL of the only trade that happened)
    expect(service.stats.totalPnl).toBe(10.0);
  });
});
