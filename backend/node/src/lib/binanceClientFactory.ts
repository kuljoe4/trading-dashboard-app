import {
  DerivativesTradingUsdsFutures,
  DERIVATIVES_TRADING_USDS_FUTURES_REST_API_TESTNET_URL,
  DERIVATIVES_TRADING_USDS_FUTURES_REST_API_PROD_URL,
  DERIVATIVES_TRADING_USDS_FUTURES_WS_STREAMS_TESTNET_URL,
  DERIVATIVES_TRADING_USDS_FUTURES_WS_STREAMS_PROD_URL
} from '@binance/derivatives-trading-usds-futures';
import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';

@Injectable()
export class BinanceClientFactory {
  private readonly logger = new Logger(BinanceClientFactory.name);

  constructor(private readonly eventEmitter: EventEmitter2) {}

  createClient(apiKey: string, apiSecret: string, isTestnet: boolean): DerivativesTradingUsdsFutures {
    const restURL = isTestnet
      ? DERIVATIVES_TRADING_USDS_FUTURES_REST_API_TESTNET_URL
      : DERIVATIVES_TRADING_USDS_FUTURES_REST_API_PROD_URL;

    const wsURL = isTestnet
      ? DERIVATIVES_TRADING_USDS_FUTURES_WS_STREAMS_TESTNET_URL
      : DERIVATIVES_TRADING_USDS_FUTURES_WS_STREAMS_PROD_URL;

    this.logger.log('Initializing Binance USDS-M Futures Client | mode=' + (isTestnet ? 'TESTNET' : 'PROD') + ' | rest=' + restURL + ' | ws=' + wsURL);

    const client = new DerivativesTradingUsdsFutures({
      configurationRestAPI: {
        apiKey,
        apiSecret,
        basePath: restURL
      },
      configurationWebsocketStreams: {
        wsURL
      }
    });

    // Wrap restAPI with a Throttled Proxy to prevent startup bursts and respect rate limits
    const originalRestApi = client.restAPI;
    const queue = new BinanceRequestQueue(this.logger, this.eventEmitter);

    (client as any).restAPI = new Proxy(originalRestApi, {
      get(target, prop, receiver) {
        const value = Reflect.get(target, prop, receiver);
        if (typeof value === 'function') {
          return (...args: any[]) => {
            return queue.add(async () => {
              const response = await value.apply(target, args);
              // Proactively extract weight from headers if available
              if (response && response.headers) {
                queue.updateWeightFromHeaders(response.headers);
              }
              return response;
            });
          };
        }
        return value;
      }
    });

    return client;
  }
}

/**
 * Centralized Request Queue for Binance USDS-M Futures API
 * Ensures a mandatory delay between requests and monitors usage weight.
 */
class BinanceRequestQueue {
  private queue: { fn: () => Promise<any>, resolve: (v: any) => void, reject: (e: any) => void }[] = [];
  private processing = false;
  private lastRequestTs = 0;
  private currentWeight1m = 0;
  private weightLimit1m = 2400;

  // Mandatory delay between requests to prevent "Burst" penalties (50-100ms)
  private readonly MIN_DELAY_MS = 100;
  // Adaptive delay for high weight usage
  private adaptiveDelayMs = 0;

  constructor(private readonly logger: Logger, private readonly eventEmitter: EventEmitter2) {}

  async add<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      this.queue.push({ fn, resolve, reject });
      this.process();
    });
  }

  public updateWeightFromHeaders(headers: any) {
    const getHeader = (name: string) => {
      return typeof headers.get === 'function'
        ? headers.get(name)
        : (headers[name.toLowerCase()] || headers[name]);
    };

    const weight = getHeader('X-MBX-USED-WEIGHT-1M');
    if (weight) {
      this.currentWeight1m = parseInt(weight, 10);

      // PROACTIVE RATE LIMIT: Stricter adaptive delays to prevent hitting the 2400 limit.
      const usageRatio = this.currentWeight1m / this.weightLimit1m;
      if (usageRatio > 0.9) {
        this.adaptiveDelayMs = 2000; // Heavy backoff near limits
      } else if (usageRatio > 0.8) {
        this.adaptiveDelayMs = 1000;
      } else if (usageRatio > 0.7) {
        this.adaptiveDelayMs = 500;
      } else if (usageRatio > 0.5) {
        this.adaptiveDelayMs = 200; // Proactive smoothing starting at 50%
      } else {
        this.adaptiveDelayMs = 0;
      }
    }
  }

  private async process() {
    if (this.processing) return;
    this.processing = true;

    while (this.queue.length > 0) {
      const now = Date.now();
      const delay = Math.max(this.MIN_DELAY_MS, this.adaptiveDelayMs);
      const elapsed = now - this.lastRequestTs;

      if (elapsed < delay) {
        await new Promise(resolve => setTimeout(resolve, delay - elapsed));
      }

      const item = this.queue.shift();
      if (item) {
        this.lastRequestTs = Date.now();
        try {
          const result = await item.fn();
          item.resolve(result);
        } catch (error: any) {
          // If we hit an IP ban or rate limit error, increase delay significantly
          const msg = error.message || '';
          const code = error.code || (error.data ? error.data.code : null);
          const isBan = msg.includes('banned') || msg.includes('418') || code === -1003;
          const isRateLimit = msg.includes('429') || code === -1015;

          if (isBan || isRateLimit) {
            this.logger.error('[BinanceQueue] Critical rate limit/ban detected. Status: ' + (isBan ? 'BANNED' : 'RATE_LIMITED') + '. Increasing cooldown...');
            this.lastRequestTs = Date.now() + 60000; // Forced 1-minute pause for this queue

            this.eventEmitter.emit('binance.api_limit_reached', {
              type: isBan ? 'BAN' : 'RATE_LIMIT',
              message: msg,
              until: isBan ? Date.now() + 600000 : Date.now() + 60000 // Estimate 10m for ban, 1m for limit
            });
          }
          item.reject(error);
        }
      }
    }

    this.processing = false;
  }
}
