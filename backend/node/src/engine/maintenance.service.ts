import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Trade } from '../models/Trade';
import { SessionConfig } from '../models/SessionConfig';
import { PositionTrackerService } from './positionTracker';
import { OrderManagerService } from './orderManager';
import { TickerCacheService } from './ticker_cache.service';
import { ENGINE_EVENTS } from './events';
import { ENGINE_CONSTANTS } from '../models/constants';
import { roundEight } from '../lib/math';

@Injectable()
export class MaintenanceService {
  private readonly logger = new Logger(MaintenanceService.name);
  private isProcessingWatchdog = false;
  private isProcessingFunding = false;

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
  async protectionWatchdog(running: boolean, config: SessionConfig | null) {
    if (!running || !config || config.paper_mode || this.isProcessingWatchdog) return;
    this.isProcessingWatchdog = true;

    const activeTrades = this.positionTracker.activeList();
    if (activeTrades.length === 0) return;

    // Filter out trades that are still in cooldown
    const tradesToAudit = activeTrades.filter(trade => {
      if (!trade.binance_order_id) return false;
      const lastUpdateTs = trade.updated_at ? new Date(trade.updated_at).getTime() : 0;
      const secondsSinceUpdate = (Date.now() - lastUpdateTs) / 1000;
      return secondsSinceUpdate >= 45;
    });

    if (tradesToAudit.length === 0) {
      this.isProcessingWatchdog = false;
      return;
    }

    const uniqueSymbols = Array.from(new Set(tradesToAudit.map(t => t.symbol)));
    this.logger.log(`[Watchdog] Running protection audit for ${uniqueSymbols.length} unique symbols (Hybrid Strategy)...`);

    try {
      const allPositions = await this.orderManager.fetchAllPositions();
      const activePositionsMap = new Map(allPositions.filter(p => Math.abs(parseFloat(p.positionAmt)) > 0).map(p => [p.symbol, p]));

      let slOrdersBySymbol = new Map<string, any[]>();

      const isSlOrder = (o: any) => (o.type === 'STOP_MARKET' || o.type === 'STOP') && (o.closePosition === true || o.closePosition === 'true' || o.reduceOnly === true || o.reduceOnly === 'true');

      if (uniqueSymbols.length > 40) {
        const allOrders = await this.orderManager.fetchAllOpenOrders();
        allOrders.filter(isSlOrder).forEach(o => {
          const list = slOrdersBySymbol.get(o.symbol) || [];
          list.push(o);
          slOrdersBySymbol.set(o.symbol, list);
        });
      } else {
        for (const symbol of uniqueSymbols) {
           const orders = await this.orderManager.fetchOpenOrders(symbol);
           slOrdersBySymbol.set(symbol, orders.filter(isSlOrder));
        }
      }

      for (const trade of tradesToAudit) {
        try {
          // Cooldown check moved up to batch filter for efficiency
          const lastUpdateTs = trade.updated_at ? new Date(trade.updated_at).getTime() : 0;
          const secondsSinceUpdate = (Date.now() - lastUpdateTs) / 1000;

          // Audit Item 13: Skip symbols undergoing ratchet updates to avoid desync race
          if (this.orderManager.isRatcheting(trade.symbol)) {
             this.logger.debug(`[Watchdog] Skipping audit for ${trade.symbol}: Ratchet update in progress.`);
             continue;
          }

          const pos = activePositionsMap.get(trade.symbol);

          if (!pos) {
            // BOLT: Handle orphaned local positions. If bot thinks it's open but exchange says 0.
            this.logger.error(`[Watchdog] CRITICAL: ${trade.symbol} is active locally but NO position found on Binance. Triggering Sync Closure.`);
            this.eventEmitter.emit(ENGINE_EVENTS.LOG_MESSAGE, { msg: `[Watchdog] Ghost position detected for ${trade.symbol}. Force-syncing to closed.`, level: 'error' });

            // Trigger a local sync-only closure to stop the engine from trying to manage this non-existent trade.
            // We use EXCHANGE_SYNC so it doesn't try to send more orders.
            await this.orderManager.closeTrade(trade.symbol, trade, 0, 'EXCHANGE_SYNC', false, true);
            continue;
          }

          const slOrders = slOrdersBySymbol.get(trade.symbol) || [];
          const hasProtection = slOrders.some(o => String(o.orderId) === trade.binance_stop_order_id || o.clientOrderId === `sl-${(trade.id || '').substring(0, 8)}`);

          if (!hasProtection) {
            // STRATEGY B: NUCLEAR OPTION
            // If the unprotected position is older than 2 minutes, the situation is critical.
            // Market close the position to protect capital.
            if (secondsSinceUpdate > 120) {
              const nuclearMsg = `[Watchdog] NUCLEAR OPTION: ${trade.symbol} unprotected for >2 minutes. Market closing position for capital safety.`;
              this.logger.error(nuclearMsg);
              this.eventEmitter.emit(ENGINE_EVENTS.LOG_MESSAGE, { msg: nuclearMsg, level: 'error' });

              await this.orderManager.closeTrade(trade.symbol, trade, 0, 'WATCHDOG_NUCLEAR_CLOSE', false, false);
              continue;
            }

            this.logger.warn(`[Watchdog] CRITICAL: ${trade.symbol} position found without expected SL order on Binance. (Expected: ${trade.binance_stop_order_id}). Found: ${slOrders.length}. Re-placing...`);

            // SECURITY: If we found orders that DON'T match our expected ID, they are likely orphans from a race condition.
            // We should cancel them before placing a new authoritative one.
            // AUDIT-FIRST: We cancel ALL found orders to ensure we have a clean slate.
            for (const orphan of slOrders) {
               this.logger.log(`[Watchdog] Canceling potential orphan SL ${orphan.orderId} for ${trade.symbol} before re-protection.`);
               await this.orderManager.cancelBinanceOrder(trade.symbol, String(orphan.orderId), orphan.algoType ? 'algo' : 'standard');
            }

            this.eventEmitter.emit(ENGINE_EVENTS.LOG_MESSAGE, { msg: `[Watchdog] Missing SL detected for ${trade.symbol}. Recovering protection...`, level: 'warn' });
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
      this.isProcessingWatchdog = false;
    }
  }

  async checkFundingFees(running: boolean, config: SessionConfig | null) {
    if (!running || !config || this.isProcessingFunding) return;
    const now = new Date();
    const isFundingTime = now.getUTCHours() % ENGINE_CONSTANTS.FUNDING_INTERVAL_HOURS === 0 && now.getUTCMinutes() === 0;

    if (isFundingTime) {
      this.isProcessingFunding = true;
      try {
        const activeTrades = this.positionTracker.activeList();
        for (const trade of activeTrades) {
          try {
            const isLong = trade.direction === 'LONG';
            const notional = (trade.mark_price || trade.last_price || trade.entry_price) * trade.qty;
            const fundingDelta = roundEight(notional * ENGINE_CONSTANTS.SIMULATED_FUNDING_RATE * (isLong ? 1 : -1));

            trade.funding_fee = roundEight((trade.funding_fee || 0) + fundingDelta);
            trade.pnl = roundEight(trade.pnl - fundingDelta);
            trade._last_funding_delta = fundingDelta;

            // Emit event to update balance in TradingSessionService
            this.eventEmitter.emit(ENGINE_EVENTS.FUNDING_APPLIED, { trade, fundingDelta });

            this.logger.log(`[Funding] Applied ${fundingDelta} estimated funding fee to ${trade.symbol} (${config.paper_mode ? 'Paper' : 'Live'})`);
          } catch (innerErr) {
            this.logger.error(`[Funding] Failed to apply fee for ${trade.symbol}: ${innerErr instanceof Error ? innerErr.message : String(innerErr)}`);
          }
        }
      } catch (err) {
        this.logger.error(`[Funding] Batch application failed: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        this.isProcessingFunding = false;
      }
    }
  }
}
