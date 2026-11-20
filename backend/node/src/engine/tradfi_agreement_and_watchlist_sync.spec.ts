import { OrderManagerService } from './orderManager';
import { ExecutionStatus } from '../models/ExecutionResult';
import { MarketFeedService } from './market_feed.service';
import { SessionConfig } from '../models/SessionConfig';
import {
  checkTradFiAgreementWithBinance,
  pickTradFiProbeSymbolFromCatalog,
  signTradFiAgreementWithBinance,
} from './tradfi_agreement.helper';

describe('TradFi Agreement Isolation & Watchlist Live Config Sync', () => {
  describe('OrderManagerService TradFi-Perps agreement scoping', () => {
    const createOrderManager = () => {
      const sessionState: any = {
        agreementRequired: false,
        tradfiAgreementRequired: false,
        tradfiAgreementRequiredSince: null,
        isBanned: jest.fn().mockReturnValue(false),
        isRateLimited: jest.fn().mockReturnValue(false),
        isOrderRateLimited: jest.fn().mockReturnValue(false),
        binanceRateLimit: { used_1m: 10, limit: 2400 },
        apiStatus: { isBanned: false, isRateLimited: false, banUntil: null },
        realTimePositions: new Map(),
        realTimeOrders: new Map(),
        localTradePnLAdjustments: new Map(),
        activeTrades: [],
        getBalance: jest.fn().mockReturnValue(1000),
        updateRateLimit: jest.fn(),
        updateOrderRateLimit: jest.fn(),
      };

      const symbolFilters: Record<string, any> = {
        MVLLUSDT: { tickSize: 0.01, stepSize: 0.1, minNotional: 5, pricePrecision: 2, qtyPrecision: 1, assetClass: 'tradfi' },
        SNDKUSDT: { tickSize: 0.01, stepSize: 0.1, minNotional: 5, pricePrecision: 2, qtyPrecision: 1, assetClass: 'tradfi' },
        HUMAUSDT: { tickSize: 0.0001, stepSize: 1, minNotional: 5, pricePrecision: 4, qtyPrecision: 0, assetClass: 'crypto' },
      };

      const signalEngine: any = {};
      const marketFeed: any = {
        getSymbolFilters: jest.fn((sym: string) => symbolFilters[sym]),
      };
      const tickerCache: any = {
        getTicker: jest.fn(() => ({ price: 100, mark_price: 100, updated_at_ms: Date.now() })),
        getPrice: jest.fn(() => 100),
      };
      const monitoringService: any = { recordApiLatency: jest.fn() };
      const positionTracker: any = {
        hasSymbol: jest.fn().mockReturnValue(false),
        getTradeBySymbol: jest.fn().mockReturnValue(null),
        setInFlight: jest.fn(),
        clearInFlight: jest.fn(),
        removeInFlight: jest.fn(),
      };
      const broadcastService: any = { broadcast: jest.fn() };
      const auditLog: any = { log: jest.fn().mockResolvedValue(undefined) };
      const eventEmitter: any = { emit: jest.fn() };
      const settingsRepository: any = { findOne: jest.fn().mockResolvedValue({}) };
      const orderFilterService: any = {
        applyFilters: jest.fn((_sym: string, price: number, qty: number) => ({ price, qty })),
        checkLeverageBracket: jest.fn().mockResolvedValue({ isAllowed: true }),
      };

      const om = new OrderManagerService(
        signalEngine,
        marketFeed,
        tickerCache,
        monitoringService,
        positionTracker,
        sessionState,
        broadcastService,
        auditLog,
        eventEmitter,
        settingsRepository,
        orderFilterService,
      );

      // Configure live mode with mocked binanceClient
      (om as any).paperMode = false;
      (om as any).binanceClient = {
        restAPI: {
          newOrder: jest.fn(),
        },
      };

      return { om, sessionState, binanceClient: (om as any).binanceClient };
    };

    it('isolates TradFi-Perps agreement rejection to tradfiAgreementRequired without blocking crypto entries', async () => {
      const { om, sessionState, binanceClient } = createOrderManager();

      binanceClient.restAPI.newOrder.mockRejectedValueOnce(
        new Error('You must sign the TradFi-Perps agreement before trading this symbol.'),
      );

      const tradfiRes = await om.enter('sess-1', 'MVLLUSDT', 'LONG', 100, 1, 95, null);
      expect(tradfiRes.status).toBe(ExecutionStatus.ORDER_REJECTED);
      expect(sessionState.tradfiAgreementRequired).toBe(true);
      expect(sessionState.agreementRequired).toBe(false);

      // Subsequent TradFi symbol is fast-rejected inside 15m window without hitting Binance
      const secondTradfi = await om.enter('sess-1', 'SNDKUSDT', 'SHORT', 100, 1, 105, null);
      expect(secondTradfi.status).toBe(ExecutionStatus.ORDER_REJECTED);
      expect(secondTradfi.error).toContain('TradFi-Perps');
      expect(binanceClient.restAPI.newOrder).toHaveBeenCalledTimes(1);

      // Regular crypto symbol (HUMAUSDT) is NOT blocked by tradfiAgreementRequired
      binanceClient.restAPI.newOrder.mockResolvedValueOnce({
        headers: {},
        data: async () => ({
          orderId: 9991,
          status: 'FILLED',
          executedQty: '100',
          cumQuote: '100',
          avgPrice: '1',
        }),
      });
      jest.spyOn(om, 'placeStopLoss').mockResolvedValueOnce({ orderId: 'sl-1', price: 0.95 });

      const cryptoRes = await om.enter('sess-1', 'HUMAUSDT', 'LONG', 1, 100, 0.95, null);
      expect(cryptoRes.status).toBe(ExecutionStatus.SUCCESS);
      expect(binanceClient.restAPI.newOrder).toHaveBeenCalledTimes(2);
    });

    it('detects Binance error code -4411 and scopes it strictly to tradfiAgreementRequired', async () => {
      const { om, sessionState, binanceClient } = createOrderManager();

      const err: any = new Error('Binance API error -4411');
      err.code = -4411;
      binanceClient.restAPI.newOrder.mockRejectedValueOnce(err);

      const res = await om.enter('sess-1', 'MVLLUSDT', 'LONG', 100, 1, 95, null);
      expect(res.status).toBe(ExecutionStatus.ORDER_REJECTED);
      expect(sessionState.tradfiAgreementRequired).toBe(true);
      expect(sessionState.agreementRequired).toBe(false);
    });

    it('auto-probes TradFi entries after 15m and clears tradfiAgreementRequired on success', async () => {
      const { om, sessionState, binanceClient } = createOrderManager();
      sessionState.tradfiAgreementRequired = true;
      sessionState.tradfiAgreementRequiredSince = Date.now() - 16 * 60 * 1000;

      binanceClient.restAPI.newOrder.mockResolvedValueOnce({
        headers: {},
        data: async () => ({
          orderId: 9992,
          status: 'FILLED',
          executedQty: '1',
          cumQuote: '100',
          avgPrice: '100',
        }),
      });
      jest.spyOn(om, 'placeStopLoss').mockResolvedValueOnce({ orderId: 'sl-2', price: 95 });

      const res = await om.enter('sess-1', 'MVLLUSDT', 'LONG', 100, 1, 95, null);
      expect(res.status).toBe(ExecutionStatus.SUCCESS);
      expect(sessionState.tradfiAgreementRequired).toBe(false);
      expect(sessionState.tradfiAgreementRequiredSince).toBeNull();
    });
  });

  describe('Live TradFi-Perps agreement verification & signing helper', () => {
    const createClientFactory = (proxyFetchImpl: jest.Mock) => ({
      genericRequest: jest.fn(async (fn: () => Promise<any>) => fn()),
      proxyFetch: proxyFetchImpl,
    });

    it('picks preferred TradFi probe symbol from exchange catalog', () => {
      expect(
        pickTradFiProbeSymbolFromCatalog([
          { symbol: 'BTCUSDT', assetClass: 'crypto' },
          { symbol: 'MVLLUSDT', assetClass: 'tradfi' },
          { symbol: 'TSLAUSDT', assetClass: 'tradfi' },
        ]),
      ).toBe('TSLAUSDT');
      expect(pickTradFiProbeSymbolFromCatalog([])).toBe('XAUUSDT');
    });

    it('returns unconfigured when no live credentials exist', async () => {
      const proxyFetch = jest.fn();
      const result = await checkTradFiAgreementWithBinance({
        creds: null,
        probeSymbol: 'TSLAUSDT',
        binanceClientFactory: createClientFactory(proxyFetch),
      });
      expect(result.status).toBe('unconfigured');
      expect(result.signed).toBeNull();
      expect(proxyFetch).not.toHaveBeenCalled();
    });

    it('returns unsigned and triggers onStatusResolved(true) when /fapi/v1/order/test returns -4411', async () => {
      const proxyFetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 400,
        text: async () => JSON.stringify({ code: -4411, msg: 'Please sign TradFi-Perps agreement contract fapi.' }),
      });
      const onStatusResolved = jest.fn();

      const result = await checkTradFiAgreementWithBinance({
        creds: { apiKey: 'live_key_123', apiSecret: 'live_secret_456' },
        probeSymbol: 'TSLAUSDT',
        binanceClientFactory: createClientFactory(proxyFetch),
        onStatusResolved,
      });

      expect(result.status).toBe('unsigned');
      expect(result.signed).toBe(false);
      expect(result.code).toBe(-4411);
      expect(result.symbol).toBe('TSLAUSDT');
      expect(onStatusResolved).toHaveBeenCalledWith(true);

      const calledUrl = String(proxyFetch.mock.calls[0][0]);
      expect(calledUrl).toContain('/fapi/v1/order/test?');
      expect(calledUrl).toContain('symbol=TSLAUSDT');
      expect(calledUrl).toContain('signature=');
    });

    it('returns signed and triggers onStatusResolved(false) on 200 OK or post-agreement filter error (-4164)', async () => {
      const proxyFetch = jest.fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: async () => JSON.stringify({}),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 400,
          text: async () => JSON.stringify({ code: -4164, msg: "Order's notional must be no smaller than 5" }),
        });
      const onStatusResolved = jest.fn();
      const binanceClientFactory = createClientFactory(proxyFetch);

      const okRes = await checkTradFiAgreementWithBinance({
        creds: { apiKey: 'live_key_123', apiSecret: 'live_secret_456' },
        probeSymbol: 'TSLAUSDT',
        binanceClientFactory,
        onStatusResolved,
      });
      expect(okRes.status).toBe('signed');
      expect(okRes.signed).toBe(true);
      expect(onStatusResolved).toHaveBeenLastCalledWith(false);

      const filterRes = await checkTradFiAgreementWithBinance({
        creds: { apiKey: 'live_key_123', apiSecret: 'live_secret_456' },
        probeSymbol: 'TSLAUSDT',
        binanceClientFactory,
        onStatusResolved,
      });
      expect(filterRes.status).toBe('signed');
      expect(filterRes.signed).toBe(true);
      expect(filterRes.code).toBe(-4164);
    });

    it('returns error (signed: null) on auth failure (-2015) without falsely claiming signed or unsigned', async () => {
      const proxyFetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 401,
        text: async () => JSON.stringify({ code: -2015, msg: 'Invalid API-key, IP, or permissions for action.' }),
      });
      const onStatusResolved = jest.fn();

      const result = await checkTradFiAgreementWithBinance({
        creds: { apiKey: 'live_key_123', apiSecret: 'live_secret_456' },
        probeSymbol: 'TSLAUSDT',
        binanceClientFactory: createClientFactory(proxyFetch),
        onStatusResolved,
      });
      expect(result.status).toBe('error');
      expect(result.signed).toBeNull();
      expect(onStatusResolved).not.toHaveBeenCalled();
    });

    it('signs TradFi-Perps agreement via signed POST /fapi/v1/stock/contract', async () => {
      const proxyFetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ msg: 'success' }),
      });

      const result = await signTradFiAgreementWithBinance({
        creds: { apiKey: 'live_key_123', apiSecret: 'live_secret_456' },
        binanceClientFactory: createClientFactory(proxyFetch),
      });
      expect(result.ok).toBe(true);
      expect(result.status).toBe(200);
      expect(String(proxyFetch.mock.calls[0][0])).toContain('/fapi/v1/stock/contract?');
      expect(String(proxyFetch.mock.calls[0][0])).toContain('signature=');
    });
  });

  describe('MarketFeedService.startWatchlistManager live config refresh', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('passes latest sessionState.config instead of stale startup config on periodic watchlist ticks', async () => {
      const startupConfig = {
        strategy_label: 'Base 1D',
        scan_interval: '1d',
        watchlist_size: 1,
        strategy_variants: [],
      } as unknown as SessionConfig;

      const updatedConfig = {
        strategy_label: 'Base 1D',
        scan_interval: '1d',
        watchlist_size: 1,
        strategy_variants: [
          {
            strategy_label: 'Top 25 Movers breakout 1h',
            scan_interval: '1h',
            discovery_mode: 'abs_change_pct',
            watchlist_size: 25,
          },
        ],
      } as unknown as SessionConfig;

      const sessionState: any = {
        config: startupConfig,
        isBanned: jest.fn().mockReturnValue(false),
      };

      const feed = new MarketFeedService(
        { getCacheSize: jest.fn().mockReturnValue(10) } as any,
        {} as any,
        sessionState,
        {} as any,
        {} as any,
        { emit: jest.fn() } as any,
        {} as any,
        {} as any,
      );

      const updateSpy = jest.spyOn(feed, 'updateWatchlist').mockResolvedValue(undefined);
      (feed as any).running = true;

      await (feed as any).startWatchlistManager(startupConfig);
      expect(updateSpy).toHaveBeenCalledTimes(1);
      expect(updateSpy).toHaveBeenLastCalledWith(startupConfig);

      // Simulate live config update (adding "Top 25 Movers breakout 1h")
      sessionState.config = updatedConfig;

      // Advance past WATCHLIST_REFRESH_INTERVAL_MS (2 minutes)
      jest.advanceTimersByTime(125_000);

      expect(updateSpy).toHaveBeenCalledTimes(2);
      expect(updateSpy).toHaveBeenLastCalledWith(updatedConfig);

      if ((feed as any).watchlistInterval) {
        clearInterval((feed as any).watchlistInterval);
      }
    });
  });
});
