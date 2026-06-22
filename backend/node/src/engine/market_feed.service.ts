import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import WebSocket from 'ws';
import { SessionConfig } from '../models/SessionConfig';
import { ENGINE_CONSTANTS } from '../models/constants';
import { TickerCacheService } from './ticker_cache.service';
import { KlineStoreService } from './kline_store.service';
import { SessionStateService } from './session_state.service';
import { SignalEngineService } from './signalEngine';
import { MonitoringService } from './monitoring.service';
import { ENGINE_EVENTS } from './events';

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
  private readonly logger = new Logger(MarketFeedService.name);
  private running = false;
  private miniTickerWs: WebSocket | null = null;
  private miniTickerReconnecting = false;
  private markTickerWs: WebSocket | null = null;
  private combinedKlineWsList: Set<WebSocket> = new Set();
  private exchangeInfo: Map<string, any> = new Map();
  private lastExchangeInfoFetch = 0;
  private lastExchangeInfoBase = '';
  private activeWatchlist: Map<string, Set<string>> = new Map();
  private subscriptionTasks: any[] = [];
  private onCandleClose: ((symbol: string) => Promise<void>) | null = null;
  private watchlistInterval: NodeJS.Timeout | null = null;
  private watchlistUpdatePending = false;
  private watchlistUpdateTimeout: NodeJS.Timeout | null = null;
  private backfillQueue: { symbol: string, interval: string }[] = [];
  private backfillProcessing = false;

  constructor(
    private tickerCache: TickerCacheService,
    private klineStore: KlineStoreService,
    private sessionState: SessionStateService,
    private signalEngine: SignalEngineService,
    private monitoringService: MonitoringService,
  ) {}

  setCandleCloseCallback(cb: (symbol: string) => Promise<void>) {
    this.onCandleClose = cb;
  }

  async start(config: SessionConfig) {
    if (this.running) await this.stop();
    this.running = true;

    const mode = config.trading_mode || (config.paper_mode ? 'paper' : 'live');
    const restBase = mode === 'testnet'
        ? 'https://demo-fapi.binance.com'
        : ENGINE_CONSTANTS.BINANCE_REST_BASE;

    await this.fetchExchangeInfo(restBase);
    this.startMiniTickerStream();
    this.startMarkTickerStream();

    const waitForWs = new Promise<void>((resolve) => {
      const check = setInterval(() => {
        if (this.tickerCache.getCacheSize() > 0) { clearInterval(check); resolve(); }
      }, 100);
      setTimeout(() => { clearInterval(check); resolve(); }, 5000);
    });

    await waitForWs;
    if (this.tickerCache.getCacheSize() === 0) await this.fetchInitialTickers();
    this.startWatchlistManager(config);
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

  private async fetchExchangeInfo(restBase: string = ENGINE_CONSTANTS.BINANCE_REST_BASE) {
    const now = Date.now();
    if (this.exchangeInfo.size > 0 && this.lastExchangeInfoBase === restBase && now - this.lastExchangeInfoFetch < 3600000) return;
    try {
      this.monitoringService.incrementApiRequests();
      const response = await fetch(`${restBase}/fapi/v1/exchangeInfo`);
      this.updateWeight(response.headers);
      if (response.ok) {
        const data: any = await response.json();

        // Dynamic Rate Limit Detection
        if (data && Array.isArray(data.rateLimits)) {
           const requestWeightLimit = data.rateLimits.find((l: any) => l.rateLimitType === 'REQUEST_WEIGHT' && l.interval === 'MINUTE');
           if (requestWeightLimit) {
              this.sessionState.updateRateLimit(this.sessionState.binanceRateLimit.used_1m, parseInt(requestWeightLimit.limit, 10));
              this.logger.log(`Dynamic Binance Rate Limit detected: ${requestWeightLimit.limit}/min`);
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
          this.exchangeInfo.clear();
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
                this.exchangeInfo.set(s.symbol, parsed);
              } else {
                this.logger.debug(`Filtering out non-crypto symbol: ${s.symbol} (Type: ${s.underlyingType})`);
              }
            }
          }
          this.lastExchangeInfoFetch = now;
          this.lastExchangeInfoBase = restBase;
        }
      }
    } catch (error) {
      this.logger.error(`Failed to fetch exchange info from ${restBase}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  getSymbolFilters(symbol: string) { return this.exchangeInfo.get(symbol); }

  private async fetchInitialTickers() {
    try {
      this.monitoringService.incrementApiRequests();
      const response = await fetch(`${ENGINE_CONSTANTS.BINANCE_REST_BASE}/fapi/v1/ticker/24hr`);
      this.updateWeight(response.headers);
      if (response.ok) {
        const tickers = await response.json();
        if (Array.isArray(tickers)) {
          const usdtTickers = tickers.filter(t => t.symbol.endsWith('USDT'));
          this.tickerCache.bulkUpdate(usdtTickers);
        }
      }
    } catch (error) {}
  }

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

  private startMiniTickerStream() {
    const connect = () => {
      if (!this.running) return;
      const ws = new WebSocket(`${ENGINE_CONSTANTS.BINANCE_WS_BASE}/ws/!miniTicker@arr`, { handshakeTimeout: ENGINE_CONSTANTS.WS_HANDSHAKE_TIMEOUT_MS });
      ws.on('message', (data: Buffer) => {
        if (this.sessionState.isEcoMode(this.running) && this.sessionState.activeTrades.length === 0) return;
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

  private startMarkTickerStream() {
    const connect = () => {
      if (!this.running) return;
      const ws = new WebSocket(`${ENGINE_CONSTANTS.BINANCE_WS_BASE}/ws/!markTicker@arr@1s`, { handshakeTimeout: ENGINE_CONSTANTS.WS_HANDSHAKE_TIMEOUT_MS });
      ws.on('message', (data: Buffer) => {
        if (this.sessionState.isEcoMode(this.running) && this.sessionState.activeTrades.length === 0) return;
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
    } catch (err) {}
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
      for (const interval of intervals) allStreams.push(`${symbol.toLowerCase()}@kline_${interval}`);
    }
    const CHUNK_SIZE = 20;
    const chunks = [];
    for (let i = 0; i < allStreams.length; i += CHUNK_SIZE) chunks.push(allStreams.slice(i, i + CHUNK_SIZE));
    for (const chunk of chunks) {
      const streams = chunk.join('/');
      const url = `${ENGINE_CONSTANTS.BINANCE_WS_BASE}/stream?streams=${streams}`;
      const connect = () => {
        if (!this.running) return;
        const ws = new WebSocket(url, { handshakeTimeout: ENGINE_CONSTANTS.WS_HANDSHAKE_TIMEOUT_MS });
        ws.on('message', (data: Buffer) => {
          try {
            const msg: BinanceKline = JSON.parse(data as any);
            const kline = msg.data?.k;
            if (kline) {
              this.klineStore.upsertCandle(kline.s, kline.i, kline);
              this.tickerCache.updateTicker(kline.s, kline.c);
              if (kline.x && this.onCandleClose) this.onCandleClose(kline.s).catch(() => {});
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
    const initialDepth = this.backfillQueue.length;
    this.logger.log(`Starting concurrent kline backfill queue. Depth: ${initialDepth}`);

    const CONCURRENCY = 5;
    const processTask = async () => {
      while (this.backfillQueue.length > 0 && this.running) {
        // Stricter rate limit for background tasks (80% of limit threshold)
        const rateLimit = this.sessionState.getBinanceRateLimit();
        const usedWeight = rateLimit.used_weight_1m;
        const limit = rateLimit.weight_limit || ENGINE_CONSTANTS.BINANCE_RATE_LIMIT_DEFAULT;
        const pauseThreshold = Math.floor(limit * 0.8);

        if (usedWeight > pauseThreshold) {
          this.logger.debug(`Backfill worker pausing (Weight: ${usedWeight}/${limit})...`);
          await new Promise(resolve => setTimeout(resolve, 5000));
          continue;
        }

        const task = this.backfillQueue.shift();
        if (task) {
          try {
            await this.backfillKlines(task.symbol, task.interval);
          } catch (err) {
            this.logger.error(`Backfill failed for ${task.symbol} ${task.interval}: ${err instanceof Error ? err.message : String(err)}`);
          }
          // Small delay between requests to smooth out weight consumption
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }
    };

    const workers = [];
    for (let i = 0; i < Math.min(CONCURRENCY, initialDepth); i++) {
      // PERFORMANCE: Stagger worker start times to avoid instant peak load
      workers.push((async () => {
        await new Promise(r => setTimeout(r, i * 200));
        return processTask();
      })());
    }

    await Promise.all(workers);
    this.backfillProcessing = false;
    this.logger.log(`Concurrent kline backfill complete.`);
  }

  private async backfillKlines(symbol: string, interval: string) {
    const requiredWarmup = this.sessionState.config ? this.signalEngine.getRequiredWarmup(this.sessionState.config) : 100;
    const existingCandles = await this.klineStore.getRecentCandles(symbol, interval, requiredWarmup);

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
      const url = `${ENGINE_CONSTANTS.BINANCE_REST_BASE}/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${this.klineStore.getMaxCandles()}`;
      this.monitoringService.incrementApiRequests();
      const response = await fetch(url);
      if (response.ok) {
        const klines = await response.json();
        if (Array.isArray(klines)) await this.klineStore.seedFromRest(symbol, interval, klines);
      }
    } catch (err) {
      this.logger.error(`Watchlist update failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
