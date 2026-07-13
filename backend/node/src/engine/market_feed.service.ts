import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Settings as SettingsEntity } from '../models/entities/Settings.entity';
import { OnEvent, EventEmitter2 } from '@nestjs/event-emitter';
import WebSocket from 'ws';
import { SessionConfig } from '../models/SessionConfig';
import { ENGINE_CONSTANTS } from '../models/constants';
import { TickerCacheService } from './ticker_cache.service';
import { KlineStoreService } from './kline_store.service';
import { SessionStateService } from './session_state.service';
import { SignalEngineService } from './signalEngine';
import { MonitoringService } from './monitoring.service';
import { ENGINE_EVENTS } from './events';
import { BinanceExchangeInfo } from '../models/binance.types';
import { BinanceRequestQueue, BinanceClientFactory } from '../lib/binanceClientFactory';
import { BinanceSubscriptionManager } from '../lib/binanceSubscriptionManager';

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
  private binanceClient: any = null;

  private globalDiscoveryTimeout: NodeJS.Timeout | null = null;
  private globalDiscoveryRetryCount = 0;
  private lastMiniTickerMsgTs = 0;
  private lastMarkTickerMsgTs = 0;
  private globalDiscoveryOpenedAt = 0;
  private hasEverReceivedData = false;
  private _globalDiscoveryConfirmed = false;
  private forceRawDiscovery = false;
  private consecutiveDiscoveryFailures = 0;

  private discoveryManagers: Map<string, BinanceSubscriptionManager> = new Map();
  private klineManagers: BinanceSubscriptionManager[] = [];

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
    if (bc) this.binanceClient = bc;
    if (this.running) await this.stop();
    this.running = true;

    const mode = config.trading_mode || (config.paper_mode ? 'paper' : 'live');
    const isTestnet = mode === 'testnet';
    const restBase = isTestnet
        ? 'https://testnet.binancefuture.com' // Corrected Testnet URL
        : ENGINE_CONSTANTS.BINANCE_REST_BASE;

    const wsBaseMarket = isTestnet
        ? 'wss://fstream.binancefuture.com/stream'
        : ENGINE_CONSTANTS.BINANCE_WS_MARKET;

    // Discovery Managers initialization is now deferred to startGlobalDiscovery

    // RESEARCH-02: Optimized Startup. loadFromDb() called via fetchExchangeInfo()
    // will now be called before any session start.
    await this.fetchExchangeInfo(restBase);

    // BOLT: Global streams (!miniTicker, !markPrice) are decoupled
    // to resolve the discovery bootstrap deadlock.
    await this.startGlobalDiscovery();
    this.startWatchlistManager(config);

    // SRE: Startup Self-Test (Citadel Protocol 2026)
    // Assert TickerCache is seeded within 15s or alert loudly.
    const runMode = mode;
    if (runMode !== 'paper') {
       setTimeout(() => {
          if (this.running && this.tickerCache.getCacheSize() === 0) {
             const alertMsg = `CRITICAL: Market Feed Startup Failure - TickerCache remains empty after 15s. Scanner is offline. Mode=${runMode}`;
             this.logger.error(alertMsg);
             this.eventEmitter.emit(ENGINE_EVENTS.LOG_MESSAGE, { msg: alertMsg, level: 'error' });
             this.eventEmitter.emit(ENGINE_EVENTS.ALERT, {
                level: 'error',
                title: 'Market Feed Failure',
                message: 'No ticker data received from Binance. Check network and API status.',
             });
          } else if (this.running) {
             this.logger.log(`[MarketFeed] Startup Self-Test passed: ${this.tickerCache.getCacheSize()} symbols seeded.`);
          }
       }, 15000);
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

    // RESEARCH-02: DB-First Metadata Loading
    if (MarketFeedService.cachedExchangeInfo.size === 0) {
      try {
        const settings = await this.settingsRepository.findOne({ where: { id: 'default' } });
        if (settings && settings.exchange_info_cache && settings.exchange_info_ts) {
          const age = now - Number(settings.exchange_info_ts);
          if (age < CACHE_TTL) {
            this.logger.log(`Loading exchange info from DB cache (Age: ${Math.round(age / 3600000)}h)...`);
            const cache = settings.exchange_info_cache;
            MarketFeedService.cachedExchangeInfo.clear();
            Object.keys(cache).forEach(symbol => {
              MarketFeedService.cachedExchangeInfo.set(symbol, cache[symbol]);
            });

            const storedLimit = settings.exchange_rate_limit || ENGINE_CONSTANTS.BINANCE_RATE_LIMIT_DEFAULT;
            MarketFeedService.cachedRateLimit = storedLimit;
            this.sessionState.updateRateLimit(this.sessionState.binanceRateLimit.used_1m, storedLimit);
            BinanceRequestQueue.setWeightLimit(storedLimit);

            MarketFeedService.lastExchangeInfoFetch = Number(settings.exchange_info_ts);
            MarketFeedService.lastExchangeInfoBase = restBase;
            this.exchangeInfo = MarketFeedService.cachedExchangeInfo;
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
      this.monitoringService.incrementApiRequests();

      let data: BinanceExchangeInfo | null = null;
      if (this.binanceClient) {
        this.logger.debug(`[MarketFeed] Fetching fresh exchange information from SDK...`);
        const response = await this.binanceClient.restAPI.exchangeInformation();
        this.updateWeight(response.headers);
        data = (await response.data()) as BinanceExchangeInfo;
      } else {
        this.logger.debug(`[MarketFeed] Fetching fresh exchange information via fetch...`);
        const response = await this.binanceClientFactory.genericRequest(
          () => fetch(`${restBase}/fapi/v1/exchangeInfo`, { signal: AbortSignal.timeout(10000) }),
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
          let filteredCryptoCount = 0;
          let filteredOtherCount = 0;

          for (const s of data.symbols) {
            // BOLT: Only include symbols that are actively trading in the target environment
            if (s.status === 'TRADING' || s.status === 'SETTLING') {
              // COMPLIANCE: Filter out TradFi/Non-Crypto symbols (Gold, Silver, Equities)
              // Binance Futures uses underlyingType 'COIN' for standard cryptocurrencies.
              const isCrypto = s.underlyingType === 'COIN' || !s.underlyingType;
              const isTradFi = s.underlyingType === 'COMMODITY' || s.underlyingType === 'EQUITY' || s.underlyingType === 'INDEX';

              if (isCrypto && !isTradFi) {
                // BOLT OPTIMIZATION: Pre-parse critical filter values to avoid O(N) find() and parseFloat() in the hot-path
                const parsed: any = { ...s };
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
                MarketFeedService.cachedExchangeInfo.set(s.symbol, parsed);
              } else {
                filteredOtherCount++;
              }
            } else {
              filteredCryptoCount++;
            }
          }
          MarketFeedService.lastExchangeInfoFetch = now;
          MarketFeedService.lastExchangeInfoBase = restBase;
          this.exchangeInfo = MarketFeedService.cachedExchangeInfo;
          this.logger.log(`[MarketFeed] Exchange info: ${this.exchangeInfo.size} symbols cached. (Filtered: ${filteredCryptoCount} inactive, ${filteredOtherCount} non-crypto)`);

          // RESEARCH-02: Persist to DB
          const cacheObj: any = {};
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

  async stop() {
    this.running = false;
    if (this.watchlistInterval) clearInterval(this.watchlistInterval);
    if (this.watchlistUpdateTimeout) clearTimeout(this.watchlistUpdateTimeout);

    await this.stopGlobalDiscovery();

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
  private startWatchlistManager(config: SessionConfig) {
    if (this.watchlistInterval) clearInterval(this.watchlistInterval);
    this.zeroWatchlistCycles = 0;
    this.updateWatchlist(config);
    this.watchlistInterval = setInterval(() => {
      this.updateWatchlist(config);

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
      // evaluate stream health every 5 minutes to avoid excessive reconnection churn
      // during transient exchange instability.
      const now = Date.now();
      if (now - this.lastStreamHealthCheck >= 5 * 60 * 1000) {
         this.lastStreamHealthCheck = now;
         this.checkStreamHealth();
      }
    }, ENGINE_CONSTANTS.WATCHLIST_REFRESH_INTERVAL_MS);
    this.watchlistInterval.unref?.();
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

      // CIRCUIT BREAKER: After 3 consecutive silent failures, switch to the raw WebSocket path.
      if (this.consecutiveDiscoveryFailures >= 3) {
        this.logger.fatal(`[MarketFeed] CIRCUIT BREAKER: Discovery has failed 3 times via primary method. Forcing raw WebSocket fallback.`);
        this.forceRawDiscovery = true;
      }

      this.logger.error(`[MarketFeed] CRITICAL: Global discovery socket open but zero messages received in 60s. Mode=${mode}. Failure #${this.consecutiveDiscoveryFailures}`);
      this.eventEmitter.emit(ENGINE_EVENTS.LOG_MESSAGE, {
        msg: `[MarketFeed] CRITICAL: No market data received after 60s. Scanner is offline. Mode=${mode}`,
        level: 'error'
      });
      // Force reconnect
      this.startGlobalDiscovery();
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
          this.startGlobalDiscovery();
       }

       // SRE: Watchlist stream health check
       if (this.activeWatchlist.size > 0) {
          this.rebuildCombinedKlineStream();
       }
    }
  }

  @OnEvent(ENGINE_EVENTS.WATCHLIST_NEEDS_UPDATE)
  async updateWatchlist(config: SessionConfig = this.sessionState.config!) {
    if (!this.running || !config) return;

    // BOLT: In light sleep, always allow watchlist updates to ensure scanner has candidates
    const isHibernating = this.sessionState.hibernating;
    const hibMode = config.hibernation_mode || 'adaptive';
    const isLight = isHibernating && hibMode === 'light';

    if (this.watchlistUpdatePending) return;
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
  }

  private async executeWatchlistUpdate(config: SessionConfig) {
    try {
      const newWatchlist = new Map<string, Set<string>>();
      const isGated = this.sessionState.isGated();
      const activeTrades = this.sessionState.activeTrades;

      // SRE: Optimization. In 'light' hibernation mode, we keep monitoring symbols even when gated
      // to avoid the 250+ weight REST backfill burst on resumption.
      const isHibernating = this.sessionState.hibernating;
      const hibMode = config.hibernation_mode || 'adaptive';
      const suppressScanner = isGated && activeTrades.length === 0 && hibMode !== 'light';

      if (config.global_scanner_enabled !== false && !suppressScanner) {
        let symbols: string[];
        if (config.symbols && config.symbols.length > 0) symbols = config.symbols;
        else {
          const top = await this.tickerCache.topByVolume((config.watchlist_size || 50) + (config.watchlist_offset || 0), config.excluded_symbols || []);
          const slicedTop = top.slice(config.watchlist_offset || 0);

          // COMPLIANCE: Filter by getSymbolFilters() to exclude non-crypto symbols (Gold, Equities)
          // that appear in miniTicker stream but are not tradable by the bot.
          symbols = slicedTop
            .map((t: any) => t.symbol)
            .filter(s => this.getSymbolFilters(s) !== undefined);
        }
        const globalInterval = config.scan_interval || '1m';
        for (const s of symbols) {
          if (!newWatchlist.has(s)) newWatchlist.set(s, new Set());
          newWatchlist.get(s)!.add(globalInterval);
        }
      }

      if (config.single_symbol_configs) {
        for (const sc of config.single_symbol_configs) {
          if (!sc.enabled) continue;
          // COMPLIANCE: Extend non-crypto filtering to manual monitors
          if (this.getSymbolFilters(sc.symbol) === undefined) {
             this.logger.warn(`Filtering out non-crypto symbol from manual monitor: ${sc.symbol}`);
             continue;
          }
          if (!newWatchlist.has(sc.symbol)) newWatchlist.set(sc.symbol, new Set());
          const interval = sc.use_custom_config && sc.custom_config?.scan_interval ? sc.custom_config.scan_interval : config.scan_interval || '1m';
          newWatchlist.get(sc.symbol)!.add(interval);
        }
      }

      for (const trade of activeTrades) {
        const t = trade;
        if (!newWatchlist.has(t.symbol)) newWatchlist.set(t.symbol, new Set());
        newWatchlist.get(t.symbol)!.add('1m');
        if (config.scan_interval) newWatchlist.get(t.symbol)!.add(config.scan_interval);
        if (t.strategy_config?.scan_interval) newWatchlist.get(t.symbol)!.add(t.strategy_config.scan_interval);
        if (t.strategy_config?.sl_lookback_timeframe) newWatchlist.get(t.symbol)!.add(t.strategy_config.sl_lookback_timeframe);
      }

      if (config.sl_lookback_timeframe) {
        for (const [symbol, intervals] of newWatchlist) intervals.add(config.sl_lookback_timeframe);
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
        await this.rebuildCombinedKlineStream();
        for (const [symbol, intervals] of newWatchlist) {
          for (const interval of intervals) {
            const oldIntervals = prevWatchlist.get(symbol);
            if (!oldIntervals || !oldIntervals.has(interval)) {
              this.backfillQueue.push({ symbol, interval });
            }
          }
        }
        this.processBackfillQueue();
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
    this.stopGlobalDiscovery();

    const mode = this.sessionState.config?.trading_mode || (this.sessionState.config?.paper_mode ? 'paper' : 'live');
    const isTestnet = mode === 'testnet';
    const wsBase = isTestnet
        ? 'wss://fstream.binancefuture.com/ws'
        : 'wss://fstream.binance.com/ws';

    // WebSocket Resilience Protocol (Industry 2026):
    // For aggregate streams (!), use dedicated connections to /ws/topic
    // instead of SUBSCRIBE frames to avoid protocol-level silent drops.
    const topics = ['!miniTicker@arr', '!markPrice@arr@1s'];

    const managerPromises = [];

    for (const topic of topics) {
        const url = `${wsBase}/${topic}`;
        this.logger.log(`[MarketFeed] Starting discovery manager (Raw-WS): ${url}`);
        const manager = new BinanceSubscriptionManager(
            url,
            {
                isTestnet,
                onMessage: (data) => this.processStreamMessage(data, topic)
            }
        );
        this.discoveryManagers.set(topic, manager);
        managerPromises.push(manager.connect());
    }

    await Promise.all(managerPromises);

    this.globalDiscoveryOpenedAt = Date.now();
    this._globalDiscoveryConfirmed = false;
  }

  private async stopGlobalDiscovery() {
    for (const manager of this.discoveryManagers.values()) {
        await manager.stop();
    }
    this.discoveryManagers.clear();
  }

  private lastRawWsLogTs = 0;
  private _firstMsgLogged = false;

  private processStreamMessage(msg: any, defaultStream?: string) {
    try {
      // SRE: Handle both combined ({stream, data}) and single-stream (raw payload) formats.
      const stream = msg.stream || defaultStream || '';
      const payload = msg.data || msg;

      // Health tracking for discovery streams
      if (stream.startsWith('!')) {
          this._globalDiscoveryConfirmed = true;
          this.consecutiveDiscoveryFailures = 0;
          if (!this.hasEverReceivedData) {
              this.hasEverReceivedData = true;
              this.logger.log(`[MarketFeed] First message received from stream: ${stream}. Connection healthy.`);
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
        if (tickers.length > 0) {
          this.tickerCache.bulkUpdate(tickers);
        }
      } else if (stream.includes('!markPrice@arr')) {
        this.lastMarkTickerMsgTs = Date.now();
        const updates: any[] = Array.isArray(payload) ? payload : [];
        for (const u of updates) {
          this.tickerCache.updateTicker(u.s, undefined, undefined, undefined, u.p);
        }
      } else if (stream.includes('@kline')) {
        const kline = payload.k;
        if (kline) {
          this.klineStore.upsertCandle(kline.s, kline.i, kline);
          this.tickerCache.updateTicker(kline.s, kline.c);
          if (kline.x && this.onCandleClose) this.onCandleClose(kline.s).catch(() => {});
        }
      } else if (stream.includes('@ticker')) {
        // Seed ticker cache from symbol-specific ticker stream
        this.tickerCache.updateTicker(payload.s, payload.c, payload.q, payload.o);
      } else if (stream.includes('@markPrice')) {
        // Authoritative real-time mark price for PnL
        this.tickerCache.updateTicker(payload.s, undefined, undefined, undefined, payload.p);
      }
    } catch (err) {
      this.logger.error(`Error processing stream message: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async rebuildCombinedKlineStream() {
    const mode = this.sessionState.config?.trading_mode || (this.sessionState.config?.paper_mode ? 'paper' : 'live');
    const isTestnet = mode === 'testnet';
    const wsBaseMarket = isTestnet
        ? 'wss://fstream.binancefuture.com/stream'
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

    // Stop all existing kline managers
    for (const manager of this.klineManagers) {
        await manager.stop();
    }
    this.klineManagers = [];

    if (allStreams.length === 0) return;

    // Industry 2026: Chunk into separate connections of max 200 streams each
    const CHUNK_SIZE = 200;
    for (let i = 0; i < allStreams.length; i += CHUNK_SIZE) {
        const chunk = allStreams.slice(i, i + CHUNK_SIZE);
        this.logger.debug(`[MarketFeed] Initializing kline manager for chunk of ${chunk.length} streams...`);

        const manager = new BinanceSubscriptionManager(
            wsBaseMarket,
            {
                isTestnet,
                onMessage: (data) => this.processStreamMessage(data)
            }
        );
        this.klineManagers.push(manager);
        await manager.connect();
        await manager.subscribe(chunk);
    }
  }

  private parseIntervalToMs(interval: string): number {
    const unit = interval.slice(-1);
    const value = parseInt(interval.slice(0, -1), 10);
    switch (unit) {
      case 'm': return value * 60 * 1000;
      case 'h': return value * 60 * 60 * 1000;
      case 'd': return value * 24 * 60 * 60 * 1000;
      default: return 60 * 1000;
    }
  }

  private async processBackfillQueue() {
    if (this.backfillProcessing || this.backfillQueue.length === 0) return;
    this.backfillProcessing = true;

    // SRE: Prioritize symbols with active positions in the backfill queue
    const activeSymbols = new Set(this.sessionState.activeTrades.map(t => t.symbol));
    this.backfillQueue.sort((a, b) => {
      const aActive = activeSymbols.has(a.symbol) ? 1 : 0;
      const bActive = activeSymbols.has(b.symbol) ? 1 : 0;
      return bActive - aActive; // Active positions first
    });

    const initialDepth = this.backfillQueue.length;
    const startWeight = this.sessionState.binanceRateLimit.used_1m;
    const startTime = Date.now();
    this.logger.log(`Starting prioritized sequential kline backfill queue. Depth: ${initialDepth} | Current Weight: ${startWeight}`);

    // STRATEGY: Sequential backfill to avoid rate-limit bursts
    while (this.backfillQueue.length > 0 && this.running) {
      // SRE: Highly aggressive rate limit for background tasks (50% of limit threshold)
      // This preserves weight for critical entry/exit operations.
      const rateLimit = this.sessionState.getBinanceRateLimit();
      const usedWeight = Number(rateLimit.used_weight_1m || 0);
      const limit = Number(rateLimit.weight_limit || ENGINE_CONSTANTS.BINANCE_RATE_LIMIT_DEFAULT);

      // SRE: Defensive guard against NaN to prevent 0ms delay hammers
      const usageRatio = (limit > 0) ? (usedWeight / limit) : 0;
      const safeUsageRatio = Number.isFinite(usageRatio) ? usageRatio : 0;

      const pauseThreshold = Math.floor(limit * 0.5);

      if (usedWeight > pauseThreshold) {
        // SRE: Window Awareness Fallback. If we are > 50% and near the end of the minute,
        // wait for the rollover instead of a long fixed 10s sleep.
        const secondsInMinute = new Date().getSeconds();
        if (secondsInMinute > 45) {
           const waitMs = (60 - secondsInMinute + 1) * 1000;
           this.logger.warn(`Backfill pausing: High weight (${usedWeight}/${limit}) near window end. Waiting ${waitMs}ms for rollover...`);
           await new Promise(resolve => setTimeout(resolve, waitMs));
           continue;
        }

        this.logger.warn(`Backfill queue pausing to preserve IP reputation (Weight: ${usedWeight}/${limit})...`);
        await new Promise(resolve => setTimeout(resolve, 10000)); // Normal backoff
        continue;
      }

      const task = this.backfillQueue.shift();
      if (task) {
        try {
          await this.backfillKlines(task.symbol, task.interval);
        } catch (err: any) {
          const msg = err.message || '';
          const isBan = msg.includes('banned') || msg.includes('418');
          const isRateLimit = msg.includes('429');

          if (isBan || isRateLimit) {
             this.logger.warn(`Critical API issue detected during backfill: ${msg}. Purging ${this.backfillQueue.length} items from backfill queue.`);
             this.backfillQueue = [];
             break; // Exit the while loop immediately
          }
          this.logger.error(`Backfill failed for ${task.symbol} ${task.interval}: ${msg}`);
        }

        // SRE: Adaptive gap between sequential requests to smooth out weight consumption.
        // Scaled by current usage ratio to proactively slow down background load.
        // BOLT: Increased base delay to 500ms and max scale to +3s for safer IP reputation.
        const baseDelay = 500;
        const adaptiveDelay = baseDelay + (safeUsageRatio * 3000);
        const finalDelay = Number.isFinite(adaptiveDelay) ? adaptiveDelay : baseDelay;

        await new Promise(resolve => setTimeout(resolve, finalDelay + Math.random() * 500));
      }
    }
    this.backfillProcessing = false;
    const endWeight = this.sessionState.binanceRateLimit.used_1m;
    const duration = (Date.now() - startTime) / 1000;
    // SRE: Weight Used is an approximation. If duration > 60s, the used_1m window has rolled over.
    const weightUsed = duration > 60 ? 'Window Rolled' : (endWeight - startWeight);
    this.logger.log(`Sequential kline backfill complete. Duration: ${duration.toFixed(1)}s | Weight Used: ${weightUsed} (Total: ${endWeight})`);
  }

  private async backfillKlines(symbol: string, interval: string) {
    const requiredWarmup = this.sessionState.config ? this.signalEngine.getRequiredWarmup(this.sessionState.config) : 100;

    // ARCHITECTURAL OPTIMIZATION: Try loading from local DB first to eliminate redundant REST calls.
    let existingCandles = await this.klineStore.getRecentCandles(symbol, interval, requiredWarmup);

    if (existingCandles.length < requiredWarmup) {
       this.logger.debug(`[MarketFeed] Low local memory cache for ${symbol} ${interval}. Checking database...`);
       const loadedCount = await this.klineStore.loadFromDb(symbol, interval, requiredWarmup);
       if (loadedCount > 0) {
          this.logger.log(`[MarketFeed] Successfully restored ${loadedCount} candles from local DB for ${symbol} ${interval}.`);
          existingCandles = await this.klineStore.getRecentCandles(symbol, interval, requiredWarmup);
       }
    }

    if (existingCandles.length >= requiredWarmup) {
      const lastCandle = existingCandles[0];
      const intervalMs = this.parseIntervalToMs(interval);
      // If the most recent candle is still fresh enough, skip backfill
      if (lastCandle.time + intervalMs >= Date.now() - (intervalMs * 2)) {
        this.logger.debug(`Skipping kline backfill for ${symbol} ${interval}: Already have ${existingCandles.length}/${requiredWarmup} candles and data is fresh.`);
        return;
      }
    } else {
      this.logger.log(`Backfilling klines for ${symbol} ${interval}: Have ${existingCandles.length}, need ${requiredWarmup} for warmup.`);
    }

    await new Promise(resolve => setTimeout(resolve, Math.random() * ENGINE_CONSTANTS.BACKFILL_MAX_JITTER_MS));
    try {
      this.monitoringService.incrementApiRequests();
      let klines: any[][];

      if (this.binanceClient) {
        const response = await this.binanceClient.restAPI.klineCandlestickData({
          symbol,
          interval: interval as any,
          limit: this.klineStore.getMaxCandles()
        });
        this.updateWeight(response.headers);
        klines = (await response.data()) as any[][];
      } else {
        const url = `${ENGINE_CONSTANTS.BINANCE_REST_BASE}/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${this.klineStore.getMaxCandles()}`;
        const response = await this.binanceClientFactory.genericRequest(
          () => fetch(url, { signal: AbortSignal.timeout(10000) }),
          'klineCandlestickData'
        );
        if (!response.ok) return;
        klines = (await response.json()) as any[][];
      }

      if (Array.isArray(klines)) await this.klineStore.seedFromRest(symbol, interval, klines);
    } catch (err) {
      this.logger.error(`Kline backfill failed for ${symbol}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
