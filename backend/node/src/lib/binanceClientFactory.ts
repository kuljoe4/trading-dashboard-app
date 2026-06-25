import {
  DerivativesTradingUsdsFutures,
  DERIVATIVES_TRADING_USDS_FUTURES_REST_API_TESTNET_URL,
  DERIVATIVES_TRADING_USDS_FUTURES_REST_API_PROD_URL,
  DERIVATIVES_TRADING_USDS_FUTURES_WS_STREAMS_TESTNET_URL,
  DERIVATIVES_TRADING_USDS_FUTURES_WS_STREAMS_PROD_URL
} from '@binance/derivatives-trading-usds-futures';
import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
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
    client.websocketStreams.connect = async (params: any) => {
      // UDS streams use the listenKey (string without @ or !), while market streams use @ (kline, ticker) or ! (miniTicker)
      const isPrivate = !!params.stream && !params.stream.includes('@') && !params.stream.includes('!');

      let gatewayURL = wsURL;
      const urlObj = new URL(wsURL);

      if (isPrivate) {
        // SRE: Strictly route private listenKey traffic to the /private gateway
        urlObj.pathname = '/private';
      } else {
        // Market/Public data traffic routes to /market or /public
        urlObj.pathname = '/market';
      }

      gatewayURL = urlObj.origin + urlObj.pathname;

      this.logger.debug(`[BinanceClient] Routing WS connection to gateway: ${gatewayURL} | isPrivate=${isPrivate} | stream=${params.stream?.substring(0, 10)}...`);

      const originalWsURL = (client.websocketStreams as any).wsURL;
      (client.websocketStreams as any).wsURL = gatewayURL;
      try {
        return await originalConnect(params);
      } finally {
        (client.websocketStreams as any).wsURL = originalWsURL;
      }
    };

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
    if (BinanceRequestQueue.currentWeight1m > 0) {
      this.logger.log(`[BinanceQueue] Window rollover detected. Resetting weight: ${BinanceRequestQueue.currentWeight1m} -> 0`);
      BinanceRequestQueue.currentWeight1m = 0;
      BinanceRequestQueue.adaptiveDelayMs = 0; // Reset adaptive throttling on rollover
      BinanceRequestQueue.windowStartTs = now;

      // SRE: Proactively update the entire engine state so background tasks can resume immediately
      this.eventEmitter.emit('binance.weight_update', 0);
    } else {
      // Just keep the window timestamp current to prevent multiple resets in the same minute
      BinanceRequestQueue.windowStartTs = now;
    }
  }

  async add<T>(fn: () => Promise<T>, label: string, isEmergency = false): Promise<T> {
    return new Promise((resolve, reject) => {
      this.queue.push({ fn, label, isEmergency, resolve, reject });
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

    if (weight) {
      BinanceRequestQueue.currentWeight1m = parseInt(weight, 10);
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

      // SRE: Rolling Window Decay (In-loop check)
      if (this.shouldRollover(now)) {
        this.executeRollover(now);
      }

      // SRE Implementation: Outbound REST requests are converted into a strict serial pipeline
      const delay = Math.max(this.MIN_DELAY_MS, BinanceRequestQueue.adaptiveDelayMs);
      const elapsed = now - BinanceRequestQueue.lastRequestTs;

      if (elapsed < delay) {
        await new Promise(resolve => setTimeout(resolve, delay - elapsed));
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

            // RESEARCH-01: Instead of process.exit(1), implement a long sleep to break boot loops and allow UI visibility.
            // Exiting causes Railway to immediately restart, leading to a "hammering" effect that can prolong bans.
            if (isBan) {
              const BAN_COOLDOWN_MS = 600000; // 10 minutes
              this.logger.fatal(`[BinanceQueue] IP BANNED (418). Entering safe cooldown mode for ${BAN_COOLDOWN_MS / 60000}m to protect infrastructure.`);

              const until = Date.now() + BAN_COOLDOWN_MS;
              const reason = msg || 'IP Banned (418) by Binance';
              this.eventEmitter.emit('binance.api_limit_reached', {
                type: 'BAN',
                message: reason,
                until
              });

              // RESEARCH-02: Persist ban status to DB to survive process restarts
              this.settingsRepository.update('default', {
                api_ban_until: until,
                api_ban_reason: reason
              }).catch(e => this.logger.error(`Failed to persist API ban: ${e.message}`));

              BinanceRequestQueue.lastRequestTs = until;
            } else {
              BinanceRequestQueue.lastRequestTs = Date.now() + 60000; // Forced 1-minute pause for rate limit

              this.eventEmitter.emit('binance.api_limit_reached', {
                type: 'RATE_LIMIT',
                message: msg,
                until: Date.now() + 60000
              });
            }
          }
          item.reject(error);
        }
      }
    }

    this.processing = false;
  }
}
