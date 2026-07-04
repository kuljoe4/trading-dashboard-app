import {
  DerivativesTradingUsdsFutures,
  DERIVATIVES_TRADING_USDS_FUTURES_REST_API_TESTNET_URL,
  DERIVATIVES_TRADING_USDS_FUTURES_REST_API_PROD_URL,
  DERIVATIVES_TRADING_USDS_FUTURES_WS_STREAMS_TESTNET_URL,
  DERIVATIVES_TRADING_USDS_FUTURES_WS_STREAMS_PROD_URL
} from '@binance/derivatives-trading-usds-futures';
import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import WebSocket from 'ws';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Settings as SettingsEntity } from '../models/entities/Settings.entity';
import { SessionStateService } from '../engine/session_state.service';

@Injectable()
export class BinanceClientFactory {
  private readonly logger = new Logger(BinanceClientFactory.name);
  private queue: BinanceRequestQueue | null = null;

  constructor(
    private readonly eventEmitter: EventEmitter2,
    @Inject(forwardRef(() => SessionStateService))
    private readonly sessionState: SessionStateService,
    @InjectRepository(SettingsEntity)
    private readonly settingsRepository: Repository<SettingsEntity>,
  ) {}

  /**
   * SRE: Enqueue a generic asynchronous task into the throttled Binance request queue.
   * Ensures that even manual 'fetch' calls respect process-wide rate limits and IP reputation.
   */
  async genericRequest<T>(fn: () => Promise<T>, label: string, isEmergency = false): Promise<T> {
    if (!this.queue) {
      this.queue = new BinanceRequestQueue(this.logger, this.eventEmitter, this.settingsRepository);
    }

    return this.queue.add(async () => {
      const result = await fn();
      // If the result looks like a Response (has headers), update the weight automatically
      if (result && (result as any).headers) {
        this.queue?.updateWeightFromHeaders((result as any).headers, label);
      }
      return result;
    }, label, isEmergency);
  }

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

    // ARCHITECTURAL FIX: Override SDK's internal URL building to support dedicated gateways
    // /private (for listenKey), /market (for anonymous market streams), and /public (HF data)
    const originalConnect = client.websocketStreams.connect.bind(client.websocketStreams);
    client.websocketStreams.connect = (async (params: any): Promise<any> => {
      // Citadel: Strictly isolate stream types for zero-collision routing (private, public/hf, market)
      const stream = params.stream || '';
      const isHF = stream.includes('!');
      const isMarket = stream.includes('@');
      // Citadel: Explicitly identify listenKeys (64-char alphanumeric) vs market streams
      const isPrivate = !isHF && !isMarket && !stream.includes('/') && /^[a-zA-Z0-9]{60,}$/.test(stream);

      let gatewayURL = wsURL;
      const urlObj = new URL(wsURL);

      if (isPrivate) {
        if (!isTestnet) urlObj.pathname = '/private';
        else urlObj.pathname = '/ws';
      } else if (isHF) {
        if (!isTestnet) urlObj.pathname = '/public';
        else urlObj.pathname = stream.includes('/') ? '/stream' : '/ws';
      } else {
        if (!isTestnet) urlObj.pathname = '/market';
        else urlObj.pathname = stream.includes('/') ? '/stream' : '/ws';
      }

      // SRE: Correct construction of the final WebSocket URL for the SDK.
      // Our gateway ALWAYS expects /stream?streams= format for anonymous market/public streams.
      const useCombinedFormat = !isPrivate;
      if (!isTestnet && useCombinedFormat) {
          urlObj.pathname = urlObj.pathname.replace(/\/$/, '') + '/stream';
          gatewayURL = urlObj.origin + urlObj.pathname;

          // BOLT: Manual construction to bypass SDK logic and ensure /stream?streams= is used.
          const finalUrl = `${gatewayURL}?streams=${params.stream}`;
          this.logger.debug(`[BinanceClient] Connecting to gateway (Manual): ${finalUrl.substring(0, 100)}... | isHF=${isHF}`);

          const ws = new WebSocket(finalUrl, { handshakeTimeout: 5000 });
          // BOLT: Add error handler to prevent unhandled 'error' events from crashing the process (e.g. 400 Bad Request)
          ws.on('error', (err: any) => {
            const msg = err.message || '';
            this.logger.error(`[BinanceClient] WebSocket error for ${params.stream}: ${msg}`);

            // CITADEL FAIL-FAST: Detected critical IP reputation threats (429, 418)
            if (msg.includes('429') || msg.includes('418')) {
              this.logger.fatal(`[CRITICAL] WebSocket handshake failed with rate-limit/ban status (${msg}). Entering Terminal Lock.`);

              // SRE: Attempt to extract absolute ban timestamp from message: "banned until (\d+)"
              const banMatch = msg.match(/banned until (\d+)/i);
              const until = banMatch ? parseInt(banMatch[1], 10) : Date.now() + (24 * 60 * 60 * 1000);

              // RESEARCH-01: Instead of process.exit(1), implement a long sleep to break boot loops and allow UI visibility.
              // Lock the REST queue until the absolute exchange timestamp to ensure zero egress traffic.
              BinanceRequestQueue.setCooldownUntil(until);

              this.eventEmitter.emit('binance.api_limit_reached', {
                type: 'BAN',
                message: msg,
                until
              });
            }
          });
          // SDK expected interface: disconnect() method
          (ws as any).disconnect = () => (ws as any).terminate();
          return ws as any;
      }

      gatewayURL = urlObj.origin + urlObj.pathname;
      this.logger.debug(`[BinanceClient] Routing WS connection to gateway: ${gatewayURL} | isPrivate=${isPrivate} | isHF=${isHF} | stream=${params.stream?.substring(0, 30)}...`);

      const originalWsURL = (client.websocketStreams as any).wsURL;
      (client.websocketStreams as any).wsURL = gatewayURL;
      try {
        return await originalConnect(params);
      } finally {
        (client.websocketStreams as any).wsURL = originalWsURL;
      }
    }) as any;

    // Wrap restAPI with a Throttled Proxy to prevent startup bursts and respect rate limits
    const originalRestApi = client.restAPI;

    // SRE: Ensure a single queue instance per factory to maintain consistent weight tracking
    if (!this.queue) {
       this.queue = new BinanceRequestQueue(this.logger, this.eventEmitter, this.settingsRepository);
    }
    const queue = this.queue;

    (client as any).restAPI = new Proxy(originalRestApi, {
      get(target, prop, receiver) {
        const value = Reflect.get(target, prop, receiver);
        if (typeof value === 'function') {
          const label = prop.toString();
          return (...args: any[]) => {
            // SRE: Detect emergency close orders to provide high-priority execution path
            let isEmergency = false;
            if (['newOrder', 'newAlgoOrder'].includes(label) && args[0]) {
               isEmergency = args[0].reduceOnly === true || args[0].closePosition === true;
            }

            return queue.add(async () => {
              const response = await value.apply(target, args);
              // Proactively extract weight from headers if available
              if (response && response.headers) {
                queue.updateWeightFromHeaders(response.headers, label);
              }
              return response;
            }, label, isEmergency);
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
  private queue: { fn: () => Promise<any>, label: string, isEmergency: boolean, resolve: (v: any) => void, reject: (e: any) => void }[] = [];
  private processing = false;

  // SRE: Shared state across all queue instances to ensure process-wide IP reputation protection
  private static lastRequestTs = 0;
  private static currentWeight1m = 0;
  private static windowStartTs = Date.now();
  private static rolloverInterval: NodeJS.Timeout | null = null;
  private static adaptiveDelayMs = 0;
  private static weightLimit1m = 2400;

  // Mandatory delay between requests to prevent "Burst" penalties (50-100ms)
  private readonly MIN_DELAY_MS = 100;

  constructor(
    private readonly logger: Logger,
    private readonly eventEmitter: EventEmitter2,
    private readonly settingsRepository: Repository<SettingsEntity>
  ) {
    this.setupRolloverCheck();
  }

  private setupRolloverCheck() {
    if (BinanceRequestQueue.rolloverInterval) return;

    // SRE: Background rollover check to break "shedding lock"
    // Even if no requests are being processed, we must reset the counter
    // at minute boundaries so other services (MarketFeed) can resume.
    BinanceRequestQueue.rolloverInterval = setInterval(() => {
      const now = Date.now();
      if (this.shouldRollover(now)) {
        this.executeRollover(now);
      }
    }, 5000); // Check every 5s
  }

  private shouldRollover(now: number): boolean {
    return Math.floor(now / 60000) > Math.floor(BinanceRequestQueue.windowStartTs / 60000);
  }

  private executeRollover(now: number) {
    // SRE: Critical rollover logic. Resets counter at clock minute boundaries (00s).
    // BOLT: Also ensure ban cooldown has elapsed before allowing weight to reset and requests to resume.
    if (now < BinanceRequestQueue.lastRequestTs) {
      this.logger.debug(`[BinanceQueue] Rollover skipped: Still in mandatory cooldown for ${Math.ceil((BinanceRequestQueue.lastRequestTs - now) / 1000)}s`);
      return;
    }

    // Citadel: If cooldown just expired, emit an event to clear ban status in the engine
    const wasBanned = BinanceRequestQueue.currentWeight1m === 9999;

    if (BinanceRequestQueue.currentWeight1m > 0) {
      this.logger.debug(`[BinanceQueue] Window rollover detected. Resetting weight: ${BinanceRequestQueue.currentWeight1m} -> 0`);
      BinanceRequestQueue.currentWeight1m = 0;
      BinanceRequestQueue.windowStartTs = now;

      // BOLT: Thundering Herd Mitigation. On window rollover, we implement a phased release
      // of the queue by keeping the adaptive delay high for the first few seconds of the new window.
      // This prevents a synchronized burst from multiple services that could trigger an immediate re-ban.
      BinanceRequestQueue.adaptiveDelayMs = 1000;
      setTimeout(() => {
         if (BinanceRequestQueue.currentWeight1m < (BinanceRequestQueue.weightLimit1m * 0.5)) {
            BinanceRequestQueue.adaptiveDelayMs = 0;
         }
      }, 2000);

      // SRE: Proactively update the entire engine state so background tasks can resume immediately
      this.eventEmitter.emit('binance.weight_update', 0);

      if (wasBanned) {
        this.logger.log(`[BinanceQueue] Terminal Lock lifted. System resuming normal execution.`);
        this.eventEmitter.emit('binance.api_limit_cleared');
      }
    } else {
      // Just keep the window timestamp current to prevent multiple resets in the same minute
      BinanceRequestQueue.windowStartTs = now;
    }
  }

  async add<T>(fn: () => Promise<T>, label: string, isEmergency = false): Promise<T> {
    // SRE: Critical guard - immediately reject non-emergency requests if currently in a hard ban cooldown.
    // This prevents building up a massive queue that bursts immediately after the cooldown expires.
    const now = Date.now();
    if (now < BinanceRequestQueue.lastRequestTs && !isEmergency) {
       const remaining = Math.ceil((BinanceRequestQueue.lastRequestTs - now) / 1000);
       return Promise.reject(new Error(`IP banned: Too many requests. Resuming in ${remaining}s.`));
    }

    return new Promise((resolve, reject) => {
      this.queue.push({ fn, label, isEmergency, resolve, reject });
      this.process();
    });
  }

  public updateWeightFromHeaders(headers: any, label?: string) {
    const getHeader = (name: string) => {
      return (headers && typeof headers.get === 'function')
        ? headers.get(name)
        : (headers ? (headers[name.toLowerCase()] || headers[name]) : null);
    };

    const weight = getHeader('X-MBX-USED-WEIGHT-1M');
    const orderCount10s = getHeader('X-MBX-ORDER-COUNT-10S');
    const orderCount1m = getHeader('X-MBX-ORDER-COUNT-1M');

    // SRE: Proactively sync order rate limits if headers are present
    if (orderCount10s || orderCount1m) {
       this.eventEmitter.emit('binance.order_limit_update', { headers });
    }

    if (weight) {
      const parsedWeight = parseInt(weight, 10);
      if (!isNaN(parsedWeight) && parsedWeight >= 0) {
        BinanceRequestQueue.currentWeight1m = parsedWeight;
        BinanceRequestQueue.windowStartTs = Date.now();

        // SRE: Synchronize weight back to SessionStateService on every REST response
        this.eventEmitter.emit('binance.weight_update', BinanceRequestQueue.currentWeight1m);

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
    } else {
       // BOLT: Some POST endpoints (orders) only return weight via a different header or not at all.
       // We log it for telemetry visibility but don't reset currentWeight1m to avoid blind spots.
       this.logger.debug(`[BinanceQueue] Weight header (X-MBX-USED-WEIGHT-1M) missing on ${label}.`);
    }
  }

  public static setWeightLimit(limit: number) {
    if (limit > 0) {
      BinanceRequestQueue.weightLimit1m = limit;
    }
  }

  public static setCooldownUntil(until: number) {
    BinanceRequestQueue.lastRequestTs = until;
  }

  private async process() {
    if (this.processing) return;
    this.processing = true;

    while (this.queue.length > 0) {
      const now = Date.now();

      // SRE: Rolling Window Decay (In-loop check)
      if (this.shouldRollover(now)) {
        this.executeRollover(now);
      }

      // SRE Implementation: Outbound REST requests are converted into a strict serial pipeline
        // BOLT: Ensure we never resume until the ban cooldown has fully passed.
        const baseDelay = Math.max(this.MIN_DELAY_MS, BinanceRequestQueue.adaptiveDelayMs);
        const cooldownRemaining = BinanceRequestQueue.lastRequestTs - now;
        const finalDelay = Math.max(baseDelay, cooldownRemaining);

        if (finalDelay > 0) {
          await new Promise(resolve => setTimeout(resolve, finalDelay));
      }

      const item = this.queue.shift();
      if (item) {
        const usageRatio = BinanceRequestQueue.currentWeight1m / BinanceRequestQueue.weightLimit1m;

        // SRE LOAD SHEDDING: Multi-tier priority management (Citadel Protocol 2026)

        // Tier 1: EMERGENCY (Bypass) - Infrastructure & Reduce-only orders
        const isEmergency = ['startUserDataStream', 'keepaliveUserDataStream', 'closeUserDataStream'].includes(item.label) || item.isEmergency;

        // Tier 2: CRITICAL (95%) - Strategy entries and cancellations
        const isCritical = ['newOrder', 'cancelOrder', 'newAlgoOrder', 'cancelAlgoOrder', 'cancelAllOpenOrders', 'exchangeInformation', 'futuresAccountBalanceV2', 'futuresAccountBalanceV3'].includes(item.label);

        // Tier 3: OPERATIONAL (80%) - State audits and trade history
        const isOperational = ['queryOrder', 'accountTradeList', 'positionInformationV3'].includes(item.label);

        // Tier 4: BACKGROUND (50%) - Non-essential backfills and deep-scans
        const isBackground = ['ticker24hrPriceChangeStatistics', 'klineCandlestickData'].includes(item.label);

        let shed = false;
        let shedReason = '';

        if (!isEmergency) {
           if (usageRatio > 1.0) {
              shed = true; shedReason = 'Weight limit exceeded (100%+)';
           } else if (usageRatio > 0.95 && !isCritical) {
              shed = true; shedReason = 'SRE Tiered Budget (Critical Zone 95%+)';
           } else if (usageRatio > 0.80 && !isCritical && !isOperational) {
              shed = true; shedReason = 'SRE Tiered Budget (Operational Zone 80%+)';
           } else if (usageRatio > 0.50 && isBackground) {
              shed = true;
              shedReason = 'SRE Tiered Budget (Background Zone 50%+)';
           }
        } else if (usageRatio > 1.1) {
           // Hard ceiling for even emergency orders to protect IP reputation from permanent ban
           shed = true;
           shedReason = 'Emergency limit exceeded (110%+)';
        }

        if (shed) {
           this.logger.warn(`[BinanceQueue] SHEDDING: [${item.label}] rejected. Reason: ${shedReason} | Usage: ${(usageRatio * 100).toFixed(1)}%`);
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
          // BOLT: Ensure weight is always valid in logs even if header parsing failed
          const currentWeight = (BinanceRequestQueue.currentWeight1m === undefined || isNaN(BinanceRequestQueue.currentWeight1m)) ? 0 : BinanceRequestQueue.currentWeight1m;
          const telemetryLog = `[Telemetry] ${item.label} executed | Weight: ${currentWeight}/${BinanceRequestQueue.weightLimit1m} | Depth: ${this.queue.length} | Latency: ${duration}ms`;
          this.logger.log(telemetryLog);

          item.resolve(result);
        } catch (error: any) {
          const msg = error.message || '';
          const code = error.code || (error.data ? error.data.code : null);
          const isBan = msg.includes('418') || code === -1003 || msg.includes('banned');
          const isRateLimit = msg.includes('429') || code === -1015;

          // CITADEL FAIL-FAST: Detected critical IP reputation threats (429, 418, -1003)
          if (isBan || isRateLimit) {
            this.logger.fatal(`[CRITICAL] API request failed with ${isBan ? 'BAN' : 'RATE_LIMIT'} status (${msg}). Entering Terminal Lock.`);

            // RESEARCH-01: Instead of process.exit(1), implement a long sleep to break boot loops and allow UI visibility.
            // Exiting causes Railway to immediately restart, leading to a "hammering" effect that can prolong bans.
            let until = Date.now() + 60000; // 1m default for rate limit

            if (isBan) {
               // SRE: Attempt to extract absolute ban timestamp from message: "banned until (\d+)"
               const banMatch = msg.match(/banned until (\d+)/i);
               if (banMatch) {
                 until = parseInt(banMatch[1], 10);
               } else if (error.headers && error.headers['retry-after']) {
                 until = Date.now() + (parseInt(error.headers['retry-after'], 10) * 1000);
               } else {
                 until = Date.now() + (24 * 60 * 60 * 1000); // 24h fallback for ban
               }
            }
            BinanceRequestQueue.setCooldownUntil(until);

            this.eventEmitter.emit('binance.api_limit_reached', {
                type: isBan ? 'BAN' : 'RATE_LIMIT',
                message: msg,
                until
            });

            // Purge non-emergency queue items
            this.queue = this.queue.filter(i => i.isEmergency);
          }

          item.reject(error);
        }
      }
    }

    this.processing = false;
  }
}
