import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import WebSocket from 'ws';
import { SessionConfig } from '../models/SessionConfig';
import { TickerCacheService } from './ticker_cache.service';
import { KlineStoreService } from './kline_store.service';
import { TradingSessionService } from './trading_session.service';

const BINANCE_WS_BASE = 'wss://fstream.binance.com';

interface BinanceKline {
  E: number;
  data?: {
    k: BinanceKline['k'];
  };
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
}

@Injectable()
export class MarketFeedService {
  private readonly logger = new Logger(MarketFeedService.name);
  private running = false;
  private miniTickerWs: WebSocket | null = null;
  private klineWsMap: Map<string, WebSocket> = new Map();
  private subscriptionTasks: any[] = [];
  private onCandeClose: ((symbol: string) => Promise<void>) | null = null;
  private watchlistInterval: NodeJS.Timeout | null = null;

  constructor(
    private tickerCache: TickerCacheService,
    private klineStore: KlineStoreService,
    @Inject(forwardRef(() => TradingSessionService))
    private tradingSession: TradingSessionService,
  ) {}

  setCandeCloseCallback(cb: (symbol: string) => Promise<void>) {
    this.onCandeClose = cb;
  }

  async start(config: SessionConfig) {
    this.running = true;
    this.logger.log('MarketFeed starting');

    // Seed initial tickers from REST as fallback for aggregate WS stream
    await this.fetchInitialTickers();

    // Start !miniTicker@arr stream
    this.startMiniTickerStream();

    // Start watchlist manager
    this.startWatchlistManager(config);

    this.logger.log('MarketFeed started');
  }

  private async fetchInitialTickers() {
    this.logger.log('Fetching initial tickers from Binance REST API...');
    try {
      const response = await fetch('https://fapi.binance.com/fapi/v1/ticker/24hr');
      
      const weight = response.headers.get('X-MBX-USED-WEIGHT-1M');
      if (weight) this.tradingSession.updateRateLimit(parseInt(weight));

      if (response.ok) {
        const tickers = await response.json();
        if (Array.isArray(tickers)) {
          // Filter only USDT pairs to keep it focused
          const usdtTickers = tickers.filter(t => t.symbol.endsWith('USDT'));
          await this.tickerCache.bulkUpdate(usdtTickers);
          this.logger.log(`Seeded ${usdtTickers.length} USDT tickers from REST API`);
        }
      } else {
        this.logger.warn(`Failed to fetch initial tickers: ${response.statusText}`);
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

    for (const [symbol, ws] of this.klineWsMap) {
      ws.close();
    }
    this.klineWsMap.clear();

    for (const task of this.subscriptionTasks) {
      clearTimeout(task);
    }
    this.subscriptionTasks = [];

    this.logger.log('MarketFeed stopped');
  }

  private startMiniTickerStream() {
    const connect = () => {
      if (!this.running) return;

      const url = `${BINANCE_WS_BASE}/stream?streams=!miniTicker@arr`;
      const ws = new WebSocket(url, { handshakeTimeout: 15000 });

      ws.on('open', () => {
        this.logger.log('miniTicker stream connected');
      });

      ws.on('message', async (data: Buffer) => {
        try {
          const msg = JSON.parse(data.toString());
          
          // Resilient parsing: handle raw arrays, wrapped objects, or single entries
          let tickers: any[] = [];
          if (Array.isArray(msg)) {
            tickers = msg;
          } else if (msg.data && Array.isArray(msg.data)) {
            tickers = msg.data;
          } else if (msg.data && typeof msg.data === 'object') {
            tickers = [msg.data];
          } else if (typeof msg === 'object' && msg.s) {
            tickers = [msg];
          }

          if (tickers.length > 0) {
            if (this.tickerCache.getCacheSize() <= 1) {
              this.logger.log(`Received first data packet from Binance (${tickers.length} symbols)`);
            }
            await this.tickerCache.bulkUpdate(tickers);
          }
        } catch (err) {
          this.logger.warn(`miniTicker parse error: ${err instanceof Error ? err.message : String(err)}`);
        }
      });

      ws.on('error', (error) => {
        this.logger.warn(`miniTicker WS error: ${error instanceof Error ? error.message : String(error)}`);
      });

      ws.on('close', () => {
        this.logger.warn('miniTicker stream closed, reconnecting in 1s');
        if (this.running) {
          this.subscriptionTasks.push(
            setTimeout(() => connect(), 1000),
          );
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
            config.watchlist_size || 10,
            config.excluded_symbols || [],
          );
          symbols = top.map((t: any) => t.symbol);
        }

        for (const symbol of symbols) {
          if (!this.klineWsMap.has(symbol)) {
            this.logger.log(`Subscribing to kline stream for ${symbol}`);
            await this.subscribeKlineStream(symbol, config.scan_interval);
          }
        }
      } catch (err) {
        this.logger.warn(`Watchlist update error: ${err instanceof Error ? err.message : String(err)}`);
      }
    };

    // Initial update immediately after REST seeding
    updateWatchlist().then(() => this.logger.log('Initial watchlist initialized'));

    // Periodic updates every 60s
    this.watchlistInterval = setInterval(updateWatchlist, 60000);
  }

  private async subscribeKlineStream(symbol: string, interval: string) {
    if (this.klineWsMap.has(symbol)) return;

    const connect = () => {
      if (!this.running) return;

      const stream = `${symbol.toLowerCase()}@kline_${interval}`;
      const url = `${BINANCE_WS_BASE}/stream?streams=${stream}`;
      let backoff = 1;

      const ws = new WebSocket(url, {
        perMessageDeflate: false,
        handshakeTimeout: 15000,
      });

      ws.on('open', () => {
        this.logger.debug(`Kline stream connected: ${stream}`);
        backoff = 1;
        ws.ping();
      });

      ws.on('message', async (data: Buffer) => {
        try {
          const msg: BinanceKline = JSON.parse(data.toString());
          const kline = msg.data?.k;
          if (kline) {
            await this.klineStore.upsertCandle(
              symbol,
              interval,
              kline,
            );

            // Notify on candle close
            if (kline.x && this.onCandeClose) {
              try {
                await this.onCandeClose(symbol);
              } catch (err) {
                this.logger.warn(`Candle close callback error for ${symbol}: ${err instanceof Error ? err.message : String(err)}`);
              }
            }
          }
        } catch (err) {
          this.logger.warn(`Kline parse error for ${stream}: ${err instanceof Error ? err.message : String(err)}`);
        }
      });

      ws.on('error', (error) => {
        this.logger.warn(`Kline WS ${stream} error: ${error instanceof Error ? error.message : String(error)}`);
      });

      ws.on('close', (code, reason) => {
        this.klineWsMap.delete(symbol);
        if (this.running) {
          this.logger.warn(`Kline stream ${stream} closed (Code: ${code}, Reason: ${reason.toString()}), reconnecting in ${backoff}s`);
          this.subscriptionTasks.push(
            setTimeout(connect, backoff * 1000),
          );
          backoff = Math.min(backoff * 2, 30);
        }
      });

      this.klineWsMap.set(symbol, ws);
    };

    connect();

    // Backfill historical data
    await this.backfillKlines(symbol, interval);
  }

  private async backfillKlines(symbol: string, interval: string) {
    this.logger.debug(`Backfilling ${interval} candles for ${symbol}`);
    try {
      const url = `https://fapi.binance.com/fapi/v1/klines`;
      const params = new URLSearchParams({
        symbol,
        interval,
        limit: '100',
      });

      const response = await fetch(`${url}?${params}`);

      const weight = response.headers.get('X-MBX-USED-WEIGHT-1M');
      if (weight) this.tradingSession.updateRateLimit(parseInt(weight));

      if (response.ok) {
        const klines = await response.json();
        if (Array.isArray(klines)) {
          await this.klineStore.seedFromRest(symbol, interval, klines);
          this.logger.debug(`Backfilled ${klines.length} candles for ${symbol}/${interval}`);
        }
      } else {
        this.logger.warn(`Backfill response not ok for ${symbol}/${interval}: ${response.statusText}`);
      }
    } catch (error) {
      this.logger.warn(`Backfill failed for ${symbol}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
