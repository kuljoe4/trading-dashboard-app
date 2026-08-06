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

    // DATA-07: totalPnl includes realized portion of open trades to match DB aggregation
    // Expected: 10.5 + (-2.0) = 8.5
    expect(service.stats.totalPnl).toBe(8.5);
  });

  describe('API Limit and Ban Protection', () => {
    it('should correctly process centralized BAN limit reached events', () => {
      const banTime = Date.now() + 10000;
      service.handleApiLimitReached({
        type: 'BAN',
        message: 'IP banned: Too many requests.',
        until: banTime
      });

      expect(service.apiStatus.isBanned).toBe(true);
      expect(service.apiStatus.isRateLimited).toBe(false);
      expect(service.apiStatus.banUntil).toBe(banTime);
      expect(service.apiStatus.lastErrorMessage).toBe('IP banned: Too many requests.');
      expect(service.isBanned()).toBe(true);
    });

    it('should correctly process centralized RATE_LIMIT limit reached events', () => {
      service.handleApiLimitReached({
        type: 'RATE_LIMIT',
        message: 'Rate limit hit',
        until: Date.now() + 5000
      });

      expect(service.apiStatus.isBanned).toBe(false);
      expect(service.apiStatus.isRateLimited).toBe(true);
      expect(service.isBanned()).toBe(false);
    });

    it('should evaluate isBanned robustly across edge cases', () => {
      // Case 1: isBanned is false
      service.apiStatus.isBanned = false;
      service.apiStatus.banUntil = null;
      expect(service.isBanned()).toBe(false);

      // Case 2: isBanned is true with null/undefined banUntil (unlimited/indefinite ban)
      service.apiStatus.isBanned = true;
      service.apiStatus.banUntil = null;
      expect(service.isBanned()).toBe(true);

      // Case 3: isBanned is true with future banUntil
      service.apiStatus.isBanned = true;
      service.apiStatus.banUntil = Date.now() + 50000;
      expect(service.isBanned()).toBe(true);

      // Case 4: isBanned is true with expired/past banUntil
      service.apiStatus.isBanned = true;
      service.apiStatus.banUntil = Date.now() - 5000;
      expect(service.isBanned()).toBe(false);
    });

    it('should completely restore API status when limit is cleared', () => {
      service.handleApiLimitReached({
        type: 'BAN',
        message: 'IP Banned',
        until: Date.now() + 10000
      });

      expect(service.isBanned()).toBe(true);

      service.handleApiLimitCleared();

      expect(service.apiStatus.isBanned).toBe(false);
      expect(service.apiStatus.isRateLimited).toBe(false);
      expect(service.apiStatus.banUntil).toBeNull();
      expect(service.apiStatus.lastErrorMessage).toBeNull();
      expect(service.isBanned()).toBe(false);
    });
  });
});
