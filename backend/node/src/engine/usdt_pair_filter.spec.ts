import { MomentumScannerService } from './momentum_scanner.service';
import { SessionConfig } from '../models/SessionConfig';

describe('MomentumScannerService USDT Quote Pair Filtering', () => {
  let service: MomentumScannerService;
  let mockKlineStore: any;
  let mockTickerCache: any;
  let mockMarketFeed: any;

  beforeEach(() => {
    mockKlineStore = {
      getRawCandles: jest.fn().mockReturnValue([
        { close: 100, high: 102, low: 98 },
        { close: 105, high: 107, low: 101 },
      ]),
    };
    mockTickerCache = {
      getTicker: jest.fn().mockReturnValue({ price: 105, volume_24h: 1000000 }),
      getLatestTickers: jest.fn().mockReturnValue([]),
      topByVolume: jest.fn().mockReturnValue([]),
      topByChangePct: jest.fn().mockReturnValue([]),
    };
    mockMarketFeed = {
      getSymbolFilters: jest.fn().mockReturnValue({ minNotional: 5 }),
    };

    service = new MomentumScannerService(
      mockKlineStore,
      mockTickerCache,
      mockMarketFeed,
    );
  });

  test('scanSymbol returns null for non-USDT quote symbols (e.g. TRUMPUSDC)', () => {
    const config = new SessionConfig();
    config.scan_lookback = 1;
    config.scan_pct_threshold = 0.5;

    const result = (service as any).scanSymbol('TRUMPUSDC', '1m', config);
    expect(result).toBeNull();
  });

  test('scanSymbol returns opportunity for valid USDT quote symbol (e.g. TRUMPUSDT)', () => {
    const config = new SessionConfig();
    config.scan_lookback = 1;
    config.scan_pct_threshold = 0.5;

    const result = (service as any).scanSymbol('TRUMPUSDT', '1m', config);
    expect(result).not.toBeNull();
    expect(result.opp.symbol).toBe('TRUMPUSDT');
  });

  test('scan filters out non-USDT quote symbols from custom symbols list', () => {
    const config = new SessionConfig();
    config.global_scanner_enabled = true;
    config.symbols = ['BTCUSDT', 'TRUMPUSDC', 'ETHUSDT', 'BTCUSDC'];
    config.scan_lookback = 1;
    config.scan_pct_threshold = 0.5;

    const results = service.scan(config);
    expect(results.some(opp => opp.symbol === 'TRUMPUSDC')).toBe(false);
    expect(results.some(opp => opp.symbol === 'BTCUSDC')).toBe(false);
    expect(results.some(opp => opp.symbol === 'BTCUSDT')).toBe(true);
    expect(results.some(opp => opp.symbol === 'ETHUSDT')).toBe(true);
  });
});
