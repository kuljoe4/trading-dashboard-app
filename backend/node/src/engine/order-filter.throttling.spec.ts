import { OrderFilterService } from './order-filter.service';

describe('OrderFilterService Throttling & Migration Test', () => {
  let service: OrderFilterService;
  let mockMarketFeed: any;
  let mockTickerCache: any;
  let mockSessionState: any;

  beforeEach(() => {
    mockMarketFeed = {
      getSymbolFilters: jest.fn().mockReturnValue({
        tickSize: 0.001,
        stepSize: 0.001,
        multiplierUp: 1.05,
        multiplierDown: 0.95,
      }),
    };

    mockTickerCache = {
      getTicker: jest.fn().mockReturnValue({
        symbol: 'ATOMUSDT',
        mark_price: 2.0,
        price: 2.0,
      }),
    };

    mockSessionState = {
      isBanned: jest.fn().mockReturnValue(false),
    };

    service = new OrderFilterService(mockMarketFeed, mockTickerCache, mockSessionState);
  });

  it('should throttle SL/TP deviation warnings to once per cooldown window', () => {
    const loggerWarnSpy = jest.spyOn((service as any).logger, 'warn').mockImplementation(() => {});

    // SL price is 1.671, mark price is 2.0.
    // Deviation = |1.671 - 2.0| / 2.0 = 0.1645 (16.45%), which is > 0.1 (10%).
    // First call should emit a warning log.
    const res1 = service.applyFilters('ATOMUSDT', 1.671, 10, { skipNotionalCheck: true });
    expect(res1.price).toBe(1.671);
    expect(loggerWarnSpy).toHaveBeenCalledTimes(1);
    expect(loggerWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining('ATOMUSDT: SL/TP Price 1.671 significantly far from Mark')
    );

    // Immediate second call should be throttled and NOT emit another warning log.
    const res2 = service.applyFilters('ATOMUSDT', 1.671, 10, { skipNotionalCheck: true });
    expect(res2.price).toBe(1.671);
    expect(loggerWarnSpy).toHaveBeenCalledTimes(1);

    // Fast-forward time past 5 minutes (300,000 ms)
    const originalNow = Date.now;
    Date.now = jest.fn().mockReturnValue(originalNow() + 6 * 60 * 1000);

    // Third call after cooldown should emit another warning log.
    const res3 = service.applyFilters('ATOMUSDT', 1.671, 10, { skipNotionalCheck: true });
    expect(res3.price).toBe(1.671);
    expect(loggerWarnSpy).toHaveBeenCalledTimes(2);

    Date.now = originalNow;
  });
});
