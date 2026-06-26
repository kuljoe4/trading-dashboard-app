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
import { BinanceRequestQueue } from '../lib/binanceClientFactory';

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
    // SRE: On boot, we don't have a session config yet. We load BOTH Prod and Testnet metadata
    // from the DB into the static cache if available, ensuring zero-latency startup for either.
    await this.fetchExchangeInfo(ENGINE_CONSTANTS.BINANCE_REST_BASE);
    await this.fetchExchangeInfo('https://testnet.binancefuture.com');
  }
  private readonly logger = new Logger(MarketFeedService.name);
  private running = false;
  private miniTickerWs: WebSocket | null = null;
  private miniTickerReconnecting = false;
  private markTickerWs: WebSocket | null = null;
  private combinedKlineWsList: Set<WebSocket> = new Set();
  private static cachedExchangeInfo: Map<string, any> = new Map();
  private static lastExchangeInfoFetch = 0;
  private static lastExchangeInfoBase = '';
  private exchangeInfo: Map<string, any> = MarketFeedService.cachedExchangeInfo;
  private activeWatchlist: Map<string, Set<string>> = new Map();
  private subscriptionTasks: any[] = [];
  private onCandleClose: ((symbol: string) => Promise<void>) | null = null;
  private watchlistInterval: NodeJS.Timeout | null = null;
  private watchlistUpdatePending = false;
  private watchlistUpdateTimeout: NodeJS.Timeout | null = null;
  private backfillQueue: { symbol: string, interval: string }[] = [];
  private backfillProcessing = false;
  private binanceClient: any = null;

  constructor(
    private tickerCache: TickerCacheService,
    private klineStore: KlineStoreService,
    private sessionState: SessionStateService,
    private signalEngine: SignalEngineService,
    private monitoringService: MonitoringService,
    private eventEmitter: EventEmitter2,
    @InjectRepository(SettingsEntity)
    private readonly settingsRepository: Repository<SettingsEntity>,
  ) {}

  setCandleCloseCallback(cb: (symbol: string) => Promise<void>) {
    this.onCandleClose = cb;
  }

  async start(config: SessionConfig, bc?: any) {
    if (bc) this.binanceClient = bc;
    if (this.running) await this.stop();
    this.running = true;

    const mode = config.trading_mode || (config.paper_mode ? 'paper' : 'live');
    const isTestnet = mode === 'testnet';
    const restBase = isTestnet
        ? 'https://testnet.binancefuture.com' // Corrected Testnet URL
        : ENGINE_CONSTANTS.BINANCE_REST_BASE;

    const wsBasePublic = isTestnet
        ? 'wss://fstream.binancefuture.com/ws'
        : ENGINE_CONSTANTS.BINANCE_WS_PUBLIC;

    const wsBaseMarket = isTestnet
        ? 'wss://fstream.binancefuture.com/stream'
        : ENGINE_CONSTANTS.BINANCE_WS_MARKET;

    // RESEARCH-02: Optimized Startup. loadFromDb() called via fetchExchangeInfo()
    // will now be called before any session start.
    await this.fetchExchangeInfo(restBase);

    this.startMiniTickerStream(wsBasePublic);
    this.startMarkTickerStream(wsBasePublic);

    // RESEARCH: "Cold Start" mitigation. We wait for WS to populate the ticker cache.
    // If it's still empty after a grace period, we perform a one-time REST fetch to ensure the watchlist isn't 0.
    // BOLT: Even if not empty, we trigger a re-evaluation after 15s to ensure the UI updates from 0 monitored symbols.
    setTimeout(async () => {
       if (!this.running) return;
       if (this.tickerCache.getCacheSize() === 0) {
          this.logger.warn(`[MarketFeed] Ticker cache empty after 15s WS wait. Falling back to REST fetchInitialTickers (Weight 40)...`);
          await this.fetchInitialTickers(restBase);
       } else {
          this.logger.log(`[MarketFeed] WS Seeding successful. Ticker cache size: ${this.tickerCache.getCacheSize()}. Triggering watchlist re-evaluation.`);
          this.eventEmitter.emit(ENGINE_EVENTS.WATCHLIST_NEEDS_UPDATE);
       }
    }, 15000);

    this.startWatchlistManager(config);
  }

  private async fetchInitialTickers(restBase: string) {
    try {
      this.monitoringService.incrementApiRequests();
      let data: any[];

      if (this.binanceClient) {
        const response = await this.binanceClient.restAPI.ticker24hrPriceChangeStatistics();
        this.updateWeight(response.headers);
        data = await response.data();
      } else {
        const response = await fetch(`${restBase}/fapi/v1/ticker/24hr`);
        this.updateWeight(response.headers);
        if (!response.ok) return;
        data = await response.json() as any[];
      }

      if (Array.isArray(data)) {
        this.tickerCache.bulkUpdate(data);
        this.logger.log(`[MarketFeed] Ticker cache seeded via REST: ${data.length} symbols.`);
        // Proactively trigger watchlist update now that we have data
        this.eventEmitter.emit(ENGINE_EVENTS.WATCHLIST_NEEDS_UPDATE);
      }
    } catch (err) {
      this.logger.error(`Failed to fetch initial tickers: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  public updateWeight(headers: any) {
    if (!headers) return;
    const weight = typeof headers.get === 'function' ? headers.get('X-MBX-USED-WEIGHT-1M') : (headers['x-mbx-used-weight-1m'] || headers['X-MBX-USED-WEIGHT-1M']);
    if (weight) {
      const currentWeight = parseInt(weight, 10);
      this.logger.debug(`Binance Weight Update: ${currentWeight}`);
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
      return;
    }

    try {
      this.monitoringService.incrementApiRequests();

      let data: any;
      if (this.binanceClient) {
        this.logger.debug(`[MarketFeed] Fetching fresh exchange information from SDK...`);
        const response = await this.binanceClient.restAPI.exchangeInformation();
        this.updateWeight(response.headers);
        data = await response.data();
      } else {
        this.logger.debug(`[MarketFeed] Fetching fresh exchange information via fetch...`);
        const response = await fetch(`${restBase}/fapi/v1/exchangeInfo`);
        this.updateWeight(response.headers);
        if (!response.ok) return;
        data = await response.json();
      }

      if (data) {

        // Dynamic Rate Limit Detection
        if (data && Array.isArray(data.rateLimits)) {
           const requestWeightLimit = data.rateLimits.find((l: any) => l.rateLimitType === 'REQUEST_WEIGHT' && l.interval === 'MINUTE');
           if (requestWeightLimit) {
              const limit = parseInt(requestWeightLimit.limit, 10);
              this.sessionState.updateRateLimit(this.sessionState.binanceRateLimit.used_1m, limit);
              // SRE Overwatch: Synchronize dynamic limit to the centralized gateway queue
              BinanceRequestQueue.setWeightLimit(limit);
              this.logger.log(`Dynamic Binance Rate Limit detected: ${limit}/min`);
           }

           const orderLimit10s = data.rateLimits.find((l: any) => l.rateLimitType === 'ORDERS' && l.interval === 'SECOND' && l.intervalNum === 10);
           const orderLimit1m = data.rateLimits.find((l: any) => l.rateLimitType === 'ORDERS' && l.interval === 'MINUTE');

           if (orderLimit10s || orderLimit1m) {
              this.sessionState.updateOrderRateLimits(null, {
                limit10s: orderLimit10s ? parseInt(orderLimit10s.limit, 10) : undefined,
                limit1m: orderLimit1m ? parseInt(orderLimit1m.limit, 10) : undefined
              });
              this.logger.log(`Dynamic Binance Order Limits: 10s=${orderLimit10s?.limit}, 1m=${orderLimit1m?.limit}`);
           }
        }

        if (data && Array.isArray(data.symbols)) {
          MarketFeedService.cachedExchangeInfo.clear();
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
                      parsed.tickSize = parseFloat(f.tickSize);
                      parsed.pricePrecision = Math.max(0, Math.round(-Math.log10(parsed.tickSize)));
                    } else if (f.filterType === 'LOT_SIZE') {
                      parsed.stepSize = parseFloat(f.stepSize);
                      parsed.qtyPrecision = Math.max(0, Math.round(-Math.log10(parsed.stepSize)));
                    } else if (f.filterType === 'MARKET_LOT_SIZE') {
                      parsed.marketMaxQty = parseFloat(f.maxQty);
                      parsed.marketMinQty = parseFloat(f.minQty);
                    } else if (f.filterType === 'PERCENT_PRICE') {
                      parsed.multiplierUp = parseFloat(f.multiplierUp || '1.1');
                      parsed.multiplierDown = parseFloat(f.multiplierDown || '0.9');
                    } else if (f.filterType === 'MIN_NOTIONAL' || f.filterType === 'NOTIONAL') {
                      parsed.minNotional = parseFloat(f.notional || f.minNotional || '0');
                    }
                  }
                }
                MarketFeedService.cachedExchangeInfo.set(s.symbol, parsed);
              } else {
                this.logger.debug(`Filtering out non-crypto symbol: ${s.symbol} (Type: ${s.underlyingType})`);
              }
            }
          }
          MarketFeedService.lastExchangeInfoFetch = now;
          MarketFeedService.lastExchangeInfoBase = restBase;
          this.exchangeInfo = MarketFeedService.cachedExchangeInfo;
          this.logger.log(`[MarketFeed] Exchange information cached and persisted: ${this.exchangeInfo.size} symbols.`);

          // RESEARCH-02: Persist to DB
          const cacheObj: any = {};
          MarketFeedService.cachedExchangeInfo.forEach((val, key) => { cacheObj[key] = val; });
          await this.settingsRepository.update('default', {
            exchange_info_cache: cacheObj,
            exchange_info_ts: now
          });
        }
      }
    } catch (error) {
      this.logger.error(`Failed to fetch exchange info from ${restBase}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  getSymbolFilters(symbol: string) { return this.exchangeInfo.get(symbol); }

  private safeClose(ws: WebSocket | null) {
    if (!ws) return;
    try {
      // Only terminate if it's OPEN or CLOSING. 
      // If it's CONNECTING, 'close()' is safer to avoid "WebSocket closed before connection established" error.
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CLOSING) {
        ws.terminate();
      } else if (ws.readyState === WebSocket.CONNECTING) {
        ws.close();
      }
    } catch (err) {
      this.logger.debug(`Error during safeClose: ${err}`);
    }
  }

  async stop() {
    this.running = false;
    if (this.watchlistInterval) clearInterval(this.watchlistInterval);
    if (this.watchlistUpdateTimeout) clearTimeout(this.watchlistUpdateTimeout);

    this.miniTickerReconnecting = true; // Block reconnection during stop
    if (this.miniTickerWs) {
      this.safeClose(this.miniTickerWs);
      this.miniTickerWs = null;
    }
    if (this.markTickerWs) {
      this.safeClose(this.markTickerWs);
      this.markTickerWs = null;
    }

    for (const ws of this.combinedKlineWsList) {
      (ws as any)._isExplicitClose = true;
      this.safeClose(ws);
    }
    this.combinedKlineWsList.clear();

    for (const task of this.subscriptionTasks) clearTimeout(task);
    this.subscriptionTasks = [];
    this.exchangeInfo.clear();
    this.activeWatchlist.clear();
    this.logger.verbose('MarketFeedService: Resources cleared');
  }

  private startMiniTickerStream(wsBase: string = ENGINE_CONSTANTS.BINANCE_WS_PUBLIC) {
    const connect = () => {
      if (!this.running) return;
      const url = `${wsBase}/!miniTicker@arr`;
      const ws = new WebSocket(url, { handshakeTimeout: ENGINE_CONSTANTS.WS_HANDSHAKE_TIMEOUT_MS });

      ws.on('error', (err) => {
        this.logger.error(`Mini-ticker stream error: ${err.message}`);
      });

      ws.on('unexpected-response', (req, res) => {
        this.logger.error(`Mini-ticker WS unexpected response: ${res.statusCode} ${res.statusMessage}`);
      });

      ws.on('message', (data: Buffer) => {
        // BOLT: Even in Eco Mode, we must populate the cache if it's currently empty to allow the first watchlist re-evaluation.
        const cacheEmpty = this.tickerCache.getCacheSize() === 0;
        if (this.sessionState.isEcoMode(this.running) && this.sessionState.activeTrades.length === 0 && !cacheEmpty) return;
        try {
          const msg = JSON.parse(data as any);
          let tickers: any[] = Array.isArray(msg) ? msg : (msg.data && Array.isArray(msg.data) ? msg.data : []);
          if (tickers.length > 0) this.tickerCache.bulkUpdate(tickers);
        } catch (err) {
          this.logger.error(`Error processing mini-ticker stream: ${err instanceof Error ? err.message : String(err)}`);
        }
      });
      ws.on('close', () => {
        this.miniTickerWs = null;
        if (this.running && !this.miniTickerReconnecting) {
          this.logger.debug('Mini-ticker stream closed. Reconnecting...');
          const timeout = setTimeout(() => {
            this.subscriptionTasks = this.subscriptionTasks.filter(t => t !== timeout);
            connect();
          }, ENGINE_CONSTANTS.WS_RECONNECT_DELAY_MS);
          this.subscriptionTasks.push(timeout);
        }
      });
      this.miniTickerWs = ws;
    };
    connect();
  }

  private startMarkTickerStream(wsBase: string = ENGINE_CONSTANTS.BINANCE_WS_PUBLIC) {
    const connect = () => {
      if (!this.running) return;
      const url = `${wsBase}/!markTicker@arr@1s`;
      const ws = new WebSocket(url, { handshakeTimeout: ENGINE_CONSTANTS.WS_HANDSHAKE_TIMEOUT_MS });

      ws.on('error', (err) => {
        this.logger.error(`Mark-ticker stream error: ${err.message}`);
      });

      ws.on('message', (data: Buffer) => {
        const cacheEmpty = this.tickerCache.getCacheSize() === 0;
        if (this.sessionState.isEcoMode(this.running) && this.sessionState.activeTrades.length === 0 && !cacheEmpty) return;
        try {
          const msg = JSON.parse(data as any);
          const updates = Array.isArray(msg) ? msg : (msg.data && Array.isArray(msg.data) ? msg.data : []);
          for (const u of updates) {
            // Field 'p' is Mark Price in !markTicker@arr
            this.tickerCache.updateTicker(u.s, undefined, undefined, undefined, u.p);
          }
        } catch (err) {
          this.logger.error(`Error processing mark-ticker stream: ${err instanceof Error ? err.message : String(err)}`);
        }
      });
      ws.on('close', () => {
        this.markTickerWs = null;
        if (this.running) this.subscriptionTasks.push(setTimeout(() => connect(), ENGINE_CONSTANTS.WS_RECONNECT_DELAY_MS));
      });
      this.markTickerWs = ws;
    };
    connect();
  }

  private startWatchlistManager(config: SessionConfig) {
    if (this.watchlistInterval) clearInterval(this.watchlistInterval);
    this.updateWatchlist(config);
    this.watchlistInterval = setInterval(() => this.updateWatchlist(config), ENGINE_CONSTANTS.WATCHLIST_REFRESH_INTERVAL_MS);
    this.watchlistInterval.unref?.();
  }

  @OnEvent(ENGINE_EVENTS.WATCHLIST_NEEDS_UPDATE)
  async updateWatchlist(config: SessionConfig = this.sessionState.config!) {
    if (!this.running || !config) return;
    if (this.watchlistUpdatePending) return;
    if (this.watchlistUpdateTimeout) clearTimeout(this.watchlistUpdateTimeout);
    this.watchlistUpdateTimeout = setTimeout(async () => {
      this.watchlistUpdatePending = true;
      try { await this.executeWatchlistUpdate(config); } finally {
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

      if (config.global_scanner_enabled !== false && !(isGated && activeTrades.length === 0)) {
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
          if (!newWatchlist.has(sc.symbol)) newWatchlist.set(sc.symbol, new Set());
          const interval = sc.use_custom_config && sc.custom_config?.scan_interval ? sc.custom_config.scan_interval : config.scan_interval || '1m';
          newWatchlist.get(sc.symbol)!.add(interval);
        }
      }

      for (const trade of activeTrades) {
        const t = trade as any;
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

      if (changed) {
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

      this.logger.log(`[MarketFeed] Watchlist updated: ${this.activeWatchlist.size} symbols monitored.`);
    } catch (err) {
      this.logger.error(`[MarketFeed] Watchlist update failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async rebuildCombinedKlineStream() {
    for (const ws of this.combinedKlineWsList) {
      (ws as any)._isExplicitClose = true;
      this.safeClose(ws);
    }
    this.combinedKlineWsList.clear();
    if (this.activeWatchlist.size === 0) return;

    const allStreams: string[] = [];
    for (const [symbol, intervals] of this.activeWatchlist) {
      const s = symbol.toLowerCase();
      // BOLT: Subscription Strategy for HF Data (2026)
      // 1. @ticker: For general momentum/scanner volume tracking.
      // 2. @markPrice: High-frequency mark price for real-time PnL accuracy on active positions.
      allStreams.push(`${s}@ticker`);

      const isActiveTrade = this.sessionState.activeTrades.some(t => t.symbol === symbol);
      if (isActiveTrade) {
        allStreams.push(`${s}@markPrice@1s`);
      }

      for (const interval of intervals) {
        allStreams.push(`${s}@kline_${interval}`);
      }
    }

    const CHUNK_SIZE = ENGINE_CONSTANTS.KLINE_STREAM_CHUNK_SIZE || 20;
    const chunks = [];
    for (let i = 0; i < allStreams.length; i += CHUNK_SIZE) chunks.push(allStreams.slice(i, i + CHUNK_SIZE));
    const isTestnet = this.sessionState.config?.trading_mode === 'testnet';
    const wsBaseMarket = isTestnet
        ? 'wss://fstream.binancefuture.com/stream'
        : ENGINE_CONSTANTS.BINANCE_WS_MARKET;

    for (const chunk of chunks) {
      const streams = chunk.join('/');
      const url = `${wsBaseMarket}?streams=${streams}`;
      const connect = () => {
        if (!this.running) return;
        this.logger.debug(`[MarketFeed] Connecting to combined stream: ${url.split('?')[0]}?streams=${chunk.length} items`);

        const ws = new WebSocket(url, { handshakeTimeout: ENGINE_CONSTANTS.WS_HANDSHAKE_TIMEOUT_MS });
        ws.on('message', (data: Buffer) => {
          try {
            const msg: any = JSON.parse(data as any);
            const stream = msg.stream || '';
            const payload = msg.data;

            if (stream.includes('@kline')) {
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
            this.logger.error(`Error processing combined kline stream: ${err instanceof Error ? err.message : String(err)}`);
          }
        });
        ws.on('close', () => {
          if (this.running && !(ws as any)._isExplicitClose) {
            this.logger.debug('Combined kline stream closed. Reconnecting...');
            const timeout = setTimeout(() => {
              this.subscriptionTasks = this.subscriptionTasks.filter(t => t !== timeout);
              connect();
            }, ENGINE_CONSTANTS.WS_RECONNECT_DELAY_MS);
            this.subscriptionTasks.push(timeout);
          }
        });
        this.combinedKlineWsList.add(ws);
      };
      connect();
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
    this.logger.log(`Starting prioritized sequential kline backfill queue. Depth: ${initialDepth}`);

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
        } catch (err) {
          this.logger.error(`Backfill failed for ${task.symbol} ${task.interval}: ${err instanceof Error ? err.message : String(err)}`);
        }

        // SRE: Adaptive gap between sequential requests to smooth out weight consumption.
        // Scaled by current usage ratio to proactively slow down background load.
        const baseDelay = 300;
        const adaptiveDelay = baseDelay + (safeUsageRatio * 2000); // Scale up to +2s at high usage
        const finalDelay = Number.isFinite(adaptiveDelay) ? adaptiveDelay : baseDelay;

        await new Promise(resolve => setTimeout(resolve, finalDelay + Math.random() * 300));
      }
    }
    this.backfillProcessing = false;
    this.logger.log(`Sequential kline backfill complete.`);
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
      let klines: any[];

      if (this.binanceClient) {
        const response = await this.binanceClient.restAPI.klineCandlestickData({
          symbol,
          interval: interval as any,
          limit: this.klineStore.getMaxCandles()
        });
        this.updateWeight(response.headers);
        klines = await response.data();
      } else {
        const url = `${ENGINE_CONSTANTS.BINANCE_REST_BASE}/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${this.klineStore.getMaxCandles()}`;
        const response = await fetch(url);
        this.updateWeight(response.headers);
        if (!response.ok) return;
        klines = await response.json() as any[];
      }

      if (Array.isArray(klines)) await this.klineStore.seedFromRest(symbol, interval, klines);
    } catch (err) {
      this.logger.error(`Kline backfill failed for ${symbol}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
