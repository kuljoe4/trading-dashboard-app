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

    this.logger.log(`Initializing Binance USDS-M Futures Client | mode=${isTestnet ? 'TESTNET' : 'PROD'} | rest=${restURL} | ws=${wsURL}`);

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
          const label = prop.toString();
          return (...args: any[]) => {
            return queue.add(async () => {
              const response = await value.apply(target, args);
              // Proactively extract weight from headers if available
              if (response && response.headers) {
                queue.updateWeightFromHeaders(response.headers);
              }
              return response;
            }, label);
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
export class BinanceRequestQueue {
  private queue: { fn: () => Promise<any>, label: string, resolve: (v: any) => void, reject: (e: any) => void }[] = [];
  private processing = false;

  // SRE: Shared state across all queue instances to ensure process-wide IP reputation protection
  private static lastRequestTs = 0;
  private static currentWeight1m = 0;
  private static adaptiveDelayMs = 0;

  private weightLimit1m = 2400;

  // Mandatory delay between requests to prevent "Burst" penalties (50-100ms)
  private readonly MIN_DELAY_MS = 100;

  constructor(private readonly logger: Logger, private readonly eventEmitter: EventEmitter2) {}

  async add<T>(fn: () => Promise<T>, label: string): Promise<T> {
    return new Promise((resolve, reject) => {
      this.queue.push({ fn, label, resolve, reject });
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
      BinanceRequestQueue.currentWeight1m = parseInt(weight, 10);

      // If we are using > 70% of the weight, start introducing adaptive delays
      const usageRatio = BinanceRequestQueue.currentWeight1m / this.weightLimit1m;
      if (usageRatio > 0.9) {
        BinanceRequestQueue.adaptiveDelayMs = 1000; // Severe throttling
      } else if (usageRatio > 0.8) {
        BinanceRequestQueue.adaptiveDelayMs = 500;
      } else if (usageRatio > 0.7) {
        BinanceRequestQueue.adaptiveDelayMs = 200;
      } else {
        BinanceRequestQueue.adaptiveDelayMs = 0;
      }

      this.logger.debug(`[BinanceQueue] Weight Update: ${BinanceRequestQueue.currentWeight1m}/${this.weightLimit1m} (Adaptive Delay: ${BinanceRequestQueue.adaptiveDelayMs}ms)`);
    }
  }

  private async process() {
    if (this.processing) return;
    this.processing = true;

    while (this.queue.length > 0) {
      const now = Date.now();
      const delay = Math.max(this.MIN_DELAY_MS, BinanceRequestQueue.adaptiveDelayMs);
      const elapsed = now - BinanceRequestQueue.lastRequestTs;

      if (elapsed < delay) {
        if (BinanceRequestQueue.adaptiveDelayMs > 200) {
           this.logger.warn(`[BinanceQueue] Severe local throttling active (${BinanceRequestQueue.adaptiveDelayMs}ms). Pacing request...`);
        }
        await new Promise(resolve => setTimeout(resolve, delay - elapsed));
      }

      const item = this.queue.shift();
      if (item) {
        BinanceRequestQueue.lastRequestTs = Date.now();
        const startTs = Date.now();
        try {
          this.logger.debug(`[BinanceQueue] Dispatching: ${item.label}`);
          const result = await item.fn();
          const duration = Date.now() - startTs;
          this.logger.debug(`[BinanceQueue] Completed: ${item.label} (${duration}ms)`);
          item.resolve(result);
        } catch (error: any) {
          // If we hit an IP ban or rate limit error, increase delay significantly
          const msg = error.message || '';
          const code = error.code || (error.data ? error.data.code : null);
          const isBan = msg.includes('banned') || msg.includes('418') || code === -1003;
          const isRateLimit = msg.includes('429') || code === -1015;

          if (isBan || isRateLimit) {
            this.logger.error(`[BinanceQueue] Critical rate limit/ban detected. Status: ${isBan ? 'BANNED' : 'RATE_LIMITED'}. Increasing cooldown...`);

            // OVERWATCH: Fail Fast on IP Ban to protect reputation and prevent worsening the duration
            if (isBan) {
              this.logger.fatal('[BinanceQueue] IP BANNED (418). Terminating process immediately to protect infrastructure.');
              process.exit(1);
            }

            BinanceRequestQueue.lastRequestTs = Date.now() + 60000; // Forced 1-minute pause for this queue

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
