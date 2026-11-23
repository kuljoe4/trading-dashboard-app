import { MarketFeedService } from './market_feed.service';

describe('MarketFeedService TradFi / Overnight Futures & Symbol Catalog', () => {
  let service: MarketFeedService;
  let mockTickerCache: any;
  let mockSettingsRepo: any;
  let mockBinanceClientFactory: any;

  beforeEach(() => {
    // Reset static exchangeInfo cache between test cases
    (MarketFeedService as any).cachedExchangeInfo = new Map();
    (MarketFeedService as any).lastExchangeInfoFetch = 0;
    (MarketFeedService as any).lastExchangeInfoBase = '';

    const tickers = new Map<string, any>([
      ['BTCUSDT', { symbol: 'BTCUSDT', price: 95000, volume_24h: 850_000_000, change_pct_24h: 2.4 }],
      ['XAUUSDT', { symbol: 'XAUUSDT', price: 2740.5, volume_24h: 120_000_000, change_pct_24h: 0.85 }],
      ['TSLAUSDT', { symbol: 'TSLAUSDT', price: 342.1, volume_24h: 45_000_000, change_pct_24h: -1.2 }],
    ]);

    mockTickerCache = {
      getTicker: jest.fn((sym: string) => tickers.get(sym) || null),
      getLatestTickers: jest.fn(() => Array.from(tickers.values())),
      getCacheSize: jest.fn(() => tickers.size),
    };

    const mockQueryBuilder = {
      where: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue(null),
    };

    mockSettingsRepo = {
      createQueryBuilder: jest.fn().mockReturnValue(mockQueryBuilder),
      findOne: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockResolvedValue({}),
    };

    const mockExchangeInfoPayload = {
      rateLimits: [{ rateLimitType: 'REQUEST_WEIGHT', interval: 'MINUTE', limit: 2400 }],
      symbols: [
        {
          symbol: 'BTCUSDT',
          status: 'TRADING',
          quoteAsset: 'USDT',
          baseAsset: 'BTC',
          contractType: 'PERPETUAL',
          underlyingType: 'COIN',
          underlyingSubType: ['Layer-1'],
          filters: [
            { filterType: 'PRICE_FILTER', tickSize: '0.1' },
            { filterType: 'LOT_SIZE', stepSize: '0.001', minQty: '0.001' },
            { filterType: 'MIN_NOTIONAL', notional: '5' },
          ],
        },
        {
          symbol: 'XAUUSDT',
          status: 'TRADING',
          quoteAsset: 'USDT',
          baseAsset: 'XAU',
          contractType: 'PERPETUAL',
          underlyingType: 'COMMODITY',
          underlyingSubType: ['METALS'],
          filters: [
            { filterType: 'PRICE_FILTER', tickSize: '0.01' },
            { filterType: 'LOT_SIZE', stepSize: '0.01', minQty: '0.01' },
            { filterType: 'MIN_NOTIONAL', notional: '5' },
          ],
        },
        {
          symbol: 'TSLAUSDT',
          status: 'TRADING',
          quoteAsset: 'USDT',
          baseAsset: 'TSLA',
          contractType: 'PERPETUAL',
          underlyingType: 'EQUITY',
          underlyingSubType: ['US_STOCK'],
          filters: [
            { filterType: 'PRICE_FILTER', tickSize: '0.01' },
            { filterType: 'LOT_SIZE', stepSize: '0.1', minQty: '0.1' },
            { filterType: 'MIN_NOTIONAL', notional: '5' },
          ],
        },
        {
          symbol: 'BTCUSDC',
          status: 'TRADING',
          quoteAsset: 'USDC',
          baseAsset: 'BTC',
          contractType: 'PERPETUAL',
          underlyingType: 'COIN',
          underlyingSubType: ['Layer-1'],
          filters: [],
        },
        {
          symbol: 'OLDUSDT',
          status: 'BREAK',
          quoteAsset: 'USDT',
          baseAsset: 'OLD',
          contractType: 'PERPETUAL',
          underlyingType: 'COIN',
          filters: [],
        },
      ],
    };

    mockBinanceClientFactory = {
      genericRequest: jest.fn(async (fn: any) => fn()),
      proxyFetch: jest.fn().mockResolvedValue({
        ok: true,
        json: async () => mockExchangeInfoPayload,
      }),
    };

    service = new MarketFeedService(
      mockTickerCache,
      {} as any,
      {
        updateRateLimit: jest.fn(),
        updateOrderRateLimits: jest.fn(),
        binanceRateLimit: { used_1m: 0 },
        isBanned: jest.fn().mockReturnValue(false),
        config: {},
      } as any,
      {} as any,
      {} as any,
      { emit: jest.fn() } as any,
      mockBinanceClientFactory,
      mockSettingsRepo,
    );
  });

  test('fetchExchangeInfo caches both Crypto and TradFi/Overnight (COMMODITY/EQUITY) USDT futures', async () => {
    await service.fetchExchangeInfo();

    const btc = service.getSymbolFilters('BTCUSDT');
    const xau = service.getSymbolFilters('XAUUSDT');
    const tsla = service.getSymbolFilters('TSLAUSDT');
    const broken = service.getSymbolFilters('OLDUSDT');

    expect(btc).toBeDefined();
    expect(btc.assetClass).toBe('crypto');

    expect(xau).toBeDefined();
    expect(xau.assetClass).toBe('tradfi');
    expect(xau.underlyingType).toBe('COMMODITY');

    expect(tsla).toBeDefined();
    expect(tsla.assetClass).toBe('tradfi');
    expect(tsla.underlyingType).toBe('EQUITY');

    expect(broken).toBeUndefined();
  });

  test('getAvailableSymbols returns USDT crypto and TradFi/Overnight futures sorted by volume and excludes non-USDT by default', async () => {
    await service.fetchExchangeInfo();

    const catalog = await service.getAvailableSymbols();
    const symbols = catalog.map((s) => s.symbol);

    expect(symbols).toEqual(['BTCUSDT', 'XAUUSDT', 'TSLAUSDT']);
    expect(symbols).not.toContain('BTCUSDC');

    const xauEntry = catalog.find((s) => s.symbol === 'XAUUSDT');
    expect(xauEntry).toMatchObject({
      symbol: 'XAUUSDT',
      assetClass: 'tradfi',
      underlyingType: 'COMMODITY',
      price: 2740.5,
      volume_24h: 120_000_000,
    });

    const withNonUsdt = await service.getAvailableSymbols({ includeNonUsdt: true });
    expect(withNonUsdt.some((s) => s.symbol === 'BTCUSDC')).toBe(true);
  });

  test('getAvailableSymbols omits HTF cross by default for zero overhead and attaches it when enabled or requested on-demand', async () => {
    const start = 1700000000000;
    const candles = Array.from({ length: 65 }, (_, i) => {
      const close = 100 + Math.sin((i - 47) * 0.32) * 8;
      return {
        time: start + i * 4 * 3600 * 1000,
        open: close * 0.999,
        high: close * 1.002,
        low: close * 0.998,
        close,
        volume: 5000 + i * 10,
      };
    });

    const peekMock = jest.fn((sym: string, interval: string) =>
      sym === 'BTCUSDT' && interval === '4h' ? candles : undefined
    );
    (service as any).klineStore = { peekRawCandles: peekMock };

    await service.fetchExchangeInfo();

    // Default (htf_ema_cross_catalog_enabled false/unset): 0 HTF calls
    const defaultCatalog = await service.getAvailableSymbols();
    const btcDefault = defaultCatalog.find((s) => s.symbol === 'BTCUSDT') as any;
    expect(peekMock).not.toHaveBeenCalled();
    expect(btcDefault?.htf_ema_cross).toBeUndefined();

    // On-demand includeHtfCross: evaluates via read-only peekRawCandles
    const htfCatalog = await service.getAvailableSymbols({ includeHtfCross: true });
    const btc = htfCatalog.find((s) => s.symbol === 'BTCUSDT') as any;
    const xau = htfCatalog.find((s) => s.symbol === 'XAUUSDT') as any;

    expect(peekMock).toHaveBeenCalledWith('BTCUSDT', '4h');
    expect(btc?.htf_ema_cross).toBeDefined();
    expect(btc.htf_ema_cross.interval).toBe('4h');
    expect(typeof btc.htf_ema_cross.suitability_score).toBe('number');
    expect(typeof btc.htf_ema_cross.freshness_score).toBe('number');
    expect(['fresh', 'approaching', 'early', 'extended', 'stale']).toContain(btc.htf_ema_cross.freshness_state);
    expect(xau?.htf_ema_cross).toBeUndefined();
  });
});
