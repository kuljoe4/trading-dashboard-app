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
import { BinanceOrderReceipt, BinanceAlgoOrderReceipt, BinancePositionV3 } from '../models/binance.types';

@Injectable()
export class MaintenanceService {
  private readonly logger = new Logger(MaintenanceService.name);
  private isProcessingWatchdog = false;
  private isProcessingFullReconciliation = false;
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
  private getOrderId(o: BinanceOrderReceipt | BinanceAlgoOrderReceipt): string {
    return String((o as any).algoId || (o as any).orderId || '');
  }

  private getOrderQty(o: BinanceOrderReceipt | BinanceAlgoOrderReceipt): number {
    const qtyStr = (o as any).origQty || (o as any).quantity || '0';
    return parseFloat(String(qtyStr));
  }

  private getOrderExecutedQty(o: BinanceOrderReceipt | BinanceAlgoOrderReceipt): number {
    return parseFloat(String((o as any).executedQty || '0'));
  }

  private getOrderStopPrice(o: BinanceOrderReceipt | BinanceAlgoOrderReceipt): number {
    const priceStr = (o as any).stopPrice || (o as any).triggerPrice || '0';
    return parseFloat(String(priceStr));
  }

  private isAlgoType(o: BinanceOrderReceipt | BinanceAlgoOrderReceipt): boolean {
    return !!((o as any).algoId || (o as any).algoType);
  }

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
      let activePositionsMap = new Map<string, BinancePositionV3>();
      let slOrdersBySymbol = new Map<string, (BinanceOrderReceipt | BinanceAlgoOrderReceipt)[]>();

      const isSlOrder = (o: BinanceOrderReceipt | BinanceAlgoOrderReceipt) => {
        const type = ((o as any).type || (o as any).algoType || "").toUpperCase();
        const isStandardSl = (type === 'STOP_MARKET' || type === 'STOP')
          && ((o as any).closePosition === true || String((o as any).closePosition) === 'true' || (o as any).reduceOnly === true || String((o as any).reduceOnly) === 'true');
        const isConditionalAlgoSl = !!(o as any).algoId && ((o as any).algoType === 'CONDITIONAL' || type === 'STOP_MARKET');
        return isStandardSl || isConditionalAlgoSl;
      };

      const uniqueSymbols = Array.from(new Set(tradesToAudit.map(t => t.symbol)));
      const processedOrphans = new Set<string>();

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
              this.eventEmitter.emit('trade.exchange_close', { symbol: trade.symbol, exitPrice: 0, reason: EXIT_REASONS.EXCHANGE_SYNC, feesAlreadyAccounted: false });
              continue;
          }

          const exAmt = Math.abs(parseFloat(pos.positionAmt));
          if (Math.abs(exAmt - trade.qty) > 0.00000001) {
            this.logger.warn(`[Watchdog] ${trade.symbol} quantity mismatch: Local ${trade.qty} vs Exchange ${exAmt}. Syncing local state.`);
            trade.qty = exAmt;

            // SRE: Live Risk Mitigation during watchdog sync
            this.positionTracker.refreshTradeRisk(trade);

            trade.updated_at = new Date();
            this.positionTracker.recalculateTotalRisk();
            this.eventEmitter.emit(ENGINE_EVENTS.TRADE_UPDATED, { trade });
          }

          let slOrders = slOrdersBySymbol.get(trade.symbol) || [];
          let matchingOrder = slOrders.find(o =>
            this.getOrderId(o) === trade.binance_stop_order_id ||
            o.clientOrderId === `sl-${(trade.id || '').substring(0, 8)}`
          );

          if (!matchingOrder) {
            const freshOrders = await this.orderManager.fetchOpenOrders(trade.symbol, { forceFresh: true });
            slOrders = freshOrders.filter(isSlOrder);
            matchingOrder = slOrders.find(o =>
              this.getOrderId(o) === trade.binance_stop_order_id ||
              o.clientOrderId === `sl-${(trade.id || '').substring(0, 8)}`
            );

            if (!matchingOrder && slOrders.length > 0) {
              const validSl = slOrders.find(o => Math.abs(this.getOrderQty(o) - trade.qty) < 0.00000001);
              if (validSl) {
                const slId = this.getOrderId(validSl);
                this.logger.log(`[Watchdog] ${trade.symbol} adopting untracked exchange SL: ${slId}`);
                trade.binance_stop_order_id = slId;
                trade.binance_stop_order_type = this.isAlgoType(validSl) ? 'algo' : 'standard';
                const exSlPrice = this.getOrderStopPrice(validSl);

                if (exSlPrice > 0 && Math.abs(exSlPrice - trade.current_sl) > 0.00000001) {
                  this.logger.log(`[Watchdog] ${trade.symbol} syncing SL price from exchange: ${trade.current_sl} -> ${exSlPrice}`);
                  trade.current_sl = exSlPrice;

                  // SRE: Live Risk Mitigation during SL sync
                  this.positionTracker.refreshTradeRisk(trade);

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

          // SRE: Single-Truth SL Audit. Cancel any orphan SL orders to prevent ghost fills
          // and avoid Binance's 10-conditional-order limit (Error -2027).
          // We run this BEFORE the missing-SL check to ensure a clean slate if re-placement is needed.
          const orphans = slOrders.filter(o =>
             !matchingOrder || this.getOrderId(o) !== this.getOrderId(matchingOrder)
          );

          for (const orphan of orphans) {
             const orphanId = this.getOrderId(orphan);
             if (processedOrphans.has(orphanId)) continue;
             processedOrphans.add(orphanId);

             // SRE: Anti-Spam Guard. Use a local set during the watchdog pass to avoid
             // redundant cancel attempts if multiple local trades share the same orphan.
             this.logger.warn(`[Watchdog] ${trade.symbol} found orphan SL order ${orphanId}. Cancelling for state integrity.`);
             await this.orderManager.cancelBinanceOrder(
                trade.symbol,
                orphanId,
                this.isAlgoType(orphan) ? 'algo' : 'standard'
             );
          }

          if (!matchingOrder) {
            const lastUpdate = trade.updated_at ? new Date(trade.updated_at).getTime() : 0;
            const secondsSinceUpdate = (Date.now() - lastUpdate) / 1000;
            if (secondsSinceUpdate > 120) {
              this.logger.error(`[Watchdog] NUCLEAR OPTION: ${trade.symbol} unprotected for ${secondsSinceUpdate.toFixed(0)}s. Market closing position.`);
              this.eventEmitter.emit('trade.exchange_close', { symbol: trade.symbol, exitPrice: 0, reason: EXIT_REASONS.WATCHDOG_NUCLEAR_CLOSE, feesAlreadyAccounted: false });
              continue;
            }
            this.logger.warn(`[Watchdog] CRITICAL: ${trade.symbol} missing SL. Re-placing...`);
            await this.orderManager.placeStopLoss(trade, trade.current_sl);
            trade.updated_at = new Date();
          } else {
            // SRE: Quantity Parity Audit. Ensure the exchange SL matches the real position quantity.
            // Skip check for 'Close Position' orders which are quantity-agnostic.
            const isClosePosition = (matchingOrder as any).closePosition === true || String((matchingOrder as any).closePosition) === 'true';

            if (!isClosePosition) {
              // DATA-ACCURACY: Compare trade quantity with REMAINING exchange order quantity to support partial fills
              const orderQty = this.getOrderQty(matchingOrder);
              const executedQty = this.getOrderExecutedQty(matchingOrder);
              const remainingOrderQty = Math.max(0, orderQty - executedQty);

              if (Math.abs(remainingOrderQty - trade.qty) > 0.00000001) {
                this.logger.warn(`[Watchdog] ${trade.symbol} SL quantity mismatch: Order Remaining ${remainingOrderQty} vs Position ${trade.qty}. Triggering cancel-replace.`);

                const matchingId = this.getOrderId(matchingOrder);
                const cancelSuccess = await this.orderManager.cancelBinanceOrder(
                  trade.symbol,
                  matchingId,
                  this.isAlgoType(matchingOrder) ? 'algo' : 'standard'
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

  /**
   * SRE: Performs a full audit of local state against Binance exchange state.
   * This logic was extracted from SessionService to decouple the engine from the persistence layer.
   */
  async reconcileLiveState(running: boolean, config: SessionConfig | null) {
    if (!running || !config || config.paper_mode || this.isProcessingFullReconciliation) return;

    this.isProcessingFullReconciliation = true;
    try {
      this.logger.log(`[SRE] Periodic full state reconciliation started.`);

      const allExchangePositions = await this.orderManager.fetchAllPositions();
      const activeExPositions = allExchangePositions.filter(
        (p) => Math.abs(parseFloat(p.positionAmt)) > 0,
      );
      const activeExMap = new Map(activeExPositions.map((p) => [p.symbol, p]));

      // PERF: Fetch all open orders once for the entire reconciliation to save weight
      const allOpenOrders = await this.orderManager.fetchAllOpenOrders();

      const localOpenTrades = this.positionTracker.activeList();
      const localSymbols = new Set(localOpenTrades.map((t) => t.symbol));

      this.logger.debug(
        `[Reconciliation] Local symbols: [${Array.from(localSymbols).join(",")}], Exchange symbols: [${Array.from(activeExMap.keys()).join(",")}]`,
      );

      // 1. Audit Local Trades (Local -> Exchange)
      for (const trade of localOpenTrades) {
        // Skip reconciliation trades themselves to avoid loops, and only check truly OPEN trades
        if (trade.is_reconciliation || trade.status !== "OPEN") continue;

        const exPos = activeExMap.get(trade.symbol);
        if (!exPos) {
          const metadata = {
            id: trade.id,
            entryPrice: trade.entry_price,
            qty: trade.qty,
            entryTs: trade.entry_ts,
          };
          this.logger.error(
            `[Reconciliation] [CRITICAL] Local trade ${trade.symbol} not found on exchange. Triggering sync close. Meta: ${JSON.stringify(metadata)}`,
          );

          this.eventEmitter.emit("trade.exchange_close", {
            symbol: trade.symbol,
            exitPrice: 0,
            reason: EXIT_REASONS.EXCHANGE_SYNC,
            isReconciliation: true,
            feesAlreadyAccounted: false,
          });
        }
      }

      // 2. Audit Exchange Positions (Exchange -> Local)
      const ghostPositions = activeExPositions.filter(
        (p) => !localSymbols.has(p.symbol),
      );

      if (ghostPositions.length > 0) {
        this.logger.warn(
          `[Reconciliation] Found ${ghostPositions.length} untracked positions during periodic audit. Emitting adoption request...`,
        );

        // SRE: Instead of adopting directly (which requires DB access), we emit an event.
        // SessionService will handle the DB persistence and synthetic trade creation.
        this.eventEmitter.emit('reconciliation.adopt_positions', {
           positions: ghostPositions,
           orders: allOpenOrders
        });
      }

      this.logger.log(`[SRE] Periodic reconciliation complete. State verified.`);
    } catch (e) {
      this.logger.error(
        `[Reconciliation] Periodic logic failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    } finally {
      this.isProcessingFullReconciliation = false;
    }
  }
}
