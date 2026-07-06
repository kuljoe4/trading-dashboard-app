import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Settings as SettingsEntity } from '../models/entities/Settings.entity';
import { OnEvent } from '@nestjs/event-emitter';
import { DerivativesTradingUsdsFutures } from '@binance/derivatives-trading-usds-futures';
import { Trade } from '../models/Trade';
import { SessionConfig } from '../models/SessionConfig';
import { SignalEngineService } from './signalEngine';
import { MarketFeedService } from './market_feed.service';
import { TickerCacheService } from './ticker_cache.service';
import { MonitoringService } from './monitoring.service';
import { PositionTrackerService } from './positionTracker';
import { SessionStateService } from './session_state.service';
import { AuditLogService } from '../trading/audit-log.service';
import { v4 as uuid } from 'uuid';
import { roundEight, floorStep, roundTo, formatSlType } from '../lib/math';
import { ENGINE_CONSTANTS, CONFIG_LIMITS, EXIT_REASONS } from '../models/constants';
import { ENGINE_EVENTS } from './events';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ExchangeExecutionException } from '../lib/exceptions';
import { ExecutionResult, ExecutionStatus } from '../models/ExecutionResult';

/**
 * HYBRID EVENT-LOOP ARCHITECTURE (Industry Standard 2026):
 * 1. Event-Driven (Primary): Listen to real-time User Data Stream (UDS) for order fills/SL hits.
 * 2. Loop-Based (Audit): MaintenanceService Watchdog performs O(N) periodic audits to catch missed UDS events.
 * 3. Graceful Degradation: If UDS fails, the system continues to function via fallback polling.
 */
@Injectable()
export class OrderManagerService {
  private readonly logger = new Logger(OrderManagerService.name);

  private binanceClient: DerivativesTradingUsdsFutures | null = null;
  private paperMode = true;
  private takerFeeRate = 0.0004; // Default taker fee (0.04%)
  private lastFeeFetch = 0;

  private consecutiveFailures = 0;
  private readonly MAX_CONSECUTIVE_FAILURES = 3;
  private circuitBreakerTrippedAt = 0;
  private readonly CIRCUIT_BREAKER_RESET_TIMEOUT = 10 * 60 * 1000; // 10 minutes

  // Audit Item 13: In-flight ratchet locks to prevent Watchdog race conditions
  private ratchetLocks: Map<string, boolean> = new Map();

  // SRE: Per-symbol closure locks to prevent concurrent execution races
  private closureLocks: Map<string, boolean> = new Map();

  // BOLT: Per-symbol log throttling for backoff periods
  private lastDeferLogTs: Map<string, number> = new Map();

  // IDEMPOTENCY: Tracking executed order IDs to prevent double-processing between REST and WebSocket (UDS)
  private executionCache: Map<string, number> = new Map();
  // CHRONOS: Tracking unique Binance trade IDs to prevent commission double-counting and PnL errors
  private tradeExecutionCache: Map<string, number> = new Map();
  private readonly EXECUTION_CACHE_TTL = 10 * 60 * 1000; // 10 minutes

  constructor(
    private readonly signalEngine: SignalEngineService,
    private readonly marketFeed: MarketFeedService,
    private readonly tickerCache: TickerCacheService,
    private readonly monitoringService: MonitoringService,
    @Inject(forwardRef(() => PositionTrackerService))
    private readonly positionTracker: PositionTrackerService,
    private readonly sessionState: SessionStateService,
    private readonly auditLog: AuditLogService,
    private readonly eventEmitter: EventEmitter2,
    @InjectRepository(SettingsEntity)
    private readonly settingsRepository: Repository<SettingsEntity>,
  ) {}

  @OnEvent('binance.order_update')
  async handleBinanceOrderUpdate(payload: any) {
    const order = payload.o;
    const symbol = order.s;
    const status = order.X; // Order Status
    const clientOrderId = order.c;
    const orderId = String(order.i);
    const side = order.S;
    const type = order.ot;
    const executionType = order.x; // Execution Type

    // IDEMPOTENCY: Check if this execution has already been processed via REST response
    if (executionType === 'TRADE' && status === 'FILLED') {
      const cacheKey = `${symbol}_${orderId}_${status}`;
      if (this.executionCache.has(cacheKey)) {
        this.logger.debug(`[Idempotency] Dropping duplicate UDS fill report for ${symbol} (ID: ${orderId})`);
        return;
      }
      this.executionCache.set(cacheKey, Date.now());
      this.cleanupExecutionCache();
    }

    // Update real-time orders cache from UDS
    let currentOrders = this.sessionState.realTimeOrders.get(symbol) || [];
    if (status === 'FILLED' || status === 'CANCELED' || status === 'EXPIRED' || status === 'REJECTED') {
      // Remove the order from cache if it's in a terminal state
      currentOrders = currentOrders.filter(o => String(o.orderId) !== orderId && o.clientOrderId !== clientOrderId);
    } else {
      // Add or update the order in cache
      const existingIdx = currentOrders.findIndex(o => String(o.orderId) === orderId || o.clientOrderId === clientOrderId);
      const orderEntry = {
        symbol,
        orderId: parseFloat(orderId),
        clientOrderId,
        price: parseFloat(order.p || '0'),
        avgPrice: parseFloat(order.ap || '0'),
        origQty: parseFloat(order.q || '0'),
        executedQty: parseFloat(order.z || '0'),
        status,
        type: order.ot,
        side: order.S,
        stopPrice: parseFloat(order.sp || '0'),
        triggerPrice: parseFloat(order.sp || '0'),
        algoId: order.i, // SRE: Explicitly map algoId from UDS for watchdog consistency
        algoType: order.ot === 'STOP_MARKET' || order.ot === 'STOP' ? 'CONDITIONAL' : undefined,
        workingType: order.wt,
        reduceOnly: order.R,
        closePosition: order.cp,
        updateTime: order.T
      };
      if (existingIdx >= 0) currentOrders[existingIdx] = orderEntry;
      else currentOrders.push(orderEntry);
    }
    this.sessionState.realTimeOrders.set(symbol, currentOrders);

    // SRE: High-fidelity structured logging for all UDS updates to confirm stream health and event delivery.
    // Throttled to LOG level for TRADE, DEBUG for others.
    const udsMsg = `[UDS] ${executionType} ${status} for ${symbol}: Qty=${order.z}/${order.q}, Price=${order.ap || order.p}, Side=${side}, Type=${type}`;
    if (executionType === 'TRADE') {
      this.logger.log(udsMsg);
    } else {
      // REDUCE LOG NOISE: Silence non-TRADE updates like NEW/CANCELED to avoid stream spam
      // this.logger.debug(udsMsg);
    }

    // COMMISSION IDEMPOTENCY: Deduplicate based on unique Binance Trade ID ('t')
    const tradeId = order.t ? String(order.t) : null;
    let isDuplicateTrade = false;
    if (executionType === 'TRADE' && tradeId) {
      if (this.tradeExecutionCache.has(tradeId)) {
        isDuplicateTrade = true;
        this.logger.debug(`[Idempotency] Dropping duplicate trade execution for ${symbol} (TradeID: ${tradeId})`);
      }
      // Note: We don't commit to cache here; we do it during commission accumulation
      // to ensure we only deduplicate if commission was actually processed.
    }

    // Accuracy Improvement: Update trade entry/exit price from User Data Stream (ORDER_TRADE_UPDATE)
    if (executionType === 'TRADE' && !isDuplicateTrade) {
      const activeTrades = this.sessionState.activeTrades;
      let trade = activeTrades.find(t => t.symbol === symbol);

      // SRE: Race condition guard - if not in activeTrades, check if it's an in-flight entry
      if (!trade && clientOrderId) {
        trade = this.positionTracker.getInFlightEntry(symbol);
        if (trade) {
          this.logger.debug(`[UDS] Matched in-flight entry for ${symbol} via registry.`);
        }
      }

      if (trade) {
        const tradeIdShort8 = (trade.id || 'N/A').substring(0, 8);
        const avgPrice = parseFloat(order.ap || '0'); // 'ap' is average price in ORDER_TRADE_UPDATE
        const lastPrice = parseFloat(order.L || '0');
        const commission = parseFloat(order.n || '0');
        const tradeExecutionId = order.t ? String(order.t) : null;

        // CHRONOS: Accumulate authoritative commission from exchange slice
        // DEDUPLICATION: Use tradeExecutionId to prevent double-counting between REST and UDS
         if (commission > 0 && tradeExecutionId) {
           if (!isDuplicateTrade) {
              trade.realized_fee = roundEight((Number(trade.realized_fee) || 0) + commission);
              this.tradeExecutionCache.set(tradeExecutionId, Date.now());
              this.logger.debug(`[${tradeIdShort8}] [UDS] Accumulated commission for ${symbol}: ${commission}. Total: ${trade.realized_fee}`);
              this.cleanupExecutionCache();
           } else {
              this.logger.debug(`[${tradeIdShort8}] [UDS] Dropping duplicate commission for execution ${tradeExecutionId}`);
           }
        }

        // BOLT: Handle both REST order IDs and Client IDs for SL matching
        const isSlOrder =
          trade.binance_stop_order_id === orderId ||
          (clientOrderId && clientOrderId.startsWith(`sl-${tradeIdShort8}`));

        const isEntryOrder =
          trade.binance_order_id === orderId ||
          (clientOrderId && clientOrderId.startsWith(`ent-${tradeIdShort8}`));

        if (isSlOrder) {
          if (status === 'PARTIALLY_FILLED') {
            const totalQty = parseFloat(order.q || '0');
            const filledQty = parseFloat(order.z || '0');
            const remainingQty = roundEight(totalQty - filledQty);

            if (remainingQty >= 0 && Math.abs(trade.qty - remainingQty) > 0.00000001) {
              this.logger.log(`[${tradeIdShort8}] [Sync] Partial SL fill for ${symbol}: ${filledQty}/${totalQty}. Remaining: ${remainingQty}`);
              trade.qty = remainingQty;

              // SRE: Update real-time position cache to match exchange
              this.sessionState.realTimePositions.set(symbol, {
                amount: remainingQty,
                entryPrice: trade.entry_price
              });

              this.eventEmitter.emit(ENGINE_EVENTS.QUANTITY_SYNC, { symbol, qty: remainingQty });
            }
          }
          else if (status === 'FILLED') {
            const totalQty = parseFloat(order.q || '0');
            const metadata = { orderId, clientOrderId, avgPrice, lastPrice, rawPrice: order.p, status, executionType };
            this.logger.log(`[${tradeIdShort8}] Binance SL HIT for ${symbol}. Closing trade locally. Meta: ${JSON.stringify(metadata)}`);

            // CHRONOS: Restore trade.qty to the total order size (order.q) before closeTrade is called.
            if (totalQty > 0 && Math.abs(trade.qty - totalQty) > 0.00000001) {
              this.logger.debug(`[${tradeIdShort8}] [Sync] Restoring qty to ${totalQty} for final SL PnL calculation.`);
              trade.qty = totalQty;
            }

            let exitPrice = avgPrice || lastPrice || parseFloat(order.p || '0');
            if (exitPrice === 0) {
              const tickerPrice = this.tickerCache.getPrice(symbol);
              this.logger.warn(`[${tradeIdShort8}] Binance WS returned 0 price for ${symbol} SL. Using ticker fallback: ${tickerPrice}`);
              exitPrice = tickerPrice || trade.current_sl;
            }

            const slType = trade.current_sl === trade.initial_sl ? 'INITIAL_SL' : (trade.sl_adjustments?.length ? trade.sl_adjustments[trade.sl_adjustments.length - 1].reason : 'ADJUSTED_SL');
            const slLabel = formatSlType(slType);
            trade.exit_signal_reason = `EXCHANGE_${slType}: Hit at ${exitPrice}`;

            this.eventEmitter.emit(ENGINE_EVENTS.LOG_MESSAGE, {
              msg: `[${tradeIdShort8}] Exchange SL hit for ${symbol} at ${exitPrice} (${slLabel})`,
              level: 'info'
            });

            this.eventEmitter.emit('trade.exchange_close', {
              symbol,
              exitPrice,
              reason: `${EXIT_REASONS.SL_HIT}_${slType}`,
              orderId, // DATA-ACCURACY: Pass orderId for authoritative recovery
              feesAlreadyAccounted: true // CHRONOS: Signal that commissions were already handled via UDS 'n' events
            });
          }
        }
        else if (isEntryOrder) {
           this.logger.debug(`[${tradeIdShort8}] [UDS] Entry order update for ${symbol}: Status=${status}, Price=${avgPrice}, Qty=${order.z}/${order.q}`);
           if (avgPrice > 0 && trade.entry_price !== avgPrice) {
              this.logger.log(`[${tradeIdShort8}] [Sync] Updating entry price from UDS for ${symbol}: ${trade.entry_price} -> ${avgPrice}`);
              trade.entry_price = roundEight(avgPrice);

              // SRE: Proactively update the real-time position cache to prevent queryOrder fallbacks in SL placement
              this.sessionState.realTimePositions.set(symbol, {
                 amount: trade.qty,
                 entryPrice: trade.entry_price
              });
           }

           // Real-time Quantity Sync: Update trade quantity from UDS (ORDER_TRADE_UPDATE)
           // order.z is the cumulative filled quantity.
           const filledQty = parseFloat(order.z || '0');
           if (filledQty > 0 && Math.abs(trade.qty - filledQty) > 0.00000001) {
              this.logger.log(`[${tradeIdShort8}] [Sync] Updating quantity from UDS for ${symbol}: ${trade.qty} -> ${filledQty}`);
              trade.qty = filledQty;

              // SRE: Also update the real-time position cache
              this.sessionState.realTimePositions.set(symbol, {
                 amount: filledQty,
                 entryPrice: trade.entry_price
              });

              this.eventEmitter.emit(ENGINE_EVENTS.QUANTITY_SYNC, { symbol, qty: filledQty });
           }
        }
        else if (side !== (trade.direction === 'LONG' ? 'BUY' : 'SELL')) {
           if (status === 'FILLED') {
             // RESTORE: Set trade.qty to total order size for correct PnL calculation on final fill
             trade.qty = parseFloat(order.q || '0');

             this.logger.log(`[${tradeIdShort8}] Non-entry order FILLED for ${symbol} (${side}). Closing trade locally.`);
             let exitPrice = avgPrice || lastPrice || parseFloat(order.p || '0');

             if (exitPrice === 0) {
                const tickerPrice = this.tickerCache.getPrice(symbol);
                this.logger.warn(`[${tradeIdShort8}] Binance WS returned 0 price for ${symbol} fill. Using ticker fallback: ${tickerPrice}`);
                exitPrice = tickerPrice || trade.entry_price;
             }

             // Distinguish between app-initiated manual close and external exchange events
             const isAppManualClose = clientOrderId && clientOrderId.startsWith('cls-');
             let reason = EXIT_REASONS.EXCHANGE_FILL;

             if (isAppManualClose) {
               reason = EXIT_REASONS.MANUAL_CLOSE;
               trade.exit_signal_reason = `Manual close confirmed by exchange at ${exitPrice}`;
             } else {
               // External event (Manual close on Binance, or external TP/SL)
               if (type === 'TAKE_PROFIT' || type === 'TAKE_PROFIT_MARKET') {
                 reason = EXIT_REASONS.TP_HIT;
                 trade.exit_signal_reason = `External Take Profit hit on exchange at ${exitPrice}`;
               } else if (type === 'STOP' || type === 'STOP_MARKET') {
                 reason = EXIT_REASONS.SL_HIT;
                 trade.exit_signal_reason = `External Stop Loss hit on exchange at ${exitPrice}`;
               } else {
                 reason = EXIT_REASONS.EXCHANGE_SL_OR_MANUAL;
                 trade.exit_signal_reason = `External close on exchange at ${exitPrice} (Type: ${type})`;
               }
             }

             this.eventEmitter.emit('trade.exchange_close', {
               symbol,
               exitPrice,
               reason,
               orderId, // DATA-ACCURACY: Pass orderId to allow authoritative recovery
               feesAlreadyAccounted: true // CHRONOS: Signal that commissions were already handled via UDS 'n' events
             });
           } else if (status === 'PARTIALLY_FILLED') {
             // SYNC: Update trade.qty to remaining exchange quantity (q - z)
             const remainingQty = parseFloat(order.q || '0') - parseFloat(order.z || '0');
             if (remainingQty > 0) {
                this.logger.log(`[${tradeIdShort8}] [Sync] Partial exit fill for ${symbol}: ${order.z}/${order.q}. Updating remaining qty to ${remainingQty}`);
                trade.qty = remainingQty;

                // Update real-time position cache
                this.sessionState.realTimePositions.set(symbol, {
                   amount: remainingQty,
                   entryPrice: trade.entry_price
                });

                this.eventEmitter.emit(ENGINE_EVENTS.QUANTITY_SYNC, { symbol, qty: remainingQty });
             }
           }
        }
      } else {
        this.logger.debug(`[UDS] Received TRADE update for ${symbol} (${side}) but no local active trade matches.`);
      }
    } else if (status === 'EXPIRED' || status === 'CANCELED' || status === 'REJECTED') {
      const activeTrades = this.sessionState.activeTrades;
      const trade = activeTrades.find(t => t.symbol === symbol);
      if (trade) {
        const tradeIdShort8 = (trade.id || 'N/A').substring(0, 8);
        const isSlOrder =
          trade.binance_stop_order_id === orderId ||
          (clientOrderId && clientOrderId.startsWith(`sl-${tradeIdShort8}`));

        if (isSlOrder) {
          this.logger.warn(`[${tradeIdShort8}] [UDS] Stop Loss order ${status} for ${symbol}. Triggering reactive watchdog audit.`);
          // RE-01: Emit event for reactive audit. MaintenanceService will handle debouncing and guards.
          this.eventEmitter.emit('watchdog.reactive_audit', { symbol });
        }
      }
    }
  }


  private checkCircuitBreaker(): boolean {
    if (this.consecutiveFailures >= this.MAX_CONSECUTIVE_FAILURES) {
      const now = Date.now();
      if (now - this.circuitBreakerTrippedAt > this.CIRCUIT_BREAKER_RESET_TIMEOUT) {
        this.logger.log('Circuit breaker auto-reset timeout reached. Attempting recovery...');
        this.recordSuccess();
        return false;
      }
      return true;
    }
    return false;
  }

  private recordFailure(isSystemic = true) {
    if (!isSystemic) {
      this.logger.debug('Non-systemic failure recorded. Not incrementing global circuit breaker.');
      return;
    }

    this.consecutiveFailures++;
    if (this.consecutiveFailures === this.MAX_CONSECUTIVE_FAILURES) {
      this.circuitBreakerTrippedAt = Date.now();
      this.logger.error(`CRITICAL: Global Circuit Breaker TRIPPED after ${this.consecutiveFailures} consecutive systemic failures.`);
    } else {
      this.logger.warn(`Systemic failure recorded. Consecutive failures: ${this.consecutiveFailures}/${this.MAX_CONSECUTIVE_FAILURES}`);
    }
  }

  private recordSuccess() {
    if (this.consecutiveFailures > 0) {
      this.logger.log('Circuit breaker reset.');
    }
    this.consecutiveFailures = 0;
  }

  public getTakerFeeRate(): number {
    return this.takerFeeRate;
  }

  public getBinanceRateLimit() {
    return this.sessionState.getBinanceRateLimit();
  }

  async setBinanceClient(client: DerivativesTradingUsdsFutures | null, paperMode = true) {
    const isFirstCall = this.binanceClient === null;
    const isNewClient = !isFirstCall && this.binanceClient !== client;

    this.binanceClient = client;
    this.paperMode = paperMode;

    // RESEARCH-02: Load cached commission rate from DB on client change/restart
    if (this.binanceClient && !this.paperMode && this.lastFeeFetch === 0) {
      try {
        const settings = await this.settingsRepository.findOne({ where: { id: 'default' } });
        if (settings && settings.taker_fee_rate && settings.taker_fee_ts) {
          this.takerFeeRate = Number(settings.taker_fee_rate);
          this.lastFeeFetch = Number(settings.taker_fee_ts);
          this.logger.log(`Loaded cached commission rate from DB: ${(this.takerFeeRate * 100).toFixed(4)}% (Age: ${Math.round((Date.now() - this.lastFeeFetch) / 3600000)}h)`);
        }
      } catch (dbErr) {
        this.logger.debug(`Failed to load commission rate from DB: ${dbErr}`);
      }
    }

    // SRE: Commission rate is treated as permanent once fetched to eliminate REST weight.
    // It only refetches if the API key itself changes (detected by isNewClient during a hot-swap)
    // or if the DB cache is completely empty.
    const shouldFetchFee = this.binanceClient && !this.paperMode &&
      (this.lastFeeFetch === 0 || isNewClient);

    if (shouldFetchFee && this.binanceClient) {
      // SRE: Proactive Weight Gating - Defer non-critical commission fetch if weight is already high
      if (this.sessionState.isRateLimited(0.7)) {
        this.logger.warn(`[OrderManager] High API weight detected. Deferring commission rate fetch. Using default: ${this.takerFeeRate}`);
        return;
      }

      try {
        // v31.0.0+: Methods are directly on restAPI
        const response = await this.binanceClient.restAPI.userCommissionRate({ symbol: 'BTCUSDT' });
        const data = await response.data() as any;
        if (data && data.takerCommissionRate) {
          const rate = parseFloat(data.takerCommissionRate);
          if (!isNaN(rate)) {
            this.takerFeeRate = rate;
            this.lastFeeFetch = Date.now();
            this.logger.log(`Taker fee rate cached and persisted: ${(this.takerFeeRate * 100).toFixed(4)}%`);

            // RESEARCH-02: Ensure Commission Rate persistence in settings table
            try {
              await this.settingsRepository.update('default', {
                taker_fee_rate: this.takerFeeRate,
                taker_fee_ts: this.lastFeeFetch
              });
            } catch (dbErr) {
               this.logger.error(`Failed to persist commission rate to DB: ${dbErr}`);
            }
          } else {
            this.logger.warn(`Binance returned NaN for takerCommissionRate. Using default: ${this.takerFeeRate}`);
          }
        }
      } catch (err) {
        this.logger.warn(`Failed to fetch commission rate, using default: ${this.takerFeeRate}`);
      }
    }
  }

  private lastWeightLogTs = 0;
  private updateWeight(headers: any) {
    if (headers && this.sessionState) {
      // Handle both native Headers and plain objects
      const weight = (headers && typeof headers.get === 'function')
        ? headers.get('X-MBX-USED-WEIGHT-1M')
        : (headers ? (headers['x-mbx-used-weight-1m'] || headers['X-MBX-USED-WEIGHT-1M']) : null);

      if (weight) {
        const currentWeight = parseInt(weight, 10);
        if (!isNaN(currentWeight) && currentWeight >= 0) {
           // REDUCE LOG NOISE: Throttle weight logs to once per 10 seconds unless it's a warning
           const now = Date.now();
           if (now - this.lastWeightLogTs > 10000) {
              this.logger.debug(`Binance Weight Update: ${currentWeight}`);
              this.lastWeightLogTs = now;
           }

           if (typeof this.sessionState.updateRateLimit === 'function') {
              this.sessionState.updateRateLimit(currentWeight);
           }

           if (typeof this.sessionState.isRateLimited === 'function' && this.sessionState.isRateLimited(0.85)) {
              const limit = this.sessionState.binanceRateLimit?.limit || 2400;
              this.logger.warn(`Binance Rate Limit Warning: ${currentWeight}/${limit}`);
           }
        }
      }

      // Also update order rate limits (X-MBX-ORDER-COUNT)
      if (typeof this.sessionState.updateOrderRateLimits === 'function') {
         this.sessionState.updateOrderRateLimits(headers);
      }
    }
  }

  /**
   * DATA-07: Robust validation for both standard and algorithmic order responses.
   * Ensures that Stop Loss placement is confirmed active on the exchange before proceeding.
   */
  public validateStopLossPlacement(symbol: string, response: any): { isValid: boolean, orderId?: string } {
    if (!response) {
      this.logger.error(`[${symbol}] Received null or undefined order response payload from exchange.`);
      return { isValid: false };
    }

    // Fallback chain for status variants: 'algoStatus' for Algo Order API, 'status' for standard
    const status = (response.algoStatus || response.status || '').toUpperCase();
    // Fallback chain for identifiers: 'algoId' for Algo Order API, 'orderId' for standard
    const identifier = String(response.algoId || response.orderId || '');

    const validStatuses = ['NEW', 'FILLED', 'PARTIALLY_FILLED'];

    if (!status || !validStatuses.includes(status)) {
      this.logger.error(
        `[${symbol}] Stop Loss validation failed. Active status: [${status}]. Raw: ${JSON.stringify(response)}`
      );
      return { isValid: false };
    }

    this.logger.log(`[${symbol}] SL confirmed active on exchange. ID: ${identifier}`);
    return { isValid: true, orderId: identifier };
  }

  /**
   * BOLT OPTIMIZATION: Uses pre-parsed filter properties on the symbol object
   * to avoid repeated O(N) array searches and string-to-float conversions in the hot path.
   */
  /**
   * Applies exchange filters (LOT_SIZE, PRICE_FILTER, etc.) to price and quantity.
   * PERFORMANCE: Supports passing pre-fetched filters to avoid Map lookups in hot-paths.
   */
  public applyFilters(
    symbol: string,
    price: number,
    qty: number,
    options: {
      priceRounding?: 'round' | 'floor' | 'ceil',
      skipNotionalCheck?: boolean,
      clampToPercentPrice?: boolean,
      cachedFilters?: any
    } = {}
  ) {
    const filters = options.cachedFilters || this.marketFeed.getSymbolFilters(symbol);
    if (!filters) return { price, qty };

    let finalPrice = price;
    let finalQty = qty;

    const tickSize = filters.tickSize;
    if (tickSize > 0) {
      const rounding = options.priceRounding || 'round';
      if (rounding === 'floor') finalPrice = roundEight(Math.floor(price / tickSize) * tickSize);
      else if (rounding === 'ceil') finalPrice = roundEight(Math.ceil(price / tickSize) * tickSize);
      else finalPrice = roundEight(Math.round(price / tickSize) * tickSize);
    }

    // PERCENT_PRICE Validation & Clamping
    if (filters.multiplierUp && !this.paperMode) {
      const ticker = this.tickerCache.getTicker(symbol);
      const markPrice = ticker?.mark_price || ticker?.price;
      if (markPrice) {
        const maxPrice = markPrice * filters.multiplierUp;
        const minPrice = markPrice * filters.multiplierDown;

        if (finalPrice > maxPrice || finalPrice < minPrice) {
          if (options.clampToPercentPrice) {
             const prevPrice = finalPrice;
             finalPrice = Math.min(Math.max(finalPrice, minPrice), maxPrice);
             // Re-apply tick size rounding after clamping
             if (tickSize > 0) {
               finalPrice = roundEight(Math.round(finalPrice / tickSize) * tickSize);
             }
             this.logger.log(`${symbol}: Price ${prevPrice} clamped to PERCENT_PRICE band edge ${finalPrice} (Mark: ${markPrice})`);
          } else {
            const isStopLossOrTp = !!options.skipNotionalCheck;

            if (!isStopLossOrTp) {
              this.logger.warn(`${symbol}: Price ${finalPrice} outside PERCENT_PRICE band [${minPrice.toFixed(5)}, ${maxPrice.toFixed(5)}] (Mark: ${markPrice})`);
              if (Math.abs(finalPrice - markPrice) / markPrice > 0.05) {
                 this.logger.error(`${symbol}: CRITICAL - Price too far from Mark. Rejecting order.`);
                 return { price: finalPrice, qty: 0 };
              }
            } else {
              const deviation = Math.abs(finalPrice - markPrice) / markPrice;
              if (deviation > 0.1) {
                this.logger.warn(`${symbol}: SL/TP Price ${finalPrice} significantly far from Mark (${(deviation * 100).toFixed(2)}%). Proceeding with filtered price.`);
              }
            }
          }
        }
      }
    }

    if (filters.stepSize > 0) {
      finalQty = floorStep(qty, filters.stepSize);

      // Support for MARKET_LOT_SIZE to prevent "Quantity greater than max quantity" errors
      if (filters.marketMaxQty !== undefined) {
        if (finalQty > filters.marketMaxQty) {
          this.logger.warn(`${symbol}: Quantity ${finalQty} exceeds MARKET_LOT_SIZE maxQty ${filters.marketMaxQty}. Clamping.`);
          finalQty = filters.marketMaxQty;
        }
        if (finalQty < filters.marketMinQty && finalQty > 0) {
          this.logger.warn(`${symbol}: Quantity ${finalQty} below MARKET_LOT_SIZE minQty ${filters.marketMinQty}.`);
          finalQty = 0; // Block entry
        }
      }
    }

    // MIN_NOTIONAL Check
    if (!options.skipNotionalCheck && filters.minNotional !== undefined) {
      if (finalQty * finalPrice < filters.minNotional) {
        this.logger.warn(`${symbol}: Order notional ${finalQty * finalPrice} is below minimum ${filters.minNotional}`);
        return { price: finalPrice, qty: 0 }; // Zero qty will block entry
      }
    }

    return { price: finalPrice, qty: finalQty };
  }

  /**
   * Set leverage for a symbol on Binance (Feature Disabled)
   */
  async setLeverage(symbol: string, leverage: number): Promise<boolean> {
    // Feature disabled as per user request to avoid exchange sync issues
    return true;
  }

  async enter(
    sessionId: string,
    symbol: string,
    direction: 'LONG' | 'SHORT',
    entryPrice: number,
    qty: number,
    slPrice: number,
    tpPrice: number | null,
    metadata: Pick<Trade, 'strategy_label' | 'strategy_config' | 'entry_daily_change_pct'> = {},
  ): Promise<ExecutionResult<Trade>> {
    const filters = this.marketFeed.getSymbolFilters(symbol);

    if (this.checkCircuitBreaker()) {
      return { status: ExecutionStatus.CIRCUIT_OPEN, error: 'Circuit breaker is open' };
    }

    if (this.sessionState.agreementRequired) {
      return { status: ExecutionStatus.ORDER_REJECTED, error: 'Exchange agreement required. Please check Binance.' };
    }

    // Zero-CPU Rate Limiter Guard
    if (!this.paperMode) {
      if (this.sessionState.isRateLimited(0.92)) {
        const currentWeight = this.sessionState.binanceRateLimit.used_1m;
        this.logger.warn(`Approaching Binance rate limit (${currentWeight}). Blocking entry for ${symbol}.`);
        return { status: ExecutionStatus.CIRCUIT_OPEN, error: 'Rate limit protection active' };
      }
      if (this.sessionState.isOrderRateLimited(1)) {
        this.logger.warn(`Approaching Binance order count limit. Blocking entry for ${symbol}.`);
        return { status: ExecutionStatus.CIRCUIT_OPEN, error: 'Order rate limit protection active' };
      }
    }
    
    try {
      // PERF: Fetch filters once and reuse across all filter operations
      const filtered = this.applyFilters(symbol, entryPrice, qty, { cachedFilters: filters });
      const filteredSl = this.applyFilters(symbol, slPrice, qty, { skipNotionalCheck: true, cachedFilters: filters }).price;
      const filteredTp = tpPrice ? this.applyFilters(symbol, tpPrice, qty, { skipNotionalCheck: true, cachedFilters: filters }).price : null;

      entryPrice = filtered.price;
      qty = filtered.qty;
      slPrice = filteredSl;
      tpPrice = filteredTp;

      // Fail early if no filters found for live mode
      if (!this.paperMode && !filters) {
        this.logger.error(`Live order rejected: No exchange filters found for ${symbol} in current environment.`);
        return { status: ExecutionStatus.ORDER_REJECTED, error: `Symbol ${symbol} is not tradable in the current environment.` };
      }

      if (qty <= 0) {
        this.logger.warn(`${symbol}: Position size too small after LOT_SIZE filtering.`);
        return { status: ExecutionStatus.ORDER_REJECTED, error: 'Position size too small after LOT_SIZE filtering.' };
      }

      // Immediate parameter validation
      if (!symbol || qty <= 0) {
        this.logger.error(`Invalid entry parameters: symbol=${symbol}, qty=${qty}`);
        return { status: ExecutionStatus.ORDER_REJECTED, error: 'Invalid entry parameters' };
      }

      const trade = {
        id: uuid(),
        symbol,
        direction,
        entry_price: entryPrice,
        qty,
        initial_sl: slPrice,
        current_sl: slPrice,
        tp: tpPrice,
        entry_ts: new Date(),
        max_rr_achieved: 0.0,
        rr_sequence_index: -1,
        sl_adjustments: [],
        status: 'OPEN',
        entry_signal_type: 'combo',
        entry_signal_confidence: 1.0,
        pnl: 0,
        realized_fee: 0,
        funding_fee: 0,
        pnl_pct: 0,
        risk_usdt: roundEight(Math.max(0, direction === 'LONG' ? entryPrice - slPrice : slPrice - entryPrice) * qty),
        initial_risk_usdt: roundEight(Math.max(0, direction === 'LONG' ? entryPrice - slPrice : slPrice - entryPrice) * qty),
        sessionId,
        strategy_label: metadata.strategy_label,
        strategy_config: metadata.strategy_config,
        entry_daily_change_pct: metadata.entry_daily_change_pct,
        updated_at: new Date(),
      } as Trade;

      // In live mode, attempt to place actual order using batchOrders for zero-cost network optimization
      if (!this.paperMode && this.binanceClient) {
        let attempts = 0;
        const MAX_ATTEMPTS = 3;
        let lastError: any = null;

        while (attempts < MAX_ATTEMPTS) {
        try {
          attempts++;
          const binanceDirection = direction === 'LONG' ? 'BUY' : 'SELL';
          const closeDirection = direction === 'LONG' ? 'SELL' : 'BUY';
          const filters = this.marketFeed.getSymbolFilters(symbol);

          // BOLT OPTIMIZATION: Use pre-parsed precisions from filters
          const qtyPrecision = filters?.qtyPrecision ?? 8;
          const pricePrecision = filters?.pricePrecision ?? 8;

          const entryOrderId = `ent-${trade.id.replace(/-/g, '').substring(0, 20)}`;
          if (entryOrderId.length > 36) {
             this.logger.error(`[${symbol}] CRITICAL: Generated ClientOrderId too long: ${entryOrderId}`);
          }

          // SRE: Register in-flight entry to prevent UDS race conditions
          this.positionTracker.setInFlight(symbol, trade);

          const entryOrder = {
            symbol,
            side: binanceDirection as any,
            type: 'MARKET',
            quantity: Number(qty || 0).toFixed(qtyPrecision),
            newOrderRespType: 'RESULT',
            newClientOrderId: entryOrderId,
            selfTradePreventionMode: 'EXPIRE_MAKER', // Hardening: Prevent self-trading
          };

          this.logger.log(`Placing entry order (Attempt ${attempts}): ${JSON.stringify(entryOrder)}`);
          let response;
          try {
            response = await this.binanceClient.restAPI.newOrder(entryOrder as any);
          } catch (e) {
            this.positionTracker.clearInFlight(symbol);
            throw e;
          }

          this.updateWeight(response?.headers);
          const entryReceipt = await response.data() as any;
          this.logger.log(`Entry receipt: ${JSON.stringify(entryReceipt)}`);

          // REST COMMISSION SYNC: Cache trade IDs and sum commissions from the response fills
          if (entryReceipt.fills && Array.isArray(entryReceipt.fills)) {
            let totalEntryCommission = 0;
            for (const fill of entryReceipt.fills) {
              if (fill.tradeId) {
                const tradeIdStr = String(fill.tradeId);
                if (!this.tradeExecutionCache.has(tradeIdStr)) {
                  this.tradeExecutionCache.set(tradeIdStr, Date.now());
                  if (fill.commission) {
                    totalEntryCommission += parseFloat(fill.commission);
                  }
                }
              }
            }
            if (totalEntryCommission > 0) {
              this.logger.debug(`[${symbol}] [Sync] Adding commissions from REST entry fills: ${totalEntryCommission}`);
              trade.realized_fee = roundEight((Number(trade.realized_fee) || 0) + totalEntryCommission);
            }
            this.cleanupExecutionCache();
          }

          if (entryReceipt.code && entryReceipt.code !== 0) {
            const code = entryReceipt.code;
            const msg = entryReceipt.msg || '';
            this.logger.warn(`[${symbol}] Entry order failed. Code: ${code}, Message: ${msg}, Raw: ${JSON.stringify(entryReceipt)}`);

            // Handle Duplicate Order ID specifically to recover state
            if (code === -2011 || msg.includes('Duplicate orderSent') || msg.includes('Duplicate clientOrderId')) {
               this.logger.log(`[${symbol}] [Sync] Detected duplicate clientOrderId on entry retry. Recovering order state...`);
               const queryRes = await this.binanceClient.restAPI.queryOrder({ symbol, origClientOrderId: entryOrderId });
               const queryData = await queryRes.data() as any;
               if (queryData && queryData.orderId) {
                  this.logger.log(`[${symbol}] [Sync] Successfully recovered existing order state for duplicate ID: ${queryData.orderId} (Status: ${queryData.status})`);
                  entryReceipt.orderId = queryData.orderId;
                  entryReceipt.avgPrice = queryData.avgPrice || queryData.price;
                  entryReceipt.executedQty = queryData.executedQty;
                  entryReceipt.status = queryData.status;
               } else {
                  this.logger.error(`[${symbol}] [Sync] Order ID duplicate detected but query failed or returned no data: ${msg}`);
                  throw new Error(`Order ID duplicate but query failed: ${msg}`);
               }
            } else {
               this.logger.warn(`[${symbol}] Entry order rejected by exchange: ${msg} (Code: ${code})`);
               throw new Error(`Entry order failed: ${msg}`);
            }
          }

          trade.binance_order_id = entryReceipt.orderId;

          // BOLT: Proactively seed real-time order cache to reduce subsequent REST weight
          const entryOrderEntry = {
            symbol,
            orderId: parseFloat(String(entryReceipt.orderId)),
            clientOrderId: entryReceipt.clientOrderId || entryOrderId,
            price: parseFloat(entryReceipt.price || '0'),
            avgPrice: parseFloat(entryReceipt.avgPrice || '0'),
            origQty: parseFloat(entryReceipt.origQty || trade.qty.toString()),
            executedQty: parseFloat(entryReceipt.executedQty || '0'),
            status: entryReceipt.status,
            type: entryReceipt.type || 'MARKET',
            side: entryReceipt.side || (direction === 'LONG' ? 'BUY' : 'SELL'),
            reduceOnly: false,
            updateTime: entryReceipt.updateTime || Date.now()
          };
          const currentOrders = this.sessionState.realTimeOrders.get(symbol) || [];
          this.sessionState.realTimeOrders.set(symbol, [...currentOrders.filter(o => String(o.orderId) !== String(entryReceipt.orderId)), entryOrderEntry]);

          // IDEMPOTENCY: Mark entry as executed to avoid duplicate UDS processing
          if (entryReceipt.status === 'FILLED' || entryReceipt.executedQty === entryReceipt.origQty) {
             this.markAsExecuted(symbol, String(entryReceipt.orderId));
          }

          // Zero-RAM Price Tracking: Extract exact execution details from REST response
          // Finding 1: Canonical fill price extraction is cumQuote / executedQty
          let absoluteEntryPrice = 0;
          if (entryReceipt.cumQuote && entryReceipt.executedQty) {
             const cumQuote = parseFloat(entryReceipt.cumQuote);
             const executedQty = parseFloat(entryReceipt.executedQty);
             if (executedQty > 0) {
                absoluteEntryPrice = cumQuote / executedQty;
                this.logger.log(`Derived ${symbol} entry price from cumQuote: ${absoluteEntryPrice}`);
             }
          }

          if (absoluteEntryPrice === 0) {
            absoluteEntryPrice = parseFloat(entryReceipt.avgPrice || entryReceipt.price || '0');
          }

          if (absoluteEntryPrice === 0 && entryReceipt.fills && Array.isArray(entryReceipt.fills) && entryReceipt.fills.length > 0) {
             const totalQty = entryReceipt.fills.reduce((sum: number, fill: any) => sum + parseFloat(fill.qty), 0);
             const weightedSum = entryReceipt.fills.reduce((sum: number, fill: any) => sum + parseFloat(fill.qty) * parseFloat(fill.price), 0);
             if (totalQty > 0) absoluteEntryPrice = weightedSum / totalQty;
          }

          // DATA-CONSISTENCY: Fallback for 0 price responses.
          // BOLT: Prioritize UDS. If UDS is connected, it will provide the entry price via ACCOUNT_UPDATE.
          // We only call queryOrder (Weight 1) if absoluteEntryPrice is still 0 after a 500ms debounce to allow UDS arrival.
          if (absoluteEntryPrice === 0 && trade.binance_order_id) {
             await new Promise(resolve => setTimeout(resolve, 500));

             if (this.sessionState.realTimePositions.has(symbol)) {
                absoluteEntryPrice = this.sessionState.realTimePositions.get(symbol)!.entryPrice;
                if (absoluteEntryPrice > 0) {
                   this.logger.debug(`[${symbol}] [Sync] Using UDS-cached entry price: ${absoluteEntryPrice}`);
                }
             }

             if (absoluteEntryPrice === 0) {
                try {
                   this.logger.log(`[${symbol}] [Sync] Binance returned 0 price for entry and UDS cache empty. Fetching authoritative price via queryOrder...`);
                   const queryRes = await this.binanceClient.restAPI.queryOrder({ symbol, orderId: BigInt(trade.binance_order_id) });
                   const queryData = await queryRes.data() as any;
                   absoluteEntryPrice = parseFloat(queryData.avgPrice || queryData.price || '0');
                   if (absoluteEntryPrice > 0) {
                     this.logger.log(`[${symbol}] [Sync] Successfully fetched authoritative entry price: ${absoluteEntryPrice}`);
                   }
                } catch (queryErr) {
                   this.logger.warn(`[${symbol}] [Sync] Failed to fetch authoritative price: ${queryErr instanceof Error ? queryErr.message : String(queryErr)}`);
                }
             }
          }

          // FINAL FALLBACK: If still 0, try ticker cache then estimated price
          if (absoluteEntryPrice === 0) {
             const tickerPrice = this.tickerCache.getPrice(symbol);
             if (tickerPrice && tickerPrice > 0) {
                this.logger.log(`[${symbol}] [Sync] Using ticker cache fallback for entry: ${tickerPrice}`);
                absoluteEntryPrice = tickerPrice;
             } else {
                this.logger.warn(`Authoritative price query and ticker cache failed for ${symbol} entry. Using estimated price ${entryPrice}.`);
                absoluteEntryPrice = entryPrice;
             }
          }

          const executedQty = parseFloat(entryReceipt.executedQty || '0');

          if (absoluteEntryPrice > 0) {
            const slippageValidation = await this.validateSlippage(
              symbol,
              trade,
              entryPrice,
              absoluteEntryPrice,
              slPrice,
              metadata.strategy_config
            );

            if (!slippageValidation.isValid) {
              this.positionTracker.clearInFlight(symbol);
              return { status: ExecutionStatus.ORDER_REJECTED, error: slippageValidation.error };
            }

            trade.entry_price = roundEight(absoluteEntryPrice);
          }
          if (executedQty > 0) trade.qty = executedQty;

          // Recalculate SL after actual fill to maintain intended risk distance
          const originalDistance = Math.abs(entryPrice - slPrice);
          slPrice = direction === 'LONG' ? trade.entry_price - originalDistance : trade.entry_price + originalDistance;
          trade.current_sl = trade.initial_sl = slPrice;

          // Zero-Cost Math Estimation for fees (FALLBACK ONLY if REST fills didn't provide it)
          if (trade.realized_fee === 0) {
            const notionalValue = (trade.qty || 0) * (trade.entry_price || 0);
            const fee = notionalValue * (this.takerFeeRate || 0.0004);
            trade.realized_fee = roundEight(isNaN(fee) ? 0 : fee);
          }

          entryPrice = trade.entry_price;
          qty = trade.qty;

          // Re-calculate risk USDT with actual entry price
          trade.risk_usdt = roundEight(Math.max(0, direction === 'LONG' ? trade.entry_price - slPrice : slPrice - trade.entry_price) * trade.qty);
          trade.initial_risk_usdt = trade.risk_usdt;

          // Combined log for entry
          const msg = `Binance order placed: ${symbol} ${direction} @ ${trade.entry_price} qty=${qty} order_id=${entryReceipt.orderId} est_fee=${trade.realized_fee} SL=${slPrice}`;
          this.logger.log(msg);
          this.eventEmitter.emit(ENGINE_EVENTS.LOG_MESSAGE, { msg, level: 'info' });

          // Issue #3: Check for agreement requirement in responses (though usually it comes as an error)
          if (entryReceipt.msg && entryReceipt.msg.includes('agreement')) {
             const agreementMsg = `CRITICAL: ${entryReceipt.msg}. Please go to Binance and sign the required agreement to enable live trading.`;
             this.eventEmitter.emit(ENGINE_EVENTS.LOG_MESSAGE, { msg: agreementMsg, level: 'error' });
          }

          await this.auditLog.log({
            action: 'LIVE_ORDER_ENTRY',
            resourceId: trade.id,
            details: { symbol, direction, qty, orderId: entryReceipt.orderId }
          });

          // Place SL separately. Pass actual fill price for immediate-breach guard.
          // SRE: Proactively update real-time positions map so SL placement can use the most fresh data if UDS hasn't arrived yet
          this.sessionState.realTimePositions.set(symbol, { amount: trade.qty, entryPrice: trade.entry_price });

          const slResult = await this.placeStopLoss(trade, slPrice, trade.entry_price);
          if (slResult?.orderId === 'TRIGGERED_LOCALLY') {
             this.logger.log(`[${trade.id.substring(0, 8)}] SL for ${symbol} was triggered locally during entry. Trade will be handled by event-driven closure.`);
             // CHRONOS: Return SL_FAILED to prevent ExecutionService from re-adding this closed trade as 'OPEN'
             return { status: ExecutionStatus.SL_FAILED, data: trade, error: 'Stop loss triggered locally during entry' };
          }
          if (!slResult || slResult.error) {
            const slError = slResult?.error || 'Unknown SL placement error';
            this.logger.warn(`SL placement failed for ${symbol}: ${slError}. Performing emergency unwind...`);
            try {
              const unwindResult = await this.closeTrade(symbol, trade, entryPrice, EXIT_REASONS.SL_PLACEMENT_FAILURE);
              if (unwindResult.exitOccurred) {
                this.positionTracker.clearInFlight(symbol);
                return { status: ExecutionStatus.SL_FAILED, data: trade, unwindPerformed: true, error: slError };
              } else {
                throw new Error(`Emergency unwind failed after SL error: ${slError}`);
              }
            } catch (unwindErr) {
              this.logger.error(`CRITICAL: Emergency unwind failed for ${symbol}: ${unwindErr instanceof Error ? unwindErr.message : String(unwindErr)}`);
              throw new ExchangeExecutionException(`SL placement failed (${slError}) and emergency unwind also failed for ${symbol}`);
            }
          }
          break; // Success, exit retry loop

        } catch (err: unknown) {
          if (err instanceof ExchangeExecutionException) {
            // SRE: Ensure cleanup on re-thrown exceptions
            this.positionTracker.clearInFlight(symbol);
            throw err;
          }
          const errMsg = err instanceof Error ? err.message : String(err);
          const isNetworkError = errMsg.includes('Network error') || errMsg.includes('timeout') || errMsg.includes('ECONNRESET') || errMsg.includes('ETIMEDOUT');

          if (isNetworkError && attempts < MAX_ATTEMPTS) {
             this.logger.warn(`Network error during entry for ${symbol}. Retrying (Attempt ${attempts + 1}/${MAX_ATTEMPTS})...`);
             await new Promise(resolve => setTimeout(resolve, 1000 * attempts));
             continue;
          }

          // CHRONOS: Ensure in-flight cleanup on all entry failure paths
          this.positionTracker.clearInFlight(symbol);

          if (trade.binance_order_id) {
            this.logger.error(`[${symbol}] Critical Failure: Unexpected error after market entry: ${errMsg}`);
            throw new ExchangeExecutionException(`Unexpected error after market entry for ${symbol}: ${errMsg}`);
          }

          let agreementMsg = `[${symbol}] Binance entry failed: ${errMsg}`;
          if (errMsg.includes('agreement') || errMsg.includes('TradFi-Perps')) {
            agreementMsg = `CRITICAL: Binance agreement required. Please sign TradFi-Perps on Binance website. (${errMsg})`;
            this.sessionState.agreementRequired = true;
          } else if (errMsg.includes('insufficient balance') || errMsg.includes('Margin is insufficient') || errMsg.includes('-2019') || errMsg.includes('-2010')) {
            agreementMsg = `CRITICAL: Insufficient funds on Binance USDS-M account to open ${symbol} (Error -2019/-2010).`;
          } else if (errMsg.includes('PERCENT_PRICE')) {
            agreementMsg = `CRITICAL: ${symbol} entry failed. Price outside protection bands (PERCENT_PRICE). Try increasing SL distance.`;
          } else if (errMsg.includes('leverage') || errMsg.includes('allowable position') || errMsg.includes('max allowable position') || errMsg.includes('position at current leverage')) {
            agreementMsg = `CRITICAL: Position limit exceeded at current leverage for ${symbol}. Adjust leverage on Binance.`;
          }

          this.logger.error(agreementMsg);
          this.eventEmitter.emit(ENGINE_EVENTS.LOG_MESSAGE, { msg: agreementMsg, level: 'error' });

          const isSystemic = !errMsg.includes('agreement') &&
                             !errMsg.includes('TradFi-Perps') &&
                             !errMsg.includes('balance') &&
                             !errMsg.includes('Margin') &&
                             !errMsg.includes('PERCENT_PRICE') &&
                             !errMsg.includes('leverage') &&
                             !errMsg.includes('position') &&
                             !errMsg.includes('quantity') &&
                             !errMsg.includes('Algo Order API');
          this.recordFailure(isSystemic);
          return { status: ExecutionStatus.ORDER_REJECTED, error: agreementMsg };
        }
        }
      } else if (this.paperMode) {
        // Simulate paper entry fee (taker rate)
        trade.realized_fee = roundEight(entryPrice * qty * ENGINE_CONSTANTS.SIMULATED_FEE_RATE);
      }

    // Initialize PnL as net of entry fees (immediately realized)
    trade.pnl = roundEight(-(trade.realized_fee || 0));

    // REDUCE LOG NOISE: Combined with "Binance order placed" above for live mode
    if (this.paperMode) {
      const msgEnter = `Enter (Paper): ${symbol} ${direction} @ ${entryPrice} qty=${qty} SL=${slPrice} TP=${tpPrice}`;
      this.logger.log(msgEnter);
      this.eventEmitter.emit(ENGINE_EVENTS.LOG_MESSAGE, { msg: msgEnter, level: 'info' });
    }

    this.recordSuccess();
      return { status: ExecutionStatus.SUCCESS, data: trade };
    } catch (error) {
      if (error instanceof ExchangeExecutionException) throw error;
      this.logger.error(`Enter failed: ${error instanceof Error ? error.message : String(error)}`);
      return { status: ExecutionStatus.UNSPECIFIED_ERROR, error: error instanceof Error ? error.message : String(error) };
    }
  }

  /**
   * Place a STOP_MARKET order on Binance for stop loss protection
   */
  async placeStopLoss(trade: Trade, slPrice: number, fillPrice?: number): Promise<{ orderId: string; price: number, error?: string } | null> {
    let currentSlPrice = slPrice;
    let adaptiveAttempts = 0;
    const MAX_ADAPTIVE_ATTEMPTS = 3;

    // Outer loop for Adaptive Buffer Strategy
    adaptiveLoop: while (adaptiveAttempts <= MAX_ADAPTIVE_ATTEMPTS) {
    const filtered = this.applyFilters(trade.symbol, currentSlPrice, trade.qty, { skipNotionalCheck: true });
    currentSlPrice = filtered.price;

    // IMMEDIATE TRIGGER GUARD: Check if current price already breached SL
    let currentMarketPrice = fillPrice;
    if (currentMarketPrice === undefined || currentMarketPrice === 0) {
      const ticker = this.tickerCache.getTicker(trade.symbol);
      currentMarketPrice = ticker?.mark_price || ticker?.price;
    }

    if (currentMarketPrice && currentMarketPrice > 0) {
      const isBreached = trade.direction === 'LONG' ? currentMarketPrice <= currentSlPrice : currentMarketPrice >= currentSlPrice;
      if (isBreached) {
        // PROFITABILITY GUARD: Only adapt if current SL is already in profit (above breakeven)
        // Breakeven includes a 0.1% buffer for taker fees (0.04% * 2 + safety)
        const feeBuffer = 0.001;
        const isProfitable = trade.direction === 'LONG'
           ? currentSlPrice >= trade.entry_price * (1 + feeBuffer)
           : currentSlPrice <= trade.entry_price * (1 - feeBuffer);

        // DATA-07: For reconciliation trades, we allow adaptation even if not strictly "profitable"
        // to give the system a chance to protect the position without immediate closure.
        const canAdapt = adaptiveAttempts < MAX_ADAPTIVE_ATTEMPTS && (isProfitable || trade.is_reconciliation);

        if (canAdapt) {
           adaptiveAttempts++;
           const multiplier = Math.pow(2, adaptiveAttempts);
           const config = this.sessionState.config;
           const bufferPct = (config?.trailing_guard_buffer_pct ?? CONFIG_LIMITS.TRAILING_GUARD_DEFAULT) * multiplier;

           let adjustedSl: number;
           if (trade.direction === 'LONG') {
              adjustedSl = currentMarketPrice * (1 - bufferPct / 100);
              // Hard floor at entry price to ensure we don't turn a profit into a loss
              adjustedSl = Math.max(adjustedSl, trade.entry_price * (1 + feeBuffer));
           } else {
              adjustedSl = currentMarketPrice * (1 + bufferPct / 100);
              adjustedSl = Math.min(adjustedSl, trade.entry_price * (1 - feeBuffer));
           }

           const logMsg = `[Adaptive SL] Pre-emptive breach for ${trade.symbol}. Multiplier x${multiplier}: ${currentSlPrice.toFixed(5)} -> ${adjustedSl.toFixed(5)} (Attempt ${adaptiveAttempts}/${MAX_ADAPTIVE_ATTEMPTS})`;
           this.logger.warn(logMsg);
           this.eventEmitter.emit(ENGINE_EVENTS.LOG_MESSAGE, { msg: logMsg, level: 'warn' });

           currentSlPrice = adjustedSl;
               continue adaptiveLoop;
        }

        this.logger.warn(`[${trade.id.substring(0, 8)}] ${trade.symbol} SL ${currentSlPrice} already breached by price ${currentMarketPrice}. Adaptive limit reached or not profitable. Closing.`);
        const slType = trade.current_sl === trade.initial_sl ? 'INITIAL_SL' : (trade.sl_adjustments?.length ? trade.sl_adjustments[trade.sl_adjustments.length - 1].reason : 'ADJUSTED_SL');
        this.eventEmitter.emit('trade.exchange_close', {
          symbol: trade.symbol,
          exitPrice: currentMarketPrice,
          reason: `${EXIT_REASONS.SL_HIT}_${slType}`,
          feesAlreadyAccounted: false // Local trigger, fee not yet accounted by UDS
        });
        return { orderId: 'TRIGGERED_LOCALLY', price: currentSlPrice };
      }
    }

    if (this.paperMode || !this.binanceClient || !trade.binance_order_id) return null;

    // BOLT: Fail early if no filters found for live mode to prevent "Invalid symbol"
    if (!this.marketFeed.getSymbolFilters(trade.symbol)) {
      this.logger.error(`Live SL rejected: No exchange filters found for ${trade.symbol} in current environment.`);
      return null;
    }

    // PERFORMANCE: Implement retry for network errors
    let networkAttempts = 0;
    const MAX_NETWORK_ATTEMPTS = 2;

    while (networkAttempts < MAX_NETWORK_ATTEMPTS) {
    const closeDirection = trade.direction === 'LONG' ? 'SELL' : 'BUY';
    const filters = this.marketFeed.getSymbolFilters(trade.symbol);
    const symbol = trade.symbol;

    try {
      networkAttempts++;

      // BOLT OPTIMIZATION: Use pre-parsed precisions from filters
      const pricePrecision = filters?.pricePrecision ?? 8;
      const qtyPrecision = filters?.qtyPrecision ?? 8;

      // INDUSTRY-BEST-PRACTICE (2026): Adaptive SL Placement Strategy.
      // We prioritize the Algo Order API (CONDITIONAL) as it is more reliable for certain accounts,
      // but fall back to standard STOP_MARKET with closePosition: true for universal compatibility.
      const slOrderParams: any = {
        symbol,
        side: closeDirection as any,
        algoType: 'CONDITIONAL',
        type: 'STOP_MARKET',
        quantity: Number(trade.qty || 0).toFixed(qtyPrecision),
        triggerPrice: Number(currentSlPrice || 0).toFixed(pricePrecision),
        workingType: 'MARK_PRICE',
        newClientOrderId: `sl-${trade.id.substring(0, 8)}`,
        reduceOnly: true,
        priceProtect: true
      };

      this.logger.log(`Placing Binance Algo SL order: ${JSON.stringify(slOrderParams)}`);

      let stopLossId: string | null = null;
      let orderType: 'standard' | 'algo' = 'algo';

      try {
        const response = await this.binanceClient.restAPI.newAlgoOrder(slOrderParams as any);
        this.updateWeight(response?.headers);
        const orderData = await response.data() as any;

        if (orderData.code && orderData.code !== 0) {
          const code = orderData.code;
          const msg = orderData.msg || '';
            this.logger.warn(`[${symbol}] SL placement failed. Code: ${code}, Message: ${msg}, Raw: ${JSON.stringify(orderData)}`);

          // Handle Duplicate Order ID specifically to recover state after timeout
          if (code === -2011 || msg.includes('Duplicate orderSent') || msg.includes('Duplicate clientOrderId')) {
            this.logger.log(`[${symbol}] [Sync] Detected duplicate clientOrderId on SL retry. Recovering SL state...`);
            // Algo orders might need a different query endpoint or different parameters
            const queryRes = await this.binanceClient.restAPI.queryOrder({ symbol, origClientOrderId: slOrderParams.newClientOrderId });
            const queryData = await queryRes.data() as any;
            if (queryData && queryData.orderId) {
              this.logger.log(`[${symbol}] [Sync] Successfully recovered existing SL order state: ${queryData.orderId}`);
              stopLossId = String(queryData.orderId);
            } else {
              this.logger.error(`[${symbol}] [Sync] SL Order ID duplicate detected but query failed or returned no data: ${msg}`);
              throw new Error(`SL Order ID duplicate but query failed: ${msg}`);
            }
          } else if (code === -2021) {
            // Adaptive Buffer Strategy: If profitable, try widening buffer
            const feeBuffer = 0.001;
            const isProfitable = trade.direction === 'LONG'
               ? currentSlPrice >= trade.entry_price * (1 + feeBuffer)
               : currentSlPrice <= trade.entry_price * (1 - feeBuffer);

            const canAdapt = adaptiveAttempts < MAX_ADAPTIVE_ATTEMPTS && (isProfitable || trade.is_reconciliation);

            if (canAdapt) {
               adaptiveAttempts++;
               const multiplier = Math.pow(2, adaptiveAttempts);
               const config = this.sessionState.config;
               const bufferPct = (config?.trailing_guard_buffer_pct ?? CONFIG_LIMITS.TRAILING_GUARD_DEFAULT) * multiplier;

               const ticker = this.tickerCache.getTicker(symbol);
               const refPrice = ticker?.mark_price || ticker?.price || currentMarketPrice || currentSlPrice;

               let adjustedSl: number;
               if (trade.direction === 'LONG') {
                  adjustedSl = refPrice * (1 - bufferPct / 100);
                  adjustedSl = Math.max(adjustedSl, trade.entry_price * (1 + feeBuffer));
               } else {
                  adjustedSl = refPrice * (1 + bufferPct / 100);
                  adjustedSl = Math.min(adjustedSl, trade.entry_price * (1 - feeBuffer));
               }

               const logMsg = `[Adaptive SL] Binance rejected -2021 for ${trade.symbol}. Multiplier x${multiplier}: ${currentSlPrice.toFixed(5)} -> ${adjustedSl.toFixed(5)} (Attempt ${adaptiveAttempts}/${MAX_ADAPTIVE_ATTEMPTS})`;
               this.logger.warn(logMsg);
               this.eventEmitter.emit(ENGINE_EVENTS.LOG_MESSAGE, { msg: logMsg, level: 'warn' });

               currentSlPrice = adjustedSl;
               continue adaptiveLoop;
            }

            const warnMsg = `[${symbol}] SL REJECTED: Price overran target (Code: -2021). Forcing emergency local close.`;
            this.logger.warn(warnMsg);
            this.eventEmitter.emit(ENGINE_EVENTS.LOG_MESSAGE, { msg: warnMsg, level: 'warn' });
            const slType = trade.current_sl === trade.initial_sl ? 'INITIAL_SL' : (trade.sl_adjustments?.length ? trade.sl_adjustments[trade.sl_adjustments.length - 1].reason : 'ADJUSTED_SL');
            this.eventEmitter.emit('trade.exchange_close', {
              symbol,
              exitPrice: this.tickerCache.getPrice(symbol) || currentSlPrice,
              reason: `${EXIT_REASONS.SL_HIT}_${slType}`,
              feesAlreadyAccounted: false,
              needsMarketClose: true
            });
            return { orderId: 'TRIGGERED_LOCALLY', price: currentSlPrice };
          } else if (code === -4044 || code === -4045 || code === -1116) {
            // "Account position is empty", "Position side does not match", or "ReduceOnly invalid" - Already closed!
            const syncMsg = `[${symbol}] SL REJECTED: Position already closed on exchange (Code: ${code}). Syncing state.`;
            this.logger.log(syncMsg);
            this.eventEmitter.emit(ENGINE_EVENTS.LOG_MESSAGE, { msg: syncMsg, level: 'info' });
            this.eventEmitter.emit('trade.exchange_close', {
               symbol,
               exitPrice: this.tickerCache.getPrice(symbol) || trade.entry_price,
               reason: EXIT_REASONS.EXCHANGE_SYNC,
               feesAlreadyAccounted: false
            });
            return { orderId: 'TRIGGERED_LOCALLY', price: trade.entry_price };
          } else {
            const errorMsg = `[${symbol}] SL REJECTED: ${msg} (Code: ${code})`;
            this.logger.warn(errorMsg);
            this.eventEmitter.emit(ENGINE_EVENTS.LOG_MESSAGE, { msg: errorMsg, level: 'warn' });
            return { orderId: '', price: 0, error: msg };
          }
        } else {
          const validation = this.validateStopLossPlacement(symbol, orderData);
          if (validation.isValid) {
            stopLossId = validation.orderId!;
          } else {
            throw new Error(`Stop Loss validation failed for ${symbol}`);
          }
        }
      } catch (err: any) {
        const msg = err.message || '';
        if (msg.includes('Order type not supported') || msg.includes('-4120')) {
          this.logger.warn(`[${symbol}] Algo Order API not supported or failed. Falling back to standard STOP_MARKET...`);
          const standardParams = { ...slOrderParams };
          delete standardParams.algoType;
          standardParams.type = 'STOP_MARKET';
          // COMPLIANCE: Standard API uses stopPrice, while Algo API used triggerPrice
          (standardParams as any).stopPrice = standardParams.triggerPrice;
          delete (standardParams as any).triggerPrice;
          // Use closePosition for standard path immunity
          (standardParams as any).closePosition = true;
          delete (standardParams as any).reduceOnly;

          try {
            const fallbackRes = await this.binanceClient.restAPI.newOrder(standardParams as any);
            const fallbackData = await fallbackRes.data() as any;
            const validation = this.validateStopLossPlacement(symbol, fallbackData);
            if (validation.isValid) {
              stopLossId = validation.orderId!;
              orderType = 'standard';
              this.logger.log(`Standard SL fallback successful: ${stopLossId}`);
            } else {
              throw new Error(fallbackData.msg || 'Fallback failed validation');
            }
          } catch (fallbackErr: any) {
            this.logger.error(`Standard SL fallback failed: ${fallbackErr.message}`);
            return { orderId: '', price: 0, error: fallbackErr.message };
          }
        } else if (msg.includes('Order would immediately trigger') || msg.includes('-2021') || msg.includes('-2010') || msg.includes('-4115') || msg.includes('-4118')) {
          // Adaptive Buffer Strategy (Exception variant)
          const feeBuffer = 0.001;
          const isProfitable = trade.direction === 'LONG'
             ? currentSlPrice >= trade.entry_price * (1 + feeBuffer)
             : currentSlPrice <= trade.entry_price * (1 - feeBuffer);

          const canAdapt = adaptiveAttempts < MAX_ADAPTIVE_ATTEMPTS && (isProfitable || trade.is_reconciliation);

          if (canAdapt) {
             adaptiveAttempts++;
             const multiplier = Math.pow(2, adaptiveAttempts);
             const config = this.sessionState.config;
             const bufferPct = (config?.trailing_guard_buffer_pct ?? CONFIG_LIMITS.TRAILING_GUARD_DEFAULT) * multiplier;

             const ticker = this.tickerCache.getTicker(symbol);
             const refPrice = ticker?.mark_price || ticker?.price || currentMarketPrice || currentSlPrice;

             let adjustedSl: number;
             if (trade.direction === 'LONG') {
                adjustedSl = refPrice * (1 - bufferPct / 100);
                adjustedSl = Math.max(adjustedSl, trade.entry_price * (1 + feeBuffer));
             } else {
                adjustedSl = refPrice * (1 + bufferPct / 100);
                adjustedSl = Math.min(adjustedSl, trade.entry_price * (1 - feeBuffer));
             }

             const logMsg = `[Adaptive SL] Binance rejected SL (exception) for ${trade.symbol}. Multiplier x${multiplier}: ${currentSlPrice.toFixed(5)} -> ${adjustedSl.toFixed(5)} (Attempt ${adaptiveAttempts}/${MAX_ADAPTIVE_ATTEMPTS})`;
             this.logger.warn(logMsg);
             this.eventEmitter.emit(ENGINE_EVENTS.LOG_MESSAGE, { msg: logMsg, level: 'warn' });

             currentSlPrice = adjustedSl;
             continue adaptiveLoop;
          }

          const warnMsg = `[${symbol}] SL REJECTED: Price protection or trigger breach (Code: ${msg}). Forcing emergency close.`;
          this.logger.warn(warnMsg);
          this.eventEmitter.emit(ENGINE_EVENTS.LOG_MESSAGE, { msg: warnMsg, level: 'warn' });
          const slType = trade.current_sl === trade.initial_sl ? 'INITIAL_SL' : (trade.sl_adjustments?.length ? trade.sl_adjustments[trade.sl_adjustments.length - 1].reason : 'ADJUSTED_SL');
          this.eventEmitter.emit('trade.exchange_close', {
            symbol,
            exitPrice: this.tickerCache.getPrice(symbol) || currentSlPrice,
            reason: `${EXIT_REASONS.SL_HIT}_${slType}`,
            feesAlreadyAccounted: false,
            needsMarketClose: true
          });
          return { orderId: 'TRIGGERED_LOCALLY', price: currentSlPrice };
        } else if (msg.includes('Account position is empty') || msg.includes('-4044') || msg.includes('-4045') || msg.includes('-4141') || msg.includes('-1116')) {
          const syncMsg = `[${symbol}] SL REJECTED: Position mismatch or closed (Code: ${msg}). Syncing state.`;
          this.logger.log(syncMsg);
          this.eventEmitter.emit(ENGINE_EVENTS.LOG_MESSAGE, { msg: syncMsg, level: 'info' });
          this.eventEmitter.emit('trade.exchange_close', {
             symbol,
             exitPrice: this.tickerCache.getPrice(symbol) || trade.entry_price,
             reason: EXIT_REASONS.EXCHANGE_SYNC,
             feesAlreadyAccounted: false
          });
          return { orderId: 'TRIGGERED_LOCALLY', price: trade.entry_price };
        } else if (msg.includes('Duplicate orderSent') || msg.includes('Duplicate clientOrderId')) {
          this.logger.log(`[${symbol}] [Sync] Detected duplicate clientOrderId (via exception) on SL retry. Recovering SL state...`);
          const queryRes = await this.binanceClient.restAPI.queryOrder({ symbol, origClientOrderId: slOrderParams.newClientOrderId });
          const queryData = await queryRes.data() as any;
          if (queryData && queryData.orderId) {
            this.logger.log(`[${symbol}] [Sync] Successfully recovered existing SL order state: ${queryData.orderId}`);
            stopLossId = String(queryData.orderId);
          } else {
            this.logger.error(`[${symbol}] [Sync] SL Order ID duplicate (exception) but query failed or returned no data.`);
            throw err;
          }
        } else {
          return { orderId: '', price: 0, error: err.message || String(err) };
        }
      }

      if (!stopLossId || stopLossId === 'undefined') {
        throw new Error(`Invalid response from Binance SL order placement`);
      }
      trade.binance_stop_order_id = stopLossId;
      trade.binance_stop_order_type = orderType;

      // BOLT: Proactively seed real-time order cache for SL to ensure watchdog awareness
      const slOrderEntry = {
        symbol,
        orderId: orderType === 'algo' ? 0 : parseFloat(stopLossId),
        algoId: orderType === 'algo' ? parseFloat(stopLossId) : undefined,
        algoType: orderType === 'algo' ? 'CONDITIONAL' : undefined,
        clientOrderId: slOrderParams.newClientOrderId,
        triggerPrice: currentSlPrice,
        stopPrice: currentSlPrice,
        origQty: trade.qty,
        quantity: trade.qty,
        status: 'NEW',
        type: 'STOP_MARKET',
        side: closeDirection,
        reduceOnly: true,
        closePosition: orderType === 'standard',
        updateTime: Date.now()
      };
      const currentSlOrders = this.sessionState.realTimeOrders.get(symbol) || [];
      this.sessionState.realTimeOrders.set(symbol, [...currentSlOrders.filter(o => String(o.orderId || o.algoId) !== stopLossId), slOrderEntry]);

      // Accuracy: Ensure local tracking reflects the final price used for placement
      if (trade.current_sl !== currentSlPrice) {
         this.logger.log(`[${trade.symbol}] Syncing local SL to adaptive placement price: ${trade.current_sl} -> ${currentSlPrice.toFixed(5)}`);
         trade.current_sl = currentSlPrice;
      }

      const msgSl = `Binance SL order placed: ${trade.symbol} at ${currentSlPrice.toFixed(5)} (ID: ${stopLossId})`;
      this.logger.log(msgSl);
      this.eventEmitter.emit(ENGINE_EVENTS.LOG_MESSAGE, { msg: msgSl, level: 'info' });

      await this.auditLog.log({
        action: 'LIVE_SL_ORDER_PLACED',
        resourceId: trade.id,
        details: { symbol: trade.symbol, slPrice: currentSlPrice, orderId: stopLossId, adaptive: adaptiveAttempts > 0 }
      });
      trade.updated_at = new Date();
      return { orderId: String(stopLossId), price: currentSlPrice };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      const isNetworkError = errMsg.includes('Network error') || errMsg.includes('timeout') || errMsg.includes('ECONNRESET');

      if (isNetworkError && networkAttempts < MAX_NETWORK_ATTEMPTS) {
        this.logger.warn(`Network error placing SL for ${trade.symbol}. Retrying (Attempt ${networkAttempts + 1}/${MAX_NETWORK_ATTEMPTS})...`);
        await new Promise(resolve => setTimeout(resolve, 1000));
        continue;
      }

      // BOLT: Handle existing order conflict. If a closePosition order already exists or max stop orders reached, clear it and retry.
      if ((errMsg.includes('existing') && (errMsg.includes('closePosition') || errMsg.includes('GTE'))) || errMsg.includes('-2027')) {
         this.logger.warn(`[${trade.symbol}] [Sync] SL conflict detected (${errMsg}). Executing aggressive symbol flush...`);
         try {
            // Aggressive symbol flush to clear ANY conflicting orders (Standard or Algo)
            const flushRes = await this.binanceClient.restAPI.cancelAllOpenOrders({ symbol: trade.symbol });
            this.updateWeight(flushRes?.headers);

            if (networkAttempts < MAX_NETWORK_ATTEMPTS) {
              this.logger.log(`[${trade.symbol}] [Sync] Aggressive flush complete. Retrying SL placement (Attempt ${networkAttempts + 1})...`);
              continue;
            }
         } catch (cleanupErr) {
            this.logger.error(`Failed to cleanup orphan conflict for ${trade.symbol}: ${cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr)}`);
         }
      } else if ((errMsg.includes('Time in Force') || errMsg.includes('GTE')) && networkAttempts < MAX_NETWORK_ATTEMPTS) {
         this.logger.warn(`Transient SL error for ${trade.symbol}: ${errMsg}. Retrying (Attempt ${networkAttempts + 1}/${MAX_NETWORK_ATTEMPTS})...`);
         await new Promise(resolve => setTimeout(resolve, 500));
         continue;
      }

      this.logger.warn(`Failed to place Binance SL for ${trade.symbol}: ${errMsg}`);

      const isSystemic = errMsg.includes('Margin is insufficient') ||
                         errMsg.includes('Too many requests') ||
                         errMsg.includes('Invalid API-key') ||
                         errMsg.includes('-4001') ||
                         errMsg.includes('-2010') ||
                         errMsg.includes('-1015') ||
                         errMsg.includes('-1003') ||
                         errMsg.includes('-2015') ||
                         errMsg.includes('-1111') ||
                         errMsg.includes('-1102') ||
                         errMsg.includes('-4016');
      this.recordFailure(isSystemic);

      if (errMsg.includes('insufficient balance') || errMsg.includes('Margin is insufficient')) {
         this.eventEmitter.emit(ENGINE_EVENTS.LOG_MESSAGE, {
            msg: `CRITICAL: Insufficient funds for SL placement on ${trade.symbol}. Unwind may be required.`,
            level: 'error'
         });
      } else if (errMsg.includes('agreement') || errMsg.includes('TradFi-Perps')) {
         this.sessionState.agreementRequired = true;
         this.eventEmitter.emit(ENGINE_EVENTS.LOG_MESSAGE, {
            msg: `CRITICAL: Agreement required for ${trade.symbol} SL placement. Please sign the TradFi-Perps agreement on Binance.`,
            level: 'error'
         });
      }

      return null;
    }
    }

    // If we reached here, it means we exited the inner network loop without success or continue.
    // Usually this is because network attempts were exhausted.
    break;
    }
    return null;
  }

  /**
   * Update an existing stop loss without protection gaps (Ratcheting)
   */
  async updateStopLoss(trade: Trade, newSlPrice: number, prevSlPrice?: number): Promise<{ success: boolean, price?: number }> {
    if (this.paperMode || !this.binanceClient || !trade.binance_order_id) return { success: true, price: newSlPrice };

    // SRE: Mutex guard to prevent concurrent overlapping ratchets
    if (this.ratchetLocks.has(trade.symbol)) {
       this.logger.warn(`[SL Ratchet] Concurrent update blocked for ${trade.symbol}. Ratchet already in progress.`);
       return { success: false };
    }

    // LOCK: Prevent Watchdog from interfering during the cancel/replace window
    this.ratchetLocks.set(trade.symbol, true);

    const oldSlPrice = prevSlPrice || trade.current_sl;
    const oldStopOrderId = trade.binance_stop_order_id;
    const oldStopOrderType = trade.binance_stop_order_type;

    try {
      // 1. Explicitly cancel existing tracked SL order if it exists
      if (trade.binance_stop_order_id) {
         this.logger.debug(`[SL] Canceling existing tracked SL ${trade.binance_stop_order_id} before replacement.`);
         const cancelSuccess = await this.cancelBinanceOrder(trade.symbol, trade.binance_stop_order_id, trade.binance_stop_order_type || 'standard');
         if (!cancelSuccess) {
            this.logger.error(`[SL Ratchet] Cancellation of ${oldStopOrderId} failed for ${trade.symbol}. Aborting ratchet to prevent ghost orders.`);
            return { success: false };
         }
         trade.binance_stop_order_id = undefined;
      }

      // 2. Audit check for any untracked or duplicate deterministic SLs
      const deterministicClientId = `sl-${trade.id.substring(0, 8)}`;
      let exchangeState: any = null;

      try {
        const queryRes = await this.binanceClient.restAPI.queryOrder({
          symbol: trade.symbol,
          origClientOrderId: deterministicClientId
        });
        exchangeState = await queryRes.data();
      } catch (e: any) {
        this.logger.debug(`[SL] No existing order with ID ${deterministicClientId} found via query.`);
      }

      if (exchangeState && exchangeState.orderId) {
        const status = exchangeState.status?.toUpperCase();
        if (status === 'NEW' || status === 'PARTIALLY_FILLED') {
           const currentExchangeSl = parseFloat(exchangeState.stopPrice || exchangeState.triggerPrice || '0');

           // If it already matches our target, we can adopt it instead of replacing
           if (Math.abs(currentExchangeSl - newSlPrice) / newSlPrice < 0.0001) {
              this.logger.log(`[SL] Adopted existing order ${exchangeState.orderId} matches target price ${newSlPrice}.`);
              trade.binance_stop_order_id = String(exchangeState.orderId);
              trade.binance_stop_order_type = exchangeState.algoType ? 'algo' : 'standard';
              return { success: true, price: currentExchangeSl };
           }

           this.logger.debug(`[SL] Replacing untracked/duplicate SL ${exchangeState.orderId} at ${currentExchangeSl}.`);
           await this.cancelBinanceOrder(trade.symbol, String(exchangeState.orderId), exchangeState.algoType ? 'algo' : 'standard');
        }
      }

      let result;
      try {
        result = await this.placeStopLoss(trade, newSlPrice);
      } catch (placeErr: any) {
        this.logger.error(`[SL Ratchet] Exception during placement for ${trade.symbol}: ${placeErr.message}`);
      }

      if (!result || !result.orderId || result.orderId === '') {
         // INDUSTRY-BEST-PRACTICE: Rollback to previous SL if new placement fails to ensure position remains protected
         this.logger.error(`[SL Ratchet] Replacement failed for ${trade.symbol}. Attempting ROLLBACK to previous SL ${oldSlPrice}...`);

         try {
           const rollbackResult = await this.placeStopLoss(trade, oldSlPrice);

           if (rollbackResult && rollbackResult.orderId && rollbackResult.orderId !== '') {
              this.logger.log(`[SL Ratchet] Rollback successful for ${trade.symbol}. Position is protected at ${rollbackResult.price}.`);
           } else {
              throw new Error('Rollback placement returned empty');
           }
         } catch (rollbackErr: any) {
            this.logger.error(`[FATAL] SL Rollback FAILED for ${trade.symbol}. Position is UNPROTECTED on exchange! Error: ${rollbackErr.message}`);
            this.eventEmitter.emit(ENGINE_EVENTS.LOG_MESSAGE, {
              msg: `FATAL: SL Ratchet failure for ${trade.symbol} and rollback also failed. Position UNPROTECTED!`,
              level: 'error'
            });
         }
         return { success: false };
      }

      trade.updated_at = new Date();
      return { success: true, price: result.price };
    } catch (err: any) {
       this.logger.error(`[SL Ratchet] Unexpected exception during ratchet for ${trade.symbol}: ${err.message}`);
       return { success: false };
    } finally {
      this.ratchetLocks.delete(trade.symbol);
    }
  }

  /**
   * Check if a symbol is currently being ratcheted
   */
  isRatcheting(symbol: string): boolean {
    return this.ratchetLocks.get(symbol) === true;
  }


  /**
   * Cancel an order on Binance
   */
  async cancelBinanceOrder(symbol: string, orderId: string, orderType: 'standard' | 'algo' = 'standard'): Promise<boolean> {
    if (this.paperMode || !this.binanceClient) return true;

    try {
      const response = orderType === 'algo'
        ? await this.binanceClient.restAPI.cancelAlgoOrder({ symbol, algoId: orderId } as any)
        : await this.binanceClient.restAPI.cancelOrder({ symbol, orderId: BigInt(orderId) });

      this.updateWeight(response?.headers);
      const data = await response.data();
      this.logger.log(`Binance ${orderType} order canceled: ${symbol} order_id=${orderId}. Response: ${JSON.stringify(data)}`);
      return true;
    } catch (err) {
      // If order is already filled or canceled, we can ignore the error
      const errMsg = err instanceof Error ? err.message : String(err);
      const upperMsg = errMsg.toUpperCase();
      if (upperMsg.includes('ORDER HAS BEEN FILLED') || upperMsg.includes('UNKNOWN_ORDER') || upperMsg.includes('UNKNOWN ORDER')) {
        this.logger.debug(`Order ${orderId} already closed: ${errMsg}`);
        return true;
      }
      this.logger.warn(`Failed to cancel Binance order ${orderId}: ${errMsg}`);

      const isSystemic = errMsg.includes('Invalid API-key') ||
                         errMsg.includes('Too many requests') ||
                         errMsg.includes('-1015') ||
                         errMsg.includes('-1003') ||
                         errMsg.includes('-2015');
      if (isSystemic) this.recordFailure(true);

      return false;
    }
  }

  public async fetchAllOpenOrders(): Promise<any[]> {
    if (!this.binanceClient) return [];
    try {
      this.monitoringService.incrementApiRequests();
      // Use standard endpoint
      const response = await this.binanceClient.restAPI.currentAllOpenOrders();
      this.updateWeight(response?.headers);
      const standardOrders = (await response.data() as any[]) || [];

      // Also fetch algorithmic orders (Stop Losses)
      const algoOrders = await this.fetchAllOpenAlgoOrders();

      const allOrders = [...standardOrders, ...algoOrders];

      // Proactively seed the real-time order cache to eliminate subsequent REST weight
      const ordersBySymbol = new Map<string, any[]>();
      for (const o of allOrders) {
        const list = ordersBySymbol.get(o.symbol) || [];
        list.push(o);
        ordersBySymbol.set(o.symbol, list);
      }
      for (const [symbol, list] of ordersBySymbol.entries()) {
        this.sessionState.realTimeOrders.set(symbol, list);
      }

      return allOrders;
    } catch (err) {
      this.logger.warn(`Failed to fetch all open orders: ${err instanceof Error ? err.message : String(err)}`);
      return [];
    }
  }

  public async fetchAllOpenAlgoOrders(): Promise<any[]> {
    if (!this.binanceClient) return [];
    try {
      this.monitoringService.incrementApiRequests();
      const response = await this.binanceClient.restAPI.currentAllAlgoOpenOrders();
      this.updateWeight(response?.headers);
      const data = await response.data() as any;
      if (Array.isArray(data)) return data;
      if (data && Array.isArray(data.orders)) return data.orders;
      return [];
    } catch (err) {
      this.logger.warn(`Failed to fetch all open algo orders: ${err instanceof Error ? err.message : String(err)}`);
      return [];
    }
  }


  checkExitSignals(
    symbol: string,
    trade: Trade,
    config: SessionConfig,
    interval: string = '1m',
  ): { exitTriggered: boolean; exitSignalType?: string } {
    if (!config.exit_signals || config.exit_signals.length === 0) {
      return { exitTriggered: false };
    }

    // BOLT OPTIMIZATION: Use pre-existing Date instance or convert once
    const entryTs = (trade.entry_ts instanceof Date)
      ? trade.entry_ts.getTime()
      : (trade.entry_ts ? new Date(trade.entry_ts).getTime() : 0);
    const tradeAgeSec = entryTs > 0 ? (Date.now() - entryTs) / 1000 : 0;

    const statuses: Record<string, { fired: boolean, active: boolean, remaining_delay: number, label: string, value: number, threshold: number, unit: string, description?: string, insufficientData?: boolean, threshold_is_price?: boolean }> = {};
    const delays = config.exit_signal_delays || {};
    const logic = config.exit_signal_logic || 'any';

    let firedCount = 0;
    let activeCount = 0;

    // BOLT OPTIMIZATION: Call signalEngine once for all exit signals
    const consolidatedResult = this.signalEngine.checkEntry(
      symbol,
      { ...config, enabled_signals: config.exit_signals },
      interval,
      trade.direction,
      'exit'
    );

    // Check each exit signal
    for (const exitSignal of config.exit_signals) {
      try {
        const delay = delays[exitSignal] || 0;
        const isActive = tradeAgeSec >= delay;
        const remaining = Math.max(0, delay - tradeAgeSec);

        const detail = consolidatedResult.details ? consolidatedResult.details[exitSignal] : null;
        const isFired = !!(detail?.fired || (consolidatedResult.firedSignals.includes(exitSignal)));

        statuses[exitSignal] = {
          fired: isFired,
          active: isActive,
          remaining_delay: remaining,
          label: detail?.metric || exitSignal,
          value: detail?.value ?? (isFired ? 1 : 0),
          threshold: detail?.threshold ?? 1,
          unit: detail?.unit ?? '%',
          description: detail?.description || `Signal ${exitSignal} ${isFired ? 'fired' : 'not fired'}`,
          insufficientData: detail?.insufficientData,
          threshold_is_price: detail?.threshold_is_price,
        };

        if (isFired && isActive) {
          firedCount++;
        }
        if (isActive) {
          activeCount++;
        }
      } catch (err) {
        this.logger.debug(
          `Exit signal ${exitSignal} processing error: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    // Update trade status for frontend
    trade.exit_signals_status = statuses;
    // BOLT OPTIMIZATION: Pre-calculate JSON string for hot-loop change detection
    trade._sig_json = JSON.stringify(statuses);

    const allEnabled = config.exit_signals.length;
    let exitTriggered = false;
    let exitSignalType: string | undefined;

    if (logic === 'any') {
      exitTriggered = firedCount > 0;
      if (exitTriggered) {
        exitSignalType = Object.keys(statuses).find(k => statuses[k].fired && statuses[k].active);
      }
    } else {
      // 'all' logic: all signals must be active AND fired
      exitTriggered = firedCount === allEnabled && activeCount === allEnabled;
      if (exitTriggered) {
        exitSignalType = 'combined';
      }
    }

    if (exitTriggered) {
      this.logger.log(`Exit triggered for ${symbol} via ${logic.toUpperCase()} logic (signals fired: ${firedCount}/${allEnabled})`);
    }

    return { exitTriggered, exitSignalType };
  }

  public async fetchAllPositions(): Promise<any[]> {
    if (!this.binanceClient) return [];
    if (!this.paperMode && this.sessionState.isRateLimited(0.95)) return [];
    try {
      this.monitoringService.incrementApiRequests();
      // Finding 7: Use V3 for targeted active positions
      const response = await this.binanceClient.restAPI.positionInformationV3();
      this.updateWeight(response.headers);
      const data = await response.data() as any;
      if (!Array.isArray(data)) {
        // SENTINEL: Avoid stringifying potentially large or sensitive response objects.
        throw new Error(`Invalid position data received (type: ${typeof data})`);
      }
      return data;
    } catch (err) {
      this.logger.error(`Failed to fetch all positions: ${err instanceof Error ? err.message : String(err)}`);
      throw err; // Rethrow so Watchdog doesn't assume 0 positions
    }
  }

  public async fetchOpenOrders(symbol: string, options: { forceFresh?: boolean } = {}): Promise<any[]> {
    if (!options.forceFresh) {
      const cached = this.sessionState.realTimeOrders.get(symbol);
      if (cached) return cached;
    }

    if (!this.binanceClient) return [];
    if (!this.paperMode && this.sessionState.isRateLimited(0.95)) return [];
    try {
      this.monitoringService.incrementApiRequests();
      // 1. Fetch standard orders
      const res = await this.binanceClient.restAPI.currentAllOpenOrders({ symbol });
      this.updateWeight(res?.headers);
      const standardOrders = (await res.data() as any[]) || [];

      // 2. Fetch algorithmic orders (Stop Losses)
      const algoOrders = await this.fetchOpenAlgoOrders(symbol, { forceFresh: true });

      const allOrders = [...standardOrders, ...algoOrders];
      this.sessionState.realTimeOrders.set(symbol, allOrders);
      return allOrders;
    } catch (err) {
      this.logger.debug(`[${symbol}] Failed to fetch open orders: ${err instanceof Error ? err.message : String(err)}`);
      return [];
    }
  }

  public async fetchOpenAlgoOrders(symbol: string, options: { forceFresh?: boolean } = {}): Promise<any[]> {
    if (!this.binanceClient) return [];
    try {
      this.monitoringService.incrementApiRequests();
      const response = await this.binanceClient.restAPI.currentAllAlgoOpenOrders({ symbol });
      this.updateWeight(response?.headers);
      const data = await response.data() as any;
      if (Array.isArray(data)) return data;
      if (data && Array.isArray(data.orders)) return data.orders;
      return [];
    } catch (err) {
      this.logger.warn(`[${symbol}] Failed to fetch open algo orders: ${err instanceof Error ? err.message : String(err)}`);
      return [];
    }
  }


  private cleanupExecutionCache() {
    const now = Date.now();
    for (const [key, timestamp] of this.executionCache.entries()) {
      if (now - timestamp > this.EXECUTION_CACHE_TTL) {
        this.executionCache.delete(key);
      }
    }
    for (const [key, timestamp] of this.tradeExecutionCache.entries()) {
      if (now - timestamp > this.EXECUTION_CACHE_TTL) {
        this.tradeExecutionCache.delete(key);
      }
    }
  }

  private markAsExecuted(symbol: string, orderId: string, status: string = 'FILLED') {
    const cacheKey = `${symbol}_${orderId}_${status}`;
    this.executionCache.set(cacheKey, Date.now());
    this.cleanupExecutionCache();
  }

  public seedRealTimePosition(symbol: string, amount: number, entryPrice: number) {
    this.sessionState.realTimePositions.set(symbol, { amount, entryPrice });
  }

  public async fetchPosition(symbol: string, options: { forceFresh?: boolean } = {}): Promise<any | null> {
    // Zero-Weight Path: Prefer local real-time cache from User Data Stream
    if (!options.forceFresh) {
      const cached = this.sessionState.realTimePositions.get(symbol);
      if (cached) {
         return {
            symbol,
            positionAmt: String(cached.amount),
            entryPrice: String(cached.entryPrice),
            unRealizedProfit: '0', // Not critical for closure checks
            positionSide: 'BOTH'
         };
      }
    }

    if (!this.binanceClient) return null;
    // BOLT: Proactive Rate Limit - Skip position fetching if near limits
    if (this.sessionState.isRateLimited(0.9)) {
       this.logger.debug(`Skipping fetchPosition for ${symbol} due to high rate limit usage`);
       return null;
    }
    try {
      // BOLT: Verify symbol exists in exchange info before calling API to prevent "Invalid symbol"
      if (!this.marketFeed.getSymbolFilters(symbol)) {
        this.logger.warn(`fetchPosition: Symbol ${symbol} not found in exchangeInfo for current environment.`);
        return null;
      }
      // Finding 7: Use V3 for targeted active positions
      const response = await this.binanceClient.restAPI.positionInformationV3({ symbol });
      this.updateWeight(response?.headers);
      const data = await response.data() as any;

      if (Array.isArray(data)) {
        // Find position with non-zero amount (Hedge Mode support)
        const activePosition = data.find(p => parseFloat(p.positionAmt) !== 0);
        // Update local cache for future zero-weight calls
        if (activePosition) {
           this.sessionState.realTimePositions.set(symbol, {
              amount: parseFloat(activePosition.positionAmt),
              entryPrice: parseFloat(activePosition.entryPrice)
           });
        }
        // If no active position, return the 'BOTH' side if available, or just the first one
        return activePosition || data.find(p => p.positionSide === 'BOTH') || data[0];
      }
      return data;
    } catch (err) {
      this.logger.warn(`Failed to fetch position for ${symbol}: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  }

  public async recoverClosingContext(symbol: string, trade: Trade, estimate: number, targetOrderId?: string): Promise<{ price: number, reason?: string }> {
    if (!this.binanceClient || this.paperMode) return { price: estimate };
    try {
      let orderId = targetOrderId;

      // If no orderId provided, try to find the most recent one in trade history
      if (!orderId) {
        const tradesRes = await this.binanceClient.restAPI.accountTradeList({ symbol, limit: 10 });
        const trades = await tradesRes.data() as any;
        if (Array.isArray(trades) && trades.length > 0) {
          const closeDirection = trade.direction === 'LONG' ? 'SELL' : 'BUY';
          // Sort by time descending to get the most recent fills
          const closingTrades = trades.filter(t => t.side === closeDirection).sort((a, b) => b.time - a.time);

          if (closingTrades.length > 0) {
            const lastFill = closingTrades[0];

            // DATA-CONSISTENCY: Ensure the fill is recent (within last 5 minutes)
            if (Date.now() - Number(lastFill.time) > 300000) {
              this.logger.warn(`[${(trade.id || 'N/A').substring(0, 8)}] Sync Recovery: Found fill for ${symbol} but it is too old. Ignoring.`);
            } else {
              orderId = lastFill.orderId;
            }
          }
        }
      }

      if (orderId) {
         try {
            this.logger.log(`[Sync] Recovering authoritative order context for ID ${orderId}...`);
            const orderRes = await this.binanceClient.restAPI.queryOrder({ symbol, orderId: BigInt(orderId) });
            const orderData = await orderRes.data() as any;

            if (orderData && orderData.type) {
                const fillPrice = parseFloat(orderData.avgPrice || orderData.price || '0');

                // SRE: Price sanity check against estimate
                if (estimate > 0 && fillPrice > 0 && Math.abs(fillPrice - estimate) / estimate > 0.05) {
                   this.logger.warn(`[Sync] Recovered price ${fillPrice} for ${symbol} deviates significantly from estimate ${estimate}. Using authoritative price anyway.`);
                }
                   const type = orderData.type;
                   const clientOrderId = orderData.clientOrderId;
                   let reason = undefined;

                   // SRE: Map exchange order type to engine-specific EXIT_REASONS
                   if (type === 'TAKE_PROFIT' || type === 'TAKE_PROFIT_MARKET') {
                      reason = EXIT_REASONS.TP_HIT;
                   } else if (type === 'STOP' || type === 'STOP_MARKET') {
                      // Distinguish between initial SL and ratchet milestones if possible
                      const isInitial = Math.abs(parseFloat(orderData.stopPrice || orderData.triggerPrice || '0') - trade.initial_sl) < trade.initial_sl * 0.0001;
                      const slType = isInitial ? 'INITIAL_SL' : (trade.sl_adjustments?.length ? trade.sl_adjustments[trade.sl_adjustments.length - 1].reason : 'ADJUSTED_SL');

                      // BOLT: Explicitly map milestone-based SLs to TRAILING_STOP for better UI awareness
                      if (!isInitial && slType.includes('milestone')) {
                        reason = EXIT_REASONS.TRAILING_STOP;
                      } else {
                        reason = `${EXIT_REASONS.SL_HIT}_${slType}`;
                      }
                   } else if (clientOrderId && clientOrderId.startsWith('cls-')) {
                      reason = EXIT_REASONS.MANUAL_CLOSE;
                   } else if (clientOrderId && clientOrderId.startsWith('tp-')) {
                      reason = EXIT_REASONS.TP_HIT;
                   } else if (clientOrderId && clientOrderId.startsWith('sig-')) {
                      reason = EXIT_REASONS.SIGNAL;
                   } else {
                      // BOLT: Distinguish TRAILING_STOP from initial SL hits
                      const currentExchangeSl = parseFloat(orderData.stopPrice || orderData.triggerPrice || '0');
                      const initialSl = Number(trade.initial_sl);
                      if (currentExchangeSl > 0 && initialSl > 0 && Math.abs(currentExchangeSl - initialSl) > initialSl * 0.0001) {
                        reason = EXIT_REASONS.TRAILING_STOP;
                      } else {
                        reason = EXIT_REASONS.EXCHANGE_SL_OR_MANUAL;
                      }
                   }
                   this.logger.log(`[Sync] Successfully recovered exit reason for ${symbol}: ${reason} (Order Type: ${type})`);

                   if (fillPrice > 0) {
                      this.logger.log(`[${(trade.id || 'N/A').substring(0, 8)}] Sync Recovery: Found authoritative price ${fillPrice} (Estimate: ${estimate})`);
                      return { price: fillPrice, reason };
                   }
                }
             } catch (orderErr) {
                this.logger.debug(`[Sync] Order context recovery failed for ID ${orderId}: ${orderErr instanceof Error ? orderErr.message : String(orderErr)}`);
             }
      }
    } catch (e: any) {
      this.logger.debug(`[${(trade.id || 'N/A').substring(0, 8)}] Execution context recovery failed: ${e.message}`);
    }
    return { price: estimate };
  }

  /** @deprecated Use recoverClosingContext */
  public async recoverLastExecutionPrice(symbol: string, trade: Trade, estimate: number): Promise<number> {
     const ctx = await this.recoverClosingContext(symbol, trade, estimate);
     return ctx.price;
  }

  /**
   * REFACTOR: Encapsulates slippage validation logic including negative slippage caps
   * and positive slippage proximity guards for capital safety.
   */
  private async validateSlippage(
    symbol: string,
    trade: Trade,
    targetPrice: number,
    actualPrice: number,
    slPrice: number,
    config?: Partial<SessionConfig>
  ): Promise<{ isValid: boolean; error?: string }> {
    const direction = trade.direction;

    // Signed slippage: positive value means better price (improvement), negative means worse price.
    const slippage = direction === 'LONG'
      ? (targetPrice - actualPrice) / targetPrice
      : (actualPrice - targetPrice) / targetPrice;

    const warningThreshold = config?.slippage_warning_threshold ?? 0.001;
    const abortThreshold = Math.min(config?.slippage_abort_threshold ?? CONFIG_LIMITS.SLIPPAGE_ABORT_DEFAULT, CONFIG_LIMITS.SLIPPAGE_ABORT_MAX);

    const slippagePctNum = slippage * 100;
    const slippagePctStr = slippagePctNum.toFixed(4);
    const sign = slippage >= 0 ? '+' : '';

    if (slippage >= 0) {
      this.logger.log(`[Execution] PRICE IMPROVEMENT for ${symbol}: Target ${targetPrice}, Actual ${actualPrice.toFixed(8)} (Slippage: ${sign}${slippagePctStr}%)`);
    } else {
      this.logger.log(`[Execution] Negative slippage for ${symbol}: Target ${targetPrice}, Actual ${actualPrice.toFixed(8)} (Slippage: ${slippagePctStr}%)`);
    }

    // SRE: Proximity and Breach Guard.
    // Positive slippage (better price) means the price moved towards our intended Stop Loss.
    // "Normal" small positive slippage is allowed and beneficial.
    // Rejection only occurs if slippage consumes >10% of the intended risk-to-stop distance.
    const intendedRiskDistance = Math.abs(targetPrice - slPrice);
    const proximityBuffer = intendedRiskDistance * 0.1; // 10% distance-to-SL guard

    const isTooCloseOrPastSl = direction === 'LONG'
      ? actualPrice <= (slPrice + proximityBuffer)
      : actualPrice >= (slPrice - proximityBuffer);

    if (isTooCloseOrPastSl) {
      const isPast = direction === 'LONG' ? actualPrice <= slPrice : actualPrice >= slPrice;
      const reason = isPast ? 'AT OR PAST' : 'TOO CLOSE TO';
      const abortMsg = `[CRITICAL] Entry for ${symbol} @ ${actualPrice.toFixed(8)} is ${reason} intended Stop Loss (${slPrice.toFixed(8)}). Aborting entry for capital safety.`;
      this.logger.error(abortMsg);
      this.eventEmitter.emit(ENGINE_EVENTS.LOG_MESSAGE, { msg: abortMsg, level: 'error' });

      try {
        // Unwind position immediately.
        await this.closeTrade(symbol, trade, actualPrice, isPast ? EXIT_REASONS.ENTRY_AT_OR_PAST_SL : EXIT_REASONS.ENTRY_TOO_CLOSE_TO_SL, false, false);
        return { isValid: false, error: `Entry ${reason.toLowerCase()} SL: ${actualPrice.toFixed(8)}` };
      } catch (unwindErr) {
        this.logger.error(`Failed to unwind unsafe entry for ${symbol}: ${unwindErr instanceof Error ? unwindErr.message : String(unwindErr)}`);
        throw unwindErr;
      }
    }

    // Abort if negative slippage (worse price) exceeds threshold
    if (slippage < -abortThreshold) {
      const abortMsg = `[CRITICAL] Negative slippage for ${symbol} (${slippagePctStr}%) exceeded abort threshold (${(abortThreshold * 100).toFixed(2)}%). Unwinding immediately.`;
      this.logger.error(abortMsg);
      this.eventEmitter.emit(ENGINE_EVENTS.LOG_MESSAGE, { msg: abortMsg, level: 'error' });

      try {
        const unwindRes = await this.closeTrade(symbol, trade, actualPrice, EXIT_REASONS.SLIPPAGE_ABORT, false, false);
        if (!unwindRes.exitOccurred) {
          this.logger.error(`[FATAL] Slippage abort unwind FAILED for ${symbol}. Position may be lingering!`);
          this.eventEmitter.emit(ENGINE_EVENTS.LOG_MESSAGE, {
            msg: `FATAL: Slippage abort unwind failed for ${symbol}. Please check exchange immediately.`,
            level: 'error'
          });
        }
        return { isValid: false, error: `Slippage abort: ${slippagePctStr}%` };
      } catch (unwindErr) {
        this.logger.error(`Slippage unwind exception for ${symbol}: ${unwindErr instanceof Error ? unwindErr.message : String(unwindErr)}`);
        throw unwindErr;
      }
    } else if (slippage < -warningThreshold) {
      this.logger.warn(`Slippage warning for ${symbol}: Delta ${slippagePctStr}% exceeds threshold ${(warningThreshold * 100).toFixed(2)}%`);
    }

    return { isValid: true };
  }

  async closeTrade(
    symbol: string,
    trade: Trade,
    exitPrice: number,
    exitReason: string,
    paperMode = this.paperMode,
    localOnly = false,
    options: { ignoreBlocked?: boolean, orderId?: string, feesAlreadyAccounted?: boolean } = {}
  ): Promise<{ trade: Trade; exitOccurred: boolean; closeBlocked?: boolean, error?: string }> {
    // SRE: Per-symbol concurrency lock to prevent overlapping closure attempts
    // BOLT: Lock is now universal to prevent race conditions during localOnly syncs (Issue 2)
    if (this.closureLocks.get(symbol)) {
       this.logger.debug(`[${symbol}] Closure already in progress. Skipping redundant request.`);
       return { trade, exitOccurred: false };
    }

    try {
      this.closureLocks.set(symbol, true);

      // SRE-01: Only block if we are actually attempting an exchange operation.
      // localOnly syncs must always be allowed to clear "ghost" trades and blocked states.
      // Nuclear Option (ignoreBlocked) bypasses this to ensure forced capital safety.
      if (trade.close_blocked && !localOnly && !options.ignoreBlocked) {
         return { trade, exitOccurred: false, closeBlocked: true };
      }

      if (!paperMode && this.checkCircuitBreaker()) {
         this.logger.warn(`[${symbol}] Circuit breaker is open. Proceeding with emergency close despite systemic failures.`);
      }

      // Structural Close Attempt Throttling & Backoff
      const nowTs = Date.now();
      const attempts = trade.close_attempts || 0;
      const lastAttempt = trade.last_close_attempt_ts || 0;
      const MAX_CLOSE_ATTEMPTS = 5;

      if (!paperMode && attempts > 0) {
         const backoffMs = Math.min(300000, 5000 * Math.pow(2, attempts - 1));
         if (nowTs - lastAttempt < backoffMs) {
            // BOLT: Throttle this log to once per minute per symbol to prevent 5-second spam
            const lastLog = this.lastDeferLogTs.get(symbol) || 0;
            if (nowTs - lastLog > 60000) {
               this.logger.warn(`[${symbol}] Close attempt deferred. Backoff: ${backoffMs}ms, Attempt: ${attempts}, Prev Reason: ${trade.exit_reason || 'unknown'}`);
               this.lastDeferLogTs.set(symbol, nowTs);
            }
            return { trade, exitOccurred: false };
         }
      }

      // BOLT: Authoritative Price Recovery. If this is an external closure (localOnly) or we lack a price,
      // we attempt to fetch the canonical avgPrice from the exchange state.
      if (!paperMode && this.binanceClient && (exitPrice === 0 || localOnly)) {
        const tickerPrice = this.tickerCache.getPrice(symbol);
        const estimate = exitPrice || tickerPrice || trade.current_sl;

        const context = await this.recoverClosingContext(symbol, trade, estimate, options.orderId);

        // Only update if we found a valid authoritative price
        if (context.price > 0 && Math.abs(context.price - exitPrice) > 0.00000001) {
           this.logger.debug(`[${symbol}] [Sync] Updated exit price from exchange context: ${exitPrice} -> ${context.price}`);
           exitPrice = context.price;

           // BOLT: Field Synchronization. Update tooltip reason to match the new authoritative price.
           if (trade.exit_signal_reason && trade.exit_signal_reason.includes('at')) {
              trade.exit_signal_reason = trade.exit_signal_reason.replace(/at [\d.]+/, `at ${exitPrice}`);
           } else if (trade.exit_signal_reason && trade.exit_signal_reason.includes('confirmed by exchange at')) {
              trade.exit_signal_reason = trade.exit_signal_reason.replace(/confirmed by exchange at [\d.]+/, `confirmed by exchange at ${exitPrice}`);
           } else if (!trade.exit_signal_reason) {
              // If no reason set yet (e.g. EXCHANGE_SYNC), create a descriptive one with the price
              const label = exitReason.replace(/_/g, ' ');
              trade.exit_signal_reason = `${label} at ${exitPrice}`;
           }
        }

        if (exitReason === EXIT_REASONS.EXCHANGE_SYNC && context.reason) {
          exitReason = context.reason;
          trade.exit_reason = exitReason; // Ensure entity also gets the specific reason
        }
      }

      // DATA-CONSISTENCY: For localOnly syncs in live mode, we must still estimate the exit fee
      // since the exchange actually collected it during the external SL/TP/Manual hit.
      // CHRONOS: Skip if fees were already accounted for via authoritative UDS 'n' events.
      if (!paperMode && localOnly && !options.feesAlreadyAccounted) {
         const feeRate = this.takerFeeRate || 0.0004;
         const exitFee = roundEight(exitPrice * trade.qty * feeRate);
         if (!isNaN(exitFee) && exitFee > 0) {
            this.logger.debug(`[${symbol}] [Sync] Estimating exit fee for local-only closure: ${exitFee}`);
            trade.realized_fee = roundEight((Number(trade.realized_fee) || 0) + exitFee);
         }
      }

      // In live mode, place close order with reduce-only for safety
      // BOLT: Support both standard binance_order_id and RECON- prefixed IDs for imported trades
      const hasOrderId = trade.binance_order_id && trade.binance_order_id !== '';
      if (!paperMode && !localOnly && this.binanceClient && hasOrderId) {
        trade.close_attempts = (trade.close_attempts || 0) + 1;
        trade.last_close_attempt_ts = nowTs;
        // Persistence trigger for every attempt increment
        this.eventEmitter.emit(ENGINE_EVENTS.TRADE_UPDATED, { trade });

        try {
          const closeDirection = trade.direction === 'LONG' ? 'SELL' : 'BUY';
          const filters = this.marketFeed.getSymbolFilters(symbol);

          // BOLT OPTIMIZATION: Use pre-parsed precisions from filters
          const qtyPrecision = filters?.qtyPrecision ?? 8;

          // BOLT: Use descriptive prefixes for exit context recovery
          let prefix = 'cls'; // Default manual close
          if (exitReason === EXIT_REASONS.TP_HIT) prefix = 'tp';
          else if (exitReason.startsWith(EXIT_REASONS.SIGNAL) || exitReason === EXIT_REASONS.TRAILING_STOP) prefix = 'sig';

          const clientOrderId = `${prefix}-${trade.id.replace(/-/g, '').substring(0, 20)}`;

          // COMPLIANCE: Ensure price filters and ticker-informed quantities are used for emergency closes
          // to stay within PERCENT_PRICE boundaries.
          const ticker = this.tickerCache.getTicker(symbol);
          const refPrice = ticker?.mark_price || ticker?.price || exitPrice;
          const filteredExit = this.applyFilters(symbol, refPrice, trade.qty, { skipNotionalCheck: true });

          if (filteredExit.qty <= 0) {
             this.logger.error(`[${symbol}] [Sync] Filtered close quantity is 0. Falling back to raw quantity.`);
             filteredExit.qty = trade.qty;
          }

          // HARDENING: Idempotent Closure Loop. Handles network timeouts and Duplicate clientOrderId
          // by querying exchange state to verify if the close order was accepted.
          let orderData: any = null;
          let closeSuccess = false;
          let attempts = 0;
          const MAX_CLOSE_ATTEMPTS = 3;

          while (attempts < MAX_CLOSE_ATTEMPTS) {
            attempts++;
            try {
              const response = await this.binanceClient.restAPI.newOrder({
                symbol,
                side: closeDirection,
                type: 'MARKET',
                quantity: parseFloat(Number(filteredExit.qty || 0).toFixed(qtyPrecision)),
                reduceOnly: true,
                newOrderRespType: 'RESULT',
                newClientOrderId: clientOrderId,
                selfTradePreventionMode: 'EXPIRE_MAKER',
              } as any);

              this.updateWeight(response?.headers);
              orderData = await response.data() as any;

              if (orderData && orderData.code && orderData.code !== 0) {
                const code = orderData.code;
                const msg = orderData.msg || '';

                if (code === -2011 || msg.includes('Duplicate orderSent') || msg.includes('Duplicate clientOrderId') || msg.includes('Duplicate order')) {
                  this.logger.log(`[${symbol}] [Sync] Detected duplicate clientOrderId on close retry. Recovering close state...`);
                  const queryRes = await this.binanceClient.restAPI.queryOrder({ symbol, origClientOrderId: clientOrderId });
                  this.updateWeight(queryRes?.headers);
                  orderData = await queryRes.data() as any;
                  if (orderData && orderData.orderId) {
                    this.logger.log(`[${symbol}] [Sync] Successfully recovered existing close order: ${orderData.orderId} (Status: ${orderData.status})`);
                    closeSuccess = true;
                    break;
                  }
                }

                if (msg.includes('ReduceOnly') || msg.includes('conflict') || msg.includes('-2022')) {
                   this.logger.warn(`[${symbol}] MARKET close conflicted. Flushing orders and retrying (Attempt ${attempts})...`);
                   if (trade.binance_stop_order_id) {
                     await this.cancelBinanceOrder(symbol, trade.binance_stop_order_id, trade.binance_stop_order_type as any);
                     trade.binance_stop_order_id = undefined;
                   }
                   await this.binanceClient.restAPI.cancelAllOpenOrders({ symbol });
                   continue;
                }

                throw new Error(msg);
              }

              if (orderData && orderData.orderId) {
                closeSuccess = true;
                break;
              }
            } catch (err: any) {
              const errMsg = err.message || '';
              const isNetworkError = errMsg.includes('Network error') || errMsg.includes('timeout') || errMsg.includes('ECONNRESET') || errMsg.includes('ETIMEDOUT');

              if (isNetworkError && attempts < MAX_CLOSE_ATTEMPTS) {
                this.logger.warn(`[${symbol}] Network error during close. Retrying (Attempt ${attempts + 1})...`);
                await new Promise(resolve => setTimeout(resolve, 1000 * attempts));
                continue;
              }

              // Handle Duplicate ID via exception (some SDK variants throw instead of returning code)
              if (errMsg.includes('Duplicate orderSent') || errMsg.includes('Duplicate clientOrderId')) {
                this.logger.log(`[${symbol}] [Sync] Duplicate ID exception on close. Recovering...`);
                const queryRes = await this.binanceClient.restAPI.queryOrder({ symbol, origClientOrderId: clientOrderId });
                this.updateWeight(queryRes?.headers);
                orderData = await queryRes.data() as any;
                if (orderData && orderData.orderId) {
                  closeSuccess = true;
                  break;
                }
              }

              throw err;
            }
          }

          if (closeSuccess) {
            // IDEMPOTENCY: Mark close as executed to avoid duplicate UDS processing
            if (orderData.status === 'FILLED' || orderData.executedQty === orderData.origQty) {
               this.markAsExecuted(symbol, String(orderData.orderId));
            }

            // BOLT: Proactively update zero-weight position cache on success
            const executedExitQty = parseFloat(orderData.executedQty || '0');
            const currentCached = this.sessionState.realTimePositions.get(symbol);
            if (currentCached) {
               const newAmount = Math.max(0, Math.abs(currentCached.amount) - executedExitQty);
               this.sessionState.realTimePositions.set(symbol, { ...currentCached, amount: newAmount });
            }
            this.logger.log(`Close order response for ${symbol}: ${JSON.stringify(orderData)}`);
            trade.binance_close_order_id = orderData.orderId;

            // Zero-RAM Price Tracking for exits
            let absoluteExitPrice = 0;
            if (orderData.cumQuote && orderData.executedQty) {
               const cumQuote = parseFloat(orderData.cumQuote);
               const executedQty = parseFloat(orderData.executedQty);
               if (executedQty > 0 && !isNaN(cumQuote) && !isNaN(executedQty)) {
                  absoluteExitPrice = cumQuote / executedQty;
                  this.logger.log(`Derived ${symbol} exit price from cumQuote: ${absoluteExitPrice}`);
               }
            }

            if (absoluteExitPrice === 0) {
               absoluteExitPrice = parseFloat(orderData.avgPrice || orderData.price || '0');
            }

            if (absoluteExitPrice === 0 && orderData.fills && Array.isArray(orderData.fills) && orderData.fills.length > 0) {
               const totalQty = orderData.fills.reduce((sum: number, fill: any) => sum + parseFloat(fill.qty), 0);
               const weightedSum = orderData.fills.reduce((sum: number, fill: any) => sum + parseFloat(fill.qty) * parseFloat(fill.price), 0);
               if (totalQty > 0) absoluteExitPrice = weightedSum / totalQty;
            }

            // DATA-CONSISTENCY: Fallback for 0 price responses
            if (absoluteExitPrice === 0 && trade.binance_close_order_id) {
               try {
                  const queryRes = await this.binanceClient.restAPI.queryOrder({ symbol, orderId: BigInt(trade.binance_close_order_id) });
                  const queryData = await queryRes.data() as any;
                  absoluteExitPrice = parseFloat(queryData.avgPrice || queryData.price || '0');
               } catch (queryErr) {
                  this.logger.warn(`[${symbol}] [Sync] Failed to fetch authoritative exit price: ${queryErr instanceof Error ? queryErr.message : String(queryErr)}`);
               }
            }

            // FINAL FALLBACK
            if (absoluteExitPrice === 0) {
               const tickerPrice = this.tickerCache.getPrice(symbol);
               absoluteExitPrice = tickerPrice || exitPrice;
            }

            const executedExitQtyFinal = parseFloat(orderData.executedQty || '0');
            if (absoluteExitPrice > 0) exitPrice = roundEight(absoluteExitPrice);

            // REST COMMISSION SYNC: Cache trade IDs and sum commissions from the exit response fills
            let exitFeeFromFills = 0;
            if (orderData.fills && Array.isArray(orderData.fills)) {
              for (const fill of orderData.fills) {
                if (fill.tradeId) {
                  const tradeIdStr = String(fill.tradeId);
                  if (!this.tradeExecutionCache.has(tradeIdStr)) {
                    this.tradeExecutionCache.set(tradeIdStr, Date.now());
                    if (fill.commission) {
                      exitFeeFromFills += parseFloat(fill.commission);
                    }
                  }
                }
              }
              if (exitFeeFromFills > 0) {
                this.logger.debug(`[${symbol}] [Sync] Adding commissions from REST exit fills: ${exitFeeFromFills}`);
                trade.realized_fee = roundEight((Number(trade.realized_fee) || 0) + exitFeeFromFills);
              }
              this.cleanupExecutionCache();
            }

            // Zero-Cost Math Estimation for exit fees (FALLBACK ONLY)
            if (exitFeeFromFills === 0 && !options.feesAlreadyAccounted) {
              const exitNotional = (executedExitQtyFinal > 0 ? executedExitQtyFinal : trade.qty) * exitPrice;
              const feeRate = this.takerFeeRate || 0.0004;
              let exitFee = exitNotional * feeRate;
              if (isNaN(exitFee)) exitFee = 0;

              trade.realized_fee = roundEight((Number(trade.realized_fee) || 0) + exitFee);
            }

            const exitFeeDisplay = exitFeeFromFills || (trade.qty * exitPrice * (this.takerFeeRate || 0.0004));
            const msgClose = `Binance close order placed: ${symbol} qty=${trade.qty || 0} order_id=${orderData.orderId} est_exit_fee=${exitFeeDisplay}`;
            this.logger.log(msgClose);
            this.eventEmitter.emit(ENGINE_EVENTS.LOG_MESSAGE, { msg: msgClose, level: 'info' });

            await this.auditLog.log({
              action: 'LIVE_ORDER_CLOSE',
              resourceId: trade.id,
              details: { symbol, qty: trade.qty, orderId: orderData.orderId, reason: exitReason }
            });

            // Cleanup remaining SL if it survived the MARKET close
            if (trade.binance_stop_order_id) {
               try {
                  await this.cancelBinanceOrder(symbol, trade.binance_stop_order_id, trade.binance_stop_order_type as any);
                  trade.binance_stop_order_id = undefined;
               } catch (e) {}
            }
          }
        } catch (err: unknown) {
          const errMsg = err instanceof Error ? err.message : String(err);
          const upperMsg = errMsg.toUpperCase();
          const errCode = (err as any).code || 'unknown';

          // LOG RAW DATA: Ensure full exchange error is visible for diagnosis
          this.logger.error(`[${symbol}] Binance API Error during close: [${errCode}] ${errMsg}`);

          // RISK-04: If close fails, check if it's because position is already closed (SL race)
          if (upperMsg.includes('REDUCE_ONLY') || upperMsg.includes('REDUCEONLY') || upperMsg.includes('POSITION SIDE DOES NOT MATCH')) {
               this.logger.log(`Binance close order for ${symbol} rejected (possibly already closed by exchange SL). Verifying via UDS cache...`);

               let positionAmt = 0;
               const cachedPos = await this.fetchPosition(symbol, { forceFresh: false });
               positionAmt = cachedPos ? Math.abs(parseFloat(cachedPos.positionAmt)) : 0;

               if (positionAmt !== 0) {
                  this.logger.log(`UDS cache says position still exists for ${symbol}. Performing fresh verification...`);
                  try {
                    const response = await this.binanceClient.restAPI.positionInformationV3({ symbol });
                    this.updateWeight(response?.headers);
                    const data = await response.data() as any;
                    if (Array.isArray(data)) {
                      const activePosition = data.find(p => parseFloat(p.positionAmt) !== 0);
                      positionAmt = activePosition ? parseFloat(activePosition.positionAmt) : 0;
                    }
                  } catch (posErr) {
                    const position = await this.fetchPosition(symbol, { forceFresh: true });
                    positionAmt = position ? parseFloat(position.positionAmt) : 0;
                  }
               }

               if (positionAmt === 0) {
                  this.logger.log(`[${(trade.id || 'N/A').substring(0, 8)}] Confirmed: ${symbol} position is already zero on exchange (Amt: ${positionAmt}). Triggering Sync Recovery.`);
                  const context = await this.recoverClosingContext(symbol, trade, exitPrice);
                  exitPrice = context.price;

                  if (context.reason) {
                    exitReason = context.reason;
                    trade.exit_reason = exitReason;
                  } else {
                    trade.exit_reason = trade.exit_reason === EXIT_REASONS.EXCHANGE_SYNC ? EXIT_REASONS.EXCHANGE_SYNC_RECOVERY : EXIT_REASONS.EXCHANGE_SL_OR_MANUAL;
                  }

                  if (!options.feesAlreadyAccounted) {
                    const feeRate = this.takerFeeRate || 0.0004;
                    let exitFee = exitPrice * trade.qty * feeRate;
                    if (isNaN(exitFee)) exitFee = 0;
                    trade.realized_fee = roundEight((Number(trade.realized_fee) || 0) + exitFee);
                  }

                  // BOLT: Field Synchronization. Update tooltip reason to match the new authoritative price.
                  if (trade.exit_signal_reason && trade.exit_signal_reason.includes('at')) {
                     trade.exit_signal_reason = trade.exit_signal_reason.replace(/at [\d.]+/, `at ${exitPrice}`);
                  } else if (!trade.exit_signal_reason) {
                     const label = exitReason.replace(/_/g, ' ');
                     trade.exit_signal_reason = `${label} at ${exitPrice}`;
                  }
               } else {
                  const tradeMeta = { id: trade.id, direction: trade.direction, qty: trade.qty, entryPrice: trade.entry_price, sl: trade.current_sl };
                  this.logger.warn(`[${symbol}] Close order failed (REDUCE_ONLY) but position still exists on exchange (Amt: ${positionAmt}). This typically means a side mismatch or a ghost SL order is consuming the 'reduce-only' capacity. TradeMeta: ${JSON.stringify(tradeMeta)}. Error: ${errMsg}`);

                  // SRE: Aggressive symbol flush on REDUCE_ONLY failure to clear any untracked or conflicting SLs
                  try {
                    this.logger.warn(`[${symbol}] [Sync] Executing aggressive symbol flush to resolve REDUCE_ONLY conflict...`);
                    await this.binanceClient!.restAPI.cancelAllOpenOrders({ symbol });
                  } catch (flushErr) {}

                  // ROLLBACK: Re-place SL if it was cancelled and close failed
                  if (!trade.binance_stop_order_id) {
                     this.logger.warn(`[${symbol}] Close failed but position persists. Re-arming protection SL...`);
                     await this.placeStopLoss(trade, trade.current_sl);
                  }

                  if (trade.close_attempts && trade.close_attempts >= MAX_CLOSE_ATTEMPTS) {
                    trade.close_blocked = true;
            const blockMsg = `CRITICAL: ${symbol} close attempt ceiling reached (REDUCE_ONLY). Automated closes are now BLOCKED. To unblock, please manual close or sync on Binance. [${errCode}] ${errMsg}`;
                    this.logger.error(blockMsg);
                    this.eventEmitter.emit(ENGINE_EVENTS.LOG_MESSAGE, { msg: blockMsg, level: 'error' });
                  }

                  this.eventEmitter.emit(ENGINE_EVENTS.TRADE_UPDATED, { trade });
                  throw err;
               }
          } else if (upperMsg.includes('PERCENT_PRICE') || upperMsg.includes('PRICE DEVIATED') || upperMsg.includes('DEVIATION')) {
               const ticker = this.tickerCache.getTicker(symbol);
               const markPrice = ticker?.mark_price || ticker?.price;
               const deviation = markPrice ? (Math.abs(exitPrice - markPrice) / markPrice * 100).toFixed(2) : 'unknown';

               const tip = `The price is currently outside Binance's protection bands (${typeof deviation === 'number' ? Number(deviation).toFixed(2) : deviation}% deviation). Manual intervention on Binance website is REQUIRED to close this position.`;
               this.logger.error(`${symbol}: Close failed due to price protection/deviation (Attempt ${trade.close_attempts}/${MAX_CLOSE_ATTEMPTS}). ${tip}. Error: [${errCode}] ${errMsg}`);

               // ROLLBACK: Re-place SL if it was cancelled and close failed
               if (!trade.binance_stop_order_id) {
                  this.logger.warn(`[${symbol}] PERCENT_PRICE failure. Re-arming protection SL...`);
                  await this.placeStopLoss(trade, trade.current_sl);
               }

               if (trade.close_attempts && trade.close_attempts >= MAX_CLOSE_ATTEMPTS) {
                  trade.close_blocked = true;
                  const blockMsg = `CRITICAL: ${symbol} close attempt ceiling reached. Automated closes are now BLOCKED for this symbol. To unblock, please manual close or sync on Binance.`;
                  this.logger.error(blockMsg);
                  this.eventEmitter.emit(ENGINE_EVENTS.LOG_MESSAGE, { msg: blockMsg, level: 'error' });
               } else {
                  this.eventEmitter.emit(ENGINE_EVENTS.LOG_MESSAGE, { msg: `CRITICAL: ${symbol} close failed (Price Protection). Attempting aggressive LIMIT fallback.`, level: 'warn' });

                  try {
                    const ticker = this.tickerCache.getTicker(symbol);
                    const limitPrice = ticker?.mark_price || ticker?.price || exitPrice;
                    const filteredLimit = this.applyFilters(symbol, limitPrice, trade.qty, {
                      priceRounding: trade.direction === 'LONG' ? 'floor' : 'ceil',
                      clampToPercentPrice: true // Ensure LIMIT is inside exchange bands
                    });

                    const filters = this.marketFeed.getSymbolFilters(symbol);
                    // BOLT OPTIMIZATION: Use pre-parsed precision
                    const limitQtyPrecision = filters?.qtyPrecision ?? 8;

                    const clientOrderId = `cls-lim-${trade.id.replace(/-/g, '').substring(0, 16)}`;
                    const limitResponse = await this.binanceClient.restAPI.newOrder({
                      symbol,
                      side: trade.direction === 'LONG' ? 'SELL' : 'BUY',
                      type: 'LIMIT',
                      quantity: Number(filteredLimit.qty || 0).toFixed(limitQtyPrecision),
                      price: Number(filteredLimit.price || 0).toFixed(8),
                      timeInForce: 'IOC',
                      reduceOnly: true,
                      newClientOrderId: clientOrderId
                    } as any);

                    const limitData = await limitResponse.data() as any;
                    if (limitData.orderId) {
                      this.logger.log(`Aggressive LIMIT fallback for ${symbol} successful: ${limitData.orderId}`);
                      trade.binance_close_order_id = limitData.orderId;
                    }
                  } catch (limitErr) {
                    this.logger.error(`Aggressive LIMIT fallback failed for ${symbol}: ${limitErr instanceof Error ? limitErr.message : String(limitErr)}`);
                  }
               }

               this.eventEmitter.emit(ENGINE_EVENTS.TRADE_UPDATED, { trade });
               throw err;
          } else {
               this.logger.warn(`Binance close order failed for ${symbol}. Code: ${errCode}. Error: ${errMsg}`);

               // ROLLBACK: Re-place SL if it was cancelled and close failed
               if (!trade.binance_stop_order_id) {
                  this.logger.warn(`[${symbol}] Unknown failure. Re-arming protection SL...`);
                  await this.placeStopLoss(trade, trade.current_sl);
               }

               if (trade.close_attempts && trade.close_attempts >= MAX_CLOSE_ATTEMPTS) {
                 trade.close_blocked = true;
                 const blockMsg = `CRITICAL: ${symbol} close attempt ceiling reached. Automated closes are now BLOCKED. [${errCode}] ${errMsg}`;
                 this.logger.error(blockMsg);
                 this.eventEmitter.emit(ENGINE_EVENTS.LOG_MESSAGE, { msg: blockMsg, level: 'error' });
               }

               this.eventEmitter.emit(ENGINE_EVENTS.TRADE_UPDATED, { trade });
               throw err;
          }
        }
      } else if (paperMode) {
        // Simulate paper exit fee (taker rate)
        const exitFee = roundEight(exitPrice * trade.qty * ENGINE_CONSTANTS.SIMULATED_FEE_RATE);
        trade.realized_fee = roundEight((trade.realized_fee || 0) + exitFee);
      }

      // Update trade AFTER successful closure confirmation
      trade.exit_price = exitPrice;
      trade.exit_ts = new Date();

      // BOLT: Final PnL calculation using the finalized exitPrice (potentially from fills)
      const finalPnlPoints = trade.direction === 'LONG'
        ? exitPrice - trade.entry_price
        : trade.entry_price - exitPrice;

      const finalGrossPnl = finalPnlPoints * (trade.qty || 0);
      const finalNetPnl = finalGrossPnl - (trade.realized_fee || 0) - (trade.funding_fee || 0);

      // DATA-CONSISTENCY: pnl_pct now reflects Net PnL relative to notional value
      const notional = trade.entry_price * (trade.qty || 0);
      const finalPnlPct = (notional !== 0) ? (finalNetPnl / notional) * 100 : 0;
      trade.pnl_pct = roundEight(Number.isFinite(finalPnlPct) ? finalPnlPct : 0);

      this.logger.log(`[PnL Calculation] ${symbol}: ${trade.direction} Exit=${exitPrice}, Entry=${trade.entry_price}, Qty=${trade.qty}, Gross=${Number(finalGrossPnl || 0).toFixed(4)}, Fee=${Number(trade.realized_fee || 0).toFixed(4)}, Net=${Number(finalNetPnl || 0).toFixed(4)}`);

      trade.pnl = roundEight(Number.isFinite(finalNetPnl) ? finalNetPnl : 0);

      trade.exit_reason = trade.exit_reason || exitReason;

      // Ensure exit signal type and reason are passed through to persistence
      if (!trade.exit_signal_type) {
        if (exitReason.startsWith(EXIT_REASONS.SL_HIT) || exitReason === EXIT_REASONS.AUTO_RECONCILED_SL) trade.exit_signal_type = 'STOP_LOSS';
        else if (exitReason === EXIT_REASONS.TP_HIT || exitReason === EXIT_REASONS.AUTO_RECONCILED_TP) trade.exit_signal_type = 'TAKE_PROFIT';
        else if (exitReason === EXIT_REASONS.MANUAL_CLOSE) trade.exit_signal_type = 'MANUAL';
        else if (exitReason === EXIT_REASONS.EXCHANGE_SL_OR_MANUAL) trade.exit_signal_type = 'EXCHANGE_MANUAL';
        else if (exitReason === EXIT_REASONS.SESSION_TERMINATED) trade.exit_signal_type = 'SESSION_TERMINATED';
        else if (exitReason === EXIT_REASONS.EXCHANGE_SYNC || exitReason === EXIT_REASONS.EXCHANGE_SYNC_RECOVERY || exitReason === EXIT_REASONS.AUTO_RECONCILED_EXIT) trade.exit_signal_type = 'EXCHANGE_SYNC';
        else if (exitReason === EXIT_REASONS.SLIPPAGE_ABORT || exitReason === EXIT_REASONS.ENTRY_AT_OR_PAST_SL || exitReason === EXIT_REASONS.ENTRY_TOO_CLOSE_TO_SL || exitReason === EXIT_REASONS.SL_PLACEMENT_FAILURE) trade.exit_signal_type = 'SAFETY_ABORT';
        else if (exitReason === EXIT_REASONS.WATCHDOG_NUCLEAR_CLOSE) trade.exit_signal_type = 'WATCHDOG_NUCLEAR_CLOSE';
        else if (exitReason === EXIT_REASONS.EXCHANGE_FILL) trade.exit_signal_type = 'EXCHANGE_FILL';
        else if (exitReason === EXIT_REASONS.TRAILING_STOP) trade.exit_signal_type = 'TRAILING_STOP';
        else if (exitReason.startsWith(EXIT_REASONS.SIGNAL)) trade.exit_signal_type = 'SIGNAL';
        else trade.exit_signal_type = 'SIGNAL';
      }

      // Clean up log throttle on successful close
      this.lastDeferLogTs.delete(symbol);

      // Determine status
      if (exitReason.startsWith(EXIT_REASONS.SL_HIT) || exitReason === EXIT_REASONS.ENTRY_AT_OR_PAST_SL || exitReason === EXIT_REASONS.ENTRY_TOO_CLOSE_TO_SL || exitReason === EXIT_REASONS.SL_PLACEMENT_FAILURE || exitReason === EXIT_REASONS.AUTO_RECONCILED_SL) {
        trade.status = 'CLOSED_SL';
      } else if (exitReason === EXIT_REASONS.TP_HIT || exitReason === EXIT_REASONS.AUTO_RECONCILED_TP) {
        trade.status = 'CLOSED_TP';
      } else if (exitReason.startsWith(EXIT_REASONS.SIGNAL) || exitReason === EXIT_REASONS.TRAILING_STOP) {
        trade.status = 'CLOSED_SIGNAL';
      } else if (exitReason === EXIT_REASONS.EXCHANGE_SYNC || exitReason === EXIT_REASONS.EXCHANGE_SYNC_RECOVERY || exitReason === EXIT_REASONS.WATCHDOG_NUCLEAR_CLOSE || exitReason === EXIT_REASONS.AUTO_RECONCILED_EXIT || exitReason === EXIT_REASONS.EXCHANGE_FILL) {
        trade.status = 'CLOSED_ORPHANED';
      } else if (exitReason === EXIT_REASONS.EXCHANGE_SL_OR_MANUAL) {
        trade.status = 'CLOSED';
      } else {
        trade.status = 'CLOSED';
      }

      // REDUCE LOG NOISE: PositionTrackerService already logs a standardized closure message.
      // We only log to debug here for internal traceability.
      this.logger.debug(`Close logic completed for ${symbol} @ ${exitPrice}. Net PnL: ${trade.pnl}`);

      return { trade, exitOccurred: true };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Close failed: ${errMsg}`);
      return { trade, exitOccurred: false, error: errMsg };
    } finally {
      this.closureLocks.delete(symbol);
    }
  }
}
