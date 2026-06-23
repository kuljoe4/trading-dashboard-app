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
                queue.updateWeightFromHeaders(response.headers, label);
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
  private static weightLimit1m = 2400;

  // Mandatory delay between requests to prevent "Burst" penalties (50-100ms)
  private readonly MIN_DELAY_MS = 100;

  constructor(private readonly logger: Logger, private readonly eventEmitter: EventEmitter2) {}

  async add<T>(fn: () => Promise<T>, label: string): Promise<T> {
    return new Promise((resolve, reject) => {
      this.queue.push({ fn, label, resolve, reject });
      this.process();
    });
  }

  public updateWeightFromHeaders(headers: any, label?: string) {
    const getHeader = (name: string) => {
      return typeof headers.get === 'function'
        ? headers.get(name)
        : (headers[name.toLowerCase()] || headers[name]);
    };

    const weight = getHeader('X-MBX-USED-WEIGHT-1M');
    const orderCount10s = getHeader('X-MBX-ORDER-COUNT-10S');
    const orderCount1m = getHeader('X-MBX-ORDER-COUNT-1M');

    if (weight) {
      BinanceRequestQueue.currentWeight1m = parseInt(weight, 10);

      // SRE Overwatch: Dynamic Back-off Execution Strategy
      const usageRatio = BinanceRequestQueue.currentWeight1m / BinanceRequestQueue.weightLimit1m;
      if (usageRatio > 0.75) {
        BinanceRequestQueue.adaptiveDelayMs = 1000; // Load Shedding zone
      } else if (usageRatio > 0.5) {
        BinanceRequestQueue.adaptiveDelayMs = 500;  // Active Throttling zone
      } else {
        BinanceRequestQueue.adaptiveDelayMs = 0;    // Normal Operation zone
      }
    }
  }

  public static setWeightLimit(limit: number) {
    if (limit > 0) {
      BinanceRequestQueue.weightLimit1m = limit;
    }
  }

  private async process() {
    if (this.processing) return;
    this.processing = true;

    while (this.queue.length > 0) {
      const now = Date.now();

      // SRE Implementation: Outbound REST requests are converted into a strict serial pipeline
      const delay = Math.max(this.MIN_DELAY_MS, BinanceRequestQueue.adaptiveDelayMs);
      const elapsed = now - BinanceRequestQueue.lastRequestTs;

      if (elapsed < delay) {
        await new Promise(resolve => setTimeout(resolve, delay - elapsed));
      }

      const item = this.queue.shift();
      if (item) {
        const usageRatio = BinanceRequestQueue.currentWeight1m / BinanceRequestQueue.weightLimit1m;

        // SRE LOAD SHEDDING: Multi-tier priority management
        // Level 1: Immune (Infrastructure & Keepalives) - Proceed even if > 100% to prevent blindness
        const isImmune = ['startUserDataStream', 'keepaliveUserDataStream', 'closeUserDataStream'].includes(item.label);
        // Level 2: Critical (Orders & Structural Info) - Shed at 95%
        const isCritical = ['newOrder', 'cancelOrder', 'newAlgoOrder', 'cancelAlgoOrder', 'cancelAllOpenOrders', 'exchangeInformation', 'futuresAccountBalanceV2'].includes(item.label);
        // Level 3: Operational (State Audits) - Shed at 85%
        const isOperational = ['queryOrder', 'accountTradeList', 'positionInformationV3'].includes(item.label);

        let shed = false;
        let shedReason = '';

        // SRE LOAD SHEDDING: Multi-tier priority management
        // Level 1: Immune (Infrastructure & Keepalives) - NEVER shed to prevent stream stalls
        if (isImmune) {
          shed = false;
        } else {
           if (usageRatio > 1.0) { shed = true; shedReason = 'Weight limit exceeded (100%+)'; }
           else if (usageRatio > 0.95 && !isCritical) { shed = true; shedReason = 'SRE Load Shedding (Critical Zone 95%+)'; }
           else if (usageRatio > 0.85 && !isCritical && !isOperational) { shed = true; shedReason = 'SRE Load Shedding (Operational Zone 85%+)'; }
           else if (usageRatio > 0.70 && !isCritical && !isOperational && !['ticker24hrPriceChangeStatistics', 'klineCandlestickData'].includes(item.label)) {
              // Catch-all for non-categorized calls
              shed = usageRatio > 0.75;
              shedReason = 'SRE Load Shedding (General 75%+)';
           } else if (usageRatio > 0.70 && ['ticker24hrPriceChangeStatistics', 'klineCandlestickData'].includes(item.label)) {
              shed = true;
              shedReason = 'SRE Load Shedding (Market Data Zone 70%+)';
           }
        }

        if (shed) {
           this.logger.warn(`[BinanceQueue] SRE LOAD SHEDDING: Rejecting non-critical call [${item.label}] (Weight usage: ${(usageRatio * 100).toFixed(1)}%). Reason: ${shedReason}`);
           item.reject(new Error(`Load shedding active: ${item.label} rejected to preserve IP reputation. (${shedReason})`));
           continue;
        }

        BinanceRequestQueue.lastRequestTs = Date.now();
        const startTs = Date.now();
        try {
          this.logger.debug(`[BinanceQueue] Dispatching: ${item.label}`);
          const result = await item.fn();
          const duration = Date.now() - startTs;

          // SRE: High-Fidelity Structured Telemetry Logging (Standardized Format)
          const telemetryLog = `[Telemetry] ${item.label} executed | Weight: ${BinanceRequestQueue.currentWeight1m}/${BinanceRequestQueue.weightLimit1m} | Depth: ${this.queue.length} | Latency: ${duration}ms`;
          this.logger.log(telemetryLog);

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
