import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { Trade } from '../models/Trade';
import { SessionConfig } from '../models/SessionConfig';
import { PositionTrackerService } from './positionTracker';
import { OrderManagerService } from './orderManager';
import { TickerCacheService } from './ticker_cache.service';
import { ENGINE_EVENTS } from './events';
import { roundEight } from '../lib/math';
import { EXIT_REASONS } from '../models/constants';

@Injectable()
export class MaintenanceService {
  private readonly logger = new Logger(MaintenanceService.name);
  private isProcessingWatchdog = false;
  private reactiveAuditTimeouts: Map<string, NodeJS.Timeout> = new Map();

  constructor(
    private readonly positionTracker: PositionTrackerService,
    private readonly orderManager: OrderManagerService,
    private readonly tickerCache: TickerCacheService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /**
   * PROTECTION WATCHDOG: Periodically verifies that all active Live positions
   * have a corresponding SL order on Binance. If missing, it re-places it.
   */
  async protectionWatchdog(running: boolean, config: SessionConfig | null, targetSymbol?: string) {
    if (!running || !config || config.paper_mode) return;

    if (!targetSymbol && this.isProcessingWatchdog) return;
    if (!targetSymbol) this.isProcessingWatchdog = true;

    try {
      const activeTrades = this.positionTracker.activeList();
      if (activeTrades.length === 0) return;

      const tradesToAudit = activeTrades.filter(trade => {
        if (!trade.binance_order_id) return false;
        if (targetSymbol && trade.symbol === targetSymbol) return true;

        const lastUpdateTs = trade.updated_at ? new Date(trade.updated_at).getTime() : 0;
        const secondsSinceUpdate = (Date.now() - lastUpdateTs) / 1000;
        return secondsSinceUpdate >= 45;
      });

      if (tradesToAudit.length === 0) return;

      this.logger.debug(`[Watchdog] Audit weights: used=${this.orderManager.getBinanceRateLimit().used_weight_1m}/${this.orderManager.getBinanceRateLimit().limit}`);

      if (this.orderManager.getBinanceRateLimit().used_weight_1m > this.orderManager.getBinanceRateLimit().limit * 0.85) {
        this.logger.warn(`[Watchdog] High API weight detected. Skipping batch audit to preserve IP status.`);
        return;
      }

      // SRE: Optimized Audit Pattern. For small sets of trades (<= 5), use targeted per-symbol calls
      // to minimize weight (7 weight per symbol). Revert to bulk for larger sets (45+ weight).
      const useBulkAudit = tradesToAudit.length > 5 && !targetSymbol;
      let activePositionsMap = new Map<string, any>();
      let slOrdersBySymbol = new Map<string, any[]>();

      const isSlOrder = (o: any) => {
        const isStandardSl = (o.type === 'STOP_MARKET' || o.type === 'STOP')
          && (o.closePosition === true || o.closePosition === 'true' || o.reduceOnly === true || o.reduceOnly === 'true');
        const isConditionalAlgoSl = !!o.algoId && (o.algoType === 'CONDITIONAL' || o.type === 'STOP_MARKET');
        return isStandardSl || isConditionalAlgoSl;
      };

      const uniqueSymbols = Array.from(new Set(tradesToAudit.map(t => t.symbol)));

      if (useBulkAudit) {
        this.logger.log(`[Watchdog] Performing bulk audit for ${tradesToAudit.length} trades...`);
        // BOLT: Coordinated Snapshot Pattern for positions (Weight 5)
        const allPositions = await this.orderManager.fetchAllPositions();
        allPositions.filter(p => Math.abs(parseFloat(p.positionAmt)) > 0).forEach(p => activePositionsMap.set(p.symbol, p));

        // SRE Overwatch: Mandatory stagger delay between heavy bulk calls to flatten the weight profile
        this.logger.debug(`[Watchdog] Staggering bulk order audit (2s cooldown)...`);
        await new Promise(resolve => setTimeout(resolve, 2000));

        const allOrders = await this.orderManager.fetchAllOpenOrders();
        allOrders.filter(isSlOrder).forEach(o => {
          const list = slOrdersBySymbol.get(o.symbol) || [];
          list.push(o);
          slOrdersBySymbol.set(o.symbol, list);
        });
      } else {
        this.logger.log(`[Watchdog] Performing targeted audit for ${uniqueSymbols.length} symbols...`);
        for (const symbol of uniqueSymbols) {
           // Zero-Weight Path: Try cache first
           const pos = await this.orderManager.fetchPosition(symbol, { forceFresh: false });
           if (pos && Math.abs(parseFloat(pos.positionAmt)) > 0) {
             activePositionsMap.set(symbol, pos);
           }

           const orders = await this.orderManager.fetchOpenOrders(symbol, { forceFresh: false });
           slOrdersBySymbol.set(symbol, orders.filter(isSlOrder));
        }
      }

      // WebSocket-First state reconciliation: Use UDS cache for active positions to avoid frequent bulk REST calls
      for (const [symbol, pos] of activePositionsMap.entries()) {
         this.orderManager.seedRealTimePosition(symbol, parseFloat(pos.positionAmt), parseFloat(pos.entryPrice));
      }

      for (const trade of tradesToAudit) {
        try {
          if (this.orderManager.isRatcheting(trade.symbol) || this.positionTracker.isEntering(trade.symbol) || this.positionTracker.isClosing(trade.symbol)) {
             continue;
          }

          if (trade.close_blocked) continue;

          // Merge trade-specific config for accurate reconciliation
          const tradeConfig = { ...config, ...(trade.strategy_config || {}) } as SessionConfig;

          let pos = activePositionsMap.get(trade.symbol);

          if (!pos) {
            const cachedPos = await this.orderManager.fetchPosition(trade.symbol, { forceFresh: false });
            if (cachedPos && Math.abs(parseFloat(cachedPos.positionAmt)) > 0) {
               pos = cachedPos;
            } else {
               const freshPos = await this.orderManager.fetchPosition(trade.symbol, { forceFresh: true });
               if (freshPos && Math.abs(parseFloat(freshPos.positionAmt)) > 0) {
                  pos = freshPos;
               }
            }
          }

          if (!pos || Math.abs(parseFloat(pos.positionAmt)) === 0) {
              this.logger.error(`[Watchdog] CRITICAL: ${trade.symbol} is active locally but NO position found on Binance. Triggering Sync Closure.`);
              this.eventEmitter.emit('trade.exchange_close', { symbol: trade.symbol, exitPrice: 0, reason: EXIT_REASONS.EXCHANGE_SYNC });
              continue;
          }

          const exAmt = Math.abs(parseFloat(pos.positionAmt));
          if (Math.abs(exAmt - trade.qty) > 0.00000001) {
            this.logger.warn(`[Watchdog] ${trade.symbol} quantity mismatch: Local ${trade.qty} vs Exchange ${exAmt}. Syncing local state.`);
            trade.qty = exAmt;
            const risk = Math.abs(trade.entry_price - trade.current_sl);
            trade.risk_usdt = roundEight(risk * trade.qty);
            trade.updated_at = new Date();
            this.positionTracker.recalculateTotalRisk();
            this.eventEmitter.emit(ENGINE_EVENTS.TRADE_UPDATED, { trade });
          }

          const slOrders = slOrdersBySymbol.get(trade.symbol) || [];
          let matchingOrder = slOrders.find(o =>
            String(o.orderId) === trade.binance_stop_order_id ||
            String(o.algoId) === trade.binance_stop_order_id ||
            o.clientOrderId === `sl-${(trade.id || '').substring(0, 8)}`
          );

          if (!matchingOrder) {
            const freshOrders = await this.orderManager.fetchOpenOrders(trade.symbol, { forceFresh: true });
            const freshSlOrders = freshOrders.filter(isSlOrder);
            matchingOrder = freshSlOrders.find(o =>
              String(o.orderId) === trade.binance_stop_order_id ||
              String(o.algoId) === trade.binance_stop_order_id ||
              o.clientOrderId === `sl-${(trade.id || '').substring(0, 8)}`
            );

            if (!matchingOrder && freshSlOrders.length > 0) {
              const validSl = freshSlOrders.find(o => Math.abs(parseFloat(o.origQty || o.quantity) - trade.qty) < 0.00000001);
              if (validSl) {
                this.logger.log(`[Watchdog] ${trade.symbol} adopting untracked exchange SL: ${validSl.algoId || validSl.orderId}`);
                trade.binance_stop_order_id = String(validSl.algoId || validSl.orderId);
                trade.binance_stop_order_type = validSl.algoType ? 'algo' : 'standard';
                const exSlPrice = parseFloat(validSl.stopPrice || validSl.triggerPrice);

                if (exSlPrice > 0 && Math.abs(exSlPrice - trade.current_sl) > 0.00000001) {
                  this.logger.log(`[Watchdog] ${trade.symbol} syncing SL price from exchange: ${trade.current_sl} -> ${exSlPrice}`);
                  trade.current_sl = exSlPrice;

                  const risk = Math.abs(trade.entry_price - trade.current_sl);
                  trade.risk_usdt = roundEight(risk * trade.qty);

                  // SRE: Reconcile rr_sequence_index based on adopted SL price
                  this.positionTracker.reconcileMilestoneFromSl(trade, exSlPrice, tradeConfig);

                  // Re-seed to ensure all internal maps and risk totals are in sync
                  this.positionTracker.addTrade(trade);
                }

                trade.updated_at = new Date();
                matchingOrder = validSl;
                this.eventEmitter.emit(ENGINE_EVENTS.TRADE_UPDATED, { trade });
              }
            }
          }

          if (!matchingOrder) {
            const lastUpdate = trade.updated_at ? new Date(trade.updated_at).getTime() : 0;
            const secondsSinceUpdate = (Date.now() - lastUpdate) / 1000;
            if (secondsSinceUpdate > 120) {
              this.logger.error(`[Watchdog] NUCLEAR OPTION: ${trade.symbol} unprotected for ${secondsSinceUpdate.toFixed(0)}s. Market closing position.`);
              this.eventEmitter.emit('trade.exchange_close', { symbol: trade.symbol, exitPrice: 0, reason: EXIT_REASONS.WATCHDOG_NUCLEAR_CLOSE });
              continue;
            }
            this.logger.warn(`[Watchdog] CRITICAL: ${trade.symbol} missing SL. Re-placing...`);
            await this.orderManager.placeStopLoss(trade, trade.current_sl);
            trade.updated_at = new Date();
          } else {
            // SRE: Quantity Parity Audit. Ensure the exchange SL matches the real position quantity.
            // Skip check for 'Close Position' orders which are quantity-agnostic.
            const isClosePosition = matchingOrder.closePosition === true || matchingOrder.closePosition === 'true';

            if (!isClosePosition) {
              const orderQty = parseFloat(matchingOrder.origQty || matchingOrder.quantity || '0');
              if (Math.abs(orderQty - trade.qty) > 0.00000001) {
                this.logger.warn(`[Watchdog] ${trade.symbol} SL quantity mismatch: Order ${orderQty} vs Position ${trade.qty}. Triggering cancel-replace.`);

                const cancelSuccess = await this.orderManager.cancelBinanceOrder(
                  trade.symbol,
                  String(matchingOrder.orderId || matchingOrder.algoId),
                  matchingOrder.algoType ? 'algo' : 'standard'
                );

                if (cancelSuccess) {
                  await this.orderManager.placeStopLoss(trade, trade.current_sl);
                  trade.updated_at = new Date();
                  this.eventEmitter.emit(ENGINE_EVENTS.TRADE_UPDATED, { trade });
                }
              }
            }
          }
        } catch (innerErr) {
          this.logger.error(`[Watchdog] Error auditing ${trade.symbol}: ${innerErr instanceof Error ? innerErr.message : String(innerErr)}`);
        }
      }
    } catch (err) {
      this.logger.error(`[Watchdog] Audit failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      if (!targetSymbol) this.isProcessingWatchdog = false;
    }
  }

  @OnEvent('watchdog.reactive_audit')
  handleReactiveAudit(payload: { symbol: string }) {
    const symbol = payload.symbol;
    const existing = this.reactiveAuditTimeouts.get(symbol);
    if (existing) clearTimeout(existing);

    // RE-02: 15s Debounce window.
    // This allows SL Ratchet operations (Cancel-then-Replace) to finish
    // before the watchdog checks for protection.
    const timeout = setTimeout(async () => {
      try {
        this.reactiveAuditTimeouts.delete(symbol);
        if (this.orderManager.isRatcheting(symbol) || this.positionTracker.isEntering(symbol) || this.positionTracker.isClosing(symbol)) {
          return;
        }
        this.eventEmitter.emit('watchdog.request_symbol_audit', { symbol });
      } catch (err) {
        this.logger.error(`Reactive audit failed for ${symbol}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }, 15000);

    this.reactiveAuditTimeouts.set(symbol, timeout);
  }
}
