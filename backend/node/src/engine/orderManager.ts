import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { DerivativesTradingUsdsFutures } from '@binance/derivatives-trading-usds-futures';
import { Trade } from '../models/Trade';
import { SessionConfig } from '../models/SessionConfig';
import { SignalEngineService } from './signalEngine';
import { MarketFeedService } from './market_feed.service';
import { TickerCacheService } from './ticker_cache.service';
import { SessionStateService } from './session_state.service';
import { AuditLogService } from '../trading/audit-log.service';
import { v4 as uuid } from 'uuid';
import { roundEight, floorStep, roundTo } from '../lib/math';
import { ENGINE_CONSTANTS } from '../models/constants';
import { ENGINE_EVENTS } from './events';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ExchangeExecutionException } from '../lib/exceptions';
import { ExecutionResult, ExecutionStatus } from '../models/ExecutionResult';

@Injectable()
export class OrderManagerService {
  private readonly logger = new Logger(OrderManagerService.name);

  private binanceClient: DerivativesTradingUsdsFutures | null = null;
  private paperMode = true;
  private takerFeeRate = 0.0004; // Default taker fee (0.04%)

  private consecutiveFailures = 0;
  private readonly MAX_CONSECUTIVE_FAILURES = 3;

  constructor(
    private readonly signalEngine: SignalEngineService,
    private readonly marketFeed: MarketFeedService,
    private readonly tickerCache: TickerCacheService,
    private readonly sessionState: SessionStateService,
    private readonly auditLog: AuditLogService,
    private readonly eventEmitter: EventEmitter2,
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

    this.logger.debug(`Processing Binance order update: ${symbol} ${side} ${status} (${orderId}, clientOrderId=${clientOrderId})`);

    // Proactively update weight from WS message if available (not standard but some messages might have it in other formats, usually it's headers only though)
    // For now we rely on the REST updates.

    // We only care about FILLED status for SL/TP or potential external closes
    if (status === 'FILLED') {
      const activeTrades = this.sessionState.activeTrades;
      const trade = activeTrades.find(t => t.symbol === symbol);

      if (trade) {
        const tradeIdShort8 = trade.id.substring(0, 8);
        // Check if this was our SL order
        if (trade.binance_stop_order_id === orderId || (clientOrderId && clientOrderId === `sl-${tradeIdShort8}`)) {
          this.logger.log(`Binance SL HIT for ${symbol}. Closing trade locally.`);
          const exitPrice = parseFloat(order.ap || order.p || '0');
          this.eventEmitter.emit(ENGINE_EVENTS.LOG_MESSAGE, {
            msg: `Exchange SL hit for ${symbol} at ${exitPrice}`,
            level: 'info'
          });

          // Trigger local closure
          this.eventEmitter.emit('trade.exchange_close', {
            symbol,
            exitPrice,
            reason: 'SL_HIT'
          });
        }
        // Check if this was our TP or some other closing order
        else if (side !== (trade.direction === 'LONG' ? 'BUY' : 'SELL')) {
           this.logger.log(`Non-entry order FILLED for ${symbol} (${side}). Closing trade locally.`);
           const exitPrice = parseFloat(order.ap || order.p || '0');
           this.eventEmitter.emit('trade.exchange_close', {
             symbol,
             exitPrice,
             reason: 'EXCHANGE_FILL'
           });
        }
      }
    } else if (status === 'EXPIRED' || status === 'CANCELED') {
        // Handle canceled SL orders if necessary
    }
  }

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

  async setBinanceClient(client: DerivativesTradingUsdsFutures | null, paperMode = true) {
    const isNewClient = this.binanceClient !== client;
    const isModeChange = this.paperMode !== paperMode;

    this.binanceClient = client;
    this.paperMode = paperMode;

    // Idempotency check: Only fetch commission rate if client or mode has changed
    if (this.binanceClient && !this.paperMode && (isNewClient || isModeChange)) {
      try {
        const response = await (this.binanceClient as any).restAPI.accountApi.userCommissionRate({ symbol: 'BTCUSDT' });
        const data = typeof response.data === 'function' ? await response.data() : (response.data || response);
        if (data && data.takerCommissionRate) {
          this.takerFeeRate = parseFloat(data.takerCommissionRate);
          this.logger.log(`Taker fee rate cached: ${(this.takerFeeRate * 100).toFixed(4)}%`);
        }
      } catch (err) {
        this.logger.warn(`Failed to fetch commission rate, using default: ${this.takerFeeRate}`);
      }
    }
  }

  private updateWeight(headers: any) {
    if (headers) {
      // Handle both native Headers and plain objects
      const weight = typeof headers.get === 'function'
        ? headers.get('X-MBX-USED-WEIGHT-1M')
        : (headers['x-mbx-used-weight-1m'] || headers['X-MBX-USED-WEIGHT-1M']);

      if (weight) {
        const currentWeight = parseInt(weight, 10);
        this.sessionState.updateRateLimit(currentWeight);

        if (this.sessionState.isRateLimited(0.85)) {
           this.logger.warn(`Binance Rate Limit Warning: ${currentWeight}/${this.sessionState.binanceRateLimit.limit}`);
        }
      }
    }
  }

  public applyFilters(symbol: string, price: number, qty: number, options: { priceRounding?: 'round' | 'floor' | 'ceil', skipNotionalCheck?: boolean } = {}) {
    const filters = this.marketFeed.getSymbolFilters(symbol);
    if (!filters) return { price, qty };

    let finalPrice = price;
    let finalQty = qty;

    const priceFilter = filters.filters.find((f: { filterType: string; tickSize?: string; stepSize?: string; notional?: string; minNotional?: string }) => f.filterType === 'PRICE_FILTER');
    if (priceFilter) {
      const tickSize = parseFloat(priceFilter.tickSize);
      const rounding = options.priceRounding || 'round';
      if (rounding === 'floor') finalPrice = roundEight(Math.floor(price / tickSize) * tickSize);
      else if (rounding === 'ceil') finalPrice = roundEight(Math.ceil(price / tickSize) * tickSize);
      else finalPrice = roundEight(Math.round(price / tickSize) * tickSize);
    }

    const lotSize = filters.filters.find((f: { filterType: string; tickSize?: string; stepSize?: string; notional?: string; minNotional?: string }) => f.filterType === 'LOT_SIZE');
    if (lotSize) {
      const stepSize = parseFloat(lotSize.stepSize);
      finalQty = floorStep(qty, stepSize);
    }

    // MIN_NOTIONAL Check
    if (!options.skipNotionalCheck) {
      const minNotionalFilter = filters.filters.find((f: { filterType: string; tickSize?: string; stepSize?: string; notional?: string; minNotional?: string }) => f.filterType === 'MIN_NOTIONAL') ||
                               filters.filters.find((f: { filterType: string; tickSize?: string; stepSize?: string; notional?: string; minNotional?: string }) => f.filterType === 'NOTIONAL');
      if (minNotionalFilter) {
        const minNotional = parseFloat(minNotionalFilter.notional || minNotionalFilter.minNotional || '0');
        if (finalQty * finalPrice < minNotional) {
          this.logger.warn(`${symbol}: Order notional ${finalQty * finalPrice} is below minimum ${minNotional}`);
          return { price: finalPrice, qty: 0 }; // Zero qty will block entry
        }
      }
    }

    return { price: finalPrice, qty: finalQty };
  }

  /**
   * Set leverage for a symbol on Binance
   */
  async setLeverage(symbol: string, leverage: number): Promise<boolean> {
    if (this.paperMode || !this.binanceClient) return true;
    try {
      this.logger.debug(`Setting leverage for ${symbol} to ${leverage}x`);
      const response = await (this.binanceClient as any).restAPI.tradeApi.changeInitialLeverage({ symbol, leverage });
      this.updateWeight(response.headers);
      return true;
    } catch (err) {
      this.logger.warn(`Failed to set leverage for ${symbol}: ${err instanceof Error ? err.message : String(err)}`);
      return false;
    }
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

    // Zero-CPU Rate Limiter Guard
    if (!this.paperMode && this.sessionState.isRateLimited(0.92)) {
      const currentWeight = this.sessionState.binanceRateLimit.used_1m;
      this.logger.warn(`Approaching Binance rate limit (${currentWeight}). Blocking entry for ${symbol}.`);
      return { status: ExecutionStatus.CIRCUIT_OPEN, error: 'Rate limit protection active' };
    }
    
    try {
      const filtered = this.applyFilters(symbol, entryPrice, qty);
      const filteredSl = this.applyFilters(symbol, slPrice, qty, { skipNotionalCheck: true }).price;
      const filteredTp = tpPrice ? this.applyFilters(symbol, tpPrice, qty, { skipNotionalCheck: true }).price : null;

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
        funding_fee: 0,
        pnl_pct: 0,
        risk_usdt: roundEight(Math.max(0, direction === 'LONG' ? entryPrice - slPrice : slPrice - entryPrice) * qty),
        sessionId,
        strategy_label: metadata.strategy_label,
        strategy_config: metadata.strategy_config,
      } as Trade;

      // In live mode, attempt to place actual order using batchOrders for zero-cost network optimization
      if (!this.paperMode && this.binanceClient) {
        try {
          // Set leverage before entry
          const targetLeverage = metadata.strategy_config?.leverage || 1;
          await this.setLeverage(symbol, targetLeverage);

          const binanceDirection = direction === 'LONG' ? 'BUY' : 'SELL';
          const closeDirection = direction === 'LONG' ? 'SELL' : 'BUY';
          const filters = this.marketFeed.getSymbolFilters(symbol);

          const lotSize = filters?.filters.find((f: any) => f.filterType === 'LOT_SIZE');
          const stepSize = parseFloat(lotSize?.stepSize || '0');
          const qtyPrecision = stepSize > 0 ? Math.max(0, Math.round(-Math.log10(stepSize))) : 8;

          const priceFilter = filters?.filters.find((f: any) => f.filterType === 'PRICE_FILTER');
          const tickSize = parseFloat(priceFilter?.tickSize || '0');
          const pricePrecision = tickSize > 0 ? Math.max(0, Math.round(-Math.log10(tickSize))) : 8;

          const entryOrderId = `ent-${trade.id.replace(/-/g, '').substring(0, 20)}`;
          const entryOrder = {
            symbol,
            side: binanceDirection as any,
            type: 'MARKET',
            quantity: qty.toFixed(qtyPrecision),
            newOrderRespType: 'RESULT',
            newClientOrderId: entryOrderId,
          };

          this.logger.log(`Placing entry order: ${JSON.stringify(entryOrder)}`);
          const response = await (this.binanceClient as any).restAPI.tradeApi.newOrder(entryOrder);

          this.updateWeight(response.headers);
          const entryReceipt = typeof response.data === 'function' ? await response.data() : (response.data || response);
          this.logger.log(`Entry receipt: ${JSON.stringify(entryReceipt)}`);

          if (entryReceipt.code && entryReceipt.code !== 0) {
            throw new Error(`Entry order failed: ${entryReceipt.msg}`);
          }

          trade.binance_order_id = entryReceipt.orderId;

          // Zero-RAM Price Tracking: Extract exact execution details from REST response
          // BOLT: Handle both single-order 'avgPrice' and potential batch 'price' fields
          let absoluteEntryPrice = parseFloat(entryReceipt.avgPrice || entryReceipt.price || '0');

          if (absoluteEntryPrice === 0 && entryReceipt.fills && Array.isArray(entryReceipt.fills) && entryReceipt.fills.length > 0) {
             const totalQty = entryReceipt.fills.reduce((sum: number, fill: any) => sum + parseFloat(fill.qty), 0);
             const weightedSum = entryReceipt.fills.reduce((sum: number, fill: any) => sum + parseFloat(fill.qty) * parseFloat(fill.price), 0);
             if (totalQty > 0) absoluteEntryPrice = weightedSum / totalQty;
          }

          const executedQty = parseFloat(entryReceipt.executedQty || '0');

          if (absoluteEntryPrice > 0) {
            const slippage = Math.abs(absoluteEntryPrice - entryPrice) / entryPrice;
            const threshold = metadata.strategy_config?.slippage_warning_threshold ?? 0.001;
            if (slippage > threshold) {
              this.logger.warn(`Slippage warning for ${symbol}: Estimated ${entryPrice}, Actual ${absoluteEntryPrice} (Delta: ${(slippage * 100).toFixed(2)}%)`);
            }
            trade.entry_price = roundEight(absoluteEntryPrice);
          }
          if (executedQty > 0) trade.qty = executedQty;

          // Recalculate SL after actual fill.
          // Since entryPrice and initial slPrice were Mark-based,
          // we maintain that exact distance relative to the Actual Fill Price (Last Price).
          const originalDistance = Math.abs(entryPrice - slPrice);
          slPrice = direction === 'LONG' ? trade.entry_price - originalDistance : trade.entry_price + originalDistance;
          trade.current_sl = trade.initial_sl = slPrice;

          // Zero-Cost Math Estimation for fees
          const notionalValue = trade.qty * trade.entry_price;
          trade.realized_fee = roundEight(notionalValue * this.takerFeeRate);

          entryPrice = trade.entry_price;
          qty = trade.qty;

          // Re-calculate risk USDT with actual entry price
          trade.risk_usdt = roundEight(Math.max(0, direction === 'LONG' ? trade.entry_price - slPrice : slPrice - trade.entry_price) * trade.qty);

          const msg = `Binance order placed: ${symbol} ${direction} qty=${qty} order_id=${entryReceipt.orderId} est_fee=${trade.realized_fee}`;
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

          // Place SL separately to avoid Algo Order API issues in batch
          const slOrderId = await this.placeStopLoss(trade, slPrice);
          if (!slOrderId) {
            this.logger.warn(`SL placement failed for ${symbol}. Performing emergency unwind...`);
            try {
              const unwindResult = await this.closeTrade(symbol, trade, entryPrice, 'SL_PLACEMENT_FAILURE');
              if (unwindResult.exitOccurred) {
                return { status: ExecutionStatus.SL_FAILED, data: trade, unwindPerformed: true };
              } else {
                throw new Error('Emergency unwind failed');
              }
            } catch (unwindErr) {
              this.logger.error(`CRITICAL: Emergency unwind failed for ${symbol}: ${unwindErr instanceof Error ? unwindErr.message : String(unwindErr)}`);
              throw new ExchangeExecutionException(`SL placement failed and emergency unwind also failed for ${symbol}`);
            }
          }

        } catch (err: unknown) {
          if (err instanceof ExchangeExecutionException) throw err;
          const errMsg = err instanceof Error ? err.message : String(err);

          if (trade.binance_order_id) {
            this.logger.error(`Critical Failure: Unexpected error after market entry for ${symbol}: ${errMsg}`);
            throw new ExchangeExecutionException(`Unexpected error after market entry for ${symbol}: ${errMsg}`);
          }

          const agreementMsg = errMsg.includes('agreement')
            ? `CRITICAL: ${errMsg}. Please go to Binance website and sign the required agreement.`
            : `Binance entry failed: ${errMsg}`;

          this.logger.error(agreementMsg);
          this.eventEmitter.emit(ENGINE_EVENTS.LOG_MESSAGE, { msg: agreementMsg, level: 'error' });

          this.recordFailure();
          return { status: ExecutionStatus.ORDER_REJECTED, error: agreementMsg };
        }
      } else if (this.paperMode) {
        // Simulate paper entry fee (taker rate)
        trade.realized_fee = roundEight(entryPrice * qty * ENGINE_CONSTANTS.SIMULATED_FEE_RATE);
      }

      // Initialize PnL as net of entry fees (immediately realized)
      trade.pnl = roundEight(-trade.realized_fee);

      const msgEnter = `Enter: ${symbol} ${direction} @ ${entryPrice} qty=${qty} SL=${slPrice} TP=${tpPrice}`;
      this.logger.log(msgEnter);
      this.eventEmitter.emit(ENGINE_EVENTS.LOG_MESSAGE, { msg: msgEnter, level: 'info' });
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
    const filtered = this.applyFilters(trade.symbol, slPrice, trade.qty, { skipNotionalCheck: true });
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

      const priceFilter = filters?.filters.find((f: any) => f.filterType === 'PRICE_FILTER');
      const tickSize = parseFloat(priceFilter?.tickSize || '0');
      const pricePrecision = tickSize > 0 ? Math.max(0, Math.round(-Math.log10(tickSize))) : 8;

      // Switch to standard STOP_MARKET for consistency and simpler batch support
      const lotSize = filters?.filters.find((f: any) => f.filterType === 'LOT_SIZE');
      const stepSize = parseFloat(lotSize?.stepSize || '0');
      const qtyPrecision = stepSize > 0 ? Math.max(0, Math.round(-Math.log10(stepSize))) : 8;

      const slOrderParams = {
        symbol: trade.symbol,
        side: closeDirection as any,
        type: 'STOP_MARKET',
        stopPrice: slPrice.toFixed(pricePrecision), // Standard STOP_MARKET uses stopPrice
        closePosition: true, // Guarantees full close
        reduceOnly: true,
        workingType: 'MARK_PRICE' as any,
        newClientOrderId: `sl-${trade.id.substring(0, 8)}`,
      };

      this.logger.log(`Placing Binance SL order: ${JSON.stringify(slOrderParams)}`);
      // Switch from newAlgoOrder to standard newOrder for STOP_MARKET
      const response = await (this.binanceClient as any).restAPI.tradeApi.newOrder(slOrderParams);

      this.updateWeight(response.headers);
      const orderData = typeof response.data === 'function' ? await response.data() : (response.data || response);
      this.logger.log(`Manual SL placement response for ${trade.symbol}: ${JSON.stringify(orderData)}`);
      const stopLossId = orderData.orderId; // Standard order only has orderId

      if (!orderData || !stopLossId) {
        throw new Error(`Invalid response from Binance SL order: ${JSON.stringify(orderData)}`);
      }
      trade.binance_stop_order_id = String(stopLossId);
      const msgSl = `Binance SL order placed: ${trade.symbol} at ${slPrice} order_id=${stopLossId}`;
      this.logger.log(msgSl);
      this.eventEmitter.emit(ENGINE_EVENTS.LOG_MESSAGE, { msg: msgSl, level: 'info' });

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
    if (this.sessionState.isRateLimited(0.7)) {
       const risk = Math.abs(trade.entry_price - trade.initial_sl);
       const move = Math.abs(newSlPrice - trade.current_sl);
       if (move < (risk * 0.15)) {
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
      const response = await (this.binanceClient as any).restAPI.tradeApi.cancelOrder({ symbol, orderId });
      this.updateWeight(response.headers);
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
      const response = await (this.binanceClient as any).restAPI.tradeApi.cancelAlgoOrder({ symbol, algoId: numericAlgoId });
      this.updateWeight(response.headers);
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
    // Zero-Weight Path: Prefer local real-time cache from User Data Stream
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
      const response = await (this.binanceClient as any).restAPI.tradeApi.positionInformationV2({ symbol });
      this.updateWeight(response.headers);
      const data = typeof response.data === 'function' ? await response.data() : (response.data || response);

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

  async closeTrade(
    symbol: string,
    trade: Trade,
    exitPrice: number,
    exitReason: string,
    paperMode = this.paperMode,
    localOnly = false,
  ): Promise<{ trade: Trade; exitOccurred: boolean }> {
    try {
      // In live mode, place close order with reduce-only for safety
      if (!paperMode && !localOnly && this.binanceClient && trade.binance_order_id) {
        try {
          // If there is an exchange stop loss, cancel it to prevent orphans
          if (trade.binance_stop_order_id) {
            await this.cancelBinanceOrder(symbol, trade.binance_stop_order_id);
          }

          const closeDirection = trade.direction === 'LONG' ? 'SELL' : 'BUY';
          try {
            const filters = this.marketFeed.getSymbolFilters(symbol);
            const lotSize = filters?.filters.find((f: any) => f.filterType === 'LOT_SIZE');
            const stepSize = parseFloat(lotSize?.stepSize || '0');
            const precision = stepSize > 0 ? Math.max(0, Math.round(-Math.log10(stepSize))) : 8;

            const response = await (this.binanceClient as any).restAPI.tradeApi.newOrder({
              symbol,
              side: closeDirection as any,
              type: 'MARKET',
              quantity: (trade.qty || 0).toFixed(precision),
              reduceOnly: true,
              newOrderRespType: 'RESULT',
              newClientOrderId: `cls-${trade.id.replace(/-/g, '').substring(0, 20)}`,
            });

            this.updateWeight(response.headers);
            const orderData = typeof response.data === 'function' ? await response.data() : (response.data || response);

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
            let absoluteExitPrice = parseFloat(orderData.avgPrice || orderData.price || '0');

            if (absoluteExitPrice === 0 && orderData.fills && Array.isArray(orderData.fills) && orderData.fills.length > 0) {
               const totalQty = orderData.fills.reduce((sum: number, fill: any) => sum + parseFloat(fill.qty), 0);
               const weightedSum = orderData.fills.reduce((sum: number, fill: any) => sum + parseFloat(fill.qty) * parseFloat(fill.price), 0);
               if (totalQty > 0) absoluteExitPrice = weightedSum / totalQty;
            }

            const executedExitQtyFinal = parseFloat(orderData.executedQty || '0');

            if (absoluteExitPrice > 0) exitPrice = roundEight(absoluteExitPrice);

            // Zero-Cost Math Estimation for exit fees
            const exitNotional = (executedExitQtyFinal > 0 ? executedExitQtyFinal : trade.qty) * exitPrice;
            const exitFee = roundEight(exitNotional * this.takerFeeRate);
            trade.realized_fee = roundEight((trade.realized_fee || 0) + exitFee);

            const msgClose = `Binance close order placed: ${symbol} qty=${trade.qty || 0} order_id=${orderData.orderId} est_exit_fee=${exitFee}`;
            this.logger.log(msgClose);
            this.eventEmitter.emit(ENGINE_EVENTS.LOG_MESSAGE, { msg: msgClose, level: 'info' });

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
                  trade.realized_fee = roundEight((trade.realized_fee || 0) + exitFee);
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

      const finalPnlPct = (trade.qty !== 0) ? (finalPnlPoints / (trade.entry_price || 1)) * 100 : 0;
      trade.pnl_pct = roundEight(Number.isFinite(finalPnlPct) ? finalPnlPct : 0);

      const finalNetPnl = (finalPnlPoints * (trade.qty || 0)) - (trade.realized_fee || 0) - (trade.funding_fee || 0);
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

      const msgCloseFinal = `Close: ${symbol} @ ${exitPrice} P&L=${trade.pnl.toFixed(2)} (${trade.pnl_pct.toFixed(2)}%) Fee=${trade.realized_fee} Reason=${exitReason}`;
      this.logger.log(msgCloseFinal);
      this.eventEmitter.emit(ENGINE_EVENTS.LOG_MESSAGE, { msg: msgCloseFinal, level: 'info' });

      return { trade, exitOccurred: true };
    } catch (error) {
      this.logger.error(`Close failed: ${error instanceof Error ? error.message : String(error)}`);
      return { trade, exitOccurred: false };
    }
  }
}
