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
    if (!running || !config || config.paper_mode) return;

    const activeTrades = this.positionTracker.activeList();
    if (activeTrades.length === 0) return;

    const uniqueSymbols = Array.from(new Set(activeTrades.map(t => t.symbol)));
    this.logger.log(`[Watchdog] Running protection audit for ${uniqueSymbols.length} unique symbols (Hybrid Strategy)...`);

    try {
      const allPositions = await this.orderManager.fetchAllPositions();
      const activePositionsMap = new Map(allPositions.filter(p => Math.abs(parseFloat(p.positionAmt)) > 0).map(p => [p.symbol, p]));

      let slOrdersSymbols = new Set<string>();
      let algoSlOrdersSymbols = new Set<string>();

      const isSlOrder = (o: any) => (o.type === 'STOP_MARKET' || o.type === 'STOP') && (o.closePosition === true || o.closePosition === 'true' || o.reduceOnly === true || o.reduceOnly === 'true');

      const allAlgoOrders = await this.orderManager.fetchAllOpenAlgoOrders();
      algoSlOrdersSymbols = new Set(allAlgoOrders.filter(isSlOrder).map(o => o.symbol));

      if (uniqueSymbols.length > 40) {
        const allOrders = await this.orderManager.fetchAllOpenOrders();
        slOrdersSymbols = new Set(allOrders.filter(isSlOrder).map(o => o.symbol));
      } else {
        for (const symbol of uniqueSymbols) {
           const orders = await this.orderManager.fetchOpenOrders(symbol);
           if (orders.some(isSlOrder)) slOrdersSymbols.add(symbol);
        }
      }

      for (const trade of activeTrades) {
        try {
          if (!trade.binance_order_id) continue;
          const pos = activePositionsMap.get(trade.symbol);
          if (!pos) continue;
          const hasProtection = slOrdersSymbols.has(trade.symbol) || algoSlOrdersSymbols.has(trade.symbol);

          if (!hasProtection) {
            this.logger.warn(`[Watchdog] CRITICAL: ${trade.symbol} position found without SL order on Binance. Re-placing...`);
            this.eventEmitter.emit(ENGINE_EVENTS.LOG_MESSAGE, { msg: `[Watchdog] Missing SL detected for ${trade.symbol}. Recovering protection...`, level: 'warn' });
            await this.orderManager.placeStopLoss(trade, trade.current_sl);
          }
        } catch (innerErr) {
          this.logger.error(`[Watchdog] Error auditing ${trade.symbol}: ${innerErr instanceof Error ? innerErr.message : String(innerErr)}`);
        }
      }
    } catch (err) {
      this.logger.error(`[Watchdog] Audit failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async checkFundingFees(running: boolean, config: SessionConfig | null) {
    if (!running || !config) return;
    const now = new Date();
    const isFundingTime = now.getUTCHours() % ENGINE_CONSTANTS.FUNDING_INTERVAL_HOURS === 0 && now.getUTCMinutes() === 0;

    if (isFundingTime) {
      try {
        const activeTrades = this.positionTracker.activeList();
        for (const trade of activeTrades) {
          try {
            const isLong = trade.direction === 'LONG';
            const notional = (trade.mark_price || trade.last_price || trade.entry_price) * trade.qty;
            const fundingDelta = roundEight(notional * ENGINE_CONSTANTS.SIMULATED_FUNDING_RATE * (isLong ? 1 : -1));

            trade.funding_fee = roundEight((trade.funding_fee || 0) + fundingDelta);
            trade.pnl = roundEight(trade.pnl - fundingDelta);
            (trade as any)._last_funding_delta = fundingDelta;

            // Emit event to update balance in TradingSessionService
            this.eventEmitter.emit(ENGINE_EVENTS.FUNDING_APPLIED, { trade, fundingDelta });

            this.logger.log(`[Funding] Applied ${fundingDelta} estimated funding fee to ${trade.symbol} (${config.paper_mode ? 'Paper' : 'Live'})`);
          } catch (innerErr) {
            this.logger.error(`[Funding] Failed to apply fee for ${trade.symbol}: ${innerErr instanceof Error ? innerErr.message : String(innerErr)}`);
          }
        }
      } catch (err) {
        this.logger.error(`[Funding] Batch application failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }
}
