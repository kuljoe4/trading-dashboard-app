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
import { ExecutionResult, ExecutionStatus } from '../models/ExecutionResult';

@Injectable()
export class OrderManagerService {
  private readonly logger = new Logger(OrderManagerService.name);

  private binanceClient: DerivativesTradingUsdsFutures | null = null;
  private paperMode = true;

  private consecutiveFailures = 0;
  private readonly MAX_CONSECUTIVE_FAILURES = 3;

  constructor(
    private readonly signalEngine: SignalEngineService,
    private readonly marketFeed: MarketFeedService,
    private readonly sessionState: SessionStateService,
    private readonly auditLog: AuditLogService,
  ) {}

  private checkCircuitBreaker(): boolean {
    return this.consecutiveFailures >= this.MAX_CONSECUTIVE_FAILURES;
  }

  private recordFailure() {
    this.consecutiveFailures++;
    this.logger.warn(`Failure recorded. Consecutive failures: ${this.consecutiveFailures}`);
  }

  private recordSuccess() {
    if (this.consecutiveFailures > 0) {
      this.logger.log('Circuit breaker reset.');
    }
    this.consecutiveFailures = 0;
  }

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
  ): Promise<ExecutionResult<Trade>> {
    if (this.checkCircuitBreaker()) {
      return { status: ExecutionStatus.CIRCUIT_OPEN, error: 'Circuit breaker is open' };
    }
    
    try {
      const filtered = this.applyFilters(symbol, entryPrice, qty);
      const filteredSl = this.applyFilters(symbol, slPrice, qty).price;
      const filteredTp = tpPrice ? this.applyFilters(symbol, tpPrice, qty).price : null;

      entryPrice = filtered.price;
      qty = filtered.qty;
      slPrice = filteredSl;
      tpPrice = filteredTp;

      // Fail early if no filters found for live mode
      if (!this.paperMode && !this.marketFeed.getSymbolFilters(symbol)) {
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
            newOrderRespType: 'RESULT',
          });
          const orderData = typeof response.data === 'function' ? await response.data() : (response.data || response);
          trade.binance_order_id = orderData.orderId;

          // Capture actual execution price and quantity from Binance response
          const avgPrice = parseFloat(orderData.avgPrice || '0');
          const executedQty = parseFloat(orderData.executedQty || '0');

          if (avgPrice > 0) {
            trade.entry_price = roundEight(avgPrice);
            entryPrice = trade.entry_price; // Update local for subsequent operations
          }
          if (executedQty > 0) {
            trade.qty = executedQty;
            qty = trade.qty; // Update local for SL placement
          }

          // Re-calculate risk USDT with actual entry price
          trade.risk_usdt = roundEight(Math.max(0, direction === 'LONG' ? trade.entry_price - slPrice : slPrice - trade.entry_price) * trade.qty);

          // Capture realized fees from fills if available, otherwise estimate
          if (orderData.fills && Array.isArray(orderData.fills) && orderData.fills.length > 0) {
            let entryFee = 0;
            for (const fill of orderData.fills) {
              entryFee += parseFloat(fill.commission || '0');
            }
            trade.realized_fee = roundEight(entryFee);
          } else {
            // Standard Binance Futures taker fee is 0.05% (or 0.04% with BNB)
            // We use a conservative estimate if fills are not provided in the response
            const estimatedFee = trade.entry_price * trade.qty * 0.0005;
            trade.realized_fee = roundEight(estimatedFee);
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
            const tradeApi = (this.binanceClient as any)?.restAPI?.tradeApi;
            if (!tradeApi) {
              throw new Error('Binance Trade API is not initialized');
            }

            const priceFilter = filters?.filters.find((f: any) => f.filterType === 'PRICE_FILTER');
            const tickSize = parseFloat(priceFilter?.tickSize || '0');
            const pricePrecision = tickSize > 0 ? Math.max(0, Math.round(-Math.log10(tickSize))) : 8;

            const slResponse = await tradeApi.newAlgoOrder({
                algoType: 'CONDITIONAL',
                symbol,
                side: closeDirection,
                type: 'STOP_MARKET',
                quantity: qty.toFixed(precision),
                triggerPrice: slPrice.toFixed(pricePrecision),
                reduceOnly: 'true',
            });
            const slOrderResult = typeof slResponse.data === 'function' ? await slResponse.data() : (slResponse.data || slResponse);
            const slOrderData = Array.isArray(slOrderResult) ? slOrderResult[0] : slOrderResult;

            // Algo orders return 'algoId' instead of 'orderId'
            const stopLossId = slOrderData.algoId || slOrderData.orderId;

            if (!slOrderData || !stopLossId) {
              throw new Error(`Stop Loss order failed: ${JSON.stringify(slOrderData)}`);
            }
            trade.binance_stop_order_id = String(stopLossId);

            this.logger.log(
              `Binance SL order placed: ${symbol} at ${slPrice} algo_id=${stopLossId}`,
            );
          } catch (slErr: unknown) {
            this.recordFailure();
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
              return { status: ExecutionStatus.SL_FAILED, error: `Stop Loss placement FAILED for ${symbol}: ${slErrMsg}`, unwindPerformed: true };
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
          this.recordFailure();
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
  async placeStopLoss(trade: Trade, slPrice: number): Promise<string | null> {
    const filtered = this.applyFilters(trade.symbol, slPrice, trade.qty);
    slPrice = filtered.price;

    if (this.paperMode || !this.binanceClient || !trade.binance_order_id) return null;

    // BOLT: Fail early if no filters found for live mode to prevent "Invalid symbol"
    if (!this.marketFeed.getSymbolFilters(trade.symbol)) {
      this.logger.error(`Live SL rejected: No exchange filters found for ${trade.symbol} in current environment.`);
      return null;
    }

    try {
      const closeDirection = trade.direction === 'LONG' ? 'SELL' : 'BUY';
      const filters = this.marketFeed.getSymbolFilters(trade.symbol);

      const lotSize = filters?.filters.find((f: any) => f.filterType === 'LOT_SIZE');
      const stepSize = parseFloat(lotSize?.stepSize || '0');
      const qtyPrecision = stepSize > 0 ? Math.max(0, Math.round(-Math.log10(stepSize))) : 8;

      const priceFilter = filters?.filters.find((f: any) => f.filterType === 'PRICE_FILTER');
      const tickSize = parseFloat(priceFilter?.tickSize || '0');
      const pricePrecision = tickSize > 0 ? Math.max(0, Math.round(-Math.log10(tickSize))) : 8;

      // Use Algo API for stop orders
      const response = await (this.binanceClient as any).restAPI.tradeApi.newAlgoOrder({
        algoType: 'CONDITIONAL',
        symbol: trade.symbol,
        side: closeDirection,
        type: 'STOP_MARKET',
        quantity: (trade.qty || 0).toFixed(qtyPrecision),
        triggerPrice: slPrice.toFixed(pricePrecision),
        reduceOnly: 'true',
      });
      const slOrderResult = typeof response.data === 'function' ? await response.data() : (response.data || response);
      const orderData = Array.isArray(slOrderResult) ? slOrderResult[0] : slOrderResult;

      // Algo orders return 'algoId' instead of 'orderId'
      const stopLossId = orderData.algoId || orderData.orderId;

      if (!orderData || !stopLossId) {
        throw new Error(`Invalid response from Binance SL order: ${JSON.stringify(orderData)}`);
      }
      trade.binance_stop_order_id = String(stopLossId);
      this.logger.log(
        `Binance SL order placed: ${trade.symbol} at ${slPrice} algo_id=${stopLossId}`,
      );

      await this.auditLog.log({
        action: 'LIVE_SL_ORDER_PLACED',
        resourceId: trade.id,
        details: { symbol: trade.symbol, slPrice, orderId: stopLossId }
      });
      return String(stopLossId);
    } catch (err) {
      this.logger.error(
        `Failed to place Binance SL for ${trade.symbol}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }

  /**
   * Update an existing stop loss by canceling and replacing it
   */
  async updateStopLoss(trade: Trade, newSlPrice: number): Promise<void> {
    if (this.paperMode || !this.binanceClient || !trade.binance_order_id) return;

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
      // Algo orders use cancelAlgoOrder
      await this.cancelBinanceAlgoOrder(trade.symbol, trade.binance_stop_order_id);
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
      const upperMsg = errMsg.toUpperCase();
      if (upperMsg.includes('ORDER HAS BEEN FILLED') || upperMsg.includes('UNKNOWN_ORDER') || upperMsg.includes('UNKNOWN ORDER')) {
        this.logger.debug(`Order ${orderId} already closed: ${errMsg}`);
        return true;
      }
      this.logger.warn(`Failed to cancel Binance order ${orderId}: ${errMsg}`);
      return false;
    }
  }

  /**
   * Cancel an algorithmic order on Binance
   */
  async cancelBinanceAlgoOrder(symbol: string, algoId: string): Promise<boolean> {
    if (this.paperMode || !this.binanceClient) return true;

    try {
      // Large IDs must be handled as BigInt to prevent precision loss,
      // but we handle non-numeric strings for testing/robustness.
      const numericAlgoId = /^\d+$/.test(algoId) ? BigInt(algoId) : algoId;
      await (this.binanceClient as any).restAPI.tradeApi.cancelAlgoOrder({ symbol, algoId: numericAlgoId });
      this.logger.log(`Binance algo order canceled: ${symbol} algo_id=${algoId}`);
      return true;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      const upperMsg = errMsg.toUpperCase();
      if (upperMsg.includes('ORDER HAS BEEN FILLED') || upperMsg.includes('UNKNOWN_ORDER') || upperMsg.includes('UNKNOWN ORDER') || upperMsg.includes('NOT FOUND')) {
        this.logger.debug(`Algo order ${algoId} already closed or not found: ${errMsg}`);
        return true;
      }
      this.logger.warn(`Failed to cancel Binance algo order ${algoId}: ${errMsg}`);
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

  public async fetchPosition(symbol: string): Promise<any | null> {
    if (!this.binanceClient) return null;
    try {
      // BOLT: Verify symbol exists in exchange info before calling API to prevent "Invalid symbol"
      if (!this.marketFeed.getSymbolFilters(symbol)) {
        this.logger.warn(`fetchPosition: Symbol ${symbol} not found in exchangeInfo for current environment.`);
        return null;
      }
      const response = await (this.binanceClient as any).restAPI.tradeApi.positionInformationV2({ symbol });
      const data = typeof response.data === 'function' ? await response.data() : (response.data || response);

      if (Array.isArray(data)) {
        // Find position with non-zero amount (Hedge Mode support)
        const activePosition = data.find(p => parseFloat(p.positionAmt) !== 0);
        // If no active position, return the 'BOTH' side if available, or just the first one
        return activePosition || data.find(p => p.positionSide === 'BOTH') || data[0];
      }
      return data;
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
      // In live mode, place close order with reduce-only for safety
      if (!paperMode && this.binanceClient && trade.binance_order_id) {
        try {
          // If there is an exchange stop loss, cancel it to prevent orphans
          if (trade.binance_stop_order_id) {
            // SL is an algo order
            await this.cancelBinanceAlgoOrder(symbol, trade.binance_stop_order_id);
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
              newOrderRespType: 'RESULT',
            });
            const orderData = typeof response.data === 'function' ? await response.data() : (response.data || response);
            trade.binance_close_order_id = orderData.orderId;

            // Capture actual execution price from Binance response
            const avgExitPrice = parseFloat(orderData.avgPrice || '0');
            if (avgExitPrice > 0) {
              exitPrice = roundEight(avgExitPrice);
            }

            // Capture realized fees from fills if available, otherwise estimate
            if (orderData.fills && Array.isArray(orderData.fills) && orderData.fills.length > 0) {
              let exitFee = 0;
              for (const fill of orderData.fills) {
                exitFee += parseFloat(fill.commission || '0');
              }
              trade.realized_fee = roundEight(trade.realized_fee + exitFee);
            } else {
              const estimatedExitFee = exitPrice * trade.qty * 0.0005;
              trade.realized_fee = roundEight(trade.realized_fee + estimatedExitFee);
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
            const upperMsg = errMsg.toUpperCase();
            // RISK-04: If close fails, check if it's because position is already closed (SL race)
            // Note: Binance can return "ReduceOnly Order is rejected." or "REDUCE_ONLY"
            if (upperMsg.includes('REDUCE_ONLY') || upperMsg.includes('REDUCEONLY') || upperMsg.includes('POSITION SIDE DOES NOT MATCH')) {
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

      // BOLT: Final PnL calculation using the finalized exitPrice (potentially from fills)
      const finalPnlPoints = trade.direction === 'LONG'
        ? exitPrice - trade.entry_price
        : trade.entry_price - exitPrice;

      const finalPnlPct = (trade.qty !== 0) ? (finalPnlPoints / (trade.entry_price || 1)) * 100 : 0;
      trade.pnl_pct = roundEight(Number.isFinite(finalPnlPct) ? finalPnlPct : 0);

      const finalNetPnl = (finalPnlPoints * (trade.qty || 0)) - (trade.realized_fee || 0);
      trade.pnl = roundEight(Number.isFinite(finalNetPnl) ? finalNetPnl : 0);

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

      this.logger.log(
        `Close: ${symbol} @ ${exitPrice} P&L=${trade.pnl.toFixed(2)} (${trade.pnl_pct.toFixed(2)}%) Fee=${trade.realized_fee} Reason=${exitReason}`,
      );

      return { trade, exitOccurred: true };
    } catch (error) {
      this.logger.error(`Close failed: ${error instanceof Error ? error.message : String(error)}`);
      return { trade, exitOccurred: false };
    }
  }
}
