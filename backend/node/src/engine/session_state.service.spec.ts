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

  it('should isolate session stats strictly to matching sessionId on reset()', () => {
    const config = new SessionConfig();
    config.strategy_label = 'Momentum Strategy';
    const currentSessionId = 'session-current';

    const closedCurrent = { id: 'c1', sessionId: currentSessionId, pnl: 25, status: 'CLOSED', strategy_label: 'Momentum Strategy' } as any;
    const closedForeign = { id: 'c2', sessionId: 'session-old', pnl: 500, status: 'CLOSED', strategy_label: 'Momentum Strategy' } as any;
    const openCurrent = { id: 'o1', sessionId: currentSessionId, pnl: -1.5, status: 'OPEN', strategy_label: 'Momentum Strategy' } as any;
    const openForeign = { id: 'o2', sessionId: 'session-old', pnl: -100, status: 'OPEN', strategy_label: 'Momentum Strategy' } as any;

    service.reset(config, [closedCurrent, closedForeign], 10000, currentSessionId, [openCurrent, openForeign]);

    expect(service.stats.totalPnl).toBe(23.5);
    expect(service.stats.entryCount).toBe(2);
    expect(service.cachedClosedTradesStats['Momentum Strategy'].pnl).toBe(25);
    expect(service.cachedClosedTradesStats['Momentum Strategy'].count).toBe(1);
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

    it('should compact heavy diagnostic fields on stale closedTrades (>50) while preserving recent 50 and risk metrics', () => {
      const config = new SessionConfig();
      config.strategy_label = 'Momentum Strategy';
      const history: any[] = [];
      for (let i = 0; i < 65; i++) {
        history.push({
          id: `trade-${i}`,
          symbol: 'BTCUSDT',
          status: 'CLOSED',
          pnl: 1.5,
          strategy_label: 'Momentum Strategy',
          strategy_config: { enabled_signals: ['ema_dual_cross'] },
          active_trade_events: [{ type: 'SL_RATCHET', ts: Date.now() }],
          sl_adjustments: [{ from: 100, to: 101 }],
          exit_signals_status: { ema_dual_cross: { fired: false } },
          _sig_json: '{"cached":true}',
        });
      }

      service.reset(config, history, 10000, 's-1', []);
      expect(service.closedTrades.length).toBe(65);
      // Recent 50 keep full diagnostic fields (except _sig_json memo)
      expect((service.closedTrades[0] as any).strategy_config).toBeDefined();
      expect((service.closedTrades[0] as any)._sig_json).toBeUndefined();
      // Entries at index >= 50 have heavy diagnostic blobs stripped in RAM
      expect((service.closedTrades[55] as any).strategy_config).toBeUndefined();
      expect((service.closedTrades[55] as any).active_trade_events).toBeUndefined();
      expect((service.closedTrades[55] as any).sl_adjustments).toBeUndefined();
      expect((service.closedTrades[55] as any).exit_signals_status).toBeUndefined();
      expect(service.closedTrades[55].pnl).toBe(1.5);
    });

    it('should decay stale previous-minute used_1m weight on minute boundary when not banned', () => {
      const prevMinuteTs = (Math.floor(Date.now() / 60000) - 1) * 60000 + 50000;
      const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(prevMinuteTs);
      service.updateRateLimit(1229, 2400);
      expect(service.getBinanceRateLimit().used_weight_1m).toBe(1229);

      // Advance clock past minute boundary (:01 of next minute)
      nowSpy.mockReturnValue(prevMinuteTs + 11000);
      expect(service.getBinanceRateLimit().used_weight_1m).toBe(0);
      expect(service.isRateLimited(0.4)).toBe(false);

      // Active ban (9999) must NOT decay across minute rollover
      service.handleApiLimitReached({ type: 'BAN', message: 'Banned', until: prevMinuteTs + 120000 });
      service.binanceRateLimit.used_1m = 9999;
      nowSpy.mockReturnValue(prevMinuteTs + 75000);
      expect(service.getBinanceRateLimit().used_weight_1m).toBe(9999);

      nowSpy.mockRestore();
    });
  });
});

