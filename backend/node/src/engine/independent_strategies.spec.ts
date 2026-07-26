import { SessionStateService } from './session_state.service';
import { SessionConfig } from '../models/SessionConfig';
import { Trade } from '../models/Trade';

describe('Independent Strategies and Gating', () => {
  let service: SessionStateService;

  beforeEach(() => {
    service = new SessionStateService();
  });

  it('should initialize empty paused strategies and strategy gate states', () => {
    const config = new SessionConfig();
    service.reset(config);
    expect(service.pausedStrategies.size).toBe(0);
    expect(service.strategyGateStates.size).toBe(0);
  });

  it('should evaluate isStrategyPaused correctly based on global and per-strategy states', () => {
    const config = new SessionConfig();
    service.reset(config);

    expect(service.isStrategyPaused('Strategy A')).toBe(false);

    // Pause Strategy A
    service.setStrategyPaused('Strategy A', true);
    expect(service.isStrategyPaused('Strategy A')).toBe(true);
    expect(service.isStrategyPaused('Strategy B')).toBe(false);

    // Unpause Strategy A
    service.setStrategyPaused('Strategy A', false);
    expect(service.isStrategyPaused('Strategy A')).toBe(false);

    // Pause globally
    service.paused = true;
    expect(service.isStrategyPaused('Strategy A')).toBe(true);
    expect(service.isStrategyPaused('Strategy B')).toBe(true);
  });

  it('should evaluate isGated correctly for independent strategy gate states', () => {
    const config = new SessionConfig();
    service.reset(config);

    // No strategyGateStates: fallback to global gateState
    service.gateState = 'max_trades';
    expect(service.isGated()).toBe(true);

    service.gateState = null;
    expect(service.isGated()).toBe(false);

    // Set strategy specific gate states
    service.strategyGateStates.set('Strategy A', { gateState: 'max_trades', gateReason: 'Gated' });
    service.strategyGateStates.set('Strategy B', { gateState: null, gateReason: null });

    // Since Strategy B is active (not gated and not paused), the session is NOT globally gated
    expect(service.isGated()).toBe(false);

    // Pause Strategy B
    service.setStrategyPaused('Strategy B', true);
    // Now B is paused and A is gated, so ALL strategies are gated/paused -> session is gated
    expect(service.isGated()).toBe(true);

    // Unpause B, but gate B
    service.setStrategyPaused('Strategy B', false);
    service.strategyGateStates.set('Strategy B', { gateState: 'sl_guard', gateReason: 'SL guard' });
    // Now both A and B are gated -> session is gated
    expect(service.isGated()).toBe(true);
  });

  it('should update stats correctly when passing explicit strategyLabel', () => {
    const config = new SessionConfig();
    config.strategy_label = 'Main Strategy';
    service.reset(config);

    // Simulate entry of trade for Main Strategy
    service.updateStatsOnEntry('t-main', 'Main Strategy');
    expect(service.stats.entryCount).toBe(1);
    expect(service.cachedClosedTradesStats['Main Strategy']?.count).toBe(1);

    // Simulate entry of trade for Strategy Variant B
    service.updateStatsOnEntry('t-b', 'Strategy B');
    expect(service.stats.entryCount).toBe(2);
    expect(service.cachedClosedTradesStats['Strategy B']?.count).toBe(1);

    // Simulate winning close of trade for Strategy Variant B
    service.updateStatsOnClose(true, 50.0, false, 't-b', 'Strategy B');
    expect(service.stats.hitCount).toBe(1);
    expect(service.stats.totalPnl).toBe(50.0);
    expect(service.cachedClosedTradesStats['Strategy B']?.pnl).toBe(50.0);
    expect(service.cachedClosedTradesStats['Strategy B']?.hits).toBe(1);

    // Main Strategy stats should be isolated and unaffected
    expect(service.cachedClosedTradesStats['Main Strategy']?.pnl || 0).toBe(0);
    expect(service.cachedClosedTradesStats['Main Strategy']?.hits || 0).toBe(0);
  });
});
