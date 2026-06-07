import { Injectable, Logger } from '@nestjs/common';
import { DerivativesTradingUsdsFutures } from '@binance/derivatives-trading-usds-futures';
import { Trade } from '../models/Trade';
import { SessionConfig } from '../models/SessionConfig';
import { SignalEngineService } from './signalEngine';
import { MarketFeedService } from './market_feed.service';
import { SessionStateService } from './session_state.service';
import { AuditLogService } from '../trading/audit-log.service';
import { v4 as uuid } from 'uuid';
import { roundEight, floorStep, roundTo } from '../lib/math';
import { ENGINE_CONSTANTS } from '../models/constants';
import { ExchangeExecutionException } from '../lib/exceptions';

@Injectable()
export class OrderManagerService {
  private readonly logger = new Logger(OrderManagerService.name);

  private binanceClient: DerivativesTradingUsdsFutures | null = null;
  private paperMode = true;

  constructor(
    private readonly signalEngine: SignalEngineService,
    private readonly marketFeed: MarketFeedService,
    private readonly sessionState: SessionStateService,
    private readonly auditLog: AuditLogService,
  ) {}

  setBinanceClient(client: DerivativesTradingUsdsFutures | null, paperMode = true) {
    this.binanceClient = client;
    this.paperMode = paperMode;
  }

  private applyFilters(symbol: string, price: number, qty: number) {
    const filters = this.marketFeed.getSymbolFilters(symbol);
    if (!filters) return { price, qty };

    let finalPrice = price;
    let finalQty = qty;

    const priceFilter = filters.filters.find((f: { filterType: string; tickSize?: string; stepSize?: string; notional?: string; minNotional?: string }) => f.filterType === 'PRICE_FILTER');
    if (priceFilter) {
      const tickSize = parseFloat(priceFilter.tickSize);
      finalPrice = roundEight(Math.round(price / tickSize) * tickSize);
    }

    const lotSize = filters.filters.find((f: { filterType: string; tickSize?: string; stepSize?: string; notional?: string; minNotional?: string }) => f.filterType === 'LOT_SIZE');
    if (lotSize) {
      const stepSize = parseFloat(lotSize.stepSize);
      finalQty = floorStep(qty, stepSize);
    }

    // MIN_NOTIONAL Check
    const minNotionalFilter = filters.filters.find((f: { filterType: string; tickSize?: string; stepSize?: string; notional?: string; minNotional?: string }) => f.filterType === 'MIN_NOTIONAL') ||
                             filters.filters.find((f: { filterType: string; tickSize?: string; stepSize?: string; notional?: string; minNotional?: string }) => f.filterType === 'NOTIONAL');
    if (minNotionalFilter) {
      const minNotional = parseFloat(minNotionalFilter.notional || minNotionalFilter.minNotional || '0');
      if (finalQty * finalPrice < minNotional) {
        this.logger.warn(`${symbol}: Order notional ${finalQty * finalPrice} is below minimum ${minNotional}`);
        return { price: finalPrice, qty: 0 }; // Zero qty will block entry
      }
    }

    return { price: finalPrice, qty: finalQty };
  }

  async enter(
    sessionId: string,
    symbol: string,
    direction: 'LONG' | 'SHORT',
    entryPrice: number,
    qty: number,
    slPrice: number,
    tpPrice: number | null,
    metadata: Pick<Trade, 'strategy_label' | 'strategy_config'> = {},
  ): Promise<Trade | null> {
    try {
      const filtered = this.applyFilters(symbol, entryPrice, qty);
      const filteredSl = this.applyFilters(symbol, slPrice, qty).price;
      const filteredTp = tpPrice ? this.applyFilters(symbol, tpPrice, qty).price : null;

      entryPrice = filtered.price;
      qty = filtered.qty;
      slPrice = filteredSl;
      tpPrice = filteredTp;

      if (qty <= 0) {
        this.logger.warn(`${symbol}: Position size too small after LOT_SIZE filtering.`);
        return null;
      }

      // Immediate parameter validation
      if (!symbol || qty <= 0) {
        this.logger.error(`Invalid entry parameters: symbol=${symbol}, qty=${qty}`);
        return null;
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
        pnl_pct: 0,
        risk_usdt: roundEight(Math.max(0, direction === 'LONG' ? entryPrice - slPrice : slPrice - entryPrice) * qty),
        sessionId,
        strategy_label: metadata.strategy_label,
        strategy_config: metadata.strategy_config,
      } as Trade;

      // In live mode, attempt to place actual order
      if (!this.paperMode && this.binanceClient) {
        try {
          const binanceDirection = direction === 'LONG' ? 'BUY' : 'SELL';
          const filters = this.marketFeed.getSymbolFilters(symbol);
          const lotSize = filters?.filters.find((f: { filterType: string; tickSize?: string; stepSize?: string; notional?: string; minNotional?: string }) => f.filterType === 'LOT_SIZE');
          const stepSize = parseFloat(lotSize?.stepSize || '0');
          const precision = stepSize > 0 ? Math.max(0, Math.round(-Math.log10(stepSize))) : 8;

          const response = await (this.binanceClient as any).restAPI.tradeApi.newOrder({
            symbol,
            side: binanceDirection,
            type: 'MARKET',
            quantity: qty.toFixed(precision),
          });
          const orderData = typeof response.data === 'function' ? await response.data() : (response.data || response);
          trade.binance_order_id = orderData.orderId;

          // Capture realized fees from entry fills
          if (orderData.fills && Array.isArray(orderData.fills)) {
            const entryFee = ((orderData.fills as any[]).reduce)((sum: number, fill: { commission: string }) => sum + parseFloat(fill.commission || '0'), 0);
            trade.realized_fee = roundEight(trade.realized_fee + entryFee);
          }

          this.logger.log(
            `Binance order placed: ${symbol} ${direction} qty=${qty} order_id=${orderData.orderId} fee=${trade.realized_fee}`,
          );

          await this.auditLog.log({
            action: 'LIVE_ORDER_ENTRY',
            resourceId: trade.id,
            details: { symbol, direction, qty, orderId: orderData.orderId }
          });

          // Place initial Stop Loss order on exchange
          try {
            const closeDirection = direction === 'LONG' ? 'SELL' : 'BUY';
            
            // USE ALGO API FOR STOP ORDERS (Fixes -4120)
            const slResponse = await (this.binanceClient as any).restAPI.algoApi.newOrder({
                symbol,
                side: closeDirection,
                type: 'STOP_MARKET',
                quantity: qty.toFixed(precision),
                stopPrice: slPrice.toFixed(precision),
                reduceOnly: true,
            });
            const slOrderResult = typeof slResponse.data === 'function' ? await slResponse.data() : (slResponse.data || slResponse);
            const slOrderData = Array.isArray(slOrderResult) ? slOrderResult[0] : slOrderResult;

            if (!slOrderData || !slOrderData.orderId) {
              throw new Error(`Stop Loss order failed: ${JSON.stringify(slOrderData)}`);
            }
            trade.binance_stop_order_id = slOrderData.orderId;
          } catch (slErr: unknown) {
            const slErrMsg = slErr instanceof Error ? slErr.message : String(slErr);
            this.logger.error(`Critical Failure: Market entry succeeded but Stop Loss placement FAILED for ${symbol}: ${slErrMsg}`);

            // EMERGENCY UNWIND: Attempt to close the position immediately to prevent unprotected exposure
            this.logger.warn(`Attempting emergency unwind for ${symbol}...`);
            try {
              const closeDirection = direction === 'LONG' ? 'SELL' : 'BUY';
              await (this.binanceClient as any).restAPI.tradeApi.newOrder({
                symbol,
                side: closeDirection,
                type: 'MARKET',
                quantity: qty.toFixed(precision),
                reduceOnly: 'true',
              });
              this.logger.log(`Emergency unwind successful for ${symbol}. Entry aborted.`);
              return null; // Return null to indicate entry was aborted
            } catch (unwindErr: unknown) {
              const unwindMsg = unwindErr instanceof Error ? unwindErr.message : String(unwindErr);
              this.logger.error(`CRITICAL RISK: Emergency unwind FAILED for ${symbol}: ${unwindMsg}. Position is OPEN and UNPROTECTED.`);
              // We must throw here to notify the session that we are in an invalid state
              throw new ExchangeExecutionException(`Market entry succeeded but Stop Loss FAILED and Unwind FAILED for ${symbol}. UNPROTECTED POSITION!`);
            }
          }
        } catch (err: unknown) {
          if (err instanceof ExchangeExecutionException) throw err;
          const errMsg = err instanceof Error ? err.message : String(err);

          // CRITICAL: If market entry already succeeded (we have an order id), we must NOT silently fallback to paper.
          // The previous try block handled the SL failure. If we are here, it means the entry MARKET order itself failed.
          if (trade.binance_order_id) {
            this.logger.error(`Critical Failure: Unexpected error after market entry for ${symbol}: ${errMsg}`);
            throw new ExchangeExecutionException(`Unexpected error after market entry for ${symbol}: ${errMsg}`);
          }

          this.logger.warn(
            `Binance entry order failed (continuing in paper mode): ${errMsg}`,
          );
          // If we fallback to paper mode after failure, we should simulate the fee
          trade.realized_fee = roundEight(entryPrice * qty * ENGINE_CONSTANTS.SIMULATED_FEE_RATE);
        }
      } else if (this.paperMode) {
        // Simulate paper entry fee (0.04% taker)
        trade.realized_fee = roundEight(entryPrice * qty * ENGINE_CONSTANTS.SIMULATED_FEE_RATE);
      }

      // Initialize PnL as net of entry fees
      trade.pnl = roundEight(-trade.realized_fee);

      this.logger.log(
        `Enter: ${symbol} ${direction} @ ${entryPrice} qty=${qty} SL=${slPrice} TP=${tpPrice}`,
      );
      return trade;
    } catch (error) {
      if (error instanceof ExchangeExecutionException) throw error;
      this.logger.error(`Enter failed: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  /**
   * Place a STOP_MARKET order on Binance for stop loss protection
   */
  async placeStopLoss(trade: Trade, slPrice: number): Promise<string | null> {
    const filtered = this.applyFilters(trade.symbol, slPrice, trade.qty);
    slPrice = filtered.price;

    if (this.paperMode || !this.binanceClient) return null;

    try {
      const closeDirection = trade.direction === 'LONG' ? 'SELL' : 'BUY';
      const filters = this.marketFeed.getSymbolFilters(trade.symbol);
      const priceFilter = filters?.filters.find((f: { filterType: string; tickSize?: string; stepSize?: string; notional?: string; minNotional?: string }) => f.filterType === 'PRICE_FILTER');
      const tickSize = parseFloat(priceFilter?.tickSize || '0');
      const precision = tickSize > 0 ? Math.max(0, Math.round(-Math.log10(tickSize))) : 8;

      // Use Algo API for stop orders
      const response = await (this.binanceClient as any).restAPI.algoApi.newOrder({
        symbol: trade.symbol,
        side: closeDirection,
        type: 'STOP_MARKET',
        quantity: (trade.qty || 0).toFixed(precision),
        stopPrice: slPrice.toFixed(precision),
        reduceOnly: true,
      });
      const slOrderResult = typeof response.data === 'function' ? await response.data() : (response.data || response);
      const orderData = Array.isArray(slOrderResult) ? slOrderResult[0] : slOrderResult;

      if (!orderData || !orderData.orderId) {
        throw new Error(`Invalid response from Binance SL order: ${JSON.stringify(orderData)}`);
      }
      trade.binance_stop_order_id = orderData.orderId;
      this.logger.log(
        `Binance SL order placed: ${trade.symbol} at ${slPrice} order_id=${orderData.orderId}`,
      );

      await this.auditLog.log({
        action: 'LIVE_SL_ORDER_PLACED',
        resourceId: trade.id,
        details: { symbol: trade.symbol, slPrice, orderId: orderData.orderId }
      });
      return orderData.orderId;
    } catch (err) {
      this.logger.error(
        `Failed to place Binance SL: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }

  /**
   * Update an existing stop loss by canceling and replacing it
   */
  async updateStopLoss(trade: Trade, newSlPrice: number): Promise<void> {
    if (this.paperMode || !this.binanceClient) return;

    // BOLT: Proactive Rate Limit - Skip non-critical SL updates if near limits
    // We only skip if the gap is small, otherwise it's critical protection
    if (this.sessionState.isRateLimited()) {
       const risk = Math.abs(trade.entry_price - trade.initial_sl);
       const move = Math.abs(newSlPrice - trade.current_sl);
       if (move < (risk * 0.1)) {
          this.logger.debug(`Skipping SL update for ${trade.symbol} due to rate limits (small move: ${move.toFixed(4)})`);
          return;
       }
    }

    // Cancel existing SL order if it exists
    if (trade.binance_stop_order_id) {
      await this.cancelBinanceOrder(trade.symbol, trade.binance_stop_order_id);
    }

    // Place new SL order
    await this.placeStopLoss(trade, newSlPrice);
  }

  /**
   * Cancel an order on Binance
   */
  async cancelBinanceOrder(symbol: string, orderId: string): Promise<boolean> {
    if (this.paperMode || !this.binanceClient) return true;

    try {
      await (this.binanceClient as any).restAPI.tradeApi.cancelOrder({ symbol, orderId });
      this.logger.log(`Binance order canceled: ${symbol} order_id=${orderId}`);
      return true;
    } catch (err) {
      // If order is already filled or canceled, we can ignore the error
      const errMsg = err instanceof Error ? err.message : String(err);
      if (errMsg.includes('Order has been filled') || errMsg.includes('UNKNOWN_ORDER')) {
        this.logger.debug(`Order ${orderId} already closed: ${errMsg}`);
        return true;
      }
      this.logger.warn(`Failed to cancel Binance order ${orderId}: ${errMsg}`);
      return false;
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

    const tradeAgeSec = trade.entry_ts
      ? (Date.now() - new Date(trade.entry_ts).getTime()) / 1000
      : 0;

    const statuses: Record<string, { fired: boolean, active: boolean, remaining_delay: number, label: string, value: number, threshold: number, unit: string, description?: string, insufficientData?: boolean }> = {};
    const delays = config.exit_signal_delays || {};
    const logic = config.exit_signal_logic || 'any';

    let firedCount = 0;
    let activeCount = 0;

    // Check each exit signal
    for (const exitSignal of config.exit_signals) {
      try {
        const delay = delays[exitSignal] || 0;
        const isActive = tradeAgeSec >= delay;
        const remaining = Math.max(0, delay - tradeAgeSec);

        // Create temp config with only the exit signal enabled
        const tempConfig = {
          ...config,
          enabled_signals: [exitSignal],
        };

        const result = this.signalEngine.checkEntry(
          symbol,
          tempConfig,
          interval,
          trade.direction,
          'exit'
        );
        const isFired = result.allFired;
        const detail = result.details ? result.details[exitSignal] : null;

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
        };

        if (isFired && isActive) {
          firedCount++;
        }
        if (isActive) {
          activeCount++;
        }
      } catch (err) {
        this.logger.debug(
          `Exit signal ${exitSignal} check error: ${err instanceof Error ? err.message : String(err)}`,
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

  private async fetchPosition(symbol: string): Promise<any | null> {
    if (!this.binanceClient) return null;
    try {
      const response = await (this.binanceClient as any).restAPI.tradeApi.positionInformationV2({ symbol });
      const data = typeof response.data === 'function' ? await response.data() : (response.data || response);
      return Array.isArray(data) ? data[0] : data;
    } catch (err) {
      this.logger.warn(`Failed to fetch position for ${symbol}: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  }

  async closeTrade(
    symbol: string,
    trade: Trade,
    exitPrice: number,
    exitReason: string,
    paperMode = this.paperMode,
  ): Promise<{ trade: Trade; exitOccurred: boolean }> {
    try {
      // Calculate P&L
      const pnlPoints = trade.direction === 'LONG'
        ? exitPrice - trade.entry_price
        : trade.entry_price - exitPrice;

      // GUARD: Prevent NaN PnL
      const rawPnl = pnlPoints * (trade.qty || 0);
      const pnl = roundEight(Number.isFinite(rawPnl) ? rawPnl : 0);
      const rawPnlPct = (trade.qty !== 0) ? (pnlPoints / (trade.entry_price || 1)) * 100 : 0;
      const pnlPct = roundEight(Number.isFinite(rawPnlPct) ? rawPnlPct : 0);

      // In live mode, place close order with reduce-only for safety
      if (!paperMode && this.binanceClient) {
        try {
          // If there is an exchange stop loss, cancel it to prevent orphans
          if (trade.binance_stop_order_id) {
            await this.cancelBinanceOrder(symbol, trade.binance_stop_order_id);
          }

          const closeDirection = trade.direction === 'LONG' ? 'SELL' : 'BUY';
          try {
            const filters = this.marketFeed.getSymbolFilters(symbol);
            const lotSize = filters?.filters.find((f: { filterType: string; tickSize?: string; stepSize?: string; notional?: string; minNotional?: string }) => f.filterType === 'LOT_SIZE');
            const stepSize = parseFloat(lotSize?.stepSize || '0');
            const precision = stepSize > 0 ? Math.max(0, Math.round(-Math.log10(stepSize))) : 8;

            const response = await (this.binanceClient as any).restAPI.tradeApi.newOrder({
              symbol,
              side: closeDirection,
              type: 'MARKET',
              quantity: (trade.qty || 0).toFixed(precision),
              reduceOnly: 'true',
            });
            const orderData = typeof response.data === 'function' ? await response.data() : (response.data || response);
            trade.binance_close_order_id = orderData.orderId;

            // Capture realized fees from exit fills
            if (orderData.fills && Array.isArray(orderData.fills)) {
              const exitFee = ((orderData.fills as any[]).reduce)((sum: number, fill: { commission: string }) => sum + parseFloat(fill.commission || '0'), 0);
              trade.realized_fee = roundEight(trade.realized_fee + exitFee);
            }

            this.logger.log(
              `Binance close order placed: ${symbol} qty=${trade.qty || 0} order_id=${orderData.orderId} total_fee=${trade.realized_fee}`,
            );

            await this.auditLog.log({
              action: 'LIVE_ORDER_CLOSE',
              resourceId: trade.id,
              details: { symbol, qty: trade.qty, orderId: orderData.orderId, reason: exitReason }
            });
          } catch (err: unknown) {
            const errMsg = err instanceof Error ? err.message : String(err);
            // RISK-04: If close fails, check if it's because position is already closed (SL race)
            if (errMsg.includes('REDUCE_ONLY') || errMsg.includes('Position side does not match')) {
               this.logger.log(`Binance close order for ${symbol} rejected (possibly already closed by exchange SL). Verifying...`);
               const position = await this.fetchPosition(symbol);
               if (position && parseFloat(position.positionAmt) === 0) {
                  this.logger.log(`Confirmed: ${symbol} position is already zero. Treating as successfully closed.`);
                  trade.exit_reason = 'EXCHANGE_SL_OR_MANUAL';
                  // Simulate exit fee since we can't easily fetch it from the exchange SL fill here
                  const exitFee = roundEight(exitPrice * trade.qty * ENGINE_CONSTANTS.SIMULATED_FEE_RATE);
                  trade.realized_fee = roundEight(trade.realized_fee + exitFee);
               } else {
                  this.logger.warn(`Binance close order failed but position still exists for ${symbol}: ${errMsg}`);
                  throw err;
               }
            } else {
               this.logger.warn(`Binance close order failed for ${symbol}: ${errMsg}`);
               throw err;
            }
          }
        } catch (err) {
          this.logger.warn(
            `Binance close operation error: ${err instanceof Error ? err.message : String(err)}`,
          );
          throw err;
        }
      } else if (paperMode) {
        // Simulate paper exit fee (0.04% taker)
        const exitFee = roundEight(exitPrice * trade.qty * ENGINE_CONSTANTS.SIMULATED_FEE_RATE);
        trade.realized_fee = roundEight(trade.realized_fee + exitFee);
      }

      // Update trade AFTER successful closure confirmation
      trade.exit_price = exitPrice;
      trade.exit_ts = new Date();
      trade.pnl_pct = pnlPct;
      trade.exit_reason = trade.exit_reason || exitReason;

      // Ensure exit signal type and reason are passed through to persistence
      if (!trade.exit_signal_type) {
        if (exitReason === 'SL_HIT') trade.exit_signal_type = 'STOP_LOSS';
        else if (exitReason === 'TP_HIT') trade.exit_signal_type = 'TAKE_PROFIT';
        else if (exitReason === 'MANUAL_CLOSE') trade.exit_signal_type = 'MANUAL';
        else if (exitReason === 'SESSION_TERMINATED') trade.exit_signal_type = 'SESSION_TERMINATED';
        else trade.exit_signal_type = 'SIGNAL';
      }

      // Determine status
      if (exitReason.includes('SL')) {
        trade.status = 'CLOSED_SL';
      } else if (exitReason.includes('TP')) {
        trade.status = 'CLOSED_TP';
      } else if (exitReason.includes('SIGNAL')) {
        trade.status = 'CLOSED_SIGNAL';
      } else {
        trade.status = 'CLOSED';
      }

      // Calculate final net PnL
      const finalNetPnl = (pnlPoints * (trade.qty || 0)) - (trade.realized_fee || 0);
      trade.pnl = roundEight(Number.isFinite(finalNetPnl) ? finalNetPnl : 0);

      this.logger.log(
        `Close: ${symbol} @ ${exitPrice} P&L=${trade.pnl.toFixed(2)} (${pnlPct.toFixed(2)}%) Fee=${trade.realized_fee} Reason=${exitReason}`,
      );

      return { trade, exitOccurred: true };
    } catch (error) {
      this.logger.error(`Close failed: ${error instanceof Error ? error.message : String(error)}`);
      return { trade, exitOccurred: false };
    }
  }
}
