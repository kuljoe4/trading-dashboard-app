import { TickerCacheService } from './ticker_cache.service';

describe('TickerCacheService', () => {
  let service: TickerCacheService;

  beforeEach(() => {
    service = new TickerCacheService();
  });

  it('supports partial updates (keeping existing volume)', async () => {
    // Initial update with both price and volume
    await service.bulkUpdate([{ s: 'BTCUSDT', c: '50000', q: '1000000' }]);
    let ticker = await service.getTicker('BTCUSDT');
    expect(ticker?.price).toBe(50000);
    expect(ticker?.volume_24h).toBe(1000000);

    // Partial update with only price
    await service.bulkUpdate([{ s: 'BTCUSDT', c: '51000' }]);
    ticker = await service.getTicker('BTCUSDT');
    expect(ticker?.price).toBe(51000);
    expect(ticker?.volume_24h).toBe(1000000); // Should be preserved
  });

  it('supports partial updates (keeping existing price)', async () => {
    // Initial update
    await service.bulkUpdate([{ s: 'BTCUSDT', c: '50000', q: '1000000' }]);

    // Partial update with only volume
    await service.bulkUpdate([{ s: 'BTCUSDT', q: '2000000' }]);
    let ticker = await service.getTicker('BTCUSDT');
    expect(ticker?.price).toBe(50000); // Should be preserved
    expect(ticker?.volume_24h).toBe(2000000);
  });

  describe('mark_price prioritization and initialization', () => {
    it('should prioritize mark_price over last price in getPrice', () => {
      service.updateTicker('BTCUSDT', 50000, 100, 49000, 50100);
      expect(service.getPrice('BTCUSDT')).toBe(50100);
    });

    it('should fall back to last price if mark_price is missing', () => {
      service.updateTicker('BTCUSDT', 50000, 100);
      expect(service.getPrice('BTCUSDT')).toBe(50000);
    });

    it('should initialize price from mark_price if price is 0', () => {
      // Initialization scenario
      service.updateTicker('BTCUSDT', 0, 0, 0, 50500);
      const ticker = service.getTicker('BTCUSDT');
      expect(ticker?.price).toBe(50500);
      expect(ticker?.mark_price).toBe(50500);
    });

    it('should update price from mark_price if existing price is 0', () => {
      // Existing ticker with 0 price scenario
      service.updateTicker('BTCUSDT', 0, 100);
      service.updateTicker('BTCUSDT', undefined, undefined, undefined, 51000);
      const ticker = service.getTicker('BTCUSDT');
      expect(ticker?.price).toBe(51000);
      expect(ticker?.mark_price).toBe(51000);
    });
  });
});
