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
});
