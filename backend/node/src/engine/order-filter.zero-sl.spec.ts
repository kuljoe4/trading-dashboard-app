import { OrderFilterService } from './order-filter.service';

/**
 * Regression coverage for the "SL/TP Price 0 significantly far from Mark (100.00%).
 * Proceeding with filtered price." defect.
 *
 * A non-positive stop-loss / take-profit price is never valid on Binance. Previously
 * applyFilters would log a warning and silently RETURN price 0, allowing a broken 0-price
 * stop into the order pipeline and flooding the logs. It must now reject hard.
 */
describe('OrderFilterService - non-positive SL/TP rejection', () => {
  let service: OrderFilterService;
  const filters = {
    tickSize: 0.0001,
    stepSize: 1,
    multiplierUp: 1.05,
    multiplierDown: 0.95,
    pricePrecision: 4,
    qtyPrecision: 0,
  };

  beforeEach(() => {
    const mockMarketFeed = {
      getSymbolFilters: jest.fn().mockReturnValue(filters),
    } as any;
    const mockTickerCache = {
      getTicker: jest.fn().mockReturnValue({ mark_price: 100, price: 100 }),
    } as any;
    const mockSessionState = { broadcast: jest.fn() } as any;
    service = new OrderFilterService(mockMarketFeed, mockTickerCache, mockSessionState);
  });

  it('rejects a zero SL/TP price instead of proceeding with 0', () => {
    const result = service.applyFilters('SYNUSDT', 0, 1, { skipNotionalCheck: true });
    expect(result.price).toBe(0);
    expect(result.qty).toBe(0);
  });

  it('rejects a negative SL/TP price', () => {
    const result = service.applyFilters('SYNUSDT', -5, 1, { skipNotionalCheck: true });
    expect(result.price).toBe(0);
    expect(result.qty).toBe(0);
  });

  it('still proceeds for a valid (non-zero) far SL/TP price', () => {
    // 50 vs mark 100 -> 50% deviation, well beyond the 10% warning threshold, but valid.
    const result = service.applyFilters('SYNUSDT', 50, 1, { skipNotionalCheck: true });
    expect(result.price).toBeGreaterThan(0);
    expect(result.qty).toBe(1);
  });

  it('does not reject a zero price when not in SL/TP mode (normal entry)', () => {
    // Non-SL/TP path only rejects when price is outside bands AND > 5% from mark.
    const result = service.applyFilters('SYNUSDT', 0, 1, { skipNotionalCheck: false });
    // Outside PERCENT_PRICE band and 100% from mark -> rejected (qty 0) but that is expected.
    expect(result.qty).toBe(0);
  });

  it('clamps a positive SL/TP price to tickSize instead of rounding to 0', () => {
    // price 0.00001 is positive, but less than tickSize 0.0001. Floor rounding would round it to 0.
    // It must now be clamped to tickSize (0.0001).
    const result = service.applyFilters('SYNUSDT', 0.00001, 1, {
      priceRounding: 'floor',
      skipNotionalCheck: true,
    });
    expect(result.price).toBe(0.0001);
    expect(result.qty).toBe(1);
  });
});
