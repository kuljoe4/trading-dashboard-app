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

          // Audit Item 13: Skip symbols undergoing lifecycle transitions to avoid desync race
          if (this.orderManager.isRatcheting(trade.symbol) || this.positionTracker.isEntering(trade.symbol) || this.positionTracker.isClosing(trade.symbol)) {
             this.logger.debug(`[Watchdog] Skipping audit for ${trade.symbol}: Ratchet or transition in progress.`);
             continue;
          }

          // SRE-01: Respect blocked closure status to avoid infinite requests/loops for positions with PERCENT_PRICE issues
          if (trade.close_blocked) {
            this.logger.debug(`[Watchdog] Skipping audit for ${trade.symbol}: Closure is explicitly blocked due to previous failures.`);
            continue;
          }

          let pos = activePositionsMap.get(trade.symbol);

          if (!pos) {
            // DOUBLE CHECK: Perform a fresh, non-cached position fetch before deciding it's a ghost.
            // This prevents race conditions with User Data Stream lag.
            this.logger.debug(`[Watchdog] Potential ghost for ${trade.symbol}. Performing fresh verification...`);
            const freshPos = await this.orderManager.fetchPosition(trade.symbol, { forceFresh: true });
            const freshAmt = freshPos ? Math.abs(parseFloat(freshPos.positionAmt)) : 0;

            if (freshAmt === 0) {
              // BOLT: Handle orphaned local positions. If bot thinks it's open but exchange says 0.
              const metadata = {
                id: trade.id,
                entryPrice: trade.entry_price,
                qty: trade.qty,
                duration: trade.entry_ts ? (Date.now() - new Date(trade.entry_ts).getTime()) / 1000 : 0
              };
              this.logger.error(`[Watchdog] CRITICAL: ${trade.symbol} is active locally but NO position found on Binance after fresh verification. Triggering Sync Closure. Meta: ${JSON.stringify(metadata)}`);
              this.eventEmitter.emit(ENGINE_EVENTS.LOG_MESSAGE, { msg: `[Watchdog] Ghost position detected for ${trade.symbol}. Force-syncing to closed.`, level: 'error' });

              // NEW: Emit event instead of direct call to ensure proper cleanup orchestration in TradingSessionService
              this.eventEmitter.emit('trade.exchange_close', {
                symbol: trade.symbol,
                exitPrice: 0,
                reason: 'EXCHANGE_SYNC'
              });
              continue;
            } else {
              this.logger.log(`[Watchdog] ${trade.symbol} ghost check recovered: Position ${freshAmt} found via fresh query. Metadata: ${JSON.stringify(freshPos)}`);
              pos = freshPos;
            }
          }

          // INTEL: Verify position quantity matches local record. Partial fills or manual changes can cause desync.
          const exAmt = Math.abs(parseFloat(pos.positionAmt));
          if (Math.abs(exAmt - trade.qty) > 0.00000001) {
            this.logger.warn(`[Watchdog] ${trade.symbol} quantity mismatch: Local ${trade.qty} vs Exchange ${exAmt}. Syncing local state.`);
            trade.qty = exAmt;
            // Update risk_usdt for accurate gating
            const risk = Math.abs(trade.entry_price - trade.current_sl);
            trade.risk_usdt = roundEight(risk * trade.qty);
            trade.updated_at = new Date();
            this.positionTracker.recalculateTotalRisk();
            // Notify of state change to ensure DB persistence
            this.eventEmitter.emit(ENGINE_EVENTS.TRADE_UPDATED, { trade });
          }

          const slOrders = slOrdersBySymbol.get(trade.symbol) || [];
          let matchingOrder = slOrders.find(o =>
            String(o.orderId) === trade.binance_stop_order_id ||
            String(o.algoId) === trade.binance_stop_order_id ||
            o.clientOrderId === `sl-${(trade.id || '').substring(0, 8)}`
          );

          if (!matchingOrder) {
            // DOUBLE CHECK: Perform a fresh query of open orders for this symbol.
            this.logger.debug(`[Watchdog] ${trade.symbol} protection missing in batch. Performing fresh verification...`);
            const freshOrders = await this.orderManager.fetchOpenOrders(trade.symbol);
            const freshSlOrders = freshOrders.filter(isSlOrder);

            matchingOrder = freshSlOrders.find(o =>
              String(o.orderId) === trade.binance_stop_order_id ||
              String(o.algoId) === trade.binance_stop_order_id ||
              o.clientOrderId === `sl-${(trade.id || '').substring(0, 8)}`
            );

            // INTEL: Broaden protection detection. Any valid Reduce-Only STOP order counts.
            if (!matchingOrder && freshSlOrders.length > 0) {
              // Check if the order quantity matches (or is close enough)
              const validSl = freshSlOrders.find(o => Math.abs(parseFloat(o.origQty || o.quantity) - trade.qty) < 0.00000001);
              if (validSl) {
                const newId = String(validSl.algoId || validSl.orderId);
                const metadata = {
                  newId,
                  oldId: trade.binance_stop_order_id,
                  price: validSl.stopPrice || validSl.triggerPrice,
                  qty: validSl.origQty || validSl.quantity,
                  type: validSl.algoType ? 'algo' : 'standard'
                };
                this.logger.warn(`[Watchdog] ${trade.symbol} found untracked SL protection. Adopting and syncing state. Meta: ${JSON.stringify(metadata)}`);
                trade.binance_stop_order_id = newId;
                trade.binance_stop_order_type = validSl.algoType ? 'algo' : 'standard';
                const exSlPrice = parseFloat(validSl.stopPrice || validSl.triggerPrice);
                if (exSlPrice > 0 && Math.abs(exSlPrice - trade.current_sl) > 0.00000001) {
                  trade.current_sl = exSlPrice;
                }
                trade.updated_at = new Date();
                matchingOrder = validSl;
                this.eventEmitter.emit(ENGINE_EVENTS.TRADE_UPDATED, { trade });
              }
            }
          }

          if (!matchingOrder) {

            // STRATEGY B: NUCLEAR OPTION
            // If the unprotected position is older than 2 minutes, the situation is critical.
            // Market close the position to protect capital.
            if (secondsSinceUpdate > 120) {
              const nuclearMsg = `[Watchdog] NUCLEAR OPTION: ${trade.symbol} unprotected for >2 minutes. Market closing position for capital safety.`;
              this.logger.error(nuclearMsg);
              this.eventEmitter.emit(ENGINE_EVENTS.LOG_MESSAGE, { msg: nuclearMsg, level: 'error' });

              // NEW: Emit event to ensure TradingSessionService handles the full closure lifecycle
              this.eventEmitter.emit('trade.exchange_close', {
                symbol: trade.symbol,
                exitPrice: 0,
                reason: 'WATCHDOG_NUCLEAR_CLOSE'
              });
              continue;
            }

            this.logger.warn(`[Watchdog] CRITICAL: ${trade.symbol} position found without expected SL order on Binance. (Expected: ${trade.binance_stop_order_id}). Found: 0. Re-placing...`);

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
