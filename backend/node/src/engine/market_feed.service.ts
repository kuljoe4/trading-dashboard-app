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
  private combinedKlineWs: WebSocket | null = null;
  private activeWatchlist: string[] = [];
  private subscriptionTasks: any[] = [];
  private onCandeClose: ((symbol: string) => Promise<void>) | null = null;
  private watchlistInterval: NodeJS.Timeout | null = null;
  private currentInterval = '1m';

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
    this.currentInterval = config.scan_interval || '1m';
    this.logger.log('MarketFeed starting');

    // Start !miniTicker@arr stream first
    this.startMiniTickerStream();

    // Prioritize WebSocket for initial data. Fallback to REST only if WS is slow.
    const waitForWs = new Promise<void>((resolve) => {
      const check = setInterval(() => {
        if (this.tickerCache.getCacheSize() > 0) {
          clearInterval(check);
          this.logger.log('Initial tickers populated from WebSocket');
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
      this.logger.log('WebSocket data not received yet, falling back to REST seeding');
      await this.fetchInitialTickers();
    }

    // Start watchlist manager
    this.startWatchlistManager(config);

    this.logger.log('MarketFeed started');
  }

  private updateWeight(headers: Headers) {
    const weight = headers.get('X-MBX-USED-WEIGHT-1M');
    if (weight) {
      this.tradingSession.updateRateLimit(parseInt(weight));
    }
  }

  private async fetchInitialTickers() {
    this.logger.log('Fetching initial tickers from Binance REST API...');
    try {
      this.monitoringService.incrementApiRequests();
      const response = await fetch('https://fapi.binance.com/fapi/v1/ticker/24hr');
      this.updateWeight(response.headers);

      if (response.ok) {
        const tickers = await response.json();
        if (Array.isArray(tickers)) {
          const usdtTickers = tickers.filter(t => t.symbol.endsWith('USDT'));
          await this.tickerCache.bulkUpdate(usdtTickers);
          this.logger.log(`Seeded ${usdtTickers.length} USDT tickers from REST API`);
        }
      }
    } catch (error) {
      this.logger.warn(`Fetch initial tickers error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async stop() {
    this.running = false;
    if (this.watchlistInterval) clearInterval(this.watchlistInterval);

    if (this.miniTickerWs) {
      this.miniTickerWs.close();
      this.miniTickerWs = null;
    }

    if (this.combinedKlineWs) {
      this.combinedKlineWs.close();
      this.combinedKlineWs = null;
    }

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
        this.logger.log('miniTicker stream connected');
      });

      ws.on('message', async (data: Buffer) => {
        try {
          const msg = JSON.parse(data.toString());
          let tickers: any[] = Array.isArray(msg) ? msg : (msg.data && Array.isArray(msg.data) ? msg.data : []);
          if (tickers.length > 0) {
            await this.tickerCache.bulkUpdate(tickers);
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

      this.miniTickerWs = ws;
    };

    connect();
  }

  private startWatchlistManager(config: SessionConfig) {
    const updateWatchlist = async () => {
      if (!this.running) return;

      try {
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

        // Check if symbols changed
        const changed = symbols.length !== this.activeWatchlist.length || 
                        symbols.some(s => !this.activeWatchlist.includes(s));

        if (changed) {
          this.logger.log(`Watchlist changed. Rebuilding combined kline stream for ${symbols.length} symbols.`);
          this.activeWatchlist = symbols;
          await this.rebuildCombinedKlineStream();
          
          // Backfill new symbols
          for (const symbol of symbols) {
            await this.backfillKlines(symbol, this.currentInterval);
          }
        }
      } catch (err) {
        this.logger.warn(`Watchlist update error: ${err instanceof Error ? err.message : String(err)}`);
      }
    };

    updateWatchlist();
    this.watchlistInterval = setInterval(updateWatchlist, 60000);
  }

  private async rebuildCombinedKlineStream() {
    if (this.combinedKlineWs) {
      this.combinedKlineWs.close();
      this.combinedKlineWs = null;
    }

    if (this.activeWatchlist.length === 0) return;

    const streams = this.activeWatchlist
      .map(s => `${s.toLowerCase()}@kline_${this.currentInterval}`)
      .join('/');
    
    const url = `${BINANCE_WS_BASE}/stream?streams=${streams}`;
    
    const connect = () => {
      if (!this.running) return;

      const ws = new WebSocket(url, { handshakeTimeout: 15000 });
      let backoff = 2000;

      ws.on('open', () => {
        this.logger.log(`Combined kline stream connected for ${this.activeWatchlist.length} symbols`);
      });

      ws.on('message', async (data: Buffer) => {
        try {
          const msg: BinanceKline = JSON.parse(data.toString());
          const kline = msg.data?.k;
          if (kline) {
            const symbol = kline.s;
            await this.klineStore.upsertCandle(symbol, this.currentInterval, kline);
            
            // Pro: Immediate price propagation to ticker cache
            await this.tickerCache.bulkUpdate([{
              s: symbol,
              c: kline.c,
              v: kline.q
            }]);

            if (kline.x && this.onCandeClose) {
              await this.onCandeClose(symbol);
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
        this.logger.warn(`Combined kline WS error: ${err.message}`);
      });

      this.combinedKlineWs = ws;
    };

    connect();
  }

  private async backfillKlines(symbol: string, interval: string) {
    // Basic concurrency limit for backfills: random delay to spread requests
    await new Promise(resolve => setTimeout(resolve, Math.random() * 2000));

    try {
      const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=100`;
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
