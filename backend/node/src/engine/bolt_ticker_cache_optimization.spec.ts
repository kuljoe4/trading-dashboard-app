import { TickerCacheService } from './ticker_cache.service';

describe('TickerCacheService Caching Regression', () => {
  let service: TickerCacheService;

  beforeEach(() => {
    service = new TickerCacheService();
  });

  it('should return the same array reference when getLatestTickers is called multiple times and no new symbol is added', () => {
    service.updateTicker('BTCUSDT', 50000, 100);
    service.updateTicker('ETHUSDT', 3000, 500);

    const tickers1 = service.getLatestTickers();
    const tickers2 = service.getLatestTickers();

    // Verify it is the exact same array reference in memory
    expect(tickers1).toBe(tickers2);
    expect(tickers1.length).toBe(2);
  });

  it('should correctly capture in-place property mutations without needing cache invalidation', () => {
    service.updateTicker('BTCUSDT', 50000, 100);

    const tickers1 = service.getLatestTickers();
    expect(tickers1[0].price).toBe(50000);

    // Update the price in place
    service.updateTicker('BTCUSDT', 51000, 105);

    // Get again. The reference should be the same, but containing the mutated price
    const tickers2 = service.getLatestTickers();
    expect(tickers2).toBe(tickers1);
    expect(tickers2[0].price).toBe(51000);
    expect(tickers2[0].volume_24h).toBe(105);
  });

  it('should invalidate the cache when a brand new symbol is added', () => {
    service.updateTicker('BTCUSDT', 50000, 100);

    const tickers1 = service.getLatestTickers();
    expect(tickers1.length).toBe(1);

    // Add a brand new symbol (should nullify and rebuild cache)
    service.updateTicker('ETHUSDT', 3000, 500);

    const tickers2 = service.getLatestTickers();
    expect(tickers2).not.toBe(tickers1);
    expect(tickers2.length).toBe(2);
    expect(tickers2.some(t => t.symbol === 'ETHUSDT')).toBe(true);
  });

  it('should invalidate the cache when clear is called', () => {
    service.updateTicker('BTCUSDT', 50000, 100);

    const tickers1 = service.getLatestTickers();
    expect(tickers1.length).toBe(1);

    service.clear();

    const tickers2 = service.getLatestTickers();
    expect(tickers2).not.toBe(tickers1);
    expect(tickers2.length).toBe(0);
  });
});
