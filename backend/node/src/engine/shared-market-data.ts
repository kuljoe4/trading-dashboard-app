import { EventEmitter2 } from '@nestjs/event-emitter';
import { BinanceSubscriptionManager } from '../lib/binanceSubscriptionManager';
import { BinanceRequestQueue } from '../lib/binanceClientFactory';
import { ENGINE_CONSTANTS } from '../models/constants';
import { KlineStoreService } from './kline_store.service';
import { TickerCacheService } from './ticker_cache.service';

export const SHARED_MARKET_DATA = Symbol('SHARED_MARKET_DATA');

type Subscriber = {
  topics: Set<string>;
  onMessage: (message: any, writeCache: boolean) => void;
  onBan: (message: string) => void;
};

class SharedStreams {
  private readonly subscribers = new Map<object, Subscriber>();
  private readonly managers = new Map<string, BinanceSubscriptionManager>();
  private retry?: NodeJS.Timeout;
  private retryDelayMs = 5000;
  private topics = new Set<string>();
  private work = Promise.resolve();

  constructor(private readonly proxyUrl?: string) {}

  subscribe(owner: object, subscriber: Subscriber) {
    this.subscribers.set(owner, subscriber);
    return this.reconcile();
  }

  unsubscribe(owner: object) {
    if (!this.subscribers.delete(owner)) return Promise.resolve();
    return this.reconcile();
  }

  private reconcile() {
    const update = this.work.then(async () => {
      const topics = new Set<string>();
      for (const subscriber of this.subscribers.values()) {
        for (const topic of subscriber.topics) topics.add(topic);
      }

      for (const [signature, manager] of this.managers) {
        const subscribed = signature.split('/');
        if (subscribed.some(topic => topics.has(topic))) continue;
        this.managers.delete(signature);
        for (const topic of subscribed) this.topics.delete(topic);
        await manager.stop();
      }

      if (!topics.size) {
        if (this.retry) clearTimeout(this.retry);
        this.retry = undefined;
        this.retryDelayMs = 5000;
        return;
      }

      // Add only missing topics. Joining, leaving, or changing Paper's watchlist
      // never reconnects a socket carrying a topic Live still needs.
      const missing = [...topics].filter(topic => !this.topics.has(topic)).sort();
      if (!missing.length || this.retry) return;
      for (let offset = 0; offset < missing.length; offset += 128) {
        const batch = missing.slice(offset, offset + 128);
        const signature = batch.join('/');
        const manager = this.createManager(signature);
        try {
          await manager.connect();
          // Track topics for the watchdog. URL-param streams send no SUBSCRIBE frame.
          await manager.subscribe(batch);
          this.managers.set(signature, manager);
          for (const topic of batch) this.topics.add(topic);
        } catch (error) {
          await manager.stop();
          this.retry = setTimeout(() => {
            this.retry = undefined;
            void this.reconcile().catch(() => {});
          }, this.retryDelayMs);
          this.retry.unref();
          this.retryDelayMs = Math.min(this.retryDelayMs * 2, 60000);
          throw error;
        }
      }
      this.retryDelayMs = 5000;
    });
    this.work = update.catch(() => {});
    return update;
  }

  private createManager(signature: string) {
    const url = `${ENGINE_CONSTANTS.BINANCE_WS_MARKET}?streams=${signature}`;
    const manager: BinanceSubscriptionManager = new BinanceSubscriptionManager(url, {
      isTestnet: false,
      proxyUrl: this.proxyUrl,
      isBanned: () => BinanceRequestQueue.isCurrentlyBanned(),
      onBan: message => {
        for (const subscriber of this.subscribers.values()) subscriber.onBan(message);
      },
      onMessage: message => {
        if (this.managers.get(signature) !== manager) return;
        let writeCache = true;
        for (const subscriber of this.subscribers.values()) {
          if (!subscriber.topics.has(message.stream)) continue;
          subscriber.onMessage(message, writeCache);
          writeCache = false;
        }
      },
    });
    return manager;
  }
}

export class SharedMarketData {
  readonly discovery: SharedStreams;
  readonly klines: SharedStreams;
  readonly events = new EventEmitter2();
  readonly tickerCache = new TickerCacheService(this.events);
  klineStore?: KlineStoreService;
  private readonly active = new Set<object>();
  private backfills = Promise.resolve();
  private readonly retained = new Map<object, Set<string>>();
  private seed?: Promise<void>;

  constructor(readonly proxyUrl?: string) {
    this.discovery = new SharedStreams(proxyUrl);
    this.klines = new SharedStreams(proxyUrl);
  }

  attach(owner: object) {
    this.active.add(owner);
  }

  backfill(load: () => Promise<void>) {
    const result = this.backfills.then(load);
    this.backfills = result.catch(() => {});
    return result;
  }

  retainCandles(owner: object, keys: Set<string>) {
    this.retained.set(owner, keys);
    this.klineStore?.pruneExcept(new Set([...this.retained.values()].flatMap(set => [...set])));
  }

  releaseCandles(owner: object) {
    this.retained.delete(owner);
    if (this.active.delete(owner) && this.active.size === 0) {
      this.tickerCache.clear();
      this.klineStore?.clear();
    }
  }

  seedTickers(load: () => Promise<void>) {
    this.seed ??= load().finally(() => { this.seed = undefined; });
    return this.seed;
  }
}
