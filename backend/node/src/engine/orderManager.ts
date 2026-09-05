import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Settings as SettingsEntity } from '../models/entities/Settings.entity';
import { OnEvent } from '@nestjs/event-emitter';
import { DerivativesTradingUsdsFutures } from '@binance/derivatives-trading-usds-futures';
import { Trade } from '../models/Trade';
import { SessionConfig } from '../models/SessionConfig';
import { SignalEngineService } from './signalEngine';
import { OrderFilterService } from './order-filter.service';
import { MarketFeedService } from './market_feed.service';
import { TickerCacheService } from './ticker_cache.service';
import { MonitoringService } from './monitoring.service';
import { PositionTrackerService } from './positionTracker';
import { SessionStateService } from './session_state.service';
import { BroadcastService } from './broadcast.service';
import { AuditLogService } from '../trading/audit-log.service';
import { v4 as uuid } from 'uuid';
import { roundEight, floorStep, roundTo, formatSlType, parseIntervalToMs } from '../lib/math';
import {
  BinanceOrderUpdateEvent,
  BinanceUserCommissionRate,
  BinanceOrderReceipt,
  BinanceAlgoOrderReceipt,
  BinancePositionV3,
  BinanceTrade
} from '../models/binance.types';
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

  private shouldUpgradeExitReason(currentReason: string, newReason: string): boolean {
    if (!newReason) return false;
    if (!currentReason) return true;

    // Generic reasons that are candidates for upgrade
    const genericReasons = [
      EXIT_REASONS.EXCHANGE_SYNC,
      EXIT_REASONS.EXCHANGE_SYNC_RECOVERY,
      EXIT_REASONS.EXCHANGE_SL_OR_MANUAL
    ];

    const isCurrentGeneric = genericReasons.includes(currentReason);
    const isNewGeneric = genericReasons.includes(newReason);

    // 1. Never overwrite a specific reason with a generic reason
    if (isNewGeneric && !isCurrentGeneric) {
      return false;
    }

    // 2. Always upgrade a generic reason to a specific reason
    if (isCurrentGeneric && !isNewGeneric) {
      return true;
    }

    // 3. If both are specific, check if we are downgrading a precise milestone SL (e.g., SL_HIT_M1) to a less precise one (e.g. SL_HIT_ADJUSTED_SL)
    if (currentReason.startsWith(EXIT_REASONS.SL_HIT) && newReason.startsWith(EXIT_REASONS.SL_HIT)) {
      const getSpecificityScore = (reason: string) => {
        const upper = reason.toUpperCase();
        if (upper.includes('_M1') || upper.includes('_M2') || upper.includes('_BREAKEVEN')) return 3;
        if (upper.includes('_ADJUSTED_SL') || upper.includes('_INITIAL_SL')) return 2;
        return 1;
      };

      if (getSpecificityScore(currentReason) > getSpecificityScore(newReason)) {
        return false;
      }
    }

    // 4. If current reason is a specific signal indicator (starts with SIGNAL_ and is longer than SIGNAL),
    // and new reason is just generic SIGNAL or starts with another specific signal, keep the current one.
    if (currentReason.startsWith(EXIT_REASONS.SIGNAL) && currentReason.length > EXIT_REASONS.SIGNAL.length) {
      if (newReason === EXIT_REASONS.SIGNAL || !newReason.startsWith(EXIT_REASONS.SIGNAL)) {
        return false;
      }
    }

    return true;
  }

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

  // Audit Item 13: Per-symbol flush locks to prevent overlapping aggressive cleanups
  private flushLocks: Map<string, boolean> = new Map();

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
    public readonly tickerCache: TickerCacheService,
    private readonly monitoringService: MonitoringService,
    @Inject(forwardRef(() => PositionTrackerService))
    private readonly positionTracker: PositionTrackerService,
    private readonly sessionState: SessionStateService,
    private readonly broadcastService: BroadcastService,
    private readonly auditLog: AuditLogService,
    private readonly eventEmitter: EventEmitter2,
    @InjectRepository(SettingsEntity)
    private readonly settingsRepository: Repository<SettingsEntity>,
    private readonly orderFilterService: OrderFilterService,
  ) {}

  @OnEvent('binance.order_update')
  async handleBinanceOrderUpdate(payload: BinanceOrderUpdateEvent) {
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
      // SRE: Robust terminal filtering. Check both orderId and algoId to catch all seeded entry types.
      currentOrders = currentOrders.filter(o =>
        (String(o.orderId) !== orderId && String(o.algoId || '') !== orderId) &&
        o.clientOrderId !== clientOrderId
      );
    } else {
      // Add or update the order in cache
      // SRE: Match by orderId, algoId, or clientOrderId
      const existingIdx = currentOrders.findIndex(o =>
        String(o.orderId) === orderId ||
        String(o.algoId || '') === orderId ||
        o.clientOrderId === clientOrderId
      );
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
    const isExecutionTrade = executionType === 'TRADE' || executionType === 'CALCULATED';

    if (isExecutionTrade && tradeId) {
      if (this.tradeExecutionCache.has(tradeId)) {
        isDuplicateTrade = true;
        this.logger.debug(`[Idempotency] Dropping duplicate trade execution for ${symbol} (TradeID: ${tradeId})`);
      }
      // Note: We don't commit to cache here; we do it during commission accumulation
      // to ensure we only deduplicate if commission was actually processed.
    }

    // Accuracy Improvement: Update trade entry/exit price from User Data Stream (ORDER_TRADE_UPDATE)
    if (isExecutionTrade && !isDuplicateTrade) {
      const activeTrades = this.sessionState.activeTrades;
      let trade = activeTrades.find(t => t.symbol === symbol);

      // SRE: Race condition guard - if not in activeTrades, check if it's an in-flight entry
      if (!trade && clientOrderId) {
        trade = this.positionTracker.getInFlightEntry(symbol);
        if (trade) {
          this.logger.debug(`[UDS] Matched in-flight entry for ${symbol} via registry.`);

          // CHRONOS: Auto-promotion. If an entry fills while still in-flight (e.g. during enter() retry or network lag),
          // we must promote it to active status immediately to enable exit monitoring and watchdog protection.
          if (status === 'FILLED' || status === 'PARTIALLY_FILLED') {
            this.logger.log(`[UDS] Promoting in-flight entry for ${symbol} to active monitoring due to ${status} event.`);

            // Sync order ID if missing (common in UDS-first arrivals)
            if (!trade.binance_order_id) {
               trade.binance_order_id = orderId;
            }

            this.positionTracker.addTrade(trade);
          }
        }
      }

      if (trade) {
        const tradeIdShort8 = (trade.id || 'N/A').substring(0, 8);
        const avgPrice = parseFloat(order.ap || '0'); // 'ap' is average price in ORDER_TRADE_UPDATE
        const lastPrice = parseFloat(order.L || '0');
        const commission = parseFloat(order.n || '0');
        const tradeExecutionId = order.t ? String(order.t) : null;

        const rp = parseFloat(order.rp || '0');

        // CHRONOS: Handle realized profit and commissions for all executions
        // DEDUPLICATION: Use tradeExecutionId to prevent double-counting between REST and UDS
        if (!isDuplicateTrade && tradeExecutionId) {
           let pnlChanged = false;
           if (commission > 0) {
              trade.realized_fee = roundEight((Number(trade.realized_fee) || 0) + commission);
              // trade.pnl is net of fees, so we subtract commission as it's realized
              trade.pnl = roundEight((Number(trade.pnl) || 0) - commission);
              pnlChanged = true;
           }
           if (rp !== 0) {
              trade.pnl = roundEight((Number(trade.pnl) || 0) + rp);
              pnlChanged = true;
           }

           if (pnlChanged) {
              this.tradeExecutionCache.set(tradeExecutionId, Date.now());
              this.logger.debug(`[${tradeIdShort8}] [UDS] PnL Update: Fee=+${commission}, RP=${rp}. Total Net PnL=${trade.pnl}, Total Fee=${trade.realized_fee}`);
              this.eventEmitter.emit(ENGINE_EVENTS.TRADE_UPDATED, { trade });
              this.cleanupExecutionCache();
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

            this.eventEmitter.emit(ENGINE_EVENTS.EXCHANGE_CLOSE, {
              symbol,
              exitPrice,
              reason: `${EXIT_REASONS.SL_HIT}_${slType}`,
              orderId, // DATA-ACCURACY: Pass orderId for authoritative recovery
              feesAlreadyAccounted: true, // CHRONOS: Signal that commissions were already handled via UDS 'n' events
              alreadyRealized: true // CHRONOS: Signal that PnL was already accumulated via UDS 'rp' events
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
           // CHRONOS: Only close locally for recognized exit orders or closePosition: true.
           // COMPLIANCE: Include 'LIQUIDATION' type (executionType 'CALCULATED' usually) as recognized.
           const isRecognizedExit =
             (trade.binance_close_order_id === orderId) ||
             (trade.binance_stop_order_id === orderId) ||
             (order.cp === true) ||
             (order.ot === 'LIQUIDATION') ||
             (order.ot === 'STOP' || order.ot === 'STOP_MARKET' || order.ot === 'TRAILING_STOP_MARKET') ||
             (clientOrderId && (clientOrderId.startsWith('cls-') || clientOrderId.startsWith('tp-') || clientOrderId.startsWith('sig-') || clientOrderId.startsWith('sl-')));

           if (status === 'FILLED' || status === 'PARTIALLY_FILLED') {
             if (!isRecognizedExit) {
               // SYNC: Update trade.qty by subtracting the fill amount of this slice
               const lastFillQty = parseFloat(order.l || '0');
               if (lastFillQty > 0) {
                 const newQty = roundEight(trade.qty - lastFillQty);
                 this.logger.warn(`[${tradeIdShort8}] [UDS] External opposite-side fill for ${symbol}: -${lastFillQty}. New qty: ${newQty}. (Order ID: ${orderId})`);
                 trade.qty = Math.max(0, newQty);

                 this.sessionState.realTimePositions.set(symbol, {
                    amount: trade.qty,
                    entryPrice: trade.entry_price
                 });
                 this.eventEmitter.emit(ENGINE_EVENTS.QUANTITY_SYNC, { symbol, qty: trade.qty });
               }

               // If the order has cp: true, it IS an authoritative close even if unrecognized
               if (order.cp !== true) {
                 this.logger.debug(`[${tradeIdShort8}] [UDS] Unrecognized external order ${status}. Qty synced, waiting for ACCOUNT_UPDATE for terminal reconciliation.`);
                 return;
               }
             }
           }

           if (status === 'FILLED') {
             this.logger.log(`[${tradeIdShort8}] Recognized exit order FILLED for ${symbol} (${side}). Closing trade locally.`);
             let exitPrice = avgPrice || lastPrice || parseFloat(order.p || '0');

             if (exitPrice === 0) {
                const tickerPrice = this.tickerCache.getPrice(symbol);
                this.logger.warn(`[${tradeIdShort8}] Binance WS returned 0 price for ${symbol} fill. Using ticker fallback: ${tickerPrice}`);
                exitPrice = tickerPrice || trade.entry_price;
             }

             // Distinguish between app-initiated manual close and external exchange events
             const isAppManualClose = clientOrderId && clientOrderId.startsWith('cls-');
             const isAppSignalClose = clientOrderId && clientOrderId.startsWith('sig-');
             let reason = EXIT_REASONS.EXCHANGE_FILL;

             if (isAppManualClose) {
               reason = EXIT_REASONS.MANUAL_CLOSE;
               trade.exit_signal_reason = `Manual close confirmed by exchange at ${exitPrice}`;
             } else if (isAppSignalClose) {
               // Find exact signal indicator and params
               // BOLT OPTIMIZATION: Use for...in loop instead of Object.entries to eliminate key-value entry array and tuple allocations
               let foundSignal = '';
               if (trade.exit_signals_status) {
                  for (const key in trade.exit_signals_status) {
                     if (Object.prototype.hasOwnProperty.call(trade.exit_signals_status, key)) {
                        const status = (trade.exit_signals_status as Record<string, any>)[key];
                        if (status && status.fired === true) {
                           foundSignal = key;
                           break;
                        }
                     }
                  }
               }

               if (foundSignal) {
                  reason = `${EXIT_REASONS.SIGNAL}_${foundSignal.toUpperCase()}`;
                  const status = trade.exit_signals_status?.[foundSignal];
                  trade.exit_signal_reason = status?.description || `Signal ${foundSignal} fired at ${exitPrice}`;
               } else if (trade.exit_reason && trade.exit_reason.startsWith(EXIT_REASONS.SIGNAL)) {
                  reason = trade.exit_reason;
                  trade.exit_signal_reason = trade.exit_signal_reason || `Signal close confirmed by exchange at ${exitPrice}`;
               } else {
                  reason = EXIT_REASONS.SIGNAL;
                  trade.exit_signal_reason = `Signal close confirmed by exchange at ${exitPrice}`;
               }
             } else {
               // External event (Manual close on Binance, or external TP/SL)
               if (type === 'TAKE_PROFIT' || type === 'TAKE_PROFIT_MARKET') {
                 reason = EXIT_REASONS.TP_HIT;
                 trade.exit_signal_reason = `External Take Profit hit on exchange at ${exitPrice}`;
               } else if (type === 'STOP' || type === 'STOP_MARKET') {
                 reason = EXIT_REASONS.SL_HIT;
                 trade.exit_signal_reason = `External Stop Loss hit on exchange at ${exitPrice}`;
               } else if (type === 'LIQUIDATION') {
                 reason = EXIT_REASONS.EXCHANGE_FILL;
                 trade.exit_signal_reason = `Liquidation event on exchange at ${exitPrice}`;
               } else {
                 reason = EXIT_REASONS.EXCHANGE_SL_OR_MANUAL;
                 trade.exit_signal_reason = `External close on exchange at ${exitPrice} (Type: ${type})`;
               }
             }

             this.eventEmitter.emit(ENGINE_EVENTS.EXCHANGE_CLOSE, {
               symbol,
               exitPrice,
               reason,
               orderId, // DATA-ACCURACY: Pass orderId to allow authoritative recovery
               feesAlreadyAccounted: true, // CHRONOS: Signal that commissions were already handled via UDS 'n' events
               alreadyRealized: true // CHRONOS: Signal that PnL was already accumulated via UDS 'rp' events
             });
           } else if (status === 'PARTIALLY_FILLED' && isRecognizedExit) {
             // SYNC: Update trade.qty to remaining exchange quantity (q - z)
             const remainingQty = parseFloat(order.q || '0') - parseFloat(order.z || '0');
             if (remainingQty > 0) {
                this.logger.log(`[${tradeIdShort8}] [Sync] Partial recognized exit fill for ${symbol}: ${order.z}/${order.q}. Updating remaining qty to ${remainingQty}`);
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

  public isBanned(): boolean {
    return this.sessionState.isBanned();
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
        const data = (await response.data()) as BinanceUserCommissionRate;
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
      const weight = (typeof headers.get === 'function')
        ? headers.get('X-MBX-USED-WEIGHT-1M')
        : (headers ? (headers['x-mbx-used-weight-1m'] || headers['X-MBX-USED-WEIGHT-1M'] || headers['X-Mbx-Used-Weight-1m'] || headers['x-mbx-used-weight-1m']) : null);

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
  public validateStopLossPlacement(symbol: string, response: Partial<BinanceOrderReceipt & BinanceAlgoOrderReceipt>): { isValid: boolean, orderId?: string } {
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
    return this.orderFilterService.applyFilters(symbol, price, qty, { ...options, paperMode: this.paperMode });
  }

  /**
   * Set leverage for a symbol on Binance (Feature Disabled)
   */
  async setLeverage(symbol: string, leverage: number): Promise<boolean> {
    // Feature disabled as per user request to avoid exchange sync issues
    return true;
  }

  /**
   * SRE: Pre-flight Leverage Bracket check.
   * Ensures the intended position size is within the allowable notional cap
   * for the symbol's current leverage to avoid Error -4031/4033 rejections.
   */
  async checkLeverageBracket(symbol: string, notional: number): Promise<{ isAllowed: boolean; maxNotional?: number }> {
    return this.orderFilterService.checkLeverageBracket(
      symbol,
      notional,
      this.paperMode,
      this.binanceClient,
      (headers) => this.updateWeight(headers),
      (s, o) => this.fetchPosition(s, o)
    );
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
      if (this.sessionState.isBanned()) {
        const until = this.sessionState.apiStatus.banUntil ? new Date(this.sessionState.apiStatus.banUntil).toLocaleTimeString() : 'unknown';
        this.logger.warn(`Binance IP ban active. Blocking entry for ${symbol} until ${until}.`);
        return { status: ExecutionStatus.CIRCUIT_OPEN, error: 'IP ban protection active' };
      }

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

    if (slPrice <= 0) {
      this.logger.error(`${symbol}: CRITICAL - Stop Loss price ${slPrice} must be positive. Rejecting order.`);
      return { status: ExecutionStatus.ORDER_REJECTED, error: 'Stop loss price must be positive' };
    }

    if (tpPrice !== null && tpPrice <= 0) {
      this.logger.error(`${symbol}: CRITICAL - Take Profit price ${tpPrice} must be positive. Rejecting order.`);
      return { status: ExecutionStatus.ORDER_REJECTED, error: 'Take profit price must be positive' };
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

      // SRE: Pre-flight Leverage Bracket check
      const notional = qty * entryPrice;
      const bracketCheck = await this.checkLeverageBracket(symbol, notional);
      if (!bracketCheck.isAllowed) {
         const error = `Leverage cap breach for ${symbol}: Max allowable notional is ${bracketCheck.maxNotional} USDT.`;
         this.logger.error(error);
         return { status: ExecutionStatus.ORDER_REJECTED, error };
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

        // CHRONOS: Register in-flight entry BEFORE the retry loop begins.
        // This ensures the UDS handler can match and promote the trade even if the REST call
        // times out or experiences extreme latency, preventing "Ghost Positions".
        this.positionTracker.setInFlight(symbol, trade);

        try {
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
            // CHRONOS: DO NOT clear in-flight on catch here.
            // We must keep the symbol in in-flight registry during the entire retry window
            // so UDS events can still find and promote it.
            throw e;
          }

          this.updateWeight(response?.headers);
          const entryReceipt = (await response.data()) as BinanceOrderReceipt;
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
              // CHRONOS: Subtract commission from pnl as it's realized
              trade.pnl = roundEight((Number(trade.pnl) || 0) - totalEntryCommission);
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
               const queryData = (await queryRes.data()) as BinanceOrderReceipt;
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

          trade.binance_order_id = String(entryReceipt.orderId);

          // BOLT: Proactively seed real-time order cache to reduce subsequent REST weight
          const entryOrderEntry = {
            symbol,
            orderId: parseFloat(String(entryReceipt.orderId)),
            clientOrderId: entryReceipt.clientOrderId || entryOrderId,
            price: parseFloat(entryReceipt.price || '0'),
            avgPrice: parseFloat(entryReceipt.avgPrice || '0'),
            origQty: parseFloat(entryReceipt.origQty || String(trade.qty ?? qty)),
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
                   const queryData = (await queryRes.data()) as BinanceOrderReceipt;
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
             // Note: in-flight cleanup handled in finally block
             return { status: ExecutionStatus.SL_FAILED, data: trade, error: 'Stop loss triggered locally during entry' };
          }
          if (!slResult || slResult.error) {
            const slError = slResult?.error || 'Unknown SL placement error';
            this.logger.warn(`SL placement failed for ${symbol}: ${slError}. Performing emergency unwind...`);
            try {
              const unwindResult = await this.closeTrade(symbol, trade, entryPrice, EXIT_REASONS.SL_PLACEMENT_FAILURE);
              if (unwindResult.exitOccurred) {
                return { status: ExecutionStatus.SL_FAILED, data: trade, unwindPerformed: true, error: slError };
              } else {
                // CHRONOS: If unwind fails, the trade is STILL OPEN on exchange.
                // We must add it to tracking so the Watchdog can find and protect/close it.
                this.logger.error(`[${symbol}] Emergency unwind failed after SL error. Adding trade to tracking for Watchdog recovery.`);
                this.positionTracker.addTrade(trade);
                return { status: ExecutionStatus.SL_FAILED, data: trade, error: slError };
              }
            } catch (unwindErr) {
              this.logger.error(`CRITICAL: Emergency unwind failed for ${symbol}: ${unwindErr instanceof Error ? unwindErr.message : String(unwindErr)}`);
              // CHRONOS: Same here, ensure it is tracked before throwing.
              this.positionTracker.addTrade(trade);
              throw new ExchangeExecutionException(`SL placement failed (${slError}) and emergency unwind also failed for ${symbol}`);
            }
          }
          break; // Success, exit retry loop

        } catch (err: unknown) {
          if (err instanceof ExchangeExecutionException) {
            throw err;
          }
          const errMsg = err instanceof Error ? err.message : String(err);
          const isNetworkError = errMsg.includes('Network error') || errMsg.includes('timeout') || errMsg.includes('ECONNRESET') || errMsg.includes('ETIMEDOUT');

          if (isNetworkError && attempts < MAX_ATTEMPTS) {
             this.logger.warn(`Network error during entry for ${symbol}. Retrying (Attempt ${attempts + 1}/${MAX_ATTEMPTS})...`);
             await new Promise(resolve => setTimeout(resolve, 1000 * attempts));
             continue;
          }

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
            agreementMsg = `CRITICAL: ${symbol} entry failed. Price outside protection bands (PERCENT_PRICE). This is due to extreme market volatility or high price deviation from mark price. SL distance has no effect on this filter.`;
          } else if (errMsg.includes('leverage') || errMsg.includes('allowable position') || errMsg.includes('max allowable position') || errMsg.includes('position at current leverage')) {
            agreementMsg = `CRITICAL: Position limit exceeded at current leverage for ${symbol}. Adjust leverage on Binance.`;
          }

          this.logger.error(agreementMsg);
          this.eventEmitter.emit(ENGINE_EVENTS.LOG_MESSAGE, { msg: agreementMsg, level: 'error' });

          // CHRONOS: Emit specific rejection for PERCENT_PRICE to ensure the UI updates the gate status immediately.
          if (errMsg.includes('PERCENT_PRICE')) {
             this.broadcastService.broadcast('gate', {
               gateState: 'sl_out_of_bounds',
               reason: agreementMsg,
               scannerPaused: false
             });
          }

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
        } finally {
          // CHRONOS: Always clear in-flight status after the retry loop finishes
          // (whether by success or exhaustion), UNLESS it was already promoted.
          this.positionTracker.clearInFlight(symbol);
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
    if (isNaN(slPrice) || !isFinite(slPrice) || slPrice <= 0) {
      this.logger.error(`[placeStopLoss] ${trade.symbol}: CRITICAL - Requested SL price ${slPrice} is invalid or non-positive. Skipping stop loss placement.`);
      return { orderId: 'FAILED_INVALID_PRICE', price: 0, error: 'Stop loss price must be positive' };
    }

    let currentSlPrice = slPrice;
    let adaptiveAttempts = 0;
    const MAX_ADAPTIVE_ATTEMPTS = 3;

    // Outer loop for Adaptive Buffer Strategy
    adaptiveLoop: while (adaptiveAttempts <= MAX_ADAPTIVE_ATTEMPTS) {
    // SRE: For Stop Loss placement, we MUST clamp to PERCENT_PRICE bands to avoid Error -4131 rejections.
    const filtered = this.applyFilters(trade.symbol, currentSlPrice, trade.qty, {
      skipNotionalCheck: true,
      clampToPercentPrice: true
    });
    currentSlPrice = filtered.price;

    // DATA-CONSISTENCY: Dust Guard for SL placement.
    // If quantity is below exchange stepSize, we cannot place a conditional order.
    // We skip exchange placement to avoid rejection loops; the engine remains responsible for price-based local closure.
    if (filtered.qty <= 0 && trade.qty > 0) {
      this.logger.warn(`[${trade.symbol}] [Sync] SL quantity ${trade.qty} is dust. Skipping exchange SL placement.`);
      return { orderId: 'SKIPPED_DUST', price: currentSlPrice };
    }

    // IMMEDIATE TRIGGER GUARD: Check if current price already breached SL
    let currentMarketPrice = fillPrice;
    if (currentMarketPrice === undefined || currentMarketPrice === 0) {
      const ticker = this.tickerCache.getTicker(trade.symbol);
      currentMarketPrice = ticker?.mark_price || ticker?.price;
    }

    if (currentMarketPrice && currentMarketPrice > 0) {
      const isBreached = currentSlPrice > 0 && (trade.direction === 'LONG' ? currentMarketPrice <= currentSlPrice : currentMarketPrice >= currentSlPrice);
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

        // SRE Loop Prevention: Only emit EXCHANGE_CLOSE if we are not already in a close sequence or close_blocked
        const isClosing = this.closureLocks.get(trade.symbol) === true;
        if (!isClosing && !trade.close_blocked) {
          this.eventEmitter.emit(ENGINE_EVENTS.EXCHANGE_CLOSE, {
            symbol: trade.symbol,
            exitPrice: currentMarketPrice,
            reason: `${EXIT_REASONS.SL_HIT}_${slType}`,
            feesAlreadyAccounted: false // Local trigger, fee not yet accounted by UDS
          });
        } else {
          this.logger.log(`[${trade.id.substring(0, 8)}] ${trade.symbol} SL breach detected but skipped EXCHANGE_CLOSE event dispatch (isClosing=${isClosing}, close_blocked=${!!trade.close_blocked}).`);
        }
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
        clientAlgoId: `sl-${trade.id.substring(0, 8)}`,
        reduceOnly: true,
        priceProtect: true
      };

      this.logger.log(`Placing Binance Algo SL order: ${JSON.stringify(slOrderParams)}`);

      let stopLossId: string | null = null;
      let orderType: 'standard' | 'algo' = 'algo';

      try {
        const response = await this.binanceClient.restAPI.newAlgoOrder(slOrderParams as any);
        this.updateWeight(response?.headers);
        const orderData = (await response.data()) as BinanceAlgoOrderReceipt;

        if (orderData.code && orderData.code !== 0) {
          const code = orderData.code;
          const msg = orderData.msg || '';
            this.logger.warn(`[${symbol}] SL placement failed. Code: ${code}, Message: ${msg}, Raw: ${JSON.stringify(orderData)}`);

          // Handle Duplicate Order ID specifically to recover state after timeout
          if (code === -2011 || msg.includes('Duplicate orderSent') || msg.includes('Duplicate clientOrderId') || msg.includes('Duplicate clientAlgoId')) {
            this.logger.log(`[${symbol}] [Sync] Detected duplicate clientAlgoId on SL retry. Recovering SL state...`);
            // Algo orders might need a different query endpoint or different parameters
            const queryRes = await (this.binanceClient.restAPI as any).queryAlgoOrder({ symbol, clientAlgoId: slOrderParams.clientAlgoId });
            const queryData = (await queryRes.data()) as BinanceAlgoOrderReceipt;
            if (queryData && (queryData.orderId || queryData.algoId)) {
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
            this.eventEmitter.emit(ENGINE_EVENTS.EXCHANGE_CLOSE, {
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
            this.eventEmitter.emit(ENGINE_EVENTS.EXCHANGE_CLOSE, {
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
          delete (standardParams as any).clientAlgoId;
          standardParams.newClientOrderId = `sl-${trade.id.substring(0, 8)}`;

          standardParams.type = 'STOP_MARKET';
          // COMPLIANCE: Standard API uses stopPrice, while Algo API used triggerPrice
          (standardParams as any).stopPrice = standardParams.triggerPrice;
          delete (standardParams as any).triggerPrice;
          // Use closePosition for standard path immunity
          (standardParams as any).closePosition = true;
          delete (standardParams as any).reduceOnly;

          // COMPLIANCE: 'quantity' MUST be omitted if 'closePosition' is true on Binance FAPI.
          // Including both results in a rejection (Error -1106) even if the quantity matches the position.
          delete (standardParams as any).quantity;

          try {
            const fallbackRes = await this.binanceClient.restAPI.newOrder(standardParams as any);
            const fallbackData = (await fallbackRes.data()) as BinanceOrderReceipt;
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
          this.eventEmitter.emit(ENGINE_EVENTS.EXCHANGE_CLOSE, {
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
          this.eventEmitter.emit(ENGINE_EVENTS.EXCHANGE_CLOSE, {
             symbol,
             exitPrice: this.tickerCache.getPrice(symbol) || trade.entry_price,
             reason: EXIT_REASONS.EXCHANGE_SYNC,
             feesAlreadyAccounted: false
          });
          return { orderId: 'TRIGGERED_LOCALLY', price: trade.entry_price };
        } else if (msg.includes('Duplicate orderSent') || msg.includes('Duplicate clientOrderId') || msg.includes('Duplicate clientAlgoId')) {
          this.logger.log(`[${symbol}] [Sync] Detected duplicate client ID (via exception) on SL retry. Recovering SL state...`);
          let queryData;
          if (slOrderParams.clientAlgoId) {
             const queryRes = await (this.binanceClient.restAPI as any).queryAlgoOrder({ symbol, clientAlgoId: slOrderParams.clientAlgoId });
             queryData = await queryRes.data();
          } else {
             const queryRes = await this.binanceClient.restAPI.queryOrder({ symbol, origClientOrderId: slOrderParams.newClientOrderId });
             queryData = await queryRes.data();
          }
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
      const numericId = parseFloat(stopLossId);
      const slOrderEntry = {
        symbol,
        // SRE: Standardize orderId to the numeric exchange ID even for algo orders
        // to ensure reliable terminal status filtering in handleBinanceOrderUpdate.
        orderId: numericId,
        algoId: orderType === 'algo' ? numericId : undefined,
        algoType: orderType === 'algo' ? 'CONDITIONAL' : undefined,
        clientOrderId: orderType === 'algo' ? slOrderParams.clientAlgoId : slOrderParams.newClientOrderId,
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
         const label = adaptiveAttempts > 0 ? 'adaptive placement' : 'filter rounding';
         this.logger.log(`[${trade.symbol}] Syncing local SL to ${label} price: ${trade.current_sl} -> ${currentSlPrice.toFixed(5)}`);
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
         this.logger.warn(`[${trade.symbol}] [Sync] SL conflict detected (${errMsg}). Executing exhaustive symbol flush...`);
         try {
            // SRE: Use exhaustive flush to clear both standard and algo orders
            await this.exhaustiveSymbolFlush(trade.symbol);

            if (networkAttempts < MAX_NETWORK_ATTEMPTS) {
              this.logger.log(`[${trade.symbol}] [Sync] Exhaustive flush complete. Retrying SL placement (Attempt ${networkAttempts + 1})...`);
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

    // SRE: Immunity check. If we are currently banned, don't try to ratchet
    if (this.sessionState.isBanned()) {
       this.logger.warn(`[SL Ratchet] Ratchet blocked for ${trade.symbol}: IP is currently banned.`);
       return { success: false };
    }

    // LOCK: Prevent Watchdog from interfering during the cancel/replace window
    this.ratchetLocks.set(trade.symbol, true);

    // CHRONOS: Pre-flight capacity check.
    // Ratcheting is a multi-part operation (Cancel + Replace + potential Rollback).
    // We budget for 2 slots (Replace + Rollback) with normal priority (1).
    if (!this.paperMode && this.binanceClient) {
      const hasWeight = !this.sessionState.isRateLimited(0.85);
      const hasOrderSlots = this.sessionState.hasOrderCapacity(2, 1);

      if (!hasWeight || !hasOrderSlots) {
         this.logger.warn(`[SL Ratchet] Deferring ratchet for ${trade.symbol} due to low capacity (WeightOK=${hasWeight}, SlotsOK=${hasOrderSlots}).`);
         this.ratchetLocks.delete(trade.symbol);
         return { success: false };
      }
    }

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
        // SRE: Query by both clientOrderId and clientAlgoId (Binance SDK/API variance)
        const queryRes = await this.binanceClient.restAPI.queryOrder({
          symbol: trade.symbol,
          origClientOrderId: deterministicClientId
        });
        exchangeState = await queryRes.data();
      } catch (e: any) {
        // Fallback for algo orders which might use clientAlgoId
        try {
           const queryRes = await (this.binanceClient.restAPI as any).queryAlgoOrder({
             symbol: trade.symbol,
             clientAlgoId: deterministicClientId
           });
           exchangeState = await queryRes.data();
        } catch (algoErr) {
           this.logger.debug(`[SL] No existing order with ID ${deterministicClientId} found via query.`);
        }
      }

      if (exchangeState && exchangeState.orderId) {
        const status = exchangeState.status?.toUpperCase();
        if (status === 'FILLED') {
           this.logger.log(`[SL Ratchet] Existing SL order ${exchangeState.orderId} is already FILLED. Short-circuiting to EXCHANGE_CLOSE.`);
           const exitPrice = parseFloat(exchangeState.avgPrice || exchangeState.price || '0') || this.tickerCache.getPrice(trade.symbol) || trade.current_sl;
           this.eventEmitter.emit(ENGINE_EVENTS.EXCHANGE_CLOSE, {
              symbol: trade.symbol,
              exitPrice,
              reason: EXIT_REASONS.EXCHANGE_SYNC,
              orderId: String(exchangeState.orderId),
              feesAlreadyAccounted: false
           });
           return { success: false };
        }
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
              // CHRONOS: Sync local state with rollback ID to maintain watchdog consistency
              trade.binance_stop_order_id = rollbackResult.orderId;
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
      const data = typeof response.data === 'function' ? await response.data() : response.data;
      this.logger.log(`Binance ${orderType} order canceled: ${symbol} order_id=${orderId}. Response: ${JSON.stringify(data)}`);

      // SRE: Proactively remove from real-time cache and mark as executed to prevent
      // the Watchdog from seeing it as an "orphan" during the UDS propagation delay.
      let currentOrders = this.sessionState.realTimeOrders.get(symbol) || [];
      const updatedOrders = currentOrders.filter(o => String(o.orderId) !== orderId && String(o.algoId || '') !== orderId);
      this.sessionState.realTimeOrders.set(symbol, updatedOrders);
      this.markAsExecuted(symbol, orderId, 'CANCELED');

      return true;
    } catch (err) {
      // If order is already filled or canceled, we can ignore the error
      const errMsg = err instanceof Error ? err.message : String(err);
      const upperMsg = errMsg.toUpperCase();
      if (upperMsg.includes('ORDER HAS BEEN FILLED') || upperMsg.includes('UNKNOWN_ORDER') || upperMsg.includes('UNKNOWN ORDER')) {
        this.logger.debug(`Order ${orderId} already closed: ${errMsg}`);

        // SRE: Even if it failed with UNKNOWN_ORDER, we must purge it from local cache
        // to prevent infinite retry loops in the Watchdog.
        let currentOrders = this.sessionState.realTimeOrders.get(symbol) || [];
        const updatedOrders = currentOrders.filter(o => String(o.orderId) !== orderId && String(o.algoId || '') !== orderId);
        this.sessionState.realTimeOrders.set(symbol, updatedOrders);
        this.markAsExecuted(symbol, orderId, 'CANCELED');

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

  public async fetchAllOpenOrders(): Promise<(BinanceOrderReceipt | BinanceAlgoOrderReceipt)[]> {
    if (!this.binanceClient) return [];
    try {
      this.monitoringService.incrementApiRequests();
      // Use standard endpoint
      const response = await this.binanceClient.restAPI.currentAllOpenOrders();
      this.updateWeight(response?.headers);
      const standardOrders = ((await response.data()) as BinanceOrderReceipt[]) || [];

      // Also fetch algorithmic orders (Stop Losses)
      const algoOrders = await this.fetchAllOpenAlgoOrders();

      const allOrders: (BinanceOrderReceipt | BinanceAlgoOrderReceipt)[] = [...standardOrders, ...algoOrders];

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

  public async fetchAllOpenAlgoOrders(): Promise<BinanceAlgoOrderReceipt[]> {
    if (!this.binanceClient) return [];
    try {
      this.monitoringService.incrementApiRequests();
      const response = await this.binanceClient.restAPI.currentAllAlgoOpenOrders();
      this.updateWeight(response?.headers);
      const data = (await response.data()) as (BinanceAlgoOrderReceipt[] | { orders: BinanceAlgoOrderReceipt[] });
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

    const statuses: Record<string, { fired: boolean, active: boolean, remaining_delay: number, config_delay?: number | string, label: string, value: number, threshold: number, unit: string, description?: string, insufficientData?: boolean, threshold_is_price?: boolean }> = {};
    const delays = config.exit_signal_delays || {};
    const logic = config.exit_signal_logic || 'any';

    let firedCount = 0;
    let activeCount = 0;

    // BOLT OPTIMIZATION: Call signalEngine once for all exit signals
    // Pass original config directly to avoid redundant SessionConfig cloning/allocations
    const consolidatedResult = this.signalEngine.checkEntry(
      symbol,
      config,
      interval,
      trade.direction,
      'exit'
    );

    // BOLT OPTIMIZATION: In-loop accumulation of satisfied active signal keys to avoid Object.keys().filter() allocations
    const satisfiedActiveKeys: string[] = [];

    // Check each exit signal
    for (const exitSignal of config.exit_signals) {
      try {
        const delay = delays[exitSignal] !== undefined ? delays[exitSignal] : 0;
        let delaySec = 0;
        let isCandleDelay = false;
        let candleCount = 0;

        if (typeof delay === 'string' && /^\d+c$/.test(delay)) {
          isCandleDelay = true;
          candleCount = parseInt(delay.slice(0, -1), 10);
        } else if (typeof delay === 'number') {
          delaySec = delay;
        } else if (typeof delay === 'string') {
          const parsed = parseFloat(delay);
          if (!isNaN(parsed)) {
            delaySec = parsed;
          }
        }

        let requiredDelaySec = delaySec;
        if (isCandleDelay) {
          // Resolve timeframe: signal_timeframes or fallback to interval or scan_interval
          const signalTf = (config.signal_timeframes?.[exitSignal] && config.signal_timeframes?.[exitSignal] !== 'default')
            ? config.signal_timeframes[exitSignal]
            : (interval || config.scan_interval || '5m');
          const candleMs = parseIntervalToMs(signalTf);
          requiredDelaySec = (candleCount * candleMs) / 1000;
        }

        const detail = consolidatedResult.details ? consolidatedResult.details[exitSignal] : null;
        const isFired = !!(detail?.fired || (consolidatedResult.firedSignals.includes(exitSignal)));

        // SRE: Override delay to zero if exit_signals_override_ratchet is active and we are in high profit relative to signal target
        if (config.exit_signals_override_ratchet && detail && detail.threshold_is_price && typeof detail.threshold === 'number' && detail.threshold > 0) {
          const currentPrice = this.tickerCache.getPrice(symbol) || trade.mark_price || trade.last_price || trade.entry_price;
          if (currentPrice && trade.entry_price && trade.qty) {
            let currentPnl = 0;
            let signalPnl = 0;
            if (trade.direction === 'LONG') {
              currentPnl = (currentPrice - trade.entry_price) * trade.qty;
              signalPnl = (detail.threshold - trade.entry_price) * trade.qty;
            } else {
              currentPnl = (trade.entry_price - currentPrice) * trade.qty;
              signalPnl = (trade.entry_price - detail.threshold) * trade.qty;
            }

            if (currentPnl > 0 && signalPnl > 0 && currentPnl > signalPnl) {
              requiredDelaySec = 0;
              this.logger.log(`[SL Override] Positive exit signal target P&L detected for ${symbol} on signal ${exitSignal}. Delay overridden to 0.`);
            }
          }
        }

        const isActive = tradeAgeSec >= requiredDelaySec;
        const remaining = Math.max(0, requiredDelaySec - tradeAgeSec);

        statuses[exitSignal] = {
          fired: isFired,
          active: isActive,
          remaining_delay: remaining,
          config_delay: delay,
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
          satisfiedActiveKeys.push(exitSignal);
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
      exitTriggered = satisfiedActiveKeys.length > 0;
      if (exitTriggered) {
        exitSignalType = satisfiedActiveKeys[0];
      }
    } else if (logic === 'all') {
      // 'all' logic: all signals must be active AND fired
      exitTriggered = satisfiedActiveKeys.length === allEnabled;
      if (exitTriggered) {
        exitSignalType = 'combined';
      }
    } else if (logic === 'combo') {
      const requiredConfigured = config.required_exit_signals || [];
      let requiredSet: string[] = [];
      let optionalSet: string[] = [];

      if (requiredConfigured.length > 0) {
        requiredSet = config.exit_signals.filter(s => requiredConfigured.includes(s));
        optionalSet = config.exit_signals.filter(s => !requiredConfigured.includes(s));
      } else {
        const baseSignals = config.exit_signals.filter(s => {
          const lastUnderscore = s.lastIndexOf('_');
          return lastUnderscore <= 0;
        });
        if (baseSignals.length > 0 && baseSignals.length < config.exit_signals.length) {
          requiredSet = baseSignals;
          optionalSet = config.exit_signals.filter(s => !baseSignals.includes(s));
        } else {
          requiredSet = [config.exit_signals[0]];
          optionalSet = config.exit_signals.slice(1);
        }
      }

      const reqSatisfied = requiredSet.every(s => satisfiedActiveKeys.includes(s));
      const optSatisfied = optionalSet.length === 0 || optionalSet.some(s => satisfiedActiveKeys.includes(s));
      exitTriggered = reqSatisfied && optSatisfied;
      if (exitTriggered) {
        exitSignalType = 'combo';
      }
    }

    if (exitTriggered) {
      this.logger.log(`Exit triggered for ${symbol} via ${logic.toUpperCase()} logic (signals fired: ${firedCount}/${allEnabled})`);
    }

    return { exitTriggered, exitSignalType };
  }

  public async fetchAllPositions(retries = 3): Promise<BinancePositionV3[]> {
    if (!this.binanceClient) return [];
    if (!this.paperMode && this.sessionState.isRateLimited(0.95)) return [];
    
    for (let i = 0; i < retries; i++) {
        try {
          this.monitoringService.incrementApiRequests();
          // Finding 7: Use V3 for targeted active positions
          const response = await this.binanceClient.restAPI.positionInformationV3();
          this.updateWeight(response.headers);
          const data = (await response.data()) as BinancePositionV3[];
          if (!Array.isArray(data)) {
            throw new Error(`Invalid position data received (type: ${typeof data})`);
          }
          return data;
        } catch (err) {
          this.logger.warn(`Failed to fetch all positions (Attempt ${i + 1}/${retries}): ${err instanceof Error ? err.message : String(err)}`);
          if (i === retries - 1) throw err;
          await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, i))); // Exponential backoff
        }
    }
    return []; // Should not reach here
  }

  public async fetchOpenOrders(symbol: string, options: { forceFresh?: boolean } = {}): Promise<(BinanceOrderReceipt | BinanceAlgoOrderReceipt)[]> {
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
      const standardOrders = ((await res.data()) as BinanceOrderReceipt[]) || [];

      // 2. Fetch algorithmic orders (Stop Losses)
      const algoOrders = await this.fetchOpenAlgoOrders(symbol, { forceFresh: true });

      const allOrders: (BinanceOrderReceipt | BinanceAlgoOrderReceipt)[] = [...standardOrders, ...algoOrders];
      this.sessionState.realTimeOrders.set(symbol, allOrders);
      return allOrders;
    } catch (err) {
      this.logger.debug(`[${symbol}] Failed to fetch open orders: ${err instanceof Error ? err.message : String(err)}`);
      return [];
    }
  }

  public async fetchOpenAlgoOrders(symbol: string, options: { forceFresh?: boolean } = {}): Promise<BinanceAlgoOrderReceipt[]> {
    if (!this.binanceClient) return [];
    try {
      this.monitoringService.incrementApiRequests();
      const response = await this.binanceClient.restAPI.currentAllAlgoOpenOrders({ symbol });
      this.updateWeight(response?.headers);
      const data = (await response.data()) as (BinanceAlgoOrderReceipt[] | { orders: BinanceAlgoOrderReceipt[] });
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

  /**
   * SRE: Exhaustive Symbol Flush.
   * Cancels BOTH standard and algorithmic orders for a symbol to resolve ReduceOnly capacity conflicts.
   */
  public async exhaustiveSymbolFlush(symbol: string) {
    if (this.paperMode || !this.binanceClient) return;

    if (this.flushLocks.get(symbol)) {
       this.logger.debug(`[${symbol}] Flush already in progress. skipping.`);
       return;
    }

    try {
      this.flushLocks.set(symbol, true);
      this.logger.log(`[${symbol}] [Flush] Initiating exhaustive symbol flush...`);

      // 1. Cancel all standard orders
      try {
        const res = await this.binanceClient.restAPI.cancelAllOpenOrders({ symbol });
        this.updateWeight(res?.headers);
        this.logger.log(`[${symbol}] [Flush] Standard orders cleared.`);
      } catch (e: any) {
        this.logger.debug(`[${symbol}] [Flush] No standard orders to clear or failed: ${e.message}`);
      }

      // 2. Cancel all algo orders
      try {
        this.logger.debug(`[${symbol}] [Flush] Clearing all algo orders...`);
        const res = await (this.binanceClient.restAPI as any).cancelAllAlgoOpenOrders({ symbol });
        this.updateWeight(res?.headers);
        this.logger.log(`[${symbol}] [Flush] Algo orders cleared.`);
      } catch (e: any) {
        this.logger.debug(`[${symbol}] [Flush] Failed to clear all algo orders via bulk API: ${e.message}. Falling back to manual loop.`);
        try {
          const algoOrders = await this.fetchOpenAlgoOrders(symbol, { forceFresh: true });
          if (algoOrders.length > 0) {
             this.logger.log(`[${symbol}] [Flush] Found ${algoOrders.length} ghost algo orders. Clearing manually...`);
             for (const o of algoOrders) {
                const algoId = String(o.algoId || o.orderId);
                await this.cancelBinanceOrder(symbol, algoId, 'algo');
             }
          }
        } catch (innerE: any) {
           this.logger.debug(`[${symbol}] [Flush] Manual algo clear failed: ${innerE.message}`);
        }
      }

      // 3. Purge real-time caches
      this.sessionState.realTimeOrders.delete(symbol);
      this.markAsExecuted(symbol, 'ALL', 'FLUSHED');

      this.logger.log(`[${symbol}] [Flush] Exhaustive flush complete.`);
    } finally {
      this.flushLocks.delete(symbol);
    }
  }

  public async queryOrderStatus(
    symbol: string,
    orderId: string,
    orderType: 'standard' | 'algo' = 'standard'
  ): Promise<{ status: string; price: number; avgPrice: number; type?: string; stopPrice?: number } | null> {
    if (!this.binanceClient || this.paperMode) return null;

    // SRE: Attempt standard or algo query based on orderType, with automatic fallback
    try {
      if (orderType === 'algo') {
        try {
          const queryRes = await (this.binanceClient.restAPI as any).queryAlgoOrder({ symbol, algoId: orderId });
          this.updateWeight(queryRes?.headers);
          const data = (await queryRes.data()) as BinanceAlgoOrderReceipt;
          if (data) {
            return {
              status: data.algoStatus || (data as any).status,
              price: parseFloat((data as any).price || '0'),
              avgPrice: parseFloat((data as any).avgPrice || '0'),
              type: data.algoType || (data as any).type,
              stopPrice: parseFloat((data as any).triggerPrice || (data as any).stopPrice || '0')
            };
          }
        } catch (algoErr: any) {
          this.logger.debug(`queryOrderStatus: algo query failed for ${orderId}, falling back to standard: ${algoErr.message}`);
        }
      }

      // Fallback or primary standard query
      const queryRes = await this.binanceClient.restAPI.queryOrder({ symbol, orderId: BigInt(orderId) });
      this.updateWeight(queryRes?.headers);
      const data = (await queryRes.data()) as BinanceOrderReceipt;
      if (data) {
        return {
          status: data.status,
          price: parseFloat(data.price || '0'),
          avgPrice: parseFloat(data.avgPrice || '0'),
          type: data.type,
          stopPrice: parseFloat(data.stopPrice || (data as any).triggerPrice || '0')
        };
      }
    } catch (err: any) {
      // Also try algo query if standard was primary but failed
      if (orderType !== 'algo') {
        try {
          const queryRes = await (this.binanceClient.restAPI as any).queryAlgoOrder({ symbol, algoId: orderId });
          this.updateWeight(queryRes?.headers);
          const data = (await queryRes.data()) as BinanceAlgoOrderReceipt;
          if (data) {
            return {
              status: data.algoStatus || (data as any).status,
              price: parseFloat((data as any).price || '0'),
              avgPrice: parseFloat((data as any).avgPrice || '0'),
              type: data.algoType || (data as any).type,
              stopPrice: parseFloat((data as any).triggerPrice || (data as any).stopPrice || '0')
            };
          }
        } catch (innerAlgoErr) {}
      }
      this.logger.debug(`Failed to query order ${orderId} for ${symbol}: ${err.message || err}`);
    }
    return null;
  }

  public async fetchPosition(symbol: string, options: { forceFresh?: boolean } = {}): Promise<BinancePositionV3 | null> {
    // Zero-Weight Path: Prefer local real-time cache from User Data Stream
    if (!options.forceFresh) {
      const cached = this.sessionState.realTimePositions.get(symbol);
      if (cached) {
         return {
            symbol,
            positionAmt: String(cached.amount),
            entryPrice: String(cached.entryPrice),
            unRealizedProfit: '0', // Not critical for closure checks
            positionSide: 'BOTH',
            breakEvenPrice: '0',
            markPrice: '0',
            liquidationPrice: '0',
            leverage: '0',
            maxNotionalValue: '0',
            marginType: 'cross',
            isolatedMargin: '0',
            isAutoAddMargin: 'false',
            notional: '0',
            isolatedWallet: '0',
            updateTime: Date.now()
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
      const data = (await response.data()) as BinancePositionV3[];

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

      // If no orderId provided, check if the trade has an active stop loss order we can query
      if (!orderId && trade.binance_stop_order_id) {
         try {
            const queryParams: any = { symbol };
            try {
              if (/^\d+$/.test(trade.binance_stop_order_id)) {
                queryParams.orderId = BigInt(trade.binance_stop_order_id);
              } else {
                queryParams.origClientOrderId = trade.binance_stop_order_id;
              }
            } catch (err) {
              queryParams.origClientOrderId = trade.binance_stop_order_id;
            }
            const stopOrderRes = await this.binanceClient.restAPI.queryOrder(queryParams);
            const stopOrderData = (await stopOrderRes.data()) as BinanceOrderReceipt;
            if (stopOrderData && (stopOrderData.status === 'FILLED' || stopOrderData.status === 'PARTIALLY_FILLED')) {
               orderId = trade.binance_stop_order_id;
               this.logger.log(`[${(trade.id || 'N/A').substring(0, 8)}] [Sync] Found filled tracked stop-loss order ${orderId} on exchange. Using for recovery.`);
            }
         } catch (e) {
            this.logger.debug(`[${(trade.id || 'N/A').substring(0, 8)}] [Sync] Failed to query stop order ${trade.binance_stop_order_id}: ${e instanceof Error ? e.message : String(e)}`);
         }
      }

      // If no orderId provided, try to find the most recent one in trade history
      if (!orderId) {
        const tradesRes = await this.binanceClient.restAPI.accountTradeList({ symbol, limit: 10 });
        const trades = (await tradesRes.data()) as BinanceTrade[];
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
              orderId = String(lastFill.orderId);
            }
          }
        }
      }

      if (orderId) {
         try {
            this.logger.log(`[Sync] Recovering authoritative order context for ID ${orderId}...`);
            const queryParams: any = { symbol };
            try {
              if (/^\d+$/.test(orderId)) {
                queryParams.orderId = BigInt(orderId);
              } else {
                queryParams.origClientOrderId = orderId;
              }
            } catch (err) {
              queryParams.origClientOrderId = orderId;
            }
            const orderRes = await this.binanceClient.restAPI.queryOrder(queryParams);
            const orderData = (await orderRes.data()) as BinanceOrderReceipt;

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

                      // Explicitly preserve slType (e.g. SL_HIT_M1, SL_HIT_BREAKEVEN, SL_HIT_TRAILING_STOP)
                      if (!isInitial && (slType === 'TRAILING_STOP' || slType === 'trailing')) {
                        reason = EXIT_REASONS.TRAILING_STOP;
                      } else {
                        reason = `${EXIT_REASONS.SL_HIT}_${slType}`;
                      }
                   } else if (clientOrderId && clientOrderId.startsWith('cls-')) {
                      reason = EXIT_REASONS.MANUAL_CLOSE;
                   } else if (clientOrderId && clientOrderId.startsWith('tp-')) {
                      reason = EXIT_REASONS.TP_HIT;
                   } else if (clientOrderId && clientOrderId.startsWith('sig-')) {
                      // Dynamically resolve exact exit signal indicator and params
                      // BOLT OPTIMIZATION: Use for...in loop instead of Object.entries to eliminate key-value entry array and tuple allocations
                      let foundSignal = '';
                      if (trade && trade.exit_signals_status) {
                         for (const key in trade.exit_signals_status) {
                            if (Object.prototype.hasOwnProperty.call(trade.exit_signals_status, key)) {
                               const status = (trade.exit_signals_status as Record<string, any>)[key];
                               if (status && status.fired === true) {
                                  foundSignal = key;
                                  break;
                               }
                            }
                         }
                      }

                      if (foundSignal) {
                         reason = `${EXIT_REASONS.SIGNAL}_${foundSignal.toUpperCase()}`;
                         this.logger.log(`[Sync] Recovered specific exit signal from status map: ${reason}`);
                      } else if (trade && trade.exit_reason && trade.exit_reason.startsWith(EXIT_REASONS.SIGNAL)) {
                         reason = trade.exit_reason;
                         this.logger.log(`[Sync] Retained specific exit signal from trade.exit_reason: ${reason}`);
                      } else {
                         reason = EXIT_REASONS.SIGNAL;
                         this.logger.log(`[Sync] Fallback to generic SIGNAL exit reason.`);
                      }
                   } else {
                      // Distinguish adjusted SL from initial SL hits
                      const currentExchangeSl = parseFloat(orderData.stopPrice || orderData.triggerPrice || '0');
                      const initialSl = Number(trade.initial_sl);
                      const isInitial = Math.abs(currentExchangeSl - initialSl) <= initialSl * 0.0001;
                      const slType = isInitial ? 'INITIAL_SL' : (trade.sl_adjustments?.length ? trade.sl_adjustments[trade.sl_adjustments.length - 1].reason : 'ADJUSTED_SL');

                      if (currentExchangeSl > 0 && initialSl > 0 && !isInitial) {
                        if (slType === 'TRAILING_STOP' || slType === 'trailing') {
                          reason = EXIT_REASONS.TRAILING_STOP;
                        } else {
                          reason = `${EXIT_REASONS.SL_HIT}_${slType}`;
                        }
                      } else {
                        reason = EXIT_REASONS.EXCHANGE_SL_OR_MANUAL;
                      }
                   }

                   if (reason === EXIT_REASONS.EXCHANGE_SL_OR_MANUAL || !reason) {
                      const currentSl = Number(trade.current_sl);
                      const initialSl = Number(trade.initial_sl);
                      const threshold = 0.005; // 0.5% tolerance for slippage

                      if (currentSl > 0 && Math.abs(fillPrice - currentSl) / currentSl <= threshold) {
                         const isInitial = Math.abs(currentSl - initialSl) < initialSl * 0.0001;
                         const slType = isInitial ? 'INITIAL_SL' : (trade.sl_adjustments?.length ? trade.sl_adjustments[trade.sl_adjustments.length - 1].reason : 'ADJUSTED_SL');

                         if (!isInitial && (slType === 'TRAILING_STOP' || slType === 'trailing')) {
                            reason = EXIT_REASONS.TRAILING_STOP;
                         } else {
                            reason = `${EXIT_REASONS.SL_HIT}_${slType}`;
                         }
                         this.logger.log(`[Sync] Price proximity recovery: resolved ${symbol} exit as Stop Loss (${reason}) based on price ${fillPrice} close to SL ${currentSl}`);
                      } else if (initialSl > 0 && Math.abs(fillPrice - initialSl) / initialSl <= threshold) {
                         reason = `${EXIT_REASONS.SL_HIT}_INITIAL_SL`;
                         this.logger.log(`[Sync] Price proximity recovery: resolved ${symbol} exit as Initial Stop Loss based on price ${fillPrice} close to Initial SL ${initialSl}`);
                      } else {
                         const tpPrice = Number((trade as any).tp_price || (trade as any).current_tp || 0);
                         if (tpPrice > 0 && Math.abs(fillPrice - tpPrice) / tpPrice <= threshold) {
                            reason = EXIT_REASONS.TP_HIT;
                            this.logger.log(`[Sync] Price proximity recovery: resolved ${symbol} exit as Take Profit based on price ${fillPrice} close to TP ${tpPrice}`);
                         }
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

      const exitReason = isPast ? EXIT_REASONS.ENTRY_AT_OR_PAST_SL : EXIT_REASONS.ENTRY_TOO_CLOSE_TO_SL;

      // CHRONOS: Unwind position via EXCHANGE_CLOSE event to ensure TradingSessionService
      // broadcasts the 'closed' event to the frontend, preventing ghost trades.
      this.eventEmitter.emit(ENGINE_EVENTS.EXCHANGE_CLOSE, {
        symbol,
        exitPrice: actualPrice,
        reason: exitReason,
        needsMarketClose: true
      });

      return { isValid: false, error: `Entry ${reason.toLowerCase()} SL: ${actualPrice.toFixed(8)}` };
    }

    // Abort if negative slippage (worse price) exceeds threshold
    if (slippage < -abortThreshold) {
      const abortMsg = `[CRITICAL] Negative slippage for ${symbol} (${slippagePctStr}%) exceeded abort threshold (${(abortThreshold * 100).toFixed(2)}%). Unwinding immediately.`;
      this.logger.error(abortMsg);
      this.eventEmitter.emit(ENGINE_EVENTS.LOG_MESSAGE, { msg: abortMsg, level: 'error' });

      // CHRONOS: Unwind position via EXCHANGE_CLOSE event to ensure consistent state broadcast
      this.eventEmitter.emit(ENGINE_EVENTS.EXCHANGE_CLOSE, {
        symbol,
        exitPrice: actualPrice,
        reason: EXIT_REASONS.SLIPPAGE_ABORT,
        needsMarketClose: true
      });

      return { isValid: false, error: `Slippage abort: ${slippagePctStr}%` };
    } else if (slippage < -warningThreshold) {
      this.logger.warn(`Slippage warning for ${symbol}: Delta ${slippagePctStr}% exceeds threshold ${(warningThreshold * 100).toFixed(2)}%`);
    }

    return { isValid: true };
  }

  /**
   * CHRONOS/Resilience: Aggressive LIMIT-inside-band fallback for positions that cannot be
   * closed via MARKET order because the price is outside Binance's PERCENT_PRICE protection
   * bands (structurally illiquid). Places a reduce-only IOC LIMIT order clamped inside the
   * exchange bands. Shared by:
   *   (a) the PERCENT_PRICE catch inside closeTrade's MARKET-close path, and
   *   (b) the illiquid_blocked shortcut at the top of closeTrade.
   *
   * Enforces the close-attempt ceiling internally: once attempts are exhausted the trade is
   * escalated to `close_blocked` (requiring manual intervention) instead of burning more orders.
   *
   * Returns true if a LIMIT order was attempted (regardless of fill), false if the ceiling was
   * already reached and the call was escalated to close_blocked instead.
   */
  private async attemptAggressiveLimitClose(symbol: string, trade: Trade, exitPrice: number): Promise<boolean> {
    const MAX_CLOSE_ATTEMPTS = 5;

    // CIRCUIT: If the attempt ceiling is reached, escalate to close_blocked and stop trying.
    if (trade.close_attempts && trade.close_attempts >= MAX_CLOSE_ATTEMPTS) {
      trade.close_blocked = true;
      const blockMsg = `CRITICAL: ${symbol} close attempt ceiling reached. Automated closes are now BLOCKED for this symbol. To unblock, please manual close or sync on Binance.`;
      this.logger.error(blockMsg);
      this.eventEmitter.emit(ENGINE_EVENTS.LOG_MESSAGE, { msg: blockMsg, level: 'error' });
      this.eventEmitter.emit(ENGINE_EVENTS.ALERT, { level: 'error', title: 'Close Blocked', message: blockMsg });
      return false;
    }

    if (!this.binanceClient) return false;

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

      const limitData = (await limitResponse.data()) as BinanceOrderReceipt;
      if (limitData.orderId) {
        this.logger.log(`Aggressive LIMIT fallback for ${symbol} successful: ${limitData.orderId} | Executed Qty: ${limitData.executedQty || 0}`);
        trade.binance_close_order_id = String(limitData.orderId);
        // SRE: Gate flag clear on executedQty > 0 to avoid clearing flag on zero-fill IOC.
        const execQty = parseFloat(limitData.executedQty || '0');
        if (execQty > 0) {
          trade.illiquid_blocked = false;
        }
      }
      return true;
    } catch (limitErr) {
      this.logger.error(`Aggressive LIMIT fallback failed for ${symbol}: ${limitErr instanceof Error ? limitErr.message : String(limitErr)}`);
      return true;
    }
  }

  async closeTrade(
    symbol: string,
    trade: Trade,
    exitPrice: number,
    exitReason: string,
    paperMode = this.paperMode,
    localOnly = false,
    options: { ignoreBlocked?: boolean, orderId?: string, feesAlreadyAccounted?: boolean, alreadyRealized?: boolean } = {}
  ): Promise<{ trade: Trade; exitOccurred: boolean; closeBlocked?: boolean, error?: string }> {
    // SRE: Per-symbol concurrency lock to prevent overlapping closure attempts
    // BOLT: Lock is now universal to prevent race conditions during localOnly syncs (Issue 2)
    if (this.closureLocks.get(symbol)) {
       this.logger.debug(`[${symbol}] Closure already in progress. Skipping redundant request.`);
       return { trade, exitOccurred: false };
    }

    const stopOrderId = trade.binance_stop_order_id;

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
      // BOLT/CHRONOS: Computed up-front (before the illiquid shortcut below) so that
      // already-illiquid positions also respect the exponential backoff and do not spam
      // exchange requests on every close attempt.
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

      // SRE: Proactively update the last attempt timestamp to prevent watchdog spam
      // even if the subsequent logic fails or returns early.
      if (!paperMode && !localOnly) {
         trade.last_close_attempt_ts = nowTs;
      }

      // CHRONOS: Routing for illiquid positions. If a symbol is structurally illiquid,
      // we skip the MARKET attempt and route directly to the aggressive LIMIT fallback.
      // Previously this rerouted via a synthetic `throw new Error('PERCENT_PRICE')`, but that
      // throw fired OUTSIDE the MARKET-close try/catch, so it propagated to the outer catch and
      // silently returned exitOccurred:false without ever placing the LIMIT order. We now invoke
      // the LIMIT fallback directly so an already-illiquid position actively retries closure
      // (the watchdog still escalates to a nuclear close after 15 min, and the attempt ceiling is
      // enforced inside the fallback).
      if (trade.illiquid_blocked && !localOnly && !options.ignoreBlocked) {
         this.logger.warn(`[${symbol}] Routing illiquid position directly to aggressive LIMIT fallback.`);
         trade.close_attempts = (trade.close_attempts || 0) + 1;
         trade.last_close_attempt_ts = nowTs;
         await this.attemptAggressiveLimitClose(symbol, trade, exitPrice);
         this.eventEmitter.emit(ENGINE_EVENTS.TRADE_UPDATED, { trade });
         // The LIMIT may still be filling via UDS; we do not synchronously finalize closure here,
         // consistent with the PERCENT_PRICE catch path which also defers finalization.
         return { trade, exitOccurred: false };
      }

      // BOLT: Authoritative Price Recovery. If this is an external closure (localOnly) or we lack a price,
      // we attempt to fetch the canonical avgPrice from the exchange state.
      if (!paperMode && this.binanceClient && (exitPrice === 0 || localOnly)) {
        const tickerPrice = this.tickerCache.getPrice(symbol);
        const estimate = exitPrice || tickerPrice || trade.current_sl;

        const context = await this.recoverClosingContext(symbol, trade, estimate, options.orderId || stopOrderId);

        // Only update if we found a valid authoritative price
        if (context.price > 0 && Math.abs(context.price - exitPrice) > 0.00000001) {
           this.logger.debug(`[${symbol}] [Sync] Updated exit price from exchange context: ${exitPrice} -> ${context.price}`);
           exitPrice = context.price;
           options.alreadyRealized = false;
           options.feesAlreadyAccounted = false;

           // BOLT: Field Synchronization. Update tooltip reason to match the new authoritative price.
           // Handles multiple patterns: "reached SL X", "at X", "confirmed by exchange at X"
           const pricePattern = /(reached SL |confirmed by exchange at |at )([\d.]+)/;
           if (trade.exit_signal_reason && pricePattern.test(trade.exit_signal_reason)) {
              trade.exit_signal_reason = trade.exit_signal_reason.replace(pricePattern, `$1${exitPrice}`);
           } else if (!trade.exit_signal_reason) {
              // If no reason set yet (e.g. EXCHANGE_SYNC), create a descriptive one with the price
              const label = (context.reason || exitReason).replace(/_/g, ' ');
              trade.exit_signal_reason = `${label} at ${exitPrice}`;
           }
        }

        if (context.reason && context.reason !== exitReason && this.shouldUpgradeExitReason(exitReason, context.reason)) {
          this.logger.log(`[${symbol}] [Sync] Upgrading exit reason: ${exitReason} -> ${context.reason}`);
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
            // CHRONOS: Subtract estimated fee from pnl
            trade.pnl = roundEight((Number(trade.pnl) || 0) - exitFee);
         }
      }

      // DATA-CONSISTENCY: Check for dust before attempting exchange closure.
      // If the position is smaller than the exchange's minimum step size, any MARKET order will be rejected.
      // We handle these residual amounts via local-only synchronization to prevent infinite loop rejections.
      const hasOrderId = trade.binance_order_id && trade.binance_order_id !== '';
      if (!paperMode && !localOnly && this.binanceClient && hasOrderId) {
        const filters = this.marketFeed.getSymbolFilters(symbol);
        if (filters && filters.stepSize > 0) {
          const epsilon = 1e-10;
          if (trade.qty < filters.stepSize - epsilon) {
            this.logger.warn(`[${symbol}] [Sync] Position ${trade.qty} is below stepSize (${filters.stepSize}). Converting to local-only dust synchronization.`);
            localOnly = true;
          }
        }
      }

      // In live mode, place close order with reduce-only for safety
      // BOLT: Support both standard binance_order_id and RECON- prefixed IDs for imported trades
      if (!paperMode && !localOnly && this.binanceClient && hasOrderId) {
        trade.close_attempts = (trade.close_attempts || 0) + 1;
        // Persistence trigger for every attempt increment
        this.eventEmitter.emit(ENGINE_EVENTS.TRADE_UPDATED, { trade });

        let closeSuccess = false;
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

          // DATA-07: Use pre-parsed filters and ensure we handle epsilon-based step alignment
          // to avoid leaving "dust" residuals (e.g. 0.1 XRP) on the exchange.
          const filteredExit = this.applyFilters(symbol, refPrice, trade.qty, {
            skipNotionalCheck: true,
            cachedFilters: filters
          });

          if (filteredExit.qty <= 0 && trade.qty > 0) {
             this.logger.warn(`[${symbol}] [Sync] Filtered close quantity is 0 for position ${trade.qty}. Handling as local-only dust sync.`);
             localOnly = true;
          }

          if (!localOnly) {
          // HARDENING: Idempotent Closure Loop. Handles network timeouts and Duplicate clientOrderId
          // by querying exchange state to verify if the close order was accepted.
          // BINANCE BEST PRACTICE: Place close order FIRST (consumes reduce-only capacity),
          // THEN cancel SL. Reversing this causes REDUCE_ONLY rejection when ghost SL exists.
          let orderData: any = null;
          let closeAttempts = 0;
          const MAX_INTERNAL_CLOSE_ATTEMPTS = 3;

          while (closeAttempts < MAX_INTERNAL_CLOSE_ATTEMPTS) {
            closeAttempts++;
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
              orderData = (await response.data()) as BinanceOrderReceipt;

              if (orderData && orderData.code && orderData.code !== 0) {
                const code = orderData.code;
                const msg = orderData.msg || '';

                if (code === -2011 || msg.includes('Duplicate orderSent') || msg.includes('Duplicate clientOrderId') || msg.includes('Duplicate order')) {
                  this.logger.log(`[${symbol}] [Sync] Detected duplicate clientOrderId on close retry. Recovering close state...`);
                  const queryRes = await this.binanceClient.restAPI.queryOrder({ symbol, origClientOrderId: clientOrderId });
                  this.updateWeight(queryRes?.headers);
                  orderData = (await queryRes.data()) as BinanceOrderReceipt;
                  if (orderData && orderData.orderId) {
                    this.logger.log(`[${symbol}] [Sync] Successfully recovered existing close order: ${orderData.orderId} (Status: ${orderData.status})`);
                    closeSuccess = true;
                    break;
                  }
                }

                if (msg.includes('ReduceOnly') || msg.includes('conflict') || msg.includes('-2022') || msg.includes('side does not match')) {
                   if (closeAttempts < MAX_INTERNAL_CLOSE_ATTEMPTS) {
                      this.logger.warn(`[${symbol}] MARKET close conflicted (ReduceOnly). Executing exhaustive symbol flush and retrying (Attempt ${closeAttempts})...`);
                      await this.exhaustiveSymbolFlush(symbol);
                      continue;
                   } else {
                      this.logger.warn(`[${symbol}] MARKET close conflicted (ReduceOnly) on final attempt ${closeAttempts}. Propagating to outer Sync Recovery.`);
                   }
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

              if (isNetworkError && closeAttempts < MAX_INTERNAL_CLOSE_ATTEMPTS) {
                this.logger.warn(`[${symbol}] Network error during close. Retrying (Attempt ${closeAttempts + 1})...`);
                await new Promise(resolve => setTimeout(resolve, 1000 * closeAttempts));
                continue;
              }

              // Handle Duplicate ID via exception (some SDK variants throw instead of returning code)
              if (errMsg.includes('Duplicate orderSent') || errMsg.includes('Duplicate clientOrderId')) {
                this.logger.log(`[${symbol}] [Sync] Duplicate ID exception on close. Recovering...`);
                const queryRes = await this.binanceClient.restAPI.queryOrder({ symbol, origClientOrderId: clientOrderId });
                this.updateWeight(queryRes?.headers);
                orderData = (await queryRes.data()) as BinanceOrderReceipt;
                if (orderData && orderData.orderId) {
                  closeSuccess = true;
                  break;
                }
              }

              if (errMsg.includes('ReduceOnly') || errMsg.includes('-2022') || errMsg.includes('side does not match')) {
                 if (closeAttempts < MAX_INTERNAL_CLOSE_ATTEMPTS) {
                    this.logger.warn(`[${symbol}] MARKET close exception (ReduceOnly). Executing exhaustive symbol flush and retrying (Attempt ${closeAttempts})...`);
                    await this.exhaustiveSymbolFlush(symbol);
                    continue;
                 } else {
                    this.logger.warn(`[${symbol}] MARKET close exception (ReduceOnly) on final attempt ${closeAttempts}. Propagating to outer Sync Recovery.`);
                 }
              }

              throw err;
            }
          }

          // AFTER successful close order placement (or duplicate recovery), cancel SL
          if (closeSuccess && trade.binance_stop_order_id) {
             this.logger.debug(`[${symbol}] [Sync] Close order placed successfully. Now cancelling SL ${trade.binance_stop_order_id} to clear reduce-only capacity.`);
             await this.cancelBinanceOrder(symbol, trade.binance_stop_order_id, trade.binance_stop_order_type || 'standard');
             trade.binance_stop_order_id = undefined;
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
                  const queryData = (await queryRes.data()) as BinanceOrderReceipt;
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
                // CHRONOS: Subtract commission from pnl
                trade.pnl = roundEight((Number(trade.pnl) || 0) - exitFeeFromFills);
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
              // CHRONOS: Subtract estimated fee from pnl
              trade.pnl = roundEight((Number(trade.pnl) || 0) - exitFee);
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
          } // end if (!localOnly)
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
                    const data = (await response.data()) as BinancePositionV3[];
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

                  // Forcing liquidation when there's no position on the exchange should be treated as a successful closure
                  // without re-sending any stop-loss orders to the exchange.
                  closeSuccess = true;

                  const context = await this.recoverClosingContext(symbol, trade, exitPrice, stopOrderId);
                  exitPrice = context.price;

                  if (context.reason && this.shouldUpgradeExitReason(exitReason, context.reason)) {
                    exitReason = context.reason;
                  } else if (!context.reason) {
                    exitReason = trade.exit_reason === EXIT_REASONS.EXCHANGE_SYNC ? EXIT_REASONS.EXCHANGE_SYNC_RECOVERY : EXIT_REASONS.EXCHANGE_SL_OR_MANUAL;
                  }

                  if (!options.feesAlreadyAccounted) {
                    const feeRate = this.takerFeeRate || 0.0004;
                    let exitFee = exitPrice * trade.qty * feeRate;
                    if (isNaN(exitFee)) exitFee = 0;
                    trade.realized_fee = roundEight((Number(trade.realized_fee) || 0) + exitFee);
                    // CHRONOS: Subtract estimated fee from pnl
                    trade.pnl = roundEight((Number(trade.pnl) || 0) - exitFee);
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

                  // ROLLBACK: Re-place SL if it was cancelled, close failed, and we are not blocked/exhausted
                  const isExhausted = (trade.close_attempts || 0) >= MAX_CLOSE_ATTEMPTS;
                  const willBeBlocked = trade.close_blocked || isExhausted;
                  if (!trade.binance_stop_order_id && !willBeBlocked) {
                     this.logger.warn(`[${symbol}] Close failed but position persists. Re-arming protection SL...`);
                     await this.placeStopLoss(trade, trade.current_sl);
                  }

                  if (trade.close_attempts && trade.close_attempts >= MAX_CLOSE_ATTEMPTS) {
                    trade.close_blocked = true;
            const blockMsg = `CRITICAL: ${symbol} close attempt ceiling reached (REDUCE_ONLY). Automated closes are now BLOCKED. To unblock, please manual close or sync on Binance. [${errCode}] ${errMsg}`;
                    this.logger.error(blockMsg);
                    this.eventEmitter.emit(ENGINE_EVENTS.LOG_MESSAGE, { msg: blockMsg, level: 'error' });
                    this.eventEmitter.emit(ENGINE_EVENTS.ALERT, { level: 'error', title: 'Close Blocked', message: blockMsg });
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

               // SRE: Distinct state for illiquid positions
               trade.illiquid_blocked = true;
               this.eventEmitter.emit(ENGINE_EVENTS.ALERT, { level: 'error', title: 'Illiquid Blocked', message: `${symbol}: Position is illiquid (price outside Binance protection bands). Manual intervention on Binance is required to close.` });

               // CHRONOS: Route into the shared aggressive LIMIT fallback. This enforces the
               // attempt ceiling internally (escalating to close_blocked when exhausted) and is
               // the same code path used by the illiquid_blocked shortcut at the top of closeTrade.
               await this.attemptAggressiveLimitClose(symbol, trade, exitPrice);

               this.eventEmitter.emit(ENGINE_EVENTS.TRADE_UPDATED, { trade });
               throw err;
          } else {
               this.logger.warn(`Binance close order failed for ${symbol}. Code: ${errCode}. Error: ${errMsg}`);

               if (trade.close_attempts && trade.close_attempts >= MAX_CLOSE_ATTEMPTS) {
                 trade.close_blocked = true;
                 const blockMsg = `CRITICAL: ${symbol} close attempt ceiling reached. Automated closes are now BLOCKED. [${errCode}] ${errMsg}`;
                 this.logger.error(blockMsg);
                 this.eventEmitter.emit(ENGINE_EVENTS.LOG_MESSAGE, { msg: blockMsg, level: 'error' });
                 this.eventEmitter.emit(ENGINE_EVENTS.ALERT, { level: 'error', title: 'Close Blocked', message: blockMsg });
               }

               this.eventEmitter.emit(ENGINE_EVENTS.TRADE_UPDATED, { trade });
               throw err;
          }
        } finally {
          // SRE: Atomicity Guard. If the close sequence was initiated but did not result
          // in a confirmed success, ensure the position remains protected by re-arming
          // the SL. Only re-arm if we are not blocked (e.g. close attempts exhausted).
          if (!closeSuccess && !localOnly && trade.status === 'OPEN' && !this.paperMode && !trade.close_blocked) {
             this.logger.warn(`[${symbol}] Close sequence finished without success. Re-arming protection SL...`);
             if (trade.binance_stop_order_id) {
                try {
                   this.logger.log(`[${symbol}] Proactively cancelling old SL ${trade.binance_stop_order_id} before re-arming...`);
                   await this.cancelBinanceOrder(symbol, trade.binance_stop_order_id, trade.binance_stop_order_type || 'standard');
                } catch (cancelErr) {
                   this.logger.debug(`[${symbol}] Failed to cancel old SL during re-arm: ${cancelErr instanceof Error ? cancelErr.message : String(cancelErr)}`);
                }
                trade.binance_stop_order_id = undefined;
             }
             await this.placeStopLoss(trade, trade.current_sl);
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

      if (!paperMode) {
         // pnl_pct: Recover original quantity from risk_usdt to ensure accuracy even if terminal qty is 0 or reduced.
         // We do this BEFORE potentially updating pnl but after we have everything needed.
         const riskDist = Math.abs(trade.entry_price - trade.initial_sl);
         const initialQty = (riskDist > 0 && trade.initial_risk_usdt) ? (trade.initial_risk_usdt / riskDist) : (trade.qty || 1);

         const totalPnlPoints = trade.direction === 'LONG'
           ? exitPrice - trade.entry_price
           : trade.entry_price - exitPrice;

         const totalGrossPnl = totalPnlPoints * initialQty;
         const absoluteNetPnl = roundEight(totalGrossPnl - (trade.realized_fee || 0) - (trade.funding_fee || 0));

         const isAnySlHit = exitReason === `${EXIT_REASONS.SL_HIT}` ||
                            (exitReason && exitReason.startsWith(EXIT_REASONS.SL_HIT)) ||
                            exitReason === EXIT_REASONS.EXCHANGE_SL_OR_MANUAL ||
                            exitReason === EXIT_REASONS.EXCHANGE_SYNC_RECOVERY;

         if ((options.alreadyRealized || options.feesAlreadyAccounted) && !isAnySlHit) {
            const divergence = Math.abs((trade.pnl || 0) - absoluteNetPnl);
            if (divergence > 0.01) {
               this.logger.warn(`[PnL Divergence Alert] Trade ${trade.id} (${symbol}): Accumulated PnL (${trade.pnl}) and Absolute Recomputed PnL (${absoluteNetPnl}) diverge by ${divergence.toFixed(4)}. Force-correcting trade PnL to Absolute Recomputed PnL to prevent state-bleeding or double-count. Qty=${initialQty}, Entry=${trade.entry_price}, Exit=${exitPrice}, Fees=${trade.realized_fee}, Funding=${trade.funding_fee}`);
               trade.pnl = absoluteNetPnl;
            } else {
               this.logger.debug(`[PnL Integrity] Using authoritative accumulated PnL for ${symbol}: ${trade.pnl} (Absolute PnL=${absoluteNetPnl}, Divergence=${divergence})`);
            }
         } else {
            // CHRONOS: Absolute PnL Calculation for Live mode.
            // When alreadyRealized is false, it means we are performing a terminal closure
            // (e.g. from Watchdog or external sync) where we have an authoritative average exit price.
            // To ensure integrity across missed UDS slices, we calculate absolute gross profit
            // from entry to exit on the total position size, then subtract all realized costs.
            this.logger.log(`[PnL Integrity] Finalizing Live trade ${symbol} via Absolute PnL path: AbsoluteGross=${totalGrossPnl.toFixed(4)}, Fees=${trade.realized_fee}, Funding=${trade.funding_fee}, FinalNet=${absoluteNetPnl} (Qty=${initialQty}, Exit=${exitPrice}, Reason=${exitReason})`);
            trade.pnl = absoluteNetPnl;
         }

         // CHRONOS: Restore trade.qty to the total order size (recovered initialQty) for history accuracy.
         // This must happen AFTER Incremental PnL calculation to avoid double-counting.
         trade.qty = initialQty;

         const notional = trade.entry_price * initialQty;

         const finalPnlPct = (notional !== 0) ? (trade.pnl / notional) * 100 : 0;
         trade.pnl_pct = roundEight(Number.isFinite(finalPnlPct) ? finalPnlPct : 0);
      } else {
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

         this.logger.log(`[PnL Calculation] ${symbol} (Paper): ${trade.direction} Exit=${exitPrice}, Entry=${trade.entry_price}, Qty=${trade.qty}, Gross=${Number(finalGrossPnl || 0).toFixed(4)}, Fee=${Number(trade.realized_fee || 0).toFixed(4)}, Net=${Number(finalNetPnl || 0).toFixed(4)}`);

         trade.pnl = roundEight(Number.isFinite(finalNetPnl) ? finalNetPnl : 0);
      }

      trade.exit_reason = exitReason;

      // Ensure exit signal type and reason are passed through to persistence
      // SRE: Re-evaluate type based on potentially updated exitReason
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
      else trade.exit_signal_type = trade.exit_signal_type || 'SIGNAL';

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

      // Calculate final exit RR
      const initialRisk = Math.abs(trade.entry_price - trade.initial_sl);
      trade.exit_rr = initialRisk > 0 ? (trade.direction === 'LONG' ? (exitPrice - trade.entry_price) : (trade.entry_price - exitPrice)) / initialRisk : 0;

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
