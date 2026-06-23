import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { Trade } from '../models/Trade';
import { SessionConfig } from '../models/SessionConfig';
import { PositionTrackerService } from './positionTracker';
import { OrderManagerService } from './orderManager';
import { TickerCacheService } from './ticker_cache.service';
import { ENGINE_EVENTS } from './events';
import { roundEight } from '../lib/math';

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

      // BOLT: Coordinated Snapshot Pattern for positions (Weight 5)
      const allPositions = await this.orderManager.fetchAllPositions();
      const activePositionsMap = new Map(allPositions.filter(p => Math.abs(parseFloat(p.positionAmt)) > 0).map(p => [p.symbol, p]));

      // WebSocket-First state reconciliation: Use UDS cache for active positions to avoid frequent bulk REST calls
      for (const [symbol, pos] of activePositionsMap.entries()) {
         this.orderManager.seedRealTimePosition(symbol, parseFloat(pos.positionAmt), parseFloat(pos.entryPrice));
      }

      const isSlOrder = (o: any) => {
        const isStandardSl = (o.type === 'STOP_MARKET' || o.type === 'STOP')
          && (o.closePosition === true || o.closePosition === 'true' || o.reduceOnly === true || o.reduceOnly === 'true');
        const isConditionalAlgoSl = !!o.algoId && (o.algoType === 'CONDITIONAL' || o.type === 'STOP_MARKET');
        return isStandardSl || isConditionalAlgoSl;
      };

      // SRE: Use Coordinated Snapshot Pattern for audits.
      // ALWAYS perform bulk fetch if auditing multiple trades to eliminate per-symbol REST bursts.
      let slOrdersBySymbol = new Map<string, any[]>();

      if (tradesToAudit.length > 1 && !targetSymbol) {
         this.logger.log(`[Watchdog] Performing bulk open order audit for ${tradesToAudit.length} trades...`);
         const allOrders = await this.orderManager.fetchAllOpenOrders();
         allOrders.filter(isSlOrder).forEach(o => {
           const list = slOrdersBySymbol.get(o.symbol) || [];
           list.push(o);
           slOrdersBySymbol.set(o.symbol, list);
         });
      } else {
         const uniqueSymbols = Array.from(new Set(tradesToAudit.map(t => t.symbol)));
         for (const symbol of uniqueSymbols) {
            const orders = await this.orderManager.fetchOpenOrders(symbol);
            slOrdersBySymbol.set(symbol, orders.filter(isSlOrder));
         }
      }

      for (const trade of tradesToAudit) {
        try {
          if (this.orderManager.isRatcheting(trade.symbol) || this.positionTracker.isEntering(trade.symbol) || this.positionTracker.isClosing(trade.symbol)) {
             continue;
          }

          if (trade.close_blocked) continue;

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
              this.eventEmitter.emit('trade.exchange_close', { symbol: trade.symbol, exitPrice: 0, reason: 'EXCHANGE_SYNC' });
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
            const freshOrders = await this.orderManager.fetchOpenOrders(trade.symbol);
            const freshSlOrders = freshOrders.filter(isSlOrder);
            matchingOrder = freshSlOrders.find(o =>
              String(o.orderId) === trade.binance_stop_order_id ||
              String(o.algoId) === trade.binance_stop_order_id ||
              o.clientOrderId === `sl-${(trade.id || '').substring(0, 8)}`
            );

            if (!matchingOrder && freshSlOrders.length > 0) {
              const validSl = freshSlOrders.find(o => Math.abs(parseFloat(o.origQty || o.quantity) - trade.qty) < 0.00000001);
              if (validSl) {
                trade.binance_stop_order_id = String(validSl.algoId || validSl.orderId);
                trade.binance_stop_order_type = validSl.algoType ? 'algo' : 'standard';
                const exSlPrice = parseFloat(validSl.stopPrice || validSl.triggerPrice);
                if (exSlPrice > 0 && Math.abs(exSlPrice - trade.current_sl) > 0.00000001) trade.current_sl = exSlPrice;
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
              this.eventEmitter.emit('trade.exchange_close', { symbol: trade.symbol, exitPrice: 0, reason: 'WATCHDOG_NUCLEAR_CLOSE' });
              continue;
            }
            this.logger.warn(`[Watchdog] CRITICAL: ${trade.symbol} missing SL. Re-placing...`);
            await this.orderManager.placeStopLoss(trade, trade.current_sl);
            trade.updated_at = new Date();
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
      this.reactiveAuditTimeouts.delete(symbol);
      if (this.orderManager.isRatcheting(symbol) || this.positionTracker.isEntering(symbol) || this.positionTracker.isClosing(symbol)) {
        return;
      }
      this.eventEmitter.emit('watchdog.request_symbol_audit', { symbol });
    }, 15000);

    this.reactiveAuditTimeouts.set(symbol, timeout);
  }
}
