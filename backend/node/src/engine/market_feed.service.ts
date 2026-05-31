import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import WebSocket from 'ws';
import { SessionConfig } from '../models/SessionConfig';
import { TickerCacheService } from './ticker_cache.service';
import { KlineStoreService } from './kline_store.service';
import { TradingSessionService } from './trading_session.service';
import { MonitoringService } from './monitoring.service';

const BINANCE_WS_BASE = 'wss://fstream.binance.com/market';

interface BinanceKline {
  stream?: string;
  data?: {
    k: {
      t: number;
      T: number;
      s: string;
      i: string;
      f: number;
      L: number;
      o: string;
      c: string;
      h: string;
      l: string;
      v: string;
      n: number;
      x: boolean;
      q: string;
      V: string;
      Q: string;
    };
  };
}

@Injectable()
export class MarketFeedService {
  private readonly logger = new Logger(MarketFeedService.name);
  private running = false;
  private miniTickerWs: WebSocket | null = null;
  private combinedKlineWsList: WebSocket[] = [];
  private activeWatchlist: Map<string, Set<string>> = new Map(); // symbol -> Set of intervals
  private subscriptionTasks: any[] = [];
  private onCandeClose: ((symbol: string) => Promise<void>) | null = null;
  private watchlistInterval: NodeJS.Timeout | null = null;

  constructor(
    private tickerCache: TickerCacheService,
    private klineStore: KlineStoreService,
    @Inject(forwardRef(() => TradingSessionService))
    private tradingSession: TradingSessionService,
    private monitoringService: MonitoringService,
  ) {}

  setCandeCloseCallback(cb: (symbol: string) => Promise<void>) {
    this.onCandeClose = cb;
  }

  async start(config: SessionConfig) {
    this.running = true;
    if (config.debug_mode) {
      this.logger.verbose('MarketFeed starting');
    }

    // Start !miniTicker@arr stream first
    this.startMiniTickerStream();

    // Prioritize WebSocket for initial data. Fallback to REST only if WS is slow.
    const waitForWs = new Promise<void>((resolve) => {
      const check = setInterval(() => {
        if (this.tickerCache.getCacheSize() > 0) {
          clearInterval(check);
          this.logger.verbose('Initial tickers populated from WebSocket');
          resolve();
        }
      }, 100);
      
      // 5s timeout for fallback
      setTimeout(() => {
        clearInterval(check);
        resolve();
      }, 5000);
    });

    await waitForWs;

    if (this.tickerCache.getCacheSize() === 0) {
      this.logger.verbose('WebSocket data not received yet, falling back to REST seeding');
      await this.fetchInitialTickers();
    }

    // Start watchlist manager
    this.startWatchlistManager(config);

    this.logger.verbose('MarketFeed started');
  }

  private updateWeight(headers: Headers) {
    const weight = headers.get('X-MBX-USED-WEIGHT-1M');
    if (weight) {
      this.tradingSession.updateRateLimit(parseInt(weight));
    }
  }

  private async fetchInitialTickers() {
    this.logger.verbose('Fetching initial tickers from Binance REST API...');
    try {
      this.monitoringService.incrementApiRequests();
      const response = await fetch('https://fapi.binance.com/fapi/v1/ticker/24hr');
      this.updateWeight(response.headers);

      if (response.ok) {
        const tickers = await response.json();
        if (Array.isArray(tickers)) {
          const usdtTickers = tickers.filter(t => t.symbol.endsWith('USDT'));
          this.tickerCache.bulkUpdate(usdtTickers);
          this.logger.log(`Seeded ${usdtTickers.length} USDT tickers from REST API`);
        }
      }
    } catch (error) {
      this.logger.warn(`Fetch initial tickers error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private safeClose(ws: WebSocket | null) {
    if (!ws) return;
    try {
      if (ws.readyState === WebSocket.CONNECTING) {
        // Hard terminate if still connecting to avoid "closed before connection established" errors
        ws.terminate();
      } else if (ws.readyState === WebSocket.OPEN) {
        ws.close();
      }
    } catch (err) {
      this.logger.warn(`Error closing WebSocket: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async stop() {
    this.running = false;
    if (this.watchlistInterval) clearInterval(this.watchlistInterval);

    if (this.miniTickerWs) {
      this.safeClose(this.miniTickerWs);
      this.miniTickerWs = null;
    }

    for (const ws of this.combinedKlineWsList) {
      this.safeClose(ws);
    }
    this.combinedKlineWsList = [];

    for (const task of this.subscriptionTasks) {
      clearTimeout(task);
    }
    this.subscriptionTasks = [];

    this.logger.log('MarketFeed stopped');
  }

  private startMiniTickerStream() {
    const connect = () => {
      if (!this.running) return;

      const url = `${BINANCE_WS_BASE}/ws/!miniTicker@arr`;
      const ws = new WebSocket(url, { handshakeTimeout: 15000 });

      ws.on('open', () => {
        if ((this.tradingSession as any).config?.debug_mode) {
          this.logger.log('miniTicker stream connected');
        }
      });

      ws.on('message', (data: Buffer) => {
        try {
          // BOLT: Aggressive CPU optimization - skip full miniTicker processing if in ECO mode
          // and the system is under load (implied by ECO mode being active)
          if (this.tradingSession.isEcoMode()) {
             // In ECO mode, we only process miniTickers if we have active trades
             if (this.tradingSession.getStatus().activeTrades.length === 0) {
                // If no trades and no listeners, we don't need real-time 24h volume for 400+ symbols
                return;
             }
          }

          // BOLT: Direct Buffer parsing to avoid redundant string allocation
          const msg = JSON.parse(data as any);
          let tickers: any[] = Array.isArray(msg) ? msg : (msg.data && Array.isArray(msg.data) ? msg.data : []);
          if (tickers.length > 0) {
            this.tickerCache.bulkUpdate(tickers);
          }
        } catch (err) {
          this.logger.warn(`miniTicker parse error: ${err instanceof Error ? err.message : String(err)}`);
        }
      });

      ws.on('close', () => {
        if (this.running) {
          this.subscriptionTasks.push(setTimeout(() => connect(), 2000));
        }
      });

      ws.on('error', (err) => {
        this.logger.warn(`miniTicker WS error: ${err.message}`);
      });

      this.miniTickerWs = ws;
    };

    connect();
  }

  private startWatchlistManager(config: SessionConfig) {
    this.updateWatchlist(config);
    this.watchlistInterval = setInterval(() => this.updateWatchlist(config), 120000);
    this.watchlistInterval.unref?.();
  }

  async updateWatchlist(config: SessionConfig = (this.tradingSession as any).config) {
    if (!this.running || !config) return;

    try {
      const newWatchlist = new Map<string, Set<string>>();
      const isGated = this.tradingSession.isGated();
      const tradingStatus = this.tradingSession.getStatus();
      const activeTradesForWatchlist = tradingStatus.activeTrades;

      // 1. Global Scanner Symbols (Skip if gated and no active trades to save resources)
      if (config.global_scanner_enabled !== false && !(isGated && activeTradesForWatchlist.length === 0)) {
        let symbols: string[];
        if (config.symbols && config.symbols.length > 0) {
          symbols = config.symbols;
        } else {
          const top = await this.tickerCache.topByVolume(
            config.watchlist_size || 50,
            config.excluded_symbols || [],
          );
          symbols = top.map((t: any) => t.symbol);
        }
        const globalInterval = config.scan_interval || '1m';
        for (const s of symbols) {
          if (!newWatchlist.has(s)) newWatchlist.set(s, new Set());
          newWatchlist.get(s)!.add(globalInterval);
        }
      }

      // 2. Single Symbol Monitor Symbols
      if (config.single_symbol_configs) {
        for (const sc of config.single_symbol_configs) {
          if (!sc.enabled) continue;
          if (!newWatchlist.has(sc.symbol)) newWatchlist.set(sc.symbol, new Set());

          const interval = sc.use_custom_config && sc.custom_config?.scan_interval
            ? sc.custom_config.scan_interval
            : config.scan_interval || '1m';

          newWatchlist.get(sc.symbol)!.add(interval);
        }
      }

      // 3. Active Trade Symbols (CRITICAL for exit signals)
      for (const trade of activeTradesForWatchlist) {
        const t = trade as any;
        if (!newWatchlist.has(t.symbol)) newWatchlist.set(t.symbol, new Set());

        // Add both 1m (default) and strategy interval
        newWatchlist.get(t.symbol)!.add('1m');
        if (config.scan_interval) {
          newWatchlist.get(t.symbol)!.add(config.scan_interval);
        }
        if (t.strategy_config?.scan_interval) {
          newWatchlist.get(t.symbol)!.add(t.strategy_config.scan_interval);
        }
        if (t.strategy_config?.sl_lookback_timeframe) {
          newWatchlist.get(t.symbol)!.add(t.strategy_config.sl_lookback_timeframe);
        }
      }

      // 4. Structural Lookback (Ensure SL data is pre-cached for all potential symbols)
      if (config.sl_lookback_timeframe) {
        for (const [symbol, intervals] of newWatchlist) {
          intervals.add(config.sl_lookback_timeframe);
        }
      }

      // Check if watchlist changed
      let changed = newWatchlist.size !== this.activeWatchlist.size;
      if (!changed) {
        for (const [symbol, intervals] of newWatchlist) {
          const oldIntervals = this.activeWatchlist.get(symbol);
          if (!oldIntervals || oldIntervals.size !== intervals.size || [...intervals].some(i => !oldIntervals.has(i))) {
            changed = true;
            break;
          }
        }
      }

      if (changed) {
        if (config.debug_mode) {
          this.logger.log(`Watchlist changed. Rebuilding combined kline streams for ${newWatchlist.size} symbols.`);
        }
        const prevWatchlist = this.activeWatchlist;
        this.activeWatchlist = newWatchlist;
        await this.rebuildCombinedKlineStream();

        // Backfill new symbol/interval combinations
        for (const [symbol, intervals] of newWatchlist) {
          for (const interval of intervals) {
            const oldIntervals = prevWatchlist.get(symbol);
            if (!oldIntervals || !oldIntervals.has(interval)) {
              await this.backfillKlines(symbol, interval);
            }
          }
        }
      }
    } catch (err) {
      this.logger.warn(`Watchlist update error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async rebuildCombinedKlineStream() {
    for (const ws of this.combinedKlineWsList) {
      this.safeClose(ws);
    }
    this.combinedKlineWsList = [];

    if (this.activeWatchlist.size === 0) return;

    // Flatten watchlist to streams
    const allStreams: string[] = [];
    for (const [symbol, intervals] of this.activeWatchlist) {
      for (const interval of intervals) {
        allStreams.push(`${symbol.toLowerCase()}@kline_${interval}`);
      }
    }

    // Split streams into chunks of 20 to avoid URL length issues
    const CHUNK_SIZE = 20;
    const chunks = [];
    for (let i = 0; i < allStreams.length; i += CHUNK_SIZE) {
      chunks.push(allStreams.slice(i, i + CHUNK_SIZE));
    }
    
    this.logger.debug(`Creating ${chunks.length} kline streams for ${allStreams.length} symbol-interval pairs.`);

    for (const chunk of chunks) {
      const streams = chunk.join('/');
      const url = `${BINANCE_WS_BASE}/stream?streams=${streams}`;
      
      const connect = () => {
        if (!this.running) return;

        const ws = new WebSocket(url, { handshakeTimeout: 15000 });
        let backoff = 2000;

        ws.on('open', () => {
          if ((this.tradingSession as any).config?.debug_mode) {
            this.logger.debug(`Combined kline stream connected for ${chunk.length} symbols`);
          }
        });

        ws.on('message', (data: Buffer) => {
          try {
            // BOLT: Direct Buffer parsing to avoid redundant string allocation
            const msg: BinanceKline = JSON.parse(data as any);
            const kline = msg.data?.k;
            if (kline) {
              const symbol = kline.s;
              const interval = kline.i;
              this.klineStore.upsertCandle(symbol, interval, kline);
              
              // Pro: Immediate price propagation to ticker cache
              // BOLT: Only update price to preserve accurate 24h volume from miniTicker stream
              this.tickerCache.bulkUpdate([{
                s: symbol,
                c: kline.c
              }]);

              if (kline.x && this.onCandeClose) {
                this.onCandeClose(symbol).catch(err => {
                  this.logger.warn(`Candle close callback error for ${symbol}: ${err.message}`);
                });
              }
            }
          } catch (err) {
            this.logger.warn(`Combined kline parse error: ${err instanceof Error ? err.message : String(err)}`);
          }
        });

        ws.on('close', () => {
          if (this.running) {
            this.subscriptionTasks.push(setTimeout(() => connect(), backoff));
            backoff = Math.min(backoff * 1.5, 30000);
          }
        });

        ws.on('error', (err) => {
          this.logger.warn(`Combined kline WS error (${chunk.length} symbols): ${err.message}`);
        });

        this.combinedKlineWsList.push(ws);
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

  private async backfillKlines(symbol: string, interval: string) {
    // Check if we already have data for this symbol/interval to avoid redundant seeding
    // BOLT: Also check if data is stale (older than 2 intervals)
    const existingCandles = await this.klineStore.getRecentCandles(symbol, interval, 1);
    if (existingCandles.length > 0) {
      const lastCandle = existingCandles[0];
      const intervalMs = this.parseIntervalToMs(interval);
      const isStale = Date.now() - lastCandle.time > intervalMs * 2;

      if (!isStale) {
        return;
      }
        if ((this.tradingSession as any).config?.debug_mode) {
          this.logger.log(`Backfilling ${symbol}/${interval}: Existing data is stale`);
        }
    }

    // Basic concurrency limit for backfills: random delay to spread requests
    await new Promise(resolve => setTimeout(resolve, Math.random() * 2000));

    try {
      const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${this.klineStore.getMaxCandles()}`;
      this.monitoringService.incrementApiRequests();
      const response = await fetch(url);
      this.updateWeight(response.headers);
      
      if (response.ok) {
        const klines = await response.json();
        if (Array.isArray(klines)) {
          await this.klineStore.seedFromRest(symbol, interval, klines);
        }
      }
    } catch (error) {
      this.logger.warn(`Backfill failed for ${symbol}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
