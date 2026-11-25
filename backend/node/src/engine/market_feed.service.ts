import { SHARED_MARKET_DATA, SharedMarketData } from './shared-market-data';
import { resolveStrategyConfig } from './strategyConfig';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Settings as SettingsEntity } from '../models/entities/Settings.entity';
import { OnEvent, EventEmitter2 } from '@nestjs/event-emitter';
import WebSocket from 'ws';
import { SessionConfig } from '../models/SessionConfig';
import { ENGINE_CONSTANTS } from '../models/constants';
import { TickerCacheService } from './ticker_cache.service';
import { KlineStoreService, Candle } from './kline_store.service';
import { SessionStateService } from './session_state.service';
import { SignalEngineService } from './signalEngine';
import { MonitoringService } from './monitoring.service';
import { ENGINE_EVENTS } from './events';
import { BinanceExchangeInfo } from '../models/binance.types';
import { BinanceRequestQueue, BinanceClientFactory } from '../lib/binanceClientFactory';
import { BinanceSubscriptionManager } from '../lib/binanceSubscriptionManager';
import { evaluateHtfEmaCross, HtfEmaCrossSummary } from './htfEmaCross';

interface BinanceKline {
  stream?: string;
  data?: {
    k: {
      t: number; T: number; s: string; i: string; f: number; L: number; o: string; c: string; h: string; l: string; v: string; n: number; x: boolean; q: string; V: string; Q: string;
    };
  };
}

@Injectable()
export class MarketFeedService {
  private static readonly STARTUP_SELFTEST_MS = 15000;

  async onModuleInit() {
    // Proactively load from DB on module init to seed the static cache
    // SRE: On boot, we don't have a session config yet. We load Production metadata
    // from the DB into the static cache if available. Testnet will be loaded on-demand
    // when a session starts to avoid dual-burst on boot.
    await this.fetchExchangeInfo(ENGINE_CONSTANTS.BINANCE_REST_BASE);
  }
  private readonly logger = new Logger(MarketFeedService.name);
  private running = false;
  private static cachedExchangeInfo: Map<string, any> = new Map();
  private static cachedRateLimit = 0;
  private static lastExchangeInfoFetch = 0;
  private static lastExchangeInfoBase = '';
  private exchangeInfo: Map<string, any> = MarketFeedService.cachedExchangeInfo;
  private activeWatchlist: Map<string, Set<string>> = new Map();
  private subscriptionTasks: any[] = [];
  private onCandleClose: ((symbol: string) => Promise<void>) | null = null;
  private watchlistInterval: NodeJS.Timeout | null = null;
  private watchlistUpdatePending = false;
  private watchlistUpdateTimeout: NodeJS.Timeout | null = null;
  private zeroWatchlistCycles = 0;
  private hasSuccessfullyBuiltWatchlist = false;
  private backfillQueue: { symbol: string, interval: string }[] = [];
  private backfillProcessing = false;
  private lastBackfillAttemptMap: Map<string, number> = new Map();
  private failureBackoffMap: Map<string, number> = new Map();
  private shortHistoryMap: Map<string, { count: number; fetchedAt: number }> = new Map();
  private ensureKlinesCooldownMap: Map<string, number> = new Map();
  private inFlightBackfills: Map<string, Promise<void>> = new Map();
  private binanceClient: any = null;

  @Optional() @Inject(SHARED_MARKET_DATA)
  private readonly sharedMarket?: SharedMarketData;

  public isBackfillShortHistory(symbol: string, interval: string): boolean {
    const resolved = this.resolveInterval(interval, this.sessionState.config) || interval;
    const key = `${symbol}:${resolved}`;
    const entry = this.shortHistoryMap.get(key);
    if (!entry) return false;
    if (Date.now() - entry.fetchedAt < 15 * 60 * 1000) return true;
    this.shortHistoryMap.delete(key);
    return false;
  }

  private currentConfig: SessionConfig | null = null;
  private currentRestBase = ENGINE_CONSTANTS.BINANCE_REST_BASE;
  private currentIsTestnet = false;
  private currentProxyUrl?: string;
  private restSeedInFlight = false;
  private lastRestSeedTs = 0;

  private lastMiniTickerMsgTs = 0;
  private lastMarkTickerMsgTs = 0;
  private globalDiscoveryOpenedAt = 0;
  private hasEverReceivedData = false;
  private _globalDiscoveryConfirmed = false;
  private forceRawDiscovery = false;
  private consecutiveDiscoveryFailures = 0;

  private discoveryManagers: Map<string, BinanceSubscriptionManager> = new Map();
  private klineManagers: BinanceSubscriptionManager[] = [];

  private discoveredSymbolsCache: {
    symbols: string[];
    timestamp: number;
    signature: string;
  } | null = null;

  private readonly catalogHtfCache = new Map<string, { key: string; summary: HtfEmaCrossSummary }>();

  private getWatchlistConfigSignature(config: SessionConfig, activeSymbolList: string[]): string {
    return JSON.stringify({
      smart: config.smart_watchlist_enabled,
      size: config.watchlist_size,
      offset: config.watchlist_offset,
      mode: config.discovery_mode,
      threshold: config.scan_pct_threshold,
      sensitivity: config.smart_watchlist_sensitivity,
      excluded: config.excluded_symbols || [],
      active: activeSymbolList.sort(),
      variants: (config.strategy_variants || []).map((v: any) => ({
        enabled: v?.enabled,
        symbols: v?.symbols,
        scan_interval: v?.scan_interval,
        discovery_mode: v?.discovery_mode,
        watchlist_size: v?.watchlist_size,
      })),
    });
  }

  constructor(
    private tickerCache: TickerCacheService,
    private klineStore: KlineStoreService,
    private sessionState: SessionStateService,
    private signalEngine: SignalEngineService,
    private monitoringService: MonitoringService,
    private eventEmitter: EventEmitter2,
    private binanceClientFactory: BinanceClientFactory,
    @InjectRepository(SettingsEntity)
    private readonly settingsRepository: Repository<SettingsEntity>,
  ) {}

  setCandleCloseCallback(cb: (symbol: string) => Promise<void>) {
    this.onCandleClose = cb;
  }

  private startMiniTickerStream() { /* Rebuild handled by watchlist manager */ }
  private startMarkTickerStream() { /* Rebuild handled by watchlist manager */ }

  private lastWatchlistLogTs = 0;

  async start(config: SessionConfig, bc?: any) {
    this.binanceClient = this.sharedMarket ? null : bc ?? null;
    if (this.running) await this.stop();
    this.running = true;
    this.sharedMarket?.attach(this);
    this.forceRawDiscovery = false;
    this.consecutiveDiscoveryFailures = 0;
    this.currentConfig = config;

    const mode = config.trading_mode || (config.paper_mode ? 'paper' : 'live');
    const isTestnet = mode === 'testnet';
    const restBase = isTestnet
        ? ENGINE_CONSTANTS.BINANCE_TESTNET_REST_URL
        : ENGINE_CONSTANTS.BINANCE_REST_BASE;

    this.currentRestBase = restBase;
    this.currentIsTestnet = isTestnet;

    try {
      const settings = await this.settingsRepository.findOne({ where: { id: 'default' } });
      if (settings?.proxy_url) this.currentProxyUrl = settings.proxy_url.trim();
    } catch (_) {}
    if (this.sharedMarket) {
      this.currentProxyUrl = this.sharedMarket.proxyUrl;
    } else if (!this.currentProxyUrl) {
      this.currentProxyUrl = process.env.PROXY_URL || process.env.HTTPS_PROXY || undefined;
    }

    const wsBaseMarket = isTestnet
        ? ENGINE_CONSTANTS.BINANCE_TESTNET_WS_URL
        : ENGINE_CONSTANTS.BINANCE_WS_MARKET;

    // Discovery Managers initialization is now deferred to startGlobalDiscovery

    // CITADEL PROTOCOL: Sequential, jittered startup warmup
    const warmupSteps = [
      () => this.fetchExchangeInfo(restBase),
      () => this.startGlobalDiscovery(),
      () => this.startWatchlistManager(config),
      () => this.seedMarketDataFromRest()
    ];

    for (const step of warmupSteps) {
      await step().catch(err => {
        this.logger.warn(`Startup step failed: ${err instanceof Error ? err.message : String(err)}`);
      });
      // Add jittered delay (150-300ms)
      await new Promise(resolve => setTimeout(resolve, 150 + Math.random() * 150));
    }

    // SRE: Startup Self-Test (Citadel Protocol 2026)
    // Assert TickerCache is seeded within 15s or alert loudly.
    const runMode = mode;
    if (runMode !== 'paper') {
       setTimeout(() => {
          if (this.running && this.tickerCache.getCacheSize() === 0) {
             if (this.sessionState.isBanned()) {
               this.logger.warn(`[MarketFeed] Startup Self-Test bypassed: IP is currently banned.`);
               return;
             }
             const alertMsg = `CRITICAL: Market Feed Startup Failure - TickerCache remains empty after ${MarketFeedService.STARTUP_SELFTEST_MS / 1000}s. Activating raw WebSocket fallback and REST seed. Mode=${runMode}`;
             this.logger.error(alertMsg);
             this.eventEmitter.emit(ENGINE_EVENTS.LOG_MESSAGE, { msg: alertMsg, level: 'error' });
             this.eventEmitter.emit(ENGINE_EVENTS.ALERT, {
                level: 'error',
                title: 'Market Feed Failure',
                message: 'No ticker data received from Binance WebSocket. Using REST fallback.',
             });

             // Fast self-healing: set raw fallback and restart global discovery
             this.forceRawDiscovery = true;
             this.startGlobalDiscovery().catch(err => {
                this.logger.error(`Failed to start raw global discovery: ${err.message}`);
             });

             // SRE: Guarantee the cache is populated even if the WS is starved.
             this.seedMarketDataFromRest().catch(() => {});
          } else if (this.running) {
             this.logger.log(`[MarketFeed] Startup Self-Test passed: ${this.tickerCache.getCacheSize()} symbols seeded.`);
          }
       }, MarketFeedService.STARTUP_SELFTEST_MS);
    }
  }

  public updateWeight(headers: any) {
    if (!headers) return;
    const weight = typeof headers.get === 'function' ? headers.get('X-MBX-USED-WEIGHT-1M') : (headers['x-mbx-used-weight-1m'] || headers['X-MBX-USED-WEIGHT-1M']);
    if (weight) {
      const currentWeight = parseInt(weight, 10);
      // REDUCE LOG NOISE: No need to log weight for every market feed update
      // this.logger.debug(`Binance Weight Update: ${currentWeight}`);
      this.sessionState.updateRateLimit(currentWeight);
    }
  }

  public async fetchExchangeInfo(restBase: string = ENGINE_CONSTANTS.BINANCE_REST_BASE) {
    const now = Date.now();
    // BOLT: Static caching of exchange info for 1 hour to prevent redundant heavy calls (Weight 40) across session restarts
    // RESEARCH-02: Increase TTL to 12 hours for metadata that rarely changes, further reducing weight usage.
    const CACHE_TTL = 12 * 60 * 60 * 1000;

    // RESEARCH-02: DB-First Metadata Loading (v2 includes TradFi/Overnight futures alongside Crypto)
    const CACHE_SCHEMA_VERSION = 2;
    if (MarketFeedService.cachedExchangeInfo.size === 0) {
      try {
        const settings = await this.settingsRepository.createQueryBuilder('settings')
          .where('settings.id = :id', { id: 'default' })
          .addSelect('settings.exchange_info_cache')
          .getOne();
        if (settings && settings.exchange_info_cache && settings.exchange_info_ts) {
          const age = now - Number(settings.exchange_info_ts);
          const cache = settings.exchange_info_cache;
          const cacheVersion = Number(cache?.__schemaVersion || 1);
          if (age < CACHE_TTL && cacheVersion >= CACHE_SCHEMA_VERSION) {
            this.logger.log(`Loading exchange info from DB cache (Age: ${Math.round(age / 3600000)}h, v${cacheVersion})...`);
            MarketFeedService.cachedExchangeInfo.clear();
            Object.keys(cache).forEach(symbol => {
              if (symbol === '__schemaVersion') return;
              MarketFeedService.cachedExchangeInfo.set(symbol, cache[symbol]);
            });

            const storedLimit = settings.exchange_rate_limit || ENGINE_CONSTANTS.BINANCE_RATE_LIMIT_DEFAULT;
            MarketFeedService.cachedRateLimit = storedLimit;
            this.sessionState.updateRateLimit(this.sessionState.binanceRateLimit.used_1m, storedLimit);
            BinanceRequestQueue.setWeightLimit(storedLimit);

            MarketFeedService.lastExchangeInfoFetch = Number(settings.exchange_info_ts);
            MarketFeedService.lastExchangeInfoBase = restBase;
            this.exchangeInfo = MarketFeedService.cachedExchangeInfo;
          } else if (age < CACHE_TTL && cacheVersion < CACHE_SCHEMA_VERSION) {
            this.logger.log(`[MarketFeed] Upgrading exchange_info_cache from v${cacheVersion} to v${CACHE_SCHEMA_VERSION} to include TradFi/Overnight futures symbols.`);
          }
        }
      } catch (dbErr) {
        this.logger.debug(`Failed to load exchange info from DB: ${dbErr}`);
      }
    }

    if (MarketFeedService.cachedExchangeInfo.size > 0 && MarketFeedService.lastExchangeInfoBase === restBase && now - MarketFeedService.lastExchangeInfoFetch < CACHE_TTL) {
      this.exchangeInfo = MarketFeedService.cachedExchangeInfo;
      if (MarketFeedService.cachedRateLimit > 0) {
        this.sessionState.updateRateLimit(this.sessionState.binanceRateLimit.used_1m, MarketFeedService.cachedRateLimit);
        BinanceRequestQueue.setWeightLimit(MarketFeedService.cachedRateLimit);
      }
      return;
    }

    try {
      let data: BinanceExchangeInfo | null = null;
      if (this.binanceClient) {
        this.logger.debug(`[MarketFeed] Fetching fresh exchange information from SDK...`);
        const response = await this.binanceClient.restAPI.exchangeInformation();
        this.updateWeight(response.headers);
        data = (await response.data()) as BinanceExchangeInfo;
      } else {
        this.logger.debug(`[MarketFeed] Fetching fresh exchange information via fetch...`);
        const response = await this.binanceClientFactory.genericRequest(
          () => this.binanceClientFactory.proxyFetch(`${restBase}/fapi/v1/exchangeInfo`, { signal: AbortSignal.timeout(10000) }, this.currentProxyUrl),
          'exchangeInformation',
          true // Metadata is critical for boot
        );
        if (!response.ok) return;
        data = (await response.json()) as BinanceExchangeInfo;
      }

      if (data) {

        // Dynamic Rate Limit Detection
        if (data && Array.isArray(data.rateLimits)) {
           const requestWeightLimit = data.rateLimits.find((l) => l.rateLimitType === 'REQUEST_WEIGHT' && l.interval === 'MINUTE');
           if (requestWeightLimit) {
              const limit = parseInt(String(requestWeightLimit.limit), 10);
              this.sessionState.updateRateLimit(this.sessionState.binanceRateLimit.used_1m, limit);
              // SRE Overwatch: Synchronize dynamic limit to the centralized gateway queue
              BinanceRequestQueue.setWeightLimit(limit);
              this.logger.log(`Dynamic Binance Rate Limit detected: ${limit}/min`);
           }

           const orderLimit10s = data.rateLimits.find((l) => l.rateLimitType === 'ORDERS' && l.interval === 'SECOND' && l.intervalNum === 10);
           const orderLimit1m = data.rateLimits.find((l) => l.rateLimitType === 'ORDERS' && l.interval === 'MINUTE');

           if (orderLimit10s || orderLimit1m) {
              this.sessionState.updateOrderRateLimits(null, {
                limit10s: orderLimit10s ? parseInt(String(orderLimit10s.limit), 10) : undefined,
                limit1m: orderLimit1m ? parseInt(String(orderLimit1m.limit), 10) : undefined
              });
              this.logger.log(`Dynamic Binance Order Limits: 10s=${orderLimit10s?.limit}, 1m=${orderLimit1m?.limit}`);
           }
        }

        if (data && Array.isArray(data.symbols)) {
          MarketFeedService.cachedExchangeInfo.clear();
          let filteredInactiveCount = 0;
          let tradFiCount = 0;

          for (const s of data.symbols) {
            // BOLT: Include all actively trading USDS-M Futures symbols (Crypto COIN + TradFi/Overnight COMMODITY, EQUITY, INDEX, TRADFI)
            if (s.status === 'TRADING' || s.status === 'SETTLING') {
              const underlyingType = String((s as any).underlyingType || 'COIN').toUpperCase();
              const underlyingSubType = Array.isArray((s as any).underlyingSubType) ? (s as any).underlyingSubType : [];
              const contractType = String((s as any).contractType || 'PERPETUAL').toUpperCase();
              const isTradFi =
                underlyingType !== 'COIN' ||
                contractType.includes('TRADFI') ||
                contractType.includes('TRADIFI') ||
                underlyingSubType.some((st: any) => /TRADFI|COMMODITY|EQUITY|STOCK|INDEX|OVERNIGHT|FOREX|METAL/i.test(String(st || '')));

              if (isTradFi) tradFiCount++;

              // BOLT OPTIMIZATION: Pre-parse critical filter values to avoid O(N) find() and parseFloat() in the hot-path
              const parsed: any = {
                ...s,
                underlyingType,
                underlyingSubType,
                contractType,
                assetClass: isTradFi ? 'tradfi' : 'crypto',
              };
              if (s.filters && Array.isArray(s.filters)) {
                for (const f of s.filters) {
                  if (f.filterType === 'PRICE_FILTER') {
                    parsed.tickSize = parseFloat(String(f.tickSize));
                    parsed.pricePrecision = Math.max(0, Math.round(-Math.log10(parsed.tickSize)));
                  } else if (f.filterType === 'LOT_SIZE') {
                    parsed.stepSize = parseFloat(String(f.stepSize));
                    parsed.qtyPrecision = Math.max(0, Math.round(-Math.log10(parsed.stepSize)));
                  } else if (f.filterType === 'MARKET_LOT_SIZE') {
                    parsed.marketMaxQty = parseFloat(String(f.maxQty));
                    parsed.marketMinQty = parseFloat(String(f.minQty));
                  } else if (f.filterType === 'PERCENT_PRICE') {
                    parsed.multiplierUp = parseFloat(String(f.multiplierUp || '1.1'));
                    parsed.multiplierDown = parseFloat(String(f.multiplierDown || '0.9'));
                  } else if (f.filterType === 'MIN_NOTIONAL' || f.filterType === 'NOTIONAL') {
                    parsed.minNotional = parseFloat(String(f.notional || f.minNotional || '0'));
                  }
                }
              }
              delete parsed.filters;
              MarketFeedService.cachedExchangeInfo.set(s.symbol, parsed);
            } else {
              filteredInactiveCount++;
            }
          }
          MarketFeedService.lastExchangeInfoFetch = now;
          MarketFeedService.lastExchangeInfoBase = restBase;
          this.exchangeInfo = MarketFeedService.cachedExchangeInfo;
          this.logger.log(`[MarketFeed] Exchange info: ${this.exchangeInfo.size} symbols cached (${tradFiCount} TradFi/Overnight, ${filteredInactiveCount} inactive skipped).`);

          // RESEARCH-02: Persist to DB
          const cacheObj: any = { __schemaVersion: CACHE_SCHEMA_VERSION };
          MarketFeedService.cachedExchangeInfo.forEach((val, key) => { cacheObj[key] = val; });

          const limit = this.sessionState.binanceRateLimit.limit;
          MarketFeedService.cachedRateLimit = limit;

          await this.settingsRepository.update('default', {
            exchange_info_cache: cacheObj,
            exchange_info_ts: now,
            exchange_rate_limit: limit
          });
        }
      }
    } catch (error) {
      this.logger.error(`Failed to fetch exchange info from ${restBase}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  getSymbolFilters(symbol: string) { return this.exchangeInfo.get(symbol); }

  /**
   * Returns the full cached Binance USDS-M Futures symbol catalog enriched with
   * any available live ticker metrics (zero extra Binance REST calls when cached).
   * Allows users to browse and add Static Watchlist symbols without running a dynamic scan first.
   */
  async getAvailableSymbols(options?: { includeNonUsdt?: boolean; includeHtfCross?: boolean }) {
    const includeNonUsdt = Boolean(options?.includeNonUsdt);

    if (this.exchangeInfo.size === 0 && !this.sessionState.isBanned()) {
      await this.fetchExchangeInfo(this.currentRestBase || ENGINE_CONSTANTS.BINANCE_REST_BASE);
    }

    const cfg = this.sessionState?.config;
    const includeHtfCross = Boolean(options?.includeHtfCross || cfg?.htf_ema_cross_catalog_enabled);
    const htfInterval = cfg?.htf_ema_cross_interval || '4h';
    const htfFast = cfg?.htf_ema_fast_period || 9;
    const htfSlow = cfg?.htf_ema_slow_period || 21;
    const htfCount = cfg?.htf_ema_cross_count || 4;
    const slDistPct = cfg?.sl_distance_pct ?? 0.8;
    const preferFresh = cfg?.htf_ema_cross_prefer_fresh !== false;
    const maxFreshBars = Math.min(30, Math.max(2, Math.round(cfg?.htf_ema_cross_max_bars ?? 6)));

    const resolveCachedHtfCross = (sym: string): HtfEmaCrossSummary | undefined => {
      if (!includeHtfCross) return undefined;
      if (!this.klineStore || typeof this.klineStore.peekRawCandles !== 'function') {
        return undefined;
      }
      const primary = this.klineStore.peekRawCandles(sym, htfInterval);
      let usedInterval = htfInterval;
      let candles = primary;
      if ((!candles || candles.length < htfSlow + 3) && htfInterval !== '1h') {
        const alt = this.klineStore.peekRawCandles(sym, '1h');
        if (alt && alt.length >= htfSlow + 3) {
          candles = alt;
          usedInterval = '1h';
        }
      }
      if (!candles || candles.length < htfSlow + 3) return undefined;

      const last = candles[candles.length - 1];
      const cacheKey = `${usedInterval}_${htfFast}_${htfSlow}_${htfCount}_${preferFresh ? 1 : 0}_${maxFreshBars}_${last.time}_${Number(last.close).toPrecision(6)}`;
      const cached = this.catalogHtfCache.get(sym);
      if (cached && cached.key === cacheKey) {
        return cached.summary;
      }

      const summary = evaluateHtfEmaCross(candles, {
        interval: usedInterval,
        fastPeriod: htfFast,
        slowPeriod: htfSlow,
        targetCrossCount: htfCount,
        slDistPct,
        allowPreCrossOnly: true,
        preferFresh,
        maxFreshBars,
      });
      if (!summary) return undefined;

      if (this.catalogHtfCache.size >= 400 && !this.catalogHtfCache.has(sym)) {
        const oldest = this.catalogHtfCache.keys().next().value;
        if (oldest) this.catalogHtfCache.delete(oldest);
      }
      this.catalogHtfCache.set(sym, { key: cacheKey, summary });
      return summary;
    };

    const items: Array<{
      symbol: string;
      baseAsset: string;
      quoteAsset: string;
      contractType: string;
      underlyingType: string;
      underlyingSubType: string[];
      assetClass: 'crypto' | 'tradfi';
      status: string;
      price: number;
      open_24h: number;
      pct: number;
      volume_24h: number;
      htf_ema_cross?: HtfEmaCrossSummary;
    }> = [];

    const seen = new Set<string>();

    this.exchangeInfo.forEach((info, symbol) => {
      if (!symbol || symbol === '__schemaVersion') return;
      const quoteAsset = String(info?.quoteAsset || (symbol.endsWith('USDT') ? 'USDT' : '')).toUpperCase();
      if (!includeNonUsdt && quoteAsset !== 'USDT' && !symbol.endsWith('USDT')) return;

      const ticker = this.tickerCache.getTicker(symbol);
      const price = Number(ticker?.price || ticker?.mark_price || 0);
      const open24h = Number(ticker?.open_24h || 0);
      const pct = price > 0 && open24h > 0 ? ((price - open24h) / open24h) * 100 : 0;
      const volume24h = Number(ticker?.volume_24h || 0);
      const underlyingType = String(info?.underlyingType || 'COIN').toUpperCase();
      const underlyingSubType = Array.isArray(info?.underlyingSubType) ? info.underlyingSubType : [];
      const contractType = String(info?.contractType || 'PERPETUAL').toUpperCase();
      const assetClass: 'crypto' | 'tradfi' =
        info?.assetClass === 'tradfi' ||
        underlyingType !== 'COIN' ||
        contractType.includes('TRADFI') ||
        contractType.includes('TRADIFI') ||
        underlyingSubType.some((st: any) => /TRADFI|COMMODITY|EQUITY|STOCK|INDEX|OVERNIGHT|FOREX|METAL/i.test(String(st || '')))
          ? 'tradfi'
          : 'crypto';

      seen.add(symbol);
      const htfCross = resolveCachedHtfCross(symbol);
      items.push({
        symbol,
        baseAsset: String(info?.baseAsset || symbol.replace(/USDT$/, '')),
        quoteAsset: quoteAsset || 'USDT',
        contractType,
        underlyingType,
        underlyingSubType,
        assetClass,
        status: String(info?.status || 'TRADING'),
        price,
        open_24h: open24h,
        pct,
        volume_24h: volume24h,
        ...(htfCross ? { htf_ema_cross: htfCross } : {}),
      });
    });

    // Include any live ticker symbols not yet in exchangeInfo (e.g. brand-new listings)
    const tickers = this.tickerCache.getLatestTickers();
    for (const t of tickers) {
      if (!t?.symbol || seen.has(t.symbol)) continue;
      if (!includeNonUsdt && !t.symbol.endsWith('USDT')) continue;
      const price = Number(t.price || t.mark_price || 0);
      const open24h = Number(t.open_24h || 0);
      const pct = price > 0 && open24h > 0 ? ((price - open24h) / open24h) * 100 : 0;
      seen.add(t.symbol);
      const htfCross = resolveCachedHtfCross(t.symbol);
      items.push({
        symbol: t.symbol,
        baseAsset: t.symbol.replace(/USDT$/, ''),
        quoteAsset: t.symbol.endsWith('USDT') ? 'USDT' : '',
        contractType: 'PERPETUAL',
        underlyingType: 'COIN',
        underlyingSubType: [],
        assetClass: 'crypto',
        status: 'TRADING',
        price,
        open_24h: open24h,
        pct,
        volume_24h: Number(t.volume_24h || 0),
        ...(htfCross ? { htf_ema_cross: htfCross } : {}),
      });
    }

    items.sort((a, b) => {
      if (b.volume_24h !== a.volume_24h) return b.volume_24h - a.volume_24h;
      return a.symbol.localeCompare(b.symbol);
    });

    return items;
  }

  /**
   * SRE/Resilience: Seed the TickerCache from REST market data when the
   * public market WebSocket is starved or banned in a live deployment.
   *
   * Symptom this addresses: the discovery socket connects and receives a
   * successful SUBSCRIBE ACK, yet delivers zero data frames for minutes
   * (recurring "live mode doesn't work" deadlock). By seeding from REST we
   * guarantee the momentum scanner always has candidates and the watchlist
   * can be built, instead of stalling at "0 symbols monitored".
   *
   * Throttled/guarded: single in-flight request, minimum 5-minute re-seed
   * cadence once populated, and routed through the centralized Binance queue.
   */
  private seedMarketDataFromRest(): Promise<void> {
    return this.sharedMarket
      ? this.sharedMarket.seedTickers(() => this.loadTickerSeed())
      : this.loadTickerSeed();
  }

  private async loadTickerSeed(): Promise<void> {
    // P0 FIX: Fail-fast ban guard - do not dispatch REST calls while IP is banned
    if (this.sessionState.isBanned()) {
      this.logger.debug(`[MarketFeed] REST seed skipped: IP is currently banned.`);
      return;
    }
    if (this.restSeedInFlight) return;
    const now = Date.now();
    if (now - this.lastRestSeedTs < 5 * 60 * 1000) {
      this.logger.debug(`[MarketFeed] REST seed skipped: 5-minute cooldown active.`);
      return;
    }
    const cacheSize = this.tickerCache.getCacheSize();
    // CITADEL PROTOCOL: Skip REST seed if TickerCache is already populated via WS or previous seed.
    // Weight Saved: 40 weight units per prevented REST call (GET /fapi/v1/ticker/24hr).
    if (cacheSize > 0) {
      this.logger.debug(`[MarketFeed] REST seed skipped: TickerCache already populated (${cacheSize} symbols).`);
      return;
    }

    this.restSeedInFlight = true;
    this.lastRestSeedTs = now;
    try {
      const restBase = this.currentRestBase;
      const url = `${restBase}/fapi/v1/ticker/24hr`;
      this.logger.log(`[MarketFeed] Seeding TickerCache from REST market data (${url})...`);
      const response = await this.binanceClientFactory.genericRequest(
        () => this.binanceClientFactory.proxyFetch(url, { signal: AbortSignal.timeout(10000) }, this.currentProxyUrl),
        'ticker24hrPriceChangeStatistics',
        false // Throttled, one-time critical seed
      );
      if (!response.ok) {
        this.logger.warn(`[MarketFeed] REST market seed returned HTTP ${response.status}. Will retry on next cycle.`);
        return;
      }
      const data = (await response.json()) as any[];
      if (Array.isArray(data) && data.length > 0) {
        this.tickerCache.bulkUpdate(data);
        this.logger.log(`[MarketFeed] REST seed complete: ${data.length} symbols loaded into TickerCache.`);
        this.eventEmitter.emit(ENGINE_EVENTS.LOG_MESSAGE, {
          msg: `[MarketFeed] Market data restored via REST fallback (${data.length} symbols).`,
          level: 'info'
        });
        // Refresh the watchlist now that the cache has candidates.
        const latestCfg = this.sessionState?.config || this.currentConfig;
        if (latestCfg) {
          this.updateWatchlist(latestCfg).catch(() => {});
        }
      }
    } catch (err) {
      this.logger.warn(`[MarketFeed] REST market data seed failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      this.restSeedInFlight = false;
    }
  }

  usesSharedMarketData() {
    return Boolean(this.sharedMarket);
  }

  async stop() {
    this.running = false;
    this.discoveredSymbolsCache = null;
    if (this.watchlistInterval) clearInterval(this.watchlistInterval);
    if (this.watchlistUpdateTimeout) clearTimeout(this.watchlistUpdateTimeout);

    await this.stopGlobalDiscovery();
    await this.sharedMarket?.klines.unsubscribe(this);
    this.sharedMarket?.releaseCandles(this);

    for (const manager of this.klineManagers) {
        await manager.stop();
    }
    this.klineManagers = [];

    for (const task of this.subscriptionTasks) clearTimeout(task);
    this.subscriptionTasks = [];
    // BOLT: Do not clear the static exchangeInfo cache on stop.
    // It should persist for resumption or other sessions.
    this.activeWatchlist.clear();
    this.logger.verbose('MarketFeedService: Resources cleared (Static exchangeInfo preserved)');
  }

  private lastStreamHealthCheck = 0;
  private async startWatchlistManager(config: SessionConfig) {
    if (this.watchlistInterval) clearInterval(this.watchlistInterval);
    this.zeroWatchlistCycles = 0;
    this.updateWatchlist(this.sessionState?.config || this.currentConfig || config);
    this.watchlistInterval = setInterval(() => {
      const activeConfig = this.sessionState?.config || this.currentConfig || config;
      this.updateWatchlist(activeConfig);

      if (this.activeWatchlist.size === 0) {
        this.zeroWatchlistCycles++;
        if (this.zeroWatchlistCycles >= 2) {
          this.logger.warn(`[MarketFeed] Scanner has 0 symbols after ${this.zeroWatchlistCycles * 2} minutes. Check config.symbols or global_scanner_enabled.`);
        }
      } else {
        this.zeroWatchlistCycles = 0;
      }

      // BOLT: Optimize health check frequency.
      // Although this loop fires every 2 minutes (watchlist refresh), we only
      // evaluate stream health every 2 minutes to avoid excessive reconnection churn
      // during transient exchange instability.
      const now = Date.now();
      if (now - this.lastStreamHealthCheck >= 2 * 60 * 1000) {
         this.lastStreamHealthCheck = now;
         this.checkStreamHealth();
      }
    }, ENGINE_CONSTANTS.WATCHLIST_REFRESH_INTERVAL_MS);
    if (this.watchlistInterval?.unref) this.watchlistInterval.unref();
  }

  /**
   * SRE: Background Stream Health Monitor.
   * If the combined market stream has not received data for an extended period,
   * force a reconnection.
   */
  private checkStreamHealth() {
    if (!this.running) return;

    // SRE: Immunity check. If we are currently banned, don't try to reconnect
    if (this.sessionState.isBanned()) return;

    const now = Date.now();

    // FAIL-FAST: Detect if global discovery socket is open but never received any data
    if (!this._globalDiscoveryConfirmed && this.globalDiscoveryOpenedAt > 0 && (now - this.globalDiscoveryOpenedAt > 60000)) {
      const mode = this.sessionState.config?.trading_mode || (this.sessionState.config?.paper_mode ? 'paper' : 'live');
      this.consecutiveDiscoveryFailures++;

      // SRE: Decide severity from whether the scanner is actually starved.
      // If the REST fallback has already seeded the TickerCache, the scanner
      // still has candidates and trading proceeds - the WS is merely silent.
      // Downgrade the alert so operators aren't misled into thinking the system
      // is dead, and avoid pointless reconnect churn.
      const cacheSize = this.tickerCache.getCacheSize();
      const scannerAlive = cacheSize > 0;

      if (scannerAlive) {
        this.logger.warn(`[MarketFeed] Live market WebSocket silent (no frames in 60s); REST fallback active with ${cacheSize} symbols. Scanner operational. Mode=${mode}. Failure #${this.consecutiveDiscoveryFailures}`);
        this.eventEmitter.emit(ENGINE_EVENTS.LOG_MESSAGE, {
          msg: `[MarketFeed] Market WS silent; operating on REST fallback (${cacheSize} symbols). Scanner operational. Mode=${mode}`,
          level: 'warn'
        });
        // No reconnect churn: rely on the periodic REST seed to keep the cache fresh.
        return;
      }

      // Cache empty -> scanner genuinely offline. Escalate and force recovery.
      // CIRCUIT BREAKER: After 1 consecutive silent failure, immediately switch
      // to the raw WebSocket path.
      if (this.consecutiveDiscoveryFailures >= 1) {
        this.logger.fatal(`[MarketFeed] CIRCUIT BREAKER: Discovery has failed via primary method. Forcing raw WebSocket fallback immediately.`);
        this.forceRawDiscovery = true;
      }

      this.logger.error(`[MarketFeed] CRITICAL: Global discovery socket open but zero messages received in 60s. Mode=${mode}. Failure #${this.consecutiveDiscoveryFailures}`);
      this.eventEmitter.emit(ENGINE_EVENTS.LOG_MESSAGE, {
        msg: `[MarketFeed] CRITICAL: No market data received after 60s. Scanner is offline. Mode=${mode}`,
        level: 'error'
      });
      // Force reconnect
      this.startGlobalDiscovery().catch(err => {
        this.logger.error(`[MarketFeed] Health check global discovery restart failed: ${err instanceof Error ? err.message : String(err)}`);
      });
      // SRE: If the public WS is starved, seed from REST so the scanner survives.
      this.seedMarketDataFromRest().catch(() => {});
      return;
    }

    // BOLT: Widened health check threshold for combined stream
    const MAX_SILENCE_MS = 7 * 60 * 1000; // 7 minutes

    const lastMsg = Math.max(this.lastMiniTickerMsgTs, this.lastMarkTickerMsgTs);
    const silence = lastMsg > 0 ? now - lastMsg : 0;

    if (silence > MAX_SILENCE_MS) {
       this.logger.warn(`[MarketFeed] Market stream silence detected (${Math.round(silence/1000)}s). Force reconnecting...`);

       // SRE: Global discovery health check
       if (now - this.lastMiniTickerMsgTs > MAX_SILENCE_MS) {
          this.logger.warn('[MarketFeed] Global discovery stream stalled. Reconnecting...');
          this.startGlobalDiscovery().catch(err => {
            this.logger.error(`[MarketFeed] Global discovery reconnect failed: ${err instanceof Error ? err.message : String(err)}`);
          });
       }

       // SRE: Watchlist stream health check
       if (this.activeWatchlist.size > 0) {
          this.rebuildCombinedKlineStream().catch(err => {
            this.logger.error(`[MarketFeed] Watchlist stream rebuild failed: ${err instanceof Error ? err.message : String(err)}`);
          });
       }
    }
  }

  @OnEvent(ENGINE_EVENTS.WATCHLIST_NEEDS_UPDATE)
  async updateWatchlist(config: SessionConfig = this.sessionState.config!) {
    if (!this.running || !config) return;

    if (this.watchlistUpdatePending) return;

    // Cold-start optimization: build the initial watchlist immediately without a 2s timer delay
    if (!this.hasSuccessfullyBuiltWatchlist && !this.watchlistUpdateTimeout) {
      try {
        this.watchlistUpdatePending = true;
        await this.executeWatchlistUpdate(config);
      } catch (err) {
        this.logger.error(`Watchlist update failed: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        this.watchlistUpdatePending = false;
      }
      return;
    }

    if (this.watchlistUpdateTimeout) clearTimeout(this.watchlistUpdateTimeout);
    this.watchlistUpdateTimeout = setTimeout(async () => {
      try {
        this.watchlistUpdatePending = true;
        await this.executeWatchlistUpdate(config);
      } catch (err) {
        this.logger.error(`Watchlist update failed: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        this.watchlistUpdatePending = false;
        this.watchlistUpdateTimeout = null;
      }
    }, 2000);
    if (this.watchlistUpdateTimeout?.unref) this.watchlistUpdateTimeout.unref();
  }

  private collectStrategyMtfIntervals(sc: SessionConfig): Set<string> {
    const tfs = new Set<string>();
    if (sc.sl_lookback_timeframe) {
      const resolvedSl = this.resolveInterval(sc.sl_lookback_timeframe, sc);
      if (resolvedSl) tfs.add(resolvedSl);
    }
    if (sc.htf_ema_cross_boost_enabled) {
      const resolvedHtf = this.resolveInterval(sc.htf_ema_cross_interval || '4h', sc);
      if (resolvedHtf) tfs.add(resolvedHtf);
    }
    const activeSignals = [
      ...(sc.enabled_signals || []),
      ...(sc.exit_signals || []),
    ];
    if (sc.signal_timeframes) {
      for (const sig of activeSignals) {
        let baseSig = sig;
        const lastUnderscore = sig.lastIndexOf('_');
        if (lastUnderscore > 0) {
          const potentialBase = sig.substring(0, lastUnderscore);
          baseSig = potentialBase;
        }
        const tf = sc.signal_timeframes[sig] || sc.signal_timeframes[baseSig];
        const resolvedTf = this.resolveInterval(tf, sc);
        if (resolvedTf) tfs.add(resolvedTf);
      }
    }
    for (const sig of activeSignals) {
      if (sig.startsWith('htf_breakout') || sig.startsWith('prev_day_breakout')) {
        const params = sc.signal_params || {};
        const refTf = this.signalEngine.resolveSignalParam(params, sig, 'htf_breakout', 'htf_breakout_ref_timeframe', (sc as any).htf_breakout_ref_timeframe || '1d');
        const resolvedRef = this.resolveInterval(refTf, sc);
        if (resolvedRef) tfs.add(resolvedRef);

        const trigTf = this.signalEngine.resolveSignalParam(params, sig, 'htf_breakout', 'htf_breakout_trigger_timeframe', (sc as any).htf_breakout_trigger_timeframe || '1h');
        if (trigTf && trigTf !== 'default') {
          const resolvedTrig = this.resolveInterval(trigTf, sc);
          if (resolvedTrig) tfs.add(resolvedTrig);
        }
      }
      if (sig.startsWith('trigger_candle_exit') || sig.startsWith('entry_candle_boundary')) {
        const params = sc.signal_params || {};
        const exitTf = this.signalEngine.resolveSignalParam(params, sig, 'trigger_candle_exit', 'trigger_candle_exit_timeframe', (sc as any).trigger_candle_exit_timeframe || 'default');
        const effectiveExitTf = (exitTf && exitTf !== 'default') ? exitTf : ((sc as any).htf_breakout_trigger_timeframe || '1h');
        const resolvedExit = this.resolveInterval(effectiveExitTf, sc);
        if (resolvedExit) tfs.add(resolvedExit);
      }
    }
    if (sc.trigger_candle_exit_enabled) {
      const effectiveExitTf = (sc.trigger_candle_exit_timeframe && sc.trigger_candle_exit_timeframe !== 'default')
        ? sc.trigger_candle_exit_timeframe
        : (sc.htf_breakout_trigger_timeframe || '1h');
      const resolvedExit = this.resolveInterval(effectiveExitTf, sc);
      if (resolvedExit) tfs.add(resolvedExit);
    }
    return tfs;
  }

  private getRequiredWarmupForSymbol(config: SessionConfig | null | undefined, symbol?: string, targetInterval?: string): number {
    if (!config) return 100;
    const getConfigWarmup = (sc: SessionConfig): number => {
      if (targetInterval && typeof (this.signalEngine as any).getRequiredWarmupForInterval === 'function') {
        const tfWarmup = (this.signalEngine as any).getRequiredWarmupForInterval(sc, targetInterval);
        const scanTf = this.resolveInterval(sc.scan_interval || '1m', sc);
        const scanReq = targetInterval === scanTf ? Math.max(Number(sc.scan_lookback || 1) + 1, 2) : 0;
        const slTf = sc.sl_lookback_timeframe ? this.resolveInterval(sc.sl_lookback_timeframe, sc) : null;
        const slReq = (slTf === targetInterval || (!slTf && targetInterval === scanTf))
          ? Math.max(Number(sc.sl_lookback_period ?? 20) + 1, 2)
          : 0;
        const combined = Math.max(tfWarmup || 0, scanReq, slReq);
        if (combined > 0) return combined;
      }
      return this.signalEngine.getRequiredWarmup(sc) || 50;
    };

    let requiredWarmup = getConfigWarmup(config);
    if (config.strategy_variants) {
      for (const variant of config.strategy_variants) {
        if ((variant as any).enabled !== false) {
          const variantWarmup = getConfigWarmup({
            ...config,
            ...variant,
            signal_params: {
              ...(config?.signal_params || {}),
              ...(variant?.signal_params || {}),
            },
            signal_timeframes: {
              ...(config?.signal_timeframes || {}),
              ...(variant?.signal_timeframes || {}),
            },
          } as SessionConfig);
          if (variantWarmup > requiredWarmup) requiredWarmup = variantWarmup;
        }
      }
    }
    if (symbol && this.sessionState?.activeTrades) {
      for (const trade of this.sessionState.activeTrades) {
        if (trade.symbol === symbol && trade.strategy_config) {
          const tradeWarmup = getConfigWarmup({
            ...config,
            ...trade.strategy_config,
            signal_params: {
              ...(config?.signal_params || {}),
              ...(trade.strategy_config?.signal_params || {}),
            },
            signal_timeframes: {
              ...(config?.signal_timeframes || {}),
              ...(trade.strategy_config?.signal_timeframes || {}),
            },
          } as SessionConfig);
          if (tradeWarmup > requiredWarmup) requiredWarmup = tradeWarmup;
        }
      }
    }
    return requiredWarmup;
  }

  private hasBufferTimeGap(candles: Candle[] | undefined, interval: string, requiredWarmup: number): boolean {
    if (!candles || candles.length < 2) return false;
    const intervalMs = this.parseIntervalToMs(interval);
    if (!Number.isFinite(intervalMs) || intervalMs <= 0) return false;
    const startIdx = Math.max(1, candles.length - Math.max(requiredWarmup, 2));
    for (let i = startIdx; i < candles.length; i++) {
      if ((candles[i].time - candles[i - 1].time) > intervalMs * 1.5) {
        return true;
      }
    }
    return false;
  }

  private async executeWatchlistUpdate(config: SessionConfig) {
    try {
      this.currentConfig = config;
      const newWatchlist = new Map<string, Set<string>>();
      const isGated = this.sessionState.isGated();
      const activeTrades = this.sessionState.activeTrades || [];
      const activeSymbolList = activeTrades.map(t => t.symbol);

      const strategyConfigs: SessionConfig[] = [config];
      if (config.strategy_variants) {
        for (const v of config.strategy_variants) {
          if ((v as any).enabled !== false) {
            strategyConfigs.push({
              ...resolveStrategyConfig(config, v),
              strategy_label: v.strategy_label,
              strategy_variants: [], // prevent infinite recursion
            });
          }
        }
      }

      const isStrategyPausedFn = (label: string): boolean => {
        if (this.sessionState.paused) return true;
        if (typeof (this.sessionState as any).isStrategyPaused === 'function') {
          return Boolean((this.sessionState as any).isStrategyPaused(label));
        }
        return Boolean(this.sessionState.pausedStrategies?.has(label));
      };

      const GATING_STATES = new Set(['max_trades', 'sl_guard', 'max_trades_period', 'max_trades_24h', 'sleeping', 'risk_pct', 'tod_risk', 'risk']);
      const isStrategyGatedFn = (label: string): boolean => {
        const stratGateMap = this.sessionState.strategyGateStates;
        if (stratGateMap && stratGateMap.size > 0) {
          const st = stratGateMap.get(label);
          return Boolean(st && GATING_STATES.has(st.gateState || ''));
        }
        return GATING_STATES.has(this.sessionState.gateState || '') || Boolean(this.sessionState.isGated?.());
      };

      const canStrategyBypassKnifeFn = (sc: SessionConfig, label: string): boolean => {
        if (!sc.allow_knife_when_gated) return false;
        const activeKnifeCount = activeTrades.filter(t => t.is_knife && (t.strategy_label || 'Momentum Strategy') === label).length;
        return activeKnifeCount === 0;
      };

      // SRE: Optimization. In 'light' hibernation mode, we keep monitoring symbols even when gated
      // to avoid the 250+ weight REST backfill burst on resumption.
      // When all enabled strategies are gated/paused (and none have active knife-catch bypass),
      // suppress 50-symbol discovery even if activeTrades.length > 0 so active exits keep headroom.
      const isHibernating = this.sessionState.hibernating;
      const hibMode = config.hibernation_mode || 'adaptive';
      const anyStrategyCanEnter = strategyConfigs.some(sc => {
        const scLabel = sc.strategy_label || 'Momentum Strategy';
        if (isStrategyPausedFn(scLabel)) return false;
        if (!isStrategyGatedFn(scLabel)) return true;
        return canStrategyBypassKnifeFn(sc, scLabel);
      });
      const suppressScanner = hibMode !== 'light' && !anyStrategyCanEnter && !strategyConfigs.some(sc => {
        const scLabel = sc.strategy_label || 'Momentum Strategy';
        return !isStrategyPausedFn(scLabel) && canStrategyBypassKnifeFn(sc, scLabel);
      });

      const scMtfMap = new Map<SessionConfig, Set<string>>();
      for (const sc of strategyConfigs) {
        scMtfMap.set(sc, this.collectStrategyMtfIntervals(sc));
      }

      if (config.global_scanner_enabled !== false && !suppressScanner) {
        let symbols: string[];
        const activeExcludedSet = new Set<string>(activeSymbolList);
        if (config.excluded_symbols && Array.isArray(config.excluded_symbols)) {
          config.excluded_symbols.forEach(s => activeExcludedSet.add(s));
        }
        const combinedExcluded = Array.from(activeExcludedSet);

        if (config.symbols && config.symbols.length > 0) {
          symbols = config.symbols.filter(s => !activeSymbolList.includes(s));
        } else {
          const signature = this.getWatchlistConfigSignature(config, activeSymbolList);
          const now = Date.now();
          const isChangeDiscovery =
            config.discovery_mode === 'change_pct' ||
            config.discovery_mode === 'loss_pct' ||
            config.discovery_mode === 'abs_change_pct';
          const CACHE_TTL_MS = isChangeDiscovery ? 2 * 60 * 1000 : 5 * 60 * 1000;

          if (
            this.discoveredSymbolsCache &&
            now - this.discoveredSymbolsCache.timestamp < CACHE_TTL_MS &&
            this.discoveredSymbolsCache.signature === signature
          ) {
            symbols = this.discoveredSymbolsCache.symbols;
          } else {
            // BOLT: Smart Watchlist Logic - Event driven discovery without extra REST calls.
            // If enabled, we expand the candidate pool from !miniTicker updates.
            const watchlistSize = config.watchlist_size || 50;
            const offset = config.watchlist_offset || 0;

            if (config.smart_watchlist_enabled) {
              // Smart Watchlist: Filter all tickers by momentum volatility from the cache (seeded by !miniTicker)
              // to find candidates that are moving fast even if they are not in the top 50 by volume.
              const sensitivity = config.smart_watchlist_sensitivity || 0.7;
              const threshold = (config.scan_pct_threshold || 2.0) * sensitivity;

              const tickers = this.tickerCache.getLatestTickers();
              const smartCandidates = tickers
                .filter(t => {
                  if (activeExcludedSet.has(t.symbol)) return false;
                  if (this.getSymbolFilters(t.symbol) === undefined) return false;

                  // Estimate momentum if open_24h is available
                  if (t.open_24h && t.open_24h > 0) {
                    const momentum = Math.abs((t.price - t.open_24h) / t.open_24h) * 100;
                    return momentum >= threshold;
                  }
                  return false;
                })
                .sort((a, b) => b.volume_24h - a.volume_24h)
                .slice(0, watchlistSize);

              symbols = smartCandidates.map(t => t.symbol);

              // Ensure we also include the standard top volume or change-pct symbols to avoid missing established liquidity
              const discoveryMode = config.discovery_mode || 'volume';
              const leaderCount = Math.max(1, Math.floor(watchlistSize / 2));
              const topSymbols = discoveryMode === 'change_pct' ? await this.tickerCache.topByChangePct(Math.max(leaderCount, 3), combinedExcluded)
                : discoveryMode === 'loss_pct' ? await this.tickerCache.topByLossPct(Math.max(leaderCount, 3), combinedExcluded)
                  : discoveryMode === 'abs_change_pct' ? await this.tickerCache.topByAbsChangePct(Math.max(leaderCount, 3), combinedExcluded)
                    : await this.tickerCache.topByVolume(leaderCount, combinedExcluded);
              const volumeSymbols = topSymbols.map(t => t.symbol);

              symbols = Array.from(new Set([...symbols, ...volumeSymbols])).filter(s => !activeExcludedSet.has(s));
            } else {
              const discoveryMode = config.discovery_mode || 'volume';
              const feedWatchlistSize = isChangeDiscovery ? Math.max(watchlistSize, 3) : watchlistSize;
              const top = discoveryMode === 'change_pct' ? await this.tickerCache.topByChangePct(feedWatchlistSize + offset, combinedExcluded)
                : discoveryMode === 'loss_pct' ? await this.tickerCache.topByLossPct(feedWatchlistSize + offset, combinedExcluded)
                  : discoveryMode === 'abs_change_pct' ? await this.tickerCache.topByAbsChangePct(feedWatchlistSize + offset, combinedExcluded)
                    : await this.tickerCache.topByVolume(feedWatchlistSize + offset, combinedExcluded);
              const slicedTop = top.slice(offset);

              // COMPLIANCE: Filter by getSymbolFilters() to exclude non-crypto symbols (Gold, Equities)
              // that appear in miniTicker stream but are not tradable by the bot.
              symbols = slicedTop
                .map((t: any) => t.symbol)
                .filter(s => this.getSymbolFilters(s) !== undefined && !activeExcludedSet.has(s));
            }

            // Save to cache
            this.discoveredSymbolsCache = {
              symbols,
              timestamp: now,
              signature,
            };
          }
        }

        // 1. Add discovery & static symbols ONLY for unpaused & non-gated (unless light hibernation or knife bypass) strategies
        for (const sc of strategyConfigs) {
          const scLabel = sc.strategy_label || 'Momentum Strategy';
          if (isStrategyPausedFn(scLabel)) continue;
          if (hibMode !== 'light' && isStrategyGatedFn(scLabel) && !canStrategyBypassKnifeFn(sc, scLabel)) continue;

          let scSymbols = symbols;
          const rootHasStatic = Boolean(config.symbols && config.symbols.length > 0);
          if (sc !== config) {
            if (sc.symbols && sc.symbols.length > 0) {
              scSymbols = sc.symbols.filter(s => !activeSymbolList.includes(s));
            } else {
              const scExcludedSet = new Set<string>(activeExcludedSet);
              if (sc.excluded_symbols && Array.isArray(sc.excluded_symbols)) {
                sc.excluded_symbols.forEach(s => scExcludedSet.add(s));
              }
              const scCombinedExcluded = Array.from(scExcludedSet);
              const effectiveDiscoveryMode = sc.discovery_mode || config.discovery_mode || 'volume';
              const effectiveWatchlistSize = sc.watchlist_size || config.watchlist_size || 50;
              const isScChangeDiscovery =
                effectiveDiscoveryMode === 'change_pct' ||
                effectiveDiscoveryMode === 'loss_pct' ||
                effectiveDiscoveryMode === 'abs_change_pct';
              const feedVariantSize = isScChangeDiscovery ? Math.max(effectiveWatchlistSize, 3) : effectiveWatchlistSize;
              const isDifferentDiscovery = sc.discovery_mode !== undefined && sc.discovery_mode !== config.discovery_mode;
              const isDifferentSize = sc.watchlist_size !== undefined && sc.watchlist_size !== config.watchlist_size;
              const isDifferentOffset = sc.watchlist_offset !== undefined && sc.watchlist_offset !== (config.watchlist_offset || 0);
              const isDifferentSmart = Boolean(sc.smart_watchlist_enabled) !== Boolean(config.smart_watchlist_enabled);
              const hasVariantExclusions = Boolean(sc.excluded_symbols && sc.excluded_symbols.length > 0);

              if (sc.smart_watchlist_enabled) {
                const sensitivity = sc.smart_watchlist_sensitivity || 0.7;
                const threshold = (sc.scan_pct_threshold || 2.0) * sensitivity;
                const tickers = this.tickerCache.getLatestTickers();
                const smartCandidates = tickers
                  .filter(t => {
                    if (scExcludedSet.has(t.symbol)) return false;
                    if (this.getSymbolFilters(t.symbol) === undefined) return false;
                    if (t.open_24h && t.open_24h > 0) {
                      const momentum = Math.abs((t.price - t.open_24h) / t.open_24h) * 100;
                      return momentum >= threshold;
                    }
                    return false;
                  })
                  .sort((a, b) => b.volume_24h - a.volume_24h)
                  .slice(0, effectiveWatchlistSize)
                  .map(t => t.symbol);
                const leaderCount = Math.max(1, Math.floor(effectiveWatchlistSize / 2));
                const scTop = effectiveDiscoveryMode === 'change_pct'
                  ? await this.tickerCache.topByChangePct(Math.max(leaderCount, 3), scCombinedExcluded)
                  : effectiveDiscoveryMode === 'loss_pct'
                    ? await this.tickerCache.topByLossPct(Math.max(leaderCount, 3), scCombinedExcluded)
                    : effectiveDiscoveryMode === 'abs_change_pct'
                      ? await this.tickerCache.topByAbsChangePct(Math.max(leaderCount, 3), scCombinedExcluded)
                      : await this.tickerCache.topByVolume(leaderCount, scCombinedExcluded);
                scSymbols = Array.from(new Set([
                  ...smartCandidates,
                  ...scTop.map((t: any) => t.symbol).filter(s => this.getSymbolFilters(s) !== undefined && !scExcludedSet.has(s)),
                ]));
              } else if (rootHasStatic || isDifferentDiscovery || isDifferentSize || isDifferentOffset || isDifferentSmart || hasVariantExclusions || isScChangeDiscovery) {
                const scOffset = sc.watchlist_offset || 0;
                const scTop = effectiveDiscoveryMode === 'change_pct'
                  ? await this.tickerCache.topByChangePct(feedVariantSize + scOffset, scCombinedExcluded)
                  : effectiveDiscoveryMode === 'loss_pct'
                    ? await this.tickerCache.topByLossPct(feedVariantSize + scOffset, scCombinedExcluded)
                    : effectiveDiscoveryMode === 'abs_change_pct'
                      ? await this.tickerCache.topByAbsChangePct(feedVariantSize + scOffset, scCombinedExcluded)
                      : await this.tickerCache.topByVolume(feedVariantSize + scOffset, scCombinedExcluded);
                scSymbols = scTop
                  .slice(scOffset)
                  .map((t: any) => t.symbol)
                  .filter(s => this.getSymbolFilters(s) !== undefined && !scExcludedSet.has(s));
              }
            }
          }
          const globalInterval = this.resolveInterval(sc.scan_interval || '1m', sc) || '1m';
          const scMtf = scMtfMap.get(sc);
          for (const s of scSymbols) {
            if (!newWatchlist.has(s)) newWatchlist.set(s, new Set());
            const symSet = newWatchlist.get(s)!;
            symSet.add(globalInterval);
            if (scMtf) {
              for (const mtfTf of scMtf) symSet.add(mtfTf);
            }
          }
        }

        // 2. Add explicit single-symbol monitors ONLY for unpaused & non-gated strategies
        for (const sc of strategyConfigs) {
          const scLabel = sc.strategy_label || 'Momentum Strategy';
          if (isStrategyPausedFn(scLabel)) continue;
          if (hibMode !== 'light' && isStrategyGatedFn(scLabel) && !canStrategyBypassKnifeFn(sc, scLabel)) continue;
          const scMtf = scMtfMap.get(sc);
          if (sc.single_symbol_configs) {
            for (const ssc of sc.single_symbol_configs) {
              if (!ssc.enabled) continue;
              // COMPLIANCE: Extend non-crypto filtering to manual monitors
              if (this.getSymbolFilters(ssc.symbol) === undefined) {
                this.logger.warn(`Filtering out non-crypto symbol from manual monitor: ${ssc.symbol}`);
                continue;
              }
              if (!newWatchlist.has(ssc.symbol)) newWatchlist.set(ssc.symbol, new Set());
              const symSet = newWatchlist.get(ssc.symbol)!;
              const interval = ssc.use_custom_config && ssc.custom_config?.scan_interval ? ssc.custom_config.scan_interval : sc.scan_interval || '1m';
              const resolvedInt = this.resolveInterval(interval, sc) || interval;
              symSet.add(resolvedInt);

              if (ssc.use_custom_config && ssc.custom_config?.sl_lookback_timeframe) {
                const customSlInterval = this.resolveInterval(ssc.custom_config.sl_lookback_timeframe, sc);
                if (customSlInterval) symSet.add(customSlInterval);
              }
              if (scMtf) {
                for (const mtfTf of scMtf) symSet.add(mtfTf);
              }
            }
          }
        }
      }

      // Include explicit single-symbol monitors when global_scanner_enabled === false
      if (!config.global_scanner_enabled && !suppressScanner) {
        for (const sc of strategyConfigs) {
          const scLabel = sc.strategy_label || 'Momentum Strategy';
          if (isStrategyPausedFn(scLabel)) continue;
          if (hibMode !== 'light' && isStrategyGatedFn(scLabel) && !canStrategyBypassKnifeFn(sc, scLabel)) continue;
          const scMtf = scMtfMap.get(sc);
          if (sc.single_symbol_configs) {
            for (const ssc of sc.single_symbol_configs) {
              if (!ssc.enabled) continue;
              if (this.getSymbolFilters(ssc.symbol) === undefined) continue;
              if (!newWatchlist.has(ssc.symbol)) newWatchlist.set(ssc.symbol, new Set());
              const symSet = newWatchlist.get(ssc.symbol)!;
              const interval = ssc.use_custom_config && ssc.custom_config?.scan_interval ? ssc.custom_config.scan_interval : sc.scan_interval || '1m';
              symSet.add(this.resolveInterval(interval, sc) || interval);
              if (ssc.use_custom_config && ssc.custom_config?.sl_lookback_timeframe) {
                const customSlInterval = this.resolveInterval(ssc.custom_config.sl_lookback_timeframe, sc);
                if (customSlInterval) symSet.add(customSlInterval);
              }
              if (scMtf) {
                for (const mtfTf of scMtf) symSet.add(mtfTf);
              }
            }
          }
        }
      }

      // 3. ALWAYS monitor open trades (capital safety), scoped to each trade's strategy & stored strategy_config,
      // regardless of global_scanner_enabled, scanner suppression, gating, or strategy pause state.
      for (const trade of activeTrades) {
        if (!newWatchlist.has(trade.symbol)) newWatchlist.set(trade.symbol, new Set());
        const symSet = newWatchlist.get(trade.symbol)!;
        symSet.add('1m');
        const tLabel = trade.strategy_label || config.strategy_label || 'Momentum Strategy';
        const matchingSc = strategyConfigs.find(sc => (sc.strategy_label || 'Momentum Strategy') === tLabel) || config;
        const effectiveTradeSc: SessionConfig = trade.strategy_config
          ? {
              ...matchingSc,
              ...trade.strategy_config,
              signal_params: {
                ...(matchingSc?.signal_params || {}),
                ...(trade.strategy_config?.signal_params || {}),
              },
              signal_timeframes: {
                ...(matchingSc?.signal_timeframes || {}),
                ...(trade.strategy_config?.signal_timeframes || {}),
              },
            } as SessionConfig
          : matchingSc;

        const resolvedScanInterval = this.resolveInterval(effectiveTradeSc.scan_interval || '5m', effectiveTradeSc);
        if (resolvedScanInterval) symSet.add(resolvedScanInterval);
        const tradeMtf = this.collectStrategyMtfIntervals(effectiveTradeSc);
        for (const mtfTf of tradeMtf) symSet.add(mtfTf);
      }

      let changed = newWatchlist.size !== this.activeWatchlist.size;
      if (!changed) {
        for (const [symbol, intervals] of newWatchlist) {
          const oldIntervals = this.activeWatchlist.get(symbol);
          if (!oldIntervals || oldIntervals.size !== intervals.size) { changed = true; break; }
          for (const i of intervals) { if (!oldIntervals.has(i)) { changed = true; break; } }
          if (changed) break;
        }
      }

      // BOLT: Force rebuild if we have never successfully built a non-empty watchlist
      // to resolve the cold-start bootstrap deadlock where the first pass might fail
      // due to transiently empty TickerCache.
      const forceRebuild = !this.hasSuccessfullyBuiltWatchlist && newWatchlist.size > 0;

      if (changed || forceRebuild) {
        if (newWatchlist.size > 0) this.hasSuccessfullyBuiltWatchlist = true;
        const prevWatchlist = this.activeWatchlist;
        this.activeWatchlist = newWatchlist;

        // Prune stale symbol/interval klines and backfill cooldowns when watchlist shrinks/rotates
        const activeKeys = new Set<string>();
        const activeCacheKeys = new Set<string>();
        const activeSymbolSet = new Set<string>(activeSymbolList);
        for (const [symbol, intervals] of newWatchlist) {
          activeSymbolSet.add(symbol);
          for (const interval of intervals) {
            activeKeys.add(`${symbol}_${interval}`);
            activeCacheKeys.add(`${symbol}:${interval}`);
          }
        }
        if (!suppressScanner) {
          if (this.sharedMarket) {
            this.sharedMarket.retainCandles(this, activeKeys);
          } else if (typeof (this.klineStore as any).pruneExcept === 'function') {
            (this.klineStore as any).pruneExcept(activeKeys);
          }
          if (typeof (this.signalEngine as any).pruneCaches === 'function') {
            (this.signalEngine as any).pruneCaches(activeSymbolSet);
          }
        }
        // Prune queued backfills for dropped symbols and garbage-collect only expired cooldown/backoff entries
        // so transient watchlist rotations keep their 5m cooldowns and 15m short-history ceilings.
        const nowPrune = Date.now();
        if (this.backfillQueue.length > 0) {
          this.backfillQueue = this.backfillQueue.filter(task => activeKeys.has(`${task.symbol}_${task.interval}`));
        }
        for (const [cacheKey, ts] of Array.from(this.lastBackfillAttemptMap.entries())) {
          if (!activeCacheKeys.has(cacheKey) && nowPrune - ts >= 5 * 60 * 1000) {
            this.lastBackfillAttemptMap.delete(cacheKey);
          }
        }
        for (const [cacheKey, retryAt] of Array.from(this.failureBackoffMap.entries())) {
          if (!activeCacheKeys.has(cacheKey) && nowPrune >= retryAt) {
            this.failureBackoffMap.delete(cacheKey);
          }
        }
        for (const [cacheKey, entry] of Array.from(this.shortHistoryMap.entries())) {
          if (!activeCacheKeys.has(cacheKey) && nowPrune - entry.fetchedAt >= 15 * 60 * 1000) {
            this.shortHistoryMap.delete(cacheKey);
          }
        }
        for (const [cacheKey, ts] of Array.from(this.ensureKlinesCooldownMap.entries())) {
          if (!activeCacheKeys.has(cacheKey) && nowPrune - ts >= 60 * 1000) {
            this.ensureKlinesCooldownMap.delete(cacheKey);
          }
        }

        await this.rebuildCombinedKlineStream();
        const nowCheck = Date.now();
        const activeTradeSymbolSet = new Set(activeSymbolList);
        const isSoloOrSmallWatchlist = newWatchlist.size <= 5;

        for (const [symbol, intervals] of newWatchlist) {
          for (const interval of intervals) {
            const requiredWarmup = this.getRequiredWarmupForSymbol(config, symbol, interval);
            const oldIntervals = prevWatchlist.get(symbol);
            const rawCandles = this.klineStore.getRawCandles(symbol, interval);
            const isSynthOnly = typeof (this.klineStore as any).isSynthesizedOnly === 'function' ? (this.klineStore as any).isSynthesizedOnly(symbol, interval) : false;
            const lastCandle = rawCandles && rawCandles.length > 0 ? rawCandles[rawCandles.length - 1] : null;
            const intervalMs = this.parseIntervalToMs(interval);
            const isStaleTail = Boolean(lastCandle && lastCandle.time > 1000000000000 && (nowCheck - lastCandle.time) >= intervalMs * 2.5);
            const hasGap = this.hasBufferTimeGap(rawCandles, interval, requiredWarmup);

            // WS-first 1m optimization: on multi-symbol scanners (>5 symbols) with higher timeframes,
            // accumulate 1m via WebSocket (0 REST weight) and only REST-heal if the symbol becomes an active trade
            // or clears non-1m gates in ExecutionService. Trim stale/gapped segments so WS never stitches across holes.
            const deferEager1m =
              interval === '1m' &&
              intervals.size > 1 &&
              !isSoloOrSmallWatchlist &&
              !activeTradeSymbolSet.has(symbol);
            if (deferEager1m) {
              if ((isStaleTail || hasGap) && typeof (this.klineStore as any).trimGapsAndStaleTail === 'function') {
                (this.klineStore as any).trimGapsAndStaleTail(symbol, '1m');
              }
              continue;
            }

            const needsWarmup = isSynthOnly || !rawCandles || rawCandles.length < requiredWarmup || isStaleTail || hasGap;
            if ((!oldIntervals || !oldIntervals.has(interval) || needsWarmup) && !this.isBackfillShortHistory(symbol, interval)) {
              const alreadyQueued = this.backfillQueue.some(t => t.symbol === symbol && t.interval === interval);
              if (!alreadyQueued) {
                this.backfillQueue.push({ symbol, interval });
              }
            }
          }
        }
        if (!this.sessionState.isBanned()) {
          this.processBackfillQueue().catch(err => {
            this.logger.error(`[MarketFeed] Backfill queue execution failed: ${err instanceof Error ? err.message : String(err)}`);
          });
        }
      }

      // BOLT: Throttled logging for watchlist updates to reduce noise during rapid config changes or trade entries
      const now = Date.now();
      if (now - this.lastWatchlistLogTs > 10000 || changed) {
        this.logger.log(`[MarketFeed] Watchlist updated: ${this.activeWatchlist.size} symbols monitored.`);
        this.lastWatchlistLogTs = now;
      }
    } catch (err) {
      this.logger.error(`[MarketFeed] Watchlist update failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async startGlobalDiscovery() {
    if (!this.sharedMarket) await this.stopGlobalDiscovery();

    // SRE: Critical guard - do not attempt to open new streams if the IP is currently banned
    if (this.sessionState.isBanned()) {
      this.logger.warn(`[MarketFeed] Global discovery start deferred: IP is currently banned.`);
      return;
    }

    const mode = this.sessionState.config?.trading_mode || (this.sessionState.config?.paper_mode ? 'paper' : 'live');
    const isTestnet = mode === 'testnet';
    // Live uses the newer /market/stream endpoint with streams embedded in the URL.
    // The classic /stream endpoint is starved by Binance from many IP ranges, and the
    // SUBSCRIBE method is not served on /market/stream, so URL-param subscription is required.
    const wsBaseMarket = isTestnet
        ? ENGINE_CONSTANTS.BINANCE_TESTNET_WS_URL
        : ENGINE_CONSTANTS.BINANCE_WS_MARKET;

    // RAW DISCOVERY FALLBACK (Citadel Protocol 2026): When the primary global aggregate streams
    // (!miniTicker@arr / !markPrice@arr) are starved for this IP range, subscribe instead to
    // individual symbol-scoped miniTicker/markPrice streams built from the candidate set we
    // already know (config.symbols + active trades + the REST-seeded TickerCache top volume).
    // This is a genuinely different subscription set (not the all-symbol broadcast) and avoids
    // the starved aggregate path. The REST seed (seedMarketDataFromRest) still keeps the full
    // candidate pool populated so the scanner can discover new symbols.
    let topics: string[];
    if (this.forceRawDiscovery && !isTestnet) {
      topics = this.buildRawDiscoveryTopics();
      this.logger.warn(`[MarketFeed] RAW discovery fallback active: subscribing to ${topics.length} symbol-scoped streams (aggregate stream starved).`);
    } else {
      topics = ['!miniTicker@arr', '!markPrice@arr@1s'];
    }

    if (this.sharedMarket && !isTestnet) {
      this.globalDiscoveryOpenedAt = Date.now();
      this._globalDiscoveryConfirmed = false;
      await this.sharedMarket.discovery.subscribe(this, this.sharedSubscriber(topics));
      return;
    }

    // Testnet still serves the SUBSCRIBE method on /stream, so keep method-based there.
    // Live must carry streams in the connection URL (?streams=...).
    let wsUrl = wsBaseMarket;
    if (!isTestnet) {
      wsUrl = `${wsBaseMarket}?streams=${topics.join('/')}`;
    }
    this.logger.log(`[MarketFeed] Starting unified discovery manager for: ${topics.join(', ')}`);

    const manager = new BinanceSubscriptionManager(
        wsUrl,
        {
            isTestnet,
            proxyUrl: this.currentProxyUrl,
            onMessage: (data) => this.processStreamMessage(data),
            isBanned: () => this.sessionState.isBanned(),
            onBan: (msg) => {
               this.logger.fatal(`[MarketFeed] WebSocket rate-limit/ban status detected: ${msg}. Propagating ban...`);
               const banMatch = msg.match(/banned until (\d+)/i);
               let until = banMatch ? parseInt(banMatch[1], 10) : Date.now() + (24 * 60 * 60 * 1000);
               if (banMatch && until < 9999999999) {
                 until *= 1000;
               }
               BinanceRequestQueue.setCooldownUntil(until);
               this.eventEmitter.emit('binance.api_limit_reached', { type: 'BAN', message: msg, until });
            }
        }
    );
    this.discoveryManagers.set('unified', manager);
    try {
      await manager.connect();
      await manager.subscribe(topics);
    } catch (err) {
      this.logger.error(`[MarketFeed] Failed to connect/subscribe global discovery manager: ${err instanceof Error ? err.message : String(err)}`);
    }

    this.globalDiscoveryOpenedAt = Date.now();
    this._globalDiscoveryConfirmed = false;
  }

  /**
   * Builds the symbol-scoped discovery topic list used by the RAW discovery fallback.
   * Instead of the global `!miniTicker@arr` / `!markPrice@arr` broadcast (which can be starved
   * for certain IP ranges), we subscribe to individual `<symbol>@miniTicker` and
   * `<symbol>@markPrice@1s` streams for the symbols we already know about. The candidate pool is
   * config.symbols + currently active trades + the top-volume symbols from the REST-seeded
   * TickerCache, so real-time prices for the scanner's working set stay fresh even when the
   * aggregate stream is dead. Falls back to the aggregate stream if we somehow know zero symbols.
   */
  private buildRawDiscoveryTopics(): string[] {
    const symbols = new Set<string>();
    const cfg = this.currentConfig;

    if (cfg?.symbols && Array.isArray(cfg.symbols)) {
      for (const s of cfg.symbols) symbols.add(String(s).toLowerCase());
    }
    for (const t of this.sessionState.activeTrades) {
      if (t && t.symbol) symbols.add(t.symbol.toLowerCase());
    }
    try {
      const top = this.tickerCache.topByVolume(200, (cfg?.excluded_symbols as string[]) || []);
      for (const tk of top) {
        if (tk && tk.symbol) symbols.add(tk.symbol.toLowerCase());
      }
    } catch {
      // TickerCache may be empty during very early startup; rely on the REST seed instead.
    }

    if (symbols.size === 0) {
      // Nothing known yet: fall back to the aggregate stream so we can still discover symbols.
      return ['!miniTicker@arr', '!markPrice@arr@1s'];
    }

    const topics: string[] = [];
    for (const s of symbols) {
      topics.push(`${s}@miniTicker`);
      topics.push(`${s}@markPrice@1s`);
    }
    return topics;
  }

  private sharedSubscriber(topics: string[]) {
    return {
      topics: new Set(topics),
      onMessage: (message: any, writeCache: boolean) => this.processStreamMessage(message, undefined, writeCache),
      onBan: (message: string) => {
        const match = message.match(/banned until (\d+)/i);
        let until = match ? Number(match[1]) : Date.now() + 24 * 60 * 60 * 1000;
        if (until < 9999999999) until *= 1000;
        BinanceRequestQueue.setCooldownUntil(until);
        this.eventEmitter.emit('binance.api_limit_reached', { type: 'BAN', message, until });
      },
    };
  }

  private async stopGlobalDiscovery() {
    await this.sharedMarket?.discovery.unsubscribe(this);
    for (const manager of this.discoveryManagers.values()) {
        await manager.stop();
    }
    this.discoveryManagers.clear();
  }

  private lastRawWsLogTs = 0;
  private _firstMsgLogged = false;
  private lastHeartbeatTs = 0;

  private processStreamMessage(msg: any, defaultStream?: string, writeCache = true) {
    try {
      // SRE: Handle both combined ({stream, data}) and single-stream (raw payload) formats.
      const stream = msg.stream || defaultStream || '';
      const payload = msg.data || msg;

      // Health tracking for discovery streams (Aggregate streams start with '!' or contain '@arr'.
      // Symbol-scoped raw-discovery streams (@miniTicker / @markPrice) are also treated as live.)
      if (stream.startsWith('!') || stream.includes('@arr') || stream.includes('@miniTicker') || stream.includes('@markPrice')) {
          this._globalDiscoveryConfirmed = true;
          this.consecutiveDiscoveryFailures = 0;
          if (!this.hasEverReceivedData) {
              this.hasEverReceivedData = true;
              this.logger.log(`[MarketFeed] First message received from stream: ${stream}. Connection healthy.`);
          }

          // Heartbeat Telemetry (Every 10s)
          const now = Date.now();
          if (now - this.lastHeartbeatTs > 10000) {
              this.logger.log(`[MarketFeed] Heartbeat: Receiving discovery data (${stream}). Cache: ${this.tickerCache.getCacheSize()} symbols.`);
              this.lastHeartbeatTs = now;
          }
      }

      if (!this._firstMsgLogged) {
        this._firstMsgLogged = true;
        this.logger.debug(`[MarketFeed] First discovery message sample: ${JSON.stringify(msg).substring(0, 200)}`);
      }

      if (this.sessionState.config?.debug_mode) {
         const now = Date.now();
         if (now - this.lastRawWsLogTs > 2000) {
            this.logger.debug(`[MarketFeed] Raw WS Frame: ${JSON.stringify(msg).substring(0, 100)}...`);
            this.lastRawWsLogTs = now;
         }
      }

      if (stream.includes('!miniTicker@arr')) {
        this.lastMiniTickerMsgTs = Date.now();
        const tickers: any[] = Array.isArray(payload) ? payload : [];
        if (writeCache && tickers.length > 0) {
          this.tickerCache.bulkUpdate(tickers);
        }
      } else if (stream.includes('@miniTicker')) {
        // Symbol-scoped miniTicker (RAW discovery fallback). Payload is a single ticker object.
        this.lastMiniTickerMsgTs = Date.now();
        if (writeCache && payload && (payload.s || payload.symbol)) {
          this.tickerCache.updateTicker(payload.s || payload.symbol, payload.c, payload.q, payload.o);
        }
      } else if (stream.includes('!markPrice@arr')) {
        this.lastMarkTickerMsgTs = Date.now();
        const updates: any[] = Array.isArray(payload) ? payload : [];
        for (const u of writeCache ? updates : []) {
          this.tickerCache.updateTicker(u.s, undefined, undefined, undefined, u.p);
        }
      } else if (stream.includes('@kline')) {
        const kline = payload.k;
        if (kline) {
          if (writeCache) {
            this.klineStore.upsertCandle(kline.s, kline.i, kline);
            this.tickerCache.updateTicker(kline.s, kline.c);
          }
          if (kline.x && this.onCandleClose) this.onCandleClose(kline.s).catch(() => {});
        }
      } else if (stream.includes('@ticker')) {
        // Seed ticker cache from symbol-specific ticker stream
        if (writeCache) this.tickerCache.updateTicker(payload.s, payload.c, payload.q, payload.o);
      } else if (stream.includes('@markPrice')) {
        // Authoritative real-time mark price for PnL
        if (writeCache) this.tickerCache.updateTicker(payload.s, undefined, undefined, undefined, payload.p);
      }
    } catch (err) {
      this.logger.error(`Error processing stream message: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async rebuildCombinedKlineStream() {
    // SRE: Critical guard - do not attempt to open new streams if the IP is currently banned
    if (this.sessionState.isBanned()) {
      this.logger.warn(`[MarketFeed] Kline stream rebuild deferred: IP is currently banned.`);
      return;
    }

    const mode = this.sessionState.config?.trading_mode || (this.sessionState.config?.paper_mode ? 'paper' : 'live');
    const isTestnet = mode === 'testnet';

    // We will use the standard `/stream` endpoint to support live SUBSCRIBE/UNSUBSCRIBE payload and avoid connection drops
    const wsBaseMarket = isTestnet
        ? ENGINE_CONSTANTS.BINANCE_TESTNET_WS_URL
        : ENGINE_CONSTANTS.BINANCE_WS_MARKET;

    const allStreams: string[] = [];

    for (const [symbol, intervals] of this.activeWatchlist) {
      const s = symbol.toLowerCase();
      allStreams.push(`${s}@ticker`);
      const isActiveTrade = this.sessionState.activeTrades.some(t => t.symbol === symbol);
      if (isActiveTrade) {
        allStreams.push(`${s}@markPrice@1s`);
      }
      for (const interval of intervals) {
        allStreams.push(`${s}@kline_${interval}`);
      }
    }

    if (this.sharedMarket && !isTestnet) {
      if (!this.running) return;
      if (!allStreams.length) await this.sharedMarket.klines.unsubscribe(this);
      else await this.sharedMarket.klines.subscribe(this, this.sharedSubscriber(allStreams));
      return;
    }

    if (allStreams.length === 0) {
        for (const manager of this.klineManagers) {
            await manager.stop();
        }
        this.klineManagers = [];
        return;
    }


    const sortedStreams = [...allStreams].sort();
    const streamSignature = sortedStreams.join('/');

    // Testnet supports dynamic SUBSCRIBE/UNSUBSCRIBE on /stream without dropping the socket.
    // Live uses /market/stream?streams=<...> (SUBSCRIBE method is NOT served on /market/stream per AGENTS.md §9).
    if (this.klineManagers.length > 0) {
      const manager = this.klineManagers[0];
      if (!isTestnet) {
        if ((manager as any)._streamsSignature === streamSignature) {
          return;
        }
        // Stream set changed on LIVE: rebuild single manager with ?streams= URL param
        for (const m of this.klineManagers) {
          await m.stop();
        }
        this.klineManagers = [];
      } else {
        const currentActive = (manager as any).activeSubscriptions || new Set();
        const newSet = new Set(allStreams);

        const toSubscribe = allStreams.filter(s => !currentActive.has(s));
        const toUnsubscribe = Array.from(currentActive).filter(s => !newSet.has(s as string)) as string[];

        if (toSubscribe.length > 0) await manager.subscribe(toSubscribe);
        if (toUnsubscribe.length > 0 && typeof manager.unsubscribe === 'function') await manager.unsubscribe(toUnsubscribe);
        return;
      }
    }

    // Stop all existing kline managers just in case we are resetting from empty
    for (const manager of this.klineManagers) {
        await manager.stop();
    }
    this.klineManagers = [];

    const wsUrl = isTestnet
      ? wsBaseMarket
      : `${wsBaseMarket}?streams=${sortedStreams.join('/')}`;

    // Initialize one single manager
    const manager = new BinanceSubscriptionManager(
        wsUrl,
        {
            isTestnet,
            proxyUrl: this.currentProxyUrl,
            onMessage: (data) => this.processStreamMessage(data),
            isBanned: () => this.sessionState.isBanned(),
            onBan: (msg) => {
               this.logger.fatal(`[MarketFeed] WebSocket rate-limit/ban status detected: ${msg}. Propagating ban...`);
               const banMatch = msg.match(/banned until (\d+)/i);
               let until = banMatch ? parseInt(banMatch[1], 10) : Date.now() + (24 * 60 * 60 * 1000);
               if (banMatch && until < 9999999999) {
                 until *= 1000;
               }
               BinanceRequestQueue.setCooldownUntil(until);
               this.eventEmitter.emit('binance.api_limit_reached', { type: 'BAN', message: msg, until });
            }
        }
    );
    (manager as any)._streamsSignature = streamSignature;
    this.klineManagers.push(manager);
    try {
      await manager.connect();
      await manager.subscribe(allStreams);
    } catch (err) {
      this.logger.error(`[MarketFeed] Failed to connect/subscribe kline manager: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * Valid Binance Futures kline intervals
   */
  private static readonly VALID_INTERVALS = new Set([
    '1m', '3m', '5m', '15m', '30m',
    '1h', '2h', '4h', '6h', '8h', '12h',
    '1d', '3d', '1w', '1M'
  ]);

  /**
   * Resolve an interval string to a valid Binance interval.
   * Replaces "default" with the configured scan_interval or "5m".
   * Returns null if the interval is invalid and cannot be resolved.
   */
  public resolveInterval(interval: string, config?: SessionConfig | null): string | null {
    if (!interval || typeof interval !== 'string') {
      return config?.scan_interval || '5m';
    }
    const trimmed = interval.trim();
    if (MarketFeedService.VALID_INTERVALS.has(trimmed)) {
      return trimmed;
    }
    if (trimmed === 'default') {
      return config?.scan_interval || '5m';
    }
    this.logger.warn(`[MarketFeed] Invalid interval "${interval}" for symbol, skipping. Valid intervals: ${Array.from(MarketFeedService.VALID_INTERVALS).join(', ')}`);
    return null;
  }

  private parseIntervalToMs(interval: string): number {
    // Robust Defensive Guard: ensure interval is a valid, non-empty string before slicing or parsing
    if (typeof interval !== 'string' || !interval) {
      return 60 * 1000; // default to 1m
    }
    const unit = interval.slice(-1);
    const value = parseInt(interval.slice(0, -1), 10);
    if (isNaN(value) || value <= 0) {
      return 60 * 1000; // default to 1m on NaN or invalid values
    }
    switch (unit) {
      case 'm': return value * 60 * 1000;
      case 'h': return value * 60 * 60 * 1000;
      case 'd': return value * 24 * 60 * 60 * 1000;
      case 'w': return value * 7 * 24 * 60 * 60 * 1000;
      case 'M': return value * 30 * 24 * 60 * 60 * 1000;
      default: return 60 * 1000;
    }
  }

  public queueBackfill(symbol: string, interval: string, requiredWarmup?: number) {
    const resolvedInterval = this.resolveInterval(interval, this.sessionState?.config) || interval;
    if (this.sessionState.isBanned() || this.isBackfillShortHistory(symbol, resolvedInterval)) {
      return;
    }
    const cacheKey = `${symbol}:${resolvedInterval}`;
    const failRetryAt = this.failureBackoffMap.get(cacheKey) || 0;
    const lastAttempt = this.lastBackfillAttemptMap.get(cacheKey) || 0;
    const now = Date.now();
    if (now < failRetryAt || (now - lastAttempt < 5 * 60 * 1000)) {
      return;
    }
    if (this.backfillQueue.length >= 120) {
      return;
    }
    const alreadyQueued = this.backfillQueue.some(t => t.symbol === symbol && t.interval === resolvedInterval);
    if (!alreadyQueued) {
      this.backfillQueue.push({ symbol, interval: resolvedInterval });
      this.processBackfillQueue().catch(err => {
        this.logger.error(`[MarketFeed] Backfill queue execution failed: ${err instanceof Error ? err.message : String(err)}`);
      });
    }
  }

  private async processBackfillQueue() {
    if (this.backfillProcessing || this.backfillQueue.length === 0) return;
    this.backfillProcessing = true;

    const initialDepth = this.backfillQueue.length;
    const startWeight = this.sessionState.binanceRateLimit?.used_1m ?? 0;
    const startTime = Date.now();
    this.logger.log(`Starting prioritized sequential kline backfill queue. Depth: ${initialDepth} | Current Weight: ${startWeight}`);

    // STRATEGY: Dynamically prioritized sequential backfill (active positions ALWAYS run first on every tick)
    while (this.backfillQueue.length > 0 && this.running) {
      // P0 FIX: Fail-fast ban guard - do not dispatch REST calls while IP is banned
      if (this.sessionState.isBanned()) {
        this.logger.warn(`Backfill queue paused: IP is currently banned. Clearing non-critical pending tasks.`);
        this.backfillQueue = [];
        break;
      }

      // Dynamically pick the highest-priority task: active position symbols always go ahead of scanner discovery
      const activeSymbols = new Set((this.sessionState.activeTrades || []).map(t => t.symbol));
      const activeIdx = this.backfillQueue.findIndex(t => activeSymbols.has(t.symbol));
      const nextIdx = activeIdx !== -1 ? activeIdx : 0;
      const isNextActive = activeIdx !== -1;

      const rateLimit = this.sessionState.getBinanceRateLimit();
      const usedWeight = Number(rateLimit.used_weight_1m || 0);
      const limit = Number(rateLimit.weight_limit || ENGINE_CONSTANTS.BINANCE_RATE_LIMIT_DEFAULT);

      // SRE: Defensive guard against NaN to prevent 0ms delay hammers
      const usageRatio = (limit > 0) ? (usedWeight / limit) : 0;
      const safeUsageRatio = Number.isFinite(usageRatio) ? usageRatio : 0;

      // Reserve headroom: discovery klines pause >40%, active trade exit-indicator warmup klines allowed up to 65%
      const pauseRatio = isNextActive ? 0.65 : 0.40;
      const pauseThreshold = Math.floor(limit * pauseRatio);

      if (usedWeight > pauseThreshold) {
        const msIntoMinute = Date.now() % 60000;
        if (msIntoMinute > 45000) {
           const waitMs = (60000 - msIntoMinute) + 1200;
           this.logger.warn(`Backfill pausing: High weight (${usedWeight}/${limit}, limit ${(pauseRatio * 100).toFixed(0)}%) near window end. Waiting ${waitMs}ms for rollover...`);
           await new Promise(resolve => setTimeout(resolve, waitMs));
           continue;
        }

        this.logger.warn(`Backfill queue pausing to preserve IP reputation (Weight: ${usedWeight}/${limit}, ceiling ${(pauseRatio * 100).toFixed(0)}%)...`);
        await new Promise(resolve => setTimeout(resolve, 10000)); // Normal backoff
        continue;
      }

      const [task] = this.backfillQueue.splice(nextIdx, 1);
      if (task) {
        try {
          await this.backfillKlines(task.symbol, task.interval);
        } catch (err: any) {
          const msg = err.message || '';
          const isBan = msg.includes('banned') || msg.includes('418') || msg.includes('IP banned');
          const isRateLimit = msg.includes('429');

          if (isBan || isRateLimit) {
             this.logger.warn(`Critical API issue detected during backfill: ${msg}. Pausing backfill queue. Re-queueing ${task.symbol} (${task.interval}) and waiting 5s.`);
             this.backfillQueue.unshift(task);
             await new Promise(resolve => setTimeout(resolve, 5000));
             continue; // Exit this iteration, let next loop iteration check ban status
          }
          this.logger.error(`Backfill failed for ${task.symbol} ${task.interval}: ${msg}`);
        }

        // SRE: Adaptive gap between sequential requests to smooth out weight consumption.
        const baseDelay = isNextActive ? 350 : 500;
        const adaptiveDelay = baseDelay + (safeUsageRatio * 3000);
        const finalDelay = Number.isFinite(adaptiveDelay) ? adaptiveDelay : baseDelay;

        await new Promise(resolve => setTimeout(resolve, finalDelay + Math.random() * 500));
      }
    }
    this.backfillProcessing = false;
    const endWeight = this.sessionState.binanceRateLimit?.used_1m ?? 0;
    const duration = (Date.now() - startTime) / 1000;
    const weightUsed = duration > 60 ? 'Window Rolled' : (endWeight - startWeight);
    this.logger.log(`Sequential kline backfill complete. Duration: ${duration.toFixed(1)}s | Weight Used: ${weightUsed} (Total: ${endWeight})`);
  }

  public async forceBackfillKlines(symbol: string, interval: string): Promise<{ success: boolean; symbol: string; interval: string; count: number; requiredWarmup: number; isWarmupComplete: boolean; message: string }> {
    if (this.sessionState.isBanned()) {
      throw new Error("Binance IP is currently banned. Kline sync is paused.");
    }

    const resolvedInterval = this.resolveInterval(interval, this.sessionState.config) || interval;
    const cacheKey = `${symbol}:${resolvedInterval}`;
    const lastAttempt = this.lastBackfillAttemptMap.get(cacheKey) || 0;
    const now = Date.now();

    if (now - lastAttempt < 10000) {
      const waitSec = Math.ceil((10000 - (now - lastAttempt)) / 1000);
      throw new Error(`Candle sync on cooldown for ${symbol} ${resolvedInterval}. Please wait ${waitSec}s.`);
    }

    const requiredWarmup = this.getRequiredWarmupForSymbol(this.sessionState.config, symbol);
    const requestLimit = Math.min(
      this.klineStore.getMaxCandles(),
      requiredWarmup <= 89 ? 99 : Math.max(requiredWarmup + 10, 100),
    );
    const isActiveTrade = (this.sessionState.activeTrades || []).some(t => t.symbol === symbol);

    this.logger.log(`[Manual Sync] Force backfilling klines for ${symbol} ${resolvedInterval}...`);

    let klines: any[][] = [];
    if (this.binanceClient) {
      const response = await this.binanceClient.restAPI.klineCandlestickData({
        symbol,
        interval: resolvedInterval as any,
        limit: requestLimit,
        ...(isActiveTrade ? { __queuePriority: 'active_warmup' } : {}),
      } as any);
      this.updateWeight(response.headers);
      klines = (await response.data()) as any[][];
    } else {
      const url = `${this.currentRestBase}/fapi/v1/klines?symbol=${symbol}&interval=${resolvedInterval}&limit=${requestLimit}`;
      const response = await this.binanceClientFactory.genericRequest(
        () => this.binanceClientFactory.proxyFetch(url, { signal: AbortSignal.timeout(10000) }, this.currentProxyUrl),
        'klineCandlestickData',
        false,
        { priority: isActiveTrade ? 'active_warmup' : undefined, estimatedWeight: requestLimit < 100 ? 1 : 2 }
      );
      if (response.ok) {
        klines = (await response.json()) as any[][];
      }
    }

    this.lastBackfillAttemptMap.set(cacheKey, Date.now());
    this.failureBackoffMap.delete(cacheKey);
    if (Array.isArray(klines)) {
      if (klines.length < requestLimit) {
        this.shortHistoryMap.set(cacheKey, { count: klines.length, fetchedAt: Date.now() });
      } else {
        this.shortHistoryMap.delete(cacheKey);
      }
      if (klines.length > 0) {
        await this.klineStore.seedFromRest(symbol, resolvedInterval, klines);
      }
    }

    const candles = this.klineStore.getRawCandles(symbol, resolvedInterval);
    const count = candles.length;
    const isWarmupComplete = count >= requiredWarmup;

    return {
      success: true,
      symbol,
      interval: resolvedInterval,
      count,
      requiredWarmup,
      isWarmupComplete,
      message: isWarmupComplete
        ? `Successfully synced ${count}/${requiredWarmup} candles for ${symbol} (${resolvedInterval}). Warmup complete.`
        : `Synced ${count}/${requiredWarmup} candles for ${symbol} (${resolvedInterval}). ${requiredWarmup - count} candles remaining for full warmup.`
    };
  }

  private backfillKlines(symbol: string, interval: string) {
    return this.sharedMarket
      ? this.sharedMarket.backfill(async () => {
          if (this.running) await this.loadKlines(symbol, interval);
        })
      : this.loadKlines(symbol, interval);
  }

  private async loadKlines(symbol: string, interval: string) {
    const resolvedInterval = this.resolveInterval(interval, this.sessionState.config);
    if (!resolvedInterval) {
      this.logger.error(`[MarketFeed] Skipping backfill for ${symbol} ${interval}: Invalid interval that cannot be resolved.`);
      return;
    }

    const requiredWarmup = Math.max(this.getRequiredWarmupForSymbol(this.sessionState.config, symbol, resolvedInterval), 20);
    const isActiveTrade = (this.sessionState.activeTrades || []).some(t => t.symbol === symbol);

    // IN-FLIGHT DEDUPLICATION: Avoid duplicate concurrent REST requests for the same symbol & interval
    const inFlightKey = `${symbol}_${resolvedInterval}`;
    if (this.inFlightBackfills.has(inFlightKey)) {
      this.logger.debug(`[MarketFeed] Reusing in-flight backfill promise for ${inFlightKey}`);
      await this.inFlightBackfills.get(inFlightKey);
      return;
    }

    const backfillTask = (async () => {
      const isSynthOnly = typeof (this.klineStore as any).isSynthesizedOnly === 'function' ? (this.klineStore as any).isSynthesizedOnly(symbol, resolvedInterval) : false;
      let existingCandles = isSynthOnly ? [] : await this.klineStore.getRecentCandles(symbol, resolvedInterval, requiredWarmup);

      if (existingCandles.length < requiredWarmup) {
         this.logger.debug(`[MarketFeed] Low local memory cache for ${symbol} ${resolvedInterval}. Checking database...`);
         const loadedCount = await this.klineStore.loadFromDb(symbol, resolvedInterval, requiredWarmup);
         if (loadedCount > 0) {
            this.logger.log(`[MarketFeed] Successfully restored ${loadedCount} candles from local DB for ${symbol} ${resolvedInterval}.`);
            existingCandles = await this.klineStore.getRecentCandles(symbol, resolvedInterval, requiredWarmup);
         }
      }

      const cacheKey = `${symbol}:${resolvedInterval}`;
      if (this.isBackfillShortHistory(symbol, resolvedInterval)) {
        this.logger.debug(`[MarketFeed] Skipping kline backfill for ${cacheKey}: Exchange short-history ceiling cached.`);
        return;
      }

      const failRetryAt = this.failureBackoffMap.get(cacheKey) || 0;
      if (Date.now() < failRetryAt) {
        this.logger.debug(`[MarketFeed] Skipping kline backfill for ${cacheKey}: Transient failure backoff active.`);
        return;
      }

      const lastAttempt = this.lastBackfillAttemptMap.get(cacheKey) || 0;
      if (Date.now() - lastAttempt < 5 * 60 * 1000) {
        this.logger.debug(`[MarketFeed] Skipping recent kline backfill attempt for ${cacheKey} (Cooldown active).`);
        return;
      }

      if (existingCandles.length > 0) {
        const lastCandle = existingCandles[existingCandles.length - 1];
        const intervalMs = this.parseIntervalToMs(resolvedInterval);
        const isFresh = (Date.now() - lastCandle.time) < (intervalMs * 1.5);
        const hasGap = this.hasBufferTimeGap(existingCandles, resolvedInterval, requiredWarmup);

        if (isFresh && !hasGap && existingCandles.length >= requiredWarmup) {
          this.logger.debug(`Skipping kline backfill for ${symbol} ${resolvedInterval}: Already have ${existingCandles.length}/${requiredWarmup} candles and data is fresh.`);
          return;
        }
      }

      const maxCandles = this.klineStore.getMaxCandles();
      const requestLimit = Math.min(
        maxCandles,
        requiredWarmup <= 89 ? 99 : Math.max(requiredWarmup + 10, 100),
      );
      this.logger.log(`Backfilling klines for ${symbol} ${resolvedInterval}: Have ${existingCandles.length}, need ${requiredWarmup} (limit=${requestLimit}).`);

      await new Promise(resolve => setTimeout(resolve, Math.random() * ENGINE_CONSTANTS.BACKFILL_MAX_JITTER_MS));
      try {
        let klines: any[][];

        if (this.binanceClient) {
          const response = await this.binanceClient.restAPI.klineCandlestickData({
            symbol,
            interval: resolvedInterval as any,
            limit: requestLimit,
            ...(isActiveTrade ? { __queuePriority: 'active_warmup' } : {}),
          } as any);
          this.updateWeight(response.headers);
          klines = (await response.data()) as any[][];
        } else {
          const url = `${this.currentRestBase}/fapi/v1/klines?symbol=${symbol}&interval=${resolvedInterval}&limit=${requestLimit}`;
          const response = await this.binanceClientFactory.genericRequest(
            () => this.binanceClientFactory.proxyFetch(url, { signal: AbortSignal.timeout(10000) }, this.currentProxyUrl),
            'klineCandlestickData',
            false,
            { priority: isActiveTrade ? 'active_warmup' : undefined, estimatedWeight: requestLimit < 100 ? 1 : 2 }
          );
          if (!response.ok) {
            this.failureBackoffMap.set(cacheKey, Date.now() + (isActiveTrade ? 15000 : 30000));
            return;
          }
          klines = (await response.json()) as any[][];
        }

        if (Array.isArray(klines)) {
          this.lastBackfillAttemptMap.set(cacheKey, Date.now());
          this.failureBackoffMap.delete(cacheKey);
          if (klines.length < requestLimit) {
            this.shortHistoryMap.set(cacheKey, { count: klines.length, fetchedAt: Date.now() });
          } else {
            this.shortHistoryMap.delete(cacheKey);
          }
          if (klines.length > 0) {
            await this.klineStore.seedFromRest(symbol, resolvedInterval, klines);
          }
        } else {
          this.failureBackoffMap.set(cacheKey, Date.now() + (isActiveTrade ? 15000 : 30000));
        }
      } catch (err) {
        // Record only short backoff on error/load-shed so 5m cooldown never locks out active-trade warmup
        this.failureBackoffMap.set(cacheKey, Date.now() + (isActiveTrade ? 15000 : 30000));
        this.logger.error(`Kline backfill failed for ${symbol}: ${err instanceof Error ? err.message : String(err)}`);
      }
    })();

    this.inFlightBackfills.set(inFlightKey, backfillTask);
    try {
      await backfillTask;
    } finally {
      this.inFlightBackfills.delete(inFlightKey);
    }
  }

  public getActiveWatchlistKeys(): Set<string> {
    const keys = new Set<string>();
    for (const [symbol, intervals] of this.activeWatchlist.entries()) {
      for (const interval of intervals) {
        keys.add(`${symbol}_${interval}`);
      }
    }
    return keys;
  }

  public getActiveWatchlistSymbols(): Set<string> {
    const symbols = new Set<string>(this.activeWatchlist.keys());
    if (!this.sessionState?.hibernating && this.discoveredSymbolsCache?.symbols) {
      for (const s of this.discoveredSymbolsCache.symbols) {
        symbols.add(s);
      }
    }
    return symbols;
  }

  public async ensureKlinesAvailable(symbol: string, interval: string, minCandles: number = 20): Promise<void> {
    if (this.sessionState.isBanned() || (typeof (this.sessionState as any).isGeoBlocked === 'function' && (this.sessionState as any).isGeoBlocked())) {
      return;
    }

    const resolvedInterval = this.resolveInterval(interval, this.sessionState.config) || interval;
    const cacheKey = `${symbol}:${resolvedInterval}`;
    const isActiveTrade = (this.sessionState.activeTrades || []).some(t => t.symbol === symbol);
    const rateLimit = this.sessionState.getBinanceRateLimit();
    const usedWeight = Number(rateLimit.used_weight_1m || 0);
    const limit = Number(rateLimit.weight_limit || ENGINE_CONSTANTS.BINANCE_RATE_LIMIT_DEFAULT);
    const pauseRatio = isActiveTrade ? 0.65 : 0.40;
    if (limit > 0 && usedWeight > Math.floor(limit * pauseRatio)) {
      this.logger.debug(`[MarketFeed] Skipping ensureKlinesAvailable for ${cacheKey}: weight ${usedWeight}/${limit} exceeds ${(pauseRatio * 100).toFixed(0)}% ceiling.`);
      return;
    }

    const now = Date.now();
    const lastHeal = this.ensureKlinesCooldownMap.get(cacheKey) || 0;
    if (now - lastHeal < 60 * 1000) {
      this.logger.debug(`[MarketFeed] Skipping ensureKlinesAvailable for ${cacheKey}: 60s auto-heal cooldown active.`);
      return;
    }

    this.ensureKlinesCooldownMap.set(cacheKey, now);
    this.lastBackfillAttemptMap.delete(cacheKey);
    await this.backfillKlines(symbol, resolvedInterval);
  }
}
