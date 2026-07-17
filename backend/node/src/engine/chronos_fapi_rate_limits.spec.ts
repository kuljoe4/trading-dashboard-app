import { SessionStateService } from './session_state.service';

describe('Chronos: Binance FAPI Order Rate Limit Protection', () => {
  let sessionState: SessionStateService;

  beforeEach(() => {
    sessionState = new SessionStateService();
    sessionState.reset({ strategy_label: 'Test' } as any);
  });

  it('should correctly parse FAPI (Futures) and MBX (Spot) order rate limit headers', () => {
    // 1. Setup headers representing Futures usage (using a raw object format to mimic getHeader fallback)
    const fapiHeaders = {
      'x-fapi-order-count-10s': '150,300',
      'x-fapi-order-count-1m': '450,1200'
    };

    sessionState.updateOrderRateLimits(fapiHeaders);

    expect(sessionState.binanceOrderLimit.used_10s).toBe(150);
    expect(sessionState.binanceOrderLimit.used_1m).toBe(450);

    // 2. Setup headers representing Spot usage fallback
    const mbxHeaders = {
      'x-mbx-order-count-10s': '200,300',
      'x-mbx-order-count-1m': '600,1200'
    };

    sessionState.updateOrderRateLimits(mbxHeaders);

    expect(sessionState.binanceOrderLimit.used_10s).toBe(200);
    expect(sessionState.binanceOrderLimit.used_1m).toBe(600);
  });

  it('should support case-insensitive Headers objects (e.g. from axios / web headers)', () => {
    // Mock web Headers object with a .get method
    const headersMap = new Map<string, string>([
      ['X-FAPI-ORDER-COUNT-10S', '280,300'],
      ['X-FAPI-ORDER-COUNT-1M', '1100,1200']
    ]);

    const mockHeaders = {
      get: (name: string) => headersMap.get(name) || headersMap.get(name.toUpperCase()) || headersMap.get(name.toLowerCase()) || null
    };

    sessionState.updateOrderRateLimits(mockHeaders);

    expect(sessionState.binanceOrderLimit.used_10s).toBe(280);
    expect(sessionState.binanceOrderLimit.used_1m).toBe(1100);
  });

  it('should correctly trigger isOrderRateLimited based on parsed FAPI limits', () => {
    // Reset limits for standard testing
    sessionState.binanceOrderLimit.limit_10s = 300;
    sessionState.binanceOrderLimit.limit_1m = 1200;

    // Below thresholds (80%)
    sessionState.binanceOrderLimit.used_10s = 239; // 239/300 = 79.6%
    sessionState.binanceOrderLimit.used_1m = 500;  // 500/1200 = 41.6%

    expect(sessionState.isOrderRateLimited(1)).toBe(false);
    expect(sessionState.isOrderRateLimited(2)).toBe(false);

    // Exceeds Low priority threshold (80%)
    sessionState.binanceOrderLimit.used_10s = 241; // 241/300 = 80.3%
    expect(sessionState.isOrderRateLimited(2)).toBe(true);  // Low priority throttled
    expect(sessionState.isOrderRateLimited(1)).toBe(false); // Normal priority allowed

    // Exceeds Normal priority threshold (90%)
    sessionState.binanceOrderLimit.used_10s = 271; // 271/300 = 90.3%
    expect(sessionState.isOrderRateLimited(1)).toBe(true);  // Normal priority throttled
    expect(sessionState.isOrderRateLimited(0)).toBe(false); // Emergency priority never throttled
  });
});
