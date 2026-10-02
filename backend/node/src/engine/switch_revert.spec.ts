import { PositionTrackerService } from './positionTracker';
import { SessionConfig } from '../models/SessionConfig';
import { Trade } from '../models/Trade';

describe('Dynamic RR Switch - Temporary Revert Logic', () => {
  it('decrements hit count and reverts to default sequences after triggering trade closes', async () => {
    const config = new SessionConfig();
    config.tp_mode = 'exp_rr_seq_switch';
    config.live_rr_sequence = [2.0];
    config.exit_rr_sequence = [1.0];
    config.peak_rr_switch_threshold = 5.0;
    config.peak_rr_switch_count = 1;

    const tracker = new PositionTrackerService(
      {} as any, {} as any, { updateStopLoss: jest.fn().mockResolvedValue({ success: true, price: 101 }), isRatcheting: jest.fn().mockReturnValue(false), applyFilters: jest.fn((sym, p) => p), calculateTrailingGuard: jest.fn().mockReturnValue(110) } as any,
      {} as any, {} as any, { setActiveTrades: jest.fn() } as any, { emit: jest.fn() } as any
    );

    const trade = {
      id: 'trade1',
      symbol: 'BTCUSDT',
      direction: 'LONG',
      status: 'OPEN',
      entry_price: 100,
      initial_sl: 90,
      current_sl: 90,
      max_rr_achieved: 0,
      qty: 1,
      risk_usdt: 10,
      strategy_label: 'Momentum Strategy',
    } as unknown as Trade;

    tracker.addTrade(trade);

    // Hit the threshold
    await tracker.checkRrSequenceAdjustments('BTCUSDT', 150, config);

    expect(tracker.peakRrSwitchHits.get('Momentum Strategy')).toBe(1);
    expect(tracker.tradePeakRrSwitchHandled.has('trade1')).toBe(true);

    // Remove the trade (simulate close)
    tracker.removeTrade('BTCUSDT');

    expect(tracker.tradePeakRrSwitchHandled.has('trade1')).toBe(false);
    expect(tracker.peakRrSwitchHits.get('Momentum Strategy')).toBe(0);
  });
});
