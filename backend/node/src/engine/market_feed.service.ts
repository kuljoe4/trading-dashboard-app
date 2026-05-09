import { Injectable, Logger } from '@nestjs/common';
import WebSocket from 'ws';
import { SessionConfig } from '../models/SessionConfig';
import { TickerCacheService } from './ticker_cache.service';
import { KlineStoreService } from './kline_store.service';

const BINANCE_WS_BASE = 'wss://fstream.binance.com';

interface BinanceKline {
  E: number;
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
  ) {}

  setCandeCloseCallback(cb: (symbol: string) => Promise<void>) {
    this.onCandeClose = cb;
  }

  async start(config: SessionConfig) {
    this.running = true;
    this.logger.log('MarketFeed starting');

    // Start !miniTicker@arr stream
    this.startMiniTickerStream();

    // Start watchlist manager
    this.startWatchlistManager(config);

    this.logger.log('MarketFeed started');
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
      const ws = new WebSocket(url, {
        perMessageDeflate: false,
        handshakeTimeout: 5000,
      });

      ws.on('open', () => {
        this.logger.debug('miniTicker stream connected');
        ws.ping();
      });

      ws.on('message', async (data: Buffer) => {
        try {
          const msg = JSON.parse(data.toString());
          const tickers = msg.data || [];
          if (Array.isArray(tickers) && tickers.length > 0) {
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
            await this.subscribeKlineStream(symbol, config.scan_interval);
          }
        }
      } catch (err) {
        this.logger.warn(`Watchlist update error: ${err instanceof Error ? err.message : String(err)}`);
      }
    };

    // Initial update after 2s delay
    this.subscriptionTasks.push(
      setTimeout(updateWatchlist, 2000),
    );

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
        handshakeTimeout: 5000,
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

      ws.on('close', () => {
        this.klineWsMap.delete(symbol);
        if (this.running) {
          this.logger.warn(`Kline stream ${stream} closed, reconnecting in ${backoff}s`);
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
    try {
      const url = `https://fapi.binance.com/fapi/v1/klines`;
      const params = new URLSearchParams({
        symbol,
        interval,
        limit: '100',
      });

      const response = await fetch(`${url}?${params}`);
      if (response.ok) {
        const klines = await response.json();
        if (Array.isArray(klines)) {
          await this.klineStore.seedFromRest(symbol, interval, klines);
          this.logger.debug(`Backfilled ${klines.length} candles for ${symbol}`);
        }
      }
    } catch (error) {
      this.logger.warn(`Backfill failed for ${symbol}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
