import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import WebSocket from 'ws';
import { SessionConfig } from '../models/SessionConfig';
import { ENGINE_CONSTANTS } from '../models/constants';
import { TickerCacheService } from './ticker_cache.service';
import { KlineStoreService } from './kline_store.service';
import { SessionStateService } from './session_state.service';
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
  private combinedKlineWsList: WebSocket[] = [];
  private exchangeInfo: Map<string, any> = new Map();
  private lastExchangeInfoFetch = 0;
  private activeWatchlist: Map<string, Set<string>> = new Map();
  private subscriptionTasks: any[] = [];
  private onCandeClose: ((symbol: string) => Promise<void>) | null = null;
  private watchlistInterval: NodeJS.Timeout | null = null;
  private watchlistUpdatePending = false;
  private watchlistUpdateTimeout: NodeJS.Timeout | null = null;

  constructor(
    private tickerCache: TickerCacheService,
    private klineStore: KlineStoreService,
    private sessionState: SessionStateService,
    private monitoringService: MonitoringService,
  ) {}

  setCandeCloseCallback(cb: (symbol: string) => Promise<void>) {
    this.onCandeClose = cb;
  }

  async start(config: SessionConfig) {
    if (this.running) await this.stop();
    this.running = true;
    await this.fetchExchangeInfo();
    this.startMiniTickerStream();

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

  private updateWeight(headers: Headers) {
    const weight = headers.get('X-MBX-USED-WEIGHT-1M');
    if (weight) this.sessionState.updateRateLimit(parseInt(weight));
  }

  private async fetchExchangeInfo() {
    const now = Date.now();
    if (this.exchangeInfo.size > 0 && now - this.lastExchangeInfoFetch < 3600000) return;
    try {
      this.monitoringService.incrementApiRequests();
      const response = await fetch(`${ENGINE_CONSTANTS.BINANCE_REST_BASE}/fapi/v1/exchangeInfo`);
      this.updateWeight(response.headers);
      if (response.ok) {
        const data: any = await response.json();
        if (data && Array.isArray(data.symbols)) {
          this.exchangeInfo.clear();
          for (const s of data.symbols) this.exchangeInfo.set(s.symbol, s);
          this.lastExchangeInfoFetch = now;
        }
      }
    } catch (error) {}
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
    if (this.miniTickerWs) { this.safeClose(this.miniTickerWs); this.miniTickerWs = null; }
    for (const ws of this.combinedKlineWsList) this.safeClose(ws);
    this.combinedKlineWsList = [];
    for (const task of this.subscriptionTasks) clearTimeout(task);
    this.subscriptionTasks = [];
  }

  private startMiniTickerStream() {
    const connect = () => {
      if (!this.running) return;
      const ws = new WebSocket(`${ENGINE_CONSTANTS.BINANCE_WS_BASE}/ws/!miniTicker@arr`, { handshakeTimeout: ENGINE_CONSTANTS.WS_HANDSHAKE_TIMEOUT_MS });
      ws.on('message', (data: Buffer) => {
        try {
          if (this.sessionState.isEcoMode(this.running) && this.sessionState.activeTrades.length === 0) return;
          const msg = JSON.parse(data as any);
          let tickers: any[] = Array.isArray(msg) ? msg : (msg.data && Array.isArray(msg.data) ? msg.data : []);
          if (tickers.length > 0) this.tickerCache.bulkUpdate(tickers);
        } catch (err) {}
      });
      ws.on('close', () => { if (this.running) this.subscriptionTasks.push(setTimeout(() => connect(), ENGINE_CONSTANTS.WS_RECONNECT_DELAY_MS)); });
      this.miniTickerWs = ws;
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
          const top = await this.tickerCache.topByVolume(config.watchlist_size || 50, config.excluded_symbols || []);
          symbols = top.map((t: any) => t.symbol);
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
            if (!oldIntervals || !oldIntervals.has(interval)) await this.backfillKlines(symbol, interval);
          }
        }
      }
    } catch (err) {}
  }

  private async rebuildCombinedKlineStream() {
    for (const ws of this.combinedKlineWsList) this.safeClose(ws);
    this.combinedKlineWsList = [];
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
              this.tickerCache.bulkUpdate([{ s: kline.s, c: kline.c }]);
              if (kline.x && this.onCandeClose) this.onCandeClose(kline.s).catch(() => {});
            }
          } catch (err) {}
        });
        ws.on('close', () => { if (this.running) this.subscriptionTasks.push(setTimeout(() => connect(), ENGINE_CONSTANTS.WS_RECONNECT_DELAY_MS)); });
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
    // PROACTIVE RATE LIMIT: Skip backfill if near rate limits to preserve execution weight
    if (this.sessionState.isRateLimited()) {
      this.logger.debug(`Skipping kline backfill for ${symbol} @ ${interval} due to Binance rate limits.`);
      return;
    }

    const existingCandles = await this.klineStore.getRecentCandles(symbol, interval, 1);
    if (existingCandles.length > 0) {
      const lastCandle = existingCandles[0];
      const intervalMs = this.parseIntervalToMs(interval);
      if (!(lastCandle.time + intervalMs < Date.now() - intervalMs)) return;
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
    } catch (error) {}
  }
}
