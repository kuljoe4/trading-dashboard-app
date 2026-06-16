import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { DerivativesTradingUsdsFutures } from '@binance/derivatives-trading-usds-futures';
import { Trade } from '../models/Trade';
import { SessionConfig } from '../models/SessionConfig';
import { SignalEngineService } from './signalEngine';
import { MarketFeedService } from './market_feed.service';
import { TickerCacheService } from './ticker_cache.service';
import { MonitoringService } from './monitoring.service';
import { SessionStateService } from './session_state.service';
import { AuditLogService } from '../trading/audit-log.service';
import { v4 as uuid } from 'uuid';
import { roundEight, floorStep, roundTo, formatSlType } from '../lib/math';
import { ENGINE_CONSTANTS, CONFIG_LIMITS } from '../models/constants';
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
    private readonly monitoringService: MonitoringService,
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
    const executionType = order.x; // Execution Type

    // Proactively update weight from WS message if available
    // Guideline: Only process fills if executionType is 'TRADE'
    if (status === 'FILLED' && executionType === 'TRADE') {
      const activeTrades = this.sessionState.activeTrades;
      const trade = activeTrades.find(t => t.symbol === symbol);

      if (trade) {
        const tradeIdShort8 = (trade.id || 'N/A').substring(0, 8);
        this.logger.debug(`[${tradeIdShort8}] Processing Binance order FILLED: ${symbol} ${side} (${orderId}, clientOrderId=${clientOrderId})`);

        // BOLT: Handle both REST order IDs and Client IDs for SL matching
        const isSlOrder =
          trade.binance_stop_order_id === orderId ||
          (clientOrderId && clientOrderId.startsWith(`sl-${tradeIdShort8}`));

        if (isSlOrder) {
          this.logger.log(`[${tradeIdShort8}] Binance SL HIT for ${symbol}. Closing trade locally.`);
          let exitPrice = parseFloat(order.ap || order.p || '0');

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

          this.eventEmitter.emit('trade.exchange_close', {
            symbol,
            exitPrice,
            reason: 'SL_HIT'
          });
        }
        else if (side !== (trade.direction === 'LONG' ? 'BUY' : 'SELL')) {
           this.logger.log(`[${tradeIdShort8}] Non-entry order FILLED for ${symbol} (${side}). Closing trade locally.`);
           let exitPrice = parseFloat(order.ap || order.p || '0');

           if (exitPrice === 0) {
              const tickerPrice = this.tickerCache.getPrice(symbol);
              this.logger.warn(`[${tradeIdShort8}] Binance WS returned 0 price for ${symbol} fill. Using ticker fallback: ${tickerPrice}`);
              exitPrice = tickerPrice || trade.entry_price;
           }

           trade.exit_signal_reason = `EXCHANGE_FILL: ${side} at ${exitPrice}`;

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

  public getTakerFeeRate(): number {
    return this.takerFeeRate;
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
        const data = typeof response?.data === 'function' ? await response.data() : (response?.data || response);
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
        if (isNaN(currentWeight) || currentWeight < 0) return;
        this.logger.debug(`Binance Weight Update: ${currentWeight}`);
        this.sessionState.updateRateLimit(currentWeight);

        if (this.sessionState.isRateLimited(0.85)) {
           this.logger.warn(`Binance Rate Limit Warning: ${currentWeight}/${this.sessionState.binanceRateLimit.limit}`);
        }
      }

      // Also update order rate limits (X-MBX-ORDER-COUNT)
      this.sessionState.updateOrderRateLimits(headers);
    }
  }

  public applyFilters(symbol: string, price: number, qty: number, options: { priceRounding?: 'round' | 'floor' | 'ceil', skipNotionalCheck?: boolean } = {}) {
    const filters = this.marketFeed.getSymbolFilters(symbol);
    if (!filters) return { price, qty };

    let finalPrice = price;
    let finalQty = qty;

    const priceFilter = filters.filters.find((f: any) => f.filterType === 'PRICE_FILTER');
    if (priceFilter) {
      const tickSize = parseFloat(priceFilter.tickSize);
      const rounding = options.priceRounding || 'round';
      if (rounding === 'floor') finalPrice = roundEight(Math.floor(price / tickSize) * tickSize);
      else if (rounding === 'ceil') finalPrice = roundEight(Math.ceil(price / tickSize) * tickSize);
      else finalPrice = roundEight(Math.round(price / tickSize) * tickSize);
    }

    // PERCENT_PRICE Validation
    const percentPriceFilter = filters.filters.find((f: any) => f.filterType === 'PERCENT_PRICE');
    if (percentPriceFilter && !this.paperMode) {
      const ticker = this.tickerCache.getTicker(symbol);
      const markPrice = ticker?.mark_price || ticker?.price;
      if (markPrice) {
        const multiplierUp = parseFloat(percentPriceFilter.multiplierUp || '1.1');
        const multiplierDown = parseFloat(percentPriceFilter.multiplierDown || '0.9');
        const maxPrice = markPrice * multiplierUp;
        const minPrice = markPrice * multiplierDown;

        if (finalPrice > maxPrice || finalPrice < minPrice) {
          // SL/TP orders are often placed outside standard bands. We only block if it's an ENTRY attempt (qty > 0 and not skipNotionalCheck)
          const isStopLossOrTp = !!options.skipNotionalCheck;

          if (!isStopLossOrTp) {
            this.logger.warn(`${symbol}: Price ${finalPrice} outside PERCENT_PRICE band [${minPrice.toFixed(5)}, ${maxPrice.toFixed(5)}] (Mark: ${markPrice})`);
            // We don't block yet, but we might want to return 0 qty if it's too far
            if (Math.abs(finalPrice - markPrice) / markPrice > 0.05) {
               this.logger.error(`${symbol}: CRITICAL - Price too far from Mark. Rejecting order.`);
               return { price: finalPrice, qty: 0 };
            }
          } else {
            // For SL/TP, we just log a debug message if it's within 10% of mark, or warn if further
            const deviation = Math.abs(finalPrice - markPrice) / markPrice;
            if (deviation > 0.1) {
              this.logger.warn(`${symbol}: SL/TP Price ${finalPrice} significantly far from Mark (${(deviation * 100).toFixed(2)}%). Proceeding with filtered price.`);
            }
          }
        }
      }
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
   * Set leverage for a symbol on Binance (Feature Disabled)
   */
  async setLeverage(symbol: string, leverage: number): Promise<boolean> {
    // Feature disabled as per user request to avoid exchange sync issues
    return true;
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
    if (this.checkCircuitBreaker()) {
      return { status: ExecutionStatus.CIRCUIT_OPEN, error: 'Circuit breaker is open' };
    }

    // Zero-CPU Rate Limiter Guard
    if (!this.paperMode) {
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
        initial_risk_usdt: roundEight(Math.max(0, direction === 'LONG' ? entryPrice - slPrice : slPrice - entryPrice) * qty),
        sessionId,
        strategy_label: metadata.strategy_label,
        strategy_config: metadata.strategy_config,
        entry_daily_change_pct: metadata.entry_daily_change_pct,
      } as Trade;

      // In live mode, attempt to place actual order using batchOrders for zero-cost network optimization
      if (!this.paperMode && this.binanceClient) {
        let attempts = 0;
        const MAX_ATTEMPTS = 3;
        let lastError: any = null;

        while (attempts < MAX_ATTEMPTS) {
        try {
          attempts++;
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
          if (entryOrderId.length > 36) {
             this.logger.error(`[${symbol}] CRITICAL: Generated ClientOrderId too long: ${entryOrderId}`);
          }
          const entryOrder = {
            symbol,
            side: binanceDirection as any,
            type: 'MARKET',
            quantity: qty.toFixed(qtyPrecision),
            newOrderRespType: 'RESULT',
            newClientOrderId: entryOrderId,
            selfTradePreventionMode: 'EXPIRE_MAKER', // Hardening: Prevent self-trading
          };

          this.logger.log(`Placing entry order (Attempt ${attempts}): ${JSON.stringify(entryOrder)}`);
          const response = await (this.binanceClient as any).restAPI.tradeApi.newOrder(entryOrder);

          this.updateWeight(response?.headers);
          const entryReceipt = typeof response?.data === 'function' ? await response.data() : (response?.data || response);
          this.logger.log(`Entry receipt: ${JSON.stringify(entryReceipt)}`);

          if (entryReceipt.code && entryReceipt.code !== 0) {
            const code = entryReceipt.code;
            const msg = entryReceipt.msg || '';
            // Handle Duplicate Order ID specifically to recover state
            if (code === -2011 || msg.includes('Duplicate orderSent') || msg.includes('Duplicate clientOrderId')) {
               this.logger.log(`[${symbol}] Detected duplicate clientOrderId on entry retry. Recovering order state...`);
               const queryRes = await (this.binanceClient as any).restAPI.tradeApi.queryOrder({ symbol, origClientOrderId: entryOrderId });
               const queryData = typeof queryRes?.data === 'function' ? await queryRes.data() : (queryRes?.data || queryRes);
               if (queryData && queryData.orderId) {
                  this.logger.log(`[${symbol}] Successfully recovered existing order state for duplicate ID: ${queryData.orderId}`);
                  entryReceipt.orderId = queryData.orderId;
                  entryReceipt.avgPrice = queryData.avgPrice || queryData.price;
                  entryReceipt.executedQty = queryData.executedQty;
                  entryReceipt.status = queryData.status;
               } else {
                  throw new Error(`Order ID duplicate but query failed: ${msg}`);
               }
            } else {
               throw new Error(`Entry order failed: ${msg}`);
            }
          }

          trade.binance_order_id = entryReceipt.orderId;

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

          // DATA-CONSISTENCY: Fallback for 0 price responses - Query exchange for authoritative fill price
          if (absoluteEntryPrice === 0 && trade.binance_order_id) {
             try {
                this.logger.log(`Binance returned 0 price for ${symbol} entry. Fetching authoritative price via queryOrder...`);
                const queryRes = await (this.binanceClient as any).restAPI.tradeApi.queryOrder({ symbol, orderId: trade.binance_order_id });
                const queryData = typeof queryRes.data === 'function' ? await queryRes.data() : (queryRes.data || queryRes);
                absoluteEntryPrice = parseFloat(queryData.avgPrice || queryData.price || '0');
                if (absoluteEntryPrice > 0) this.logger.log(`Successfully fetched authoritative entry price: ${absoluteEntryPrice}`);
             } catch (queryErr) {
                this.logger.warn(`Failed to fetch authoritative price for ${symbol}: ${queryErr instanceof Error ? queryErr.message : String(queryErr)}`);
             }
          }

          // FINAL FALLBACK: If still 0, use estimated price
          if (absoluteEntryPrice === 0) {
             this.logger.warn(`Authoritative price query failed for ${symbol} entry. Using estimated price ${entryPrice}.`);
             absoluteEntryPrice = entryPrice;
          }

          const executedQty = parseFloat(entryReceipt.executedQty || '0');

          if (absoluteEntryPrice > 0) {
            const slippage = Math.abs(absoluteEntryPrice - entryPrice) / entryPrice;
            const warningThreshold = metadata.strategy_config?.slippage_warning_threshold ?? 0.001;
            const abortThreshold = Math.min(metadata.strategy_config?.slippage_abort_threshold ?? CONFIG_LIMITS.SLIPPAGE_ABORT_DEFAULT, CONFIG_LIMITS.SLIPPAGE_ABORT_MAX);

            this.logger.log(`[Entry] Execution for ${symbol}: Target ${entryPrice}, Actual ${absoluteEntryPrice.toFixed(8)} (Slippage: ${(slippage * 100).toFixed(4)}%)`);

            if (slippage > abortThreshold) {
              const abortMsg = `[CRITICAL] Slippage for ${symbol} (${(slippage * 100).toFixed(2)}%) exceeded abort threshold (${(abortThreshold * 100).toFixed(2)}%). Unwinding immediately.`;
              this.logger.error(abortMsg);
              this.eventEmitter.emit(ENGINE_EVENTS.LOG_MESSAGE, { msg: abortMsg, level: 'error' });

              // Unwind logic
              try {
                const unwindRes = await this.closeTrade(symbol, trade, absoluteEntryPrice, 'SLIPPAGE_ABORT', false, false);
                if (!unwindRes.exitOccurred) {
                  this.logger.error(`[FATAL] Slippage abort unwind FAILED for ${symbol}. Position may be lingering!`);
                  this.eventEmitter.emit(ENGINE_EVENTS.LOG_MESSAGE, {
                    msg: `FATAL: Slippage abort unwind failed for ${symbol}. Please check exchange immediately.`,
                    level: 'error'
                  });
                }
                return { status: ExecutionStatus.ORDER_REJECTED, error: `Slippage abort: ${(slippage * 100).toFixed(2)}%` };
              } catch (unwindErr) {
                this.logger.error(`Slippage unwind exception for ${symbol}: ${unwindErr instanceof Error ? unwindErr.message : String(unwindErr)}`);
                throw unwindErr;
              }
            } else if (slippage > warningThreshold) {
              this.logger.warn(`Slippage warning for ${symbol}: Delta ${(slippage * 100).toFixed(2)}% exceeds threshold ${(warningThreshold * 100).toFixed(2)}%`);
            }
            trade.entry_price = roundEight(absoluteEntryPrice);
          }
          if (executedQty > 0) trade.qty = executedQty;

          // Recalculate SL after actual fill to maintain intended risk distance
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
          trade.initial_risk_usdt = trade.risk_usdt;

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

          // Place SL separately. Pass actual fill price for immediate-breach guard.
          const slOrderId = await this.placeStopLoss(trade, slPrice, trade.entry_price);
          if (slOrderId === 'TRIGGERED_LOCALLY') {
             this.logger.log(`[${trade.id.substring(0, 8)}] SL for ${symbol} was triggered locally during entry. Trade will be closed.`);
             return { status: ExecutionStatus.SUCCESS, data: trade };
          }
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
          break; // Success, exit retry loop

        } catch (err: unknown) {
          if (err instanceof ExchangeExecutionException) throw err;
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
          if (errMsg.includes('agreement')) {
            agreementMsg = `CRITICAL: ${errMsg}. Please go to Binance website and sign the required agreement.`;
          } else if (errMsg.includes('insufficient balance') || errMsg.includes('Margin is insufficient')) {
            agreementMsg = `CRITICAL: Insufficient funds on Binance USDS-M account to open ${symbol}.`;
          } else if (errMsg.includes('PERCENT_PRICE')) {
            agreementMsg = `CRITICAL: ${symbol} entry failed. The market is too volatile or liquidity is too low (PERCENT_PRICE filter). Try reducing risk or increasing SL distance.`;
          } else if (errMsg.includes('leverage') || errMsg.includes('allowable position') || errMsg.includes('max allowable position') || errMsg.includes('position at current leverage')) {
            agreementMsg = `CRITICAL: Position limit exceeded at current leverage for ${symbol}. Please adjust leverage or position size on Binance.`;
          }

          this.logger.error(agreementMsg);
          this.eventEmitter.emit(ENGINE_EVENTS.LOG_MESSAGE, { msg: agreementMsg, level: 'error' });

          this.recordFailure();
          return { status: ExecutionStatus.ORDER_REJECTED, error: agreementMsg };
        }
        }
      } else if (this.paperMode) {
        // Simulate paper entry fee (taker rate)
        trade.realized_fee = roundEight(entryPrice * qty * ENGINE_CONSTANTS.SIMULATED_FEE_RATE);
      }

    // Initialize PnL as net of entry fees (immediately realized)
    trade.pnl = roundEight(-(trade.realized_fee || 0));

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
  async placeStopLoss(trade: Trade, slPrice: number, fillPrice?: number): Promise<string | null> {
    const filtered = this.applyFilters(trade.symbol, slPrice, trade.qty, { skipNotionalCheck: true });
    slPrice = filtered.price;

    // IMMEDIATE TRIGGER GUARD: Check if current price already breached SL
    // Fix A: Prioritize the authoritative fillPrice and IGNORE the ticker cache if fillPrice is provided.
    // This prevents race conditions where the ticker cache still reflects pre-execution prices.
    let currentPrice = fillPrice;
    if (currentPrice === undefined || currentPrice === 0) {
      const ticker = this.tickerCache.getTicker(trade.symbol);
      currentPrice = ticker?.mark_price || ticker?.price;
    }

    if (currentPrice && currentPrice > 0) {
      const isBreached = trade.direction === 'LONG' ? currentPrice <= slPrice : currentPrice >= slPrice;
      if (isBreached) {
        this.logger.warn(`[${trade.id.substring(0, 8)}] ${trade.symbol} SL ${slPrice} already breached by price ${currentPrice} (using authoritative guard). Triggering immediate local close.`);
        this.eventEmitter.emit('trade.exchange_close', {
          symbol: trade.symbol,
          exitPrice: currentPrice,
          reason: 'SL_HIT'
        });
        return 'TRIGGERED_LOCALLY';
      }
    }

    if (this.paperMode || !this.binanceClient || !trade.binance_order_id) return null;

    // BOLT: Fail early if no filters found for live mode to prevent "Invalid symbol"
    if (!this.marketFeed.getSymbolFilters(trade.symbol)) {
      this.logger.error(`Live SL rejected: No exchange filters found for ${trade.symbol} in current environment.`);
      return null;
    }

    // PERFORMANCE: Implement retry for network errors
    let attempts = 0;
    const MAX_ATTEMPTS = 2;

    while (attempts < MAX_ATTEMPTS) {
    const closeDirection = trade.direction === 'LONG' ? 'SELL' : 'BUY';
    const filters = this.marketFeed.getSymbolFilters(trade.symbol);
    const symbol = trade.symbol;

    try {
      attempts++;

      const priceFilter = filters?.filters.find((f: any) => f.filterType === 'PRICE_FILTER');
      const tickSize = parseFloat(priceFilter?.tickSize || '0');
      const pricePrecision = tickSize > 0 ? Math.max(0, Math.round(-Math.log10(tickSize))) : 8;

      const lotSize = filters?.filters.find((f: any) => f.filterType === 'LOT_SIZE');
      const stepSize = parseFloat(lotSize?.stepSize || '0');
      const qtyPrecision = stepSize > 0 ? Math.max(0, Math.round(-Math.log10(stepSize))) : 8;

      // INDUSTRY-BEST-PRACTICE: For Stop Loss, use closePosition: true.
      // Fix: When closePosition is true, quantity must NOT be sent for STOP_MARKET orders on Binance Futures.
      // This avoids "Order type not supported" errors on certain account configurations.
      const slOrderParams: any = {
        symbol: trade.symbol,
        side: closeDirection as any,
        type: 'STOP_MARKET',
        stopPrice: slPrice.toFixed(pricePrecision),
        closePosition: true,
        workingType: 'MARK_PRICE' as any,
        newClientOrderId: `sl-${trade.id.substring(0, 8)}`,
        selfTradePreventionMode: 'EXPIRE_MAKER', // Hardening: Prevent self-trading
      };

      this.logger.log(`Placing Binance SL order: ${JSON.stringify(slOrderParams)}`);

      let stopLossId: string | null = null;
      let orderType: 'standard' | 'algo' = 'standard';

      try {
        const response = await (this.binanceClient as any).restAPI.tradeApi.newOrder(slOrderParams);
        this.updateWeight(response?.headers);
        const orderData = typeof response?.data === 'function' ? await response.data() : (response?.data || response);

        if (orderData.code && orderData.code !== 0) {
          const code = orderData.code;
          const msg = orderData.msg || '';
          // Handle Duplicate Order ID specifically to recover state after timeout
          if (code === -2011 || msg.includes('Duplicate orderSent') || msg.includes('Duplicate clientOrderId')) {
            this.logger.log(`[${symbol}] Detected duplicate clientOrderId on SL placement retry. Recovering SL state...`);
            const queryRes = await (this.binanceClient as any).restAPI.tradeApi.queryOrder({ symbol, origClientOrderId: slOrderParams.newClientOrderId });
            const queryData = typeof queryRes?.data === 'function' ? await queryRes.data() : (queryRes?.data || queryRes);
            if (queryData && queryData.orderId) {
              this.logger.log(`[${symbol}] Successfully recovered existing SL order state: ${queryData.orderId}`);
              stopLossId = String(queryData.orderId);
            } else {
              throw new Error(`SL Order ID duplicate but query failed: ${msg}`);
            }
          } else {
            throw new Error(`SL placement failed: ${msg}`);
          }
        } else {
          this.logger.log(`Standard SL placement response for ${symbol}: ${JSON.stringify(orderData)}`);
          stopLossId = String(orderData.orderId || orderData.id);
        }
        orderType = 'standard';
      } catch (err: any) {
        const msg = err.message || '';
        if (msg.includes('Duplicate orderSent') || msg.includes('Duplicate clientOrderId')) {
          this.logger.log(`[${symbol}] Detected duplicate clientOrderId (via exception) on SL placement retry. Recovering SL state...`);
          const queryRes = await (this.binanceClient as any).restAPI.tradeApi.queryOrder({ symbol, origClientOrderId: slOrderParams.newClientOrderId });
          const queryData = typeof queryRes?.data === 'function' ? await queryRes.data() : (queryRes?.data || queryRes);
          if (queryData && queryData.orderId) {
            this.logger.log(`[${symbol}] Successfully recovered existing SL order state: ${queryData.orderId}`);
            stopLossId = String(queryData.orderId);
            orderType = 'standard';
          } else {
            throw err;
          }
        } else {
          throw err;
        }
      }

      if (!stopLossId || stopLossId === 'undefined') {
        throw new Error(`Invalid response from Binance SL order placement`);
      }
      trade.binance_stop_order_id = stopLossId;
      trade.binance_stop_order_type = orderType;
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
      const errMsg = err instanceof Error ? err.message : String(err);
      const isNetworkError = errMsg.includes('Network error') || errMsg.includes('timeout') || errMsg.includes('ECONNRESET');

      if (isNetworkError && attempts < MAX_ATTEMPTS) {
        this.logger.warn(`Network error placing SL for ${trade.symbol}. Retrying (Attempt ${attempts + 1}/${MAX_ATTEMPTS})...`);
        await new Promise(resolve => setTimeout(resolve, 1000));
        continue;
      }

      // BOLT: Handle existing order conflict. If a closePosition order already exists, clear it and retry.
      if (errMsg.includes('existing') && (errMsg.includes('closePosition') || errMsg.includes('GTE'))) {
         this.logger.warn(`Detection of potential orphan closePosition order for ${trade.symbol}. Attempting proactive cleanup...`);
         try {
            // Check standard open orders
            const res = await (this.binanceClient as any).restAPI.tradeApi.currentAllOpenOrders({ symbol: trade.symbol });
            this.updateWeight(res?.headers);
            const orders = typeof res?.data === 'function' ? await res.data() : (res?.data || res);
            let cleanedCount = 0;

            if (Array.isArray(orders)) {
              for (const o of orders) {
                // Binance error implies a closePosition order exists. We look for STOP types with closePosition in the SAME direction.
                if ((o.type === 'STOP_MARKET' || o.type === 'STOP' || o.type === 'TAKE_PROFIT_MARKET') &&
                    (o.closePosition === true || o.closePosition === 'true') &&
                    o.side === closeDirection) {
                  this.logger.log(`Found conflicting orphan SL/TP order ${o.orderId} for ${trade.symbol} (${o.side}). Canceling...`);
                  await this.cancelBinanceOrder(trade.symbol, String(o.orderId));
                  cleanedCount++;
                }
              }
            }


            if (cleanedCount > 0 && attempts < MAX_ATTEMPTS) {
              this.logger.log(`Cleaned ${cleanedCount} orphan orders for ${trade.symbol}. Retrying SL placement...`);
              continue;
            }
         } catch (cleanupErr) {
            this.logger.error(`Failed to cleanup orphan SL for ${trade.symbol}: ${cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr)}`);
         }
      } else if ((errMsg.includes('Time in Force') || errMsg.includes('GTE')) && attempts < MAX_ATTEMPTS) {
         this.logger.warn(`Transient SL error for ${trade.symbol}: ${errMsg}. Retrying (Attempt ${attempts + 1}/${MAX_ATTEMPTS})...`);
         await new Promise(resolve => setTimeout(resolve, 500));
         continue;
      }

      this.logger.error(`Failed to place Binance SL for ${trade.symbol}: ${errMsg}`);

      if (errMsg.includes('insufficient balance') || errMsg.includes('Margin is insufficient')) {
         this.eventEmitter.emit(ENGINE_EVENTS.LOG_MESSAGE, {
            msg: `CRITICAL: Insufficient funds for SL placement on ${trade.symbol}. Unwind may be required.`,
            level: 'error'
         });
      } else if (errMsg.includes('agreement')) {
         this.eventEmitter.emit(ENGINE_EVENTS.LOG_MESSAGE, {
            msg: `CRITICAL: Agreement required for ${trade.symbol} SL placement. Please sign the TradFi-Perps agreement on Binance.`,
            level: 'error'
         });
      }

      return null;
    }
    }
    return null;
  }

  /**
   * Update an existing stop loss without protection gaps (Ratcheting)
   */
  async updateStopLoss(trade: Trade, newSlPrice: number, prevSlPrice?: number): Promise<boolean> {
    if (this.paperMode || !this.binanceClient || !trade.binance_order_id) return true;

    const risk = Math.abs(trade.entry_price - trade.initial_sl);
    const move = Math.abs(newSlPrice - trade.current_sl);
    const isSmallMove = move < (risk * 0.15);

    // Order Rate Limit Guard
    if (this.sessionState.isOrderRateLimited(isSmallMove ? 2 : 1)) {
       this.logger.debug(`Skipping SL update for ${trade.symbol} due to order rate limits (move: ${move.toFixed(4)})`);
       return true;
    }

    const filters = this.marketFeed.getSymbolFilters(trade.symbol);
    const priceFilter = filters?.filters.find((f: any) => f.filterType === 'PRICE_FILTER');
    const tickSize = parseFloat(priceFilter?.tickSize || '0');
    const pricePrecision = tickSize > 0 ? Math.max(0, Math.round(-Math.log10(tickSize))) : 8;
    const formattedPrice = newSlPrice.toFixed(pricePrecision);

    // PERFORMANCE: Use modifyOrder for Standard API to avoid protection gaps
    if (trade.binance_stop_order_id && trade.binance_stop_order_type === 'standard') {
      try {
        this.logger.log(`Ratcheting SL for ${trade.symbol} via modifyOrder: ${trade.current_sl} -> ${formattedPrice}`);
        const res = await (this.binanceClient as any).restAPI.tradeApi.modifyOrder({
          symbol: trade.symbol,
          orderId: trade.binance_stop_order_id,
          stopPrice: formattedPrice,
          price: formattedPrice // Required for some modify versions but usually same as stopPrice for STOP_MARKET
        });
          this.updateWeight(res?.headers);
        return true;
      } catch (err: any) {
        const msg = err.message || String(err);
        this.logger.warn(`Failed to modify SL for ${trade.symbol}: ${msg}. Falling back to replace.`);
        // If modify fails (e.g. order filled), we fall through to the replace logic
      }
    }

    // For failed modify or symbols that don't support it, handle closePosition constraint.
    // Binance only allows ONE closePosition order. To update, we must CANCEL first then REPLACE.
    const oldSlId = trade.binance_stop_order_id;

    if (oldSlId) {
      this.logger.debug(`[SL] Canceling existing SL ${oldSlId} for ${trade.symbol} before replacement.`);
      const cancelSuccess = await this.cancelBinanceOrder(trade.symbol, oldSlId);
      if (cancelSuccess) {
         trade.binance_stop_order_id = undefined;
      }
    }

    // Place NEW stop loss after old one is cleared
    let result = await this.placeStopLoss(trade, newSlPrice);

    // ROLLBACK LOGIC: If new SL placement fails, attempt to re-place the OLD one
    if (!result && prevSlPrice) {
       this.logger.warn(`[SL] Replacement failed for ${trade.symbol}. Attempting ROLLBACK to previous SL at ${prevSlPrice}...`);
       result = await this.placeStopLoss(trade, prevSlPrice);
       if (result) {
          this.logger.log(`[SL] Successfully rolled back protection for ${trade.symbol} to ${prevSlPrice}.`);
          // DATA-CONSISTENCY: Sync local state back to the rolled-back price
          trade.current_sl = prevSlPrice;
          return false; // Still return false because the requested update failed
       }
    }

    if (!result) {
       this.logger.error(`[CRITICAL] SL Replacement & Rollback failed for ${trade.symbol}. Position is UNPROTECTED. Attempting emergency unwind...`);
       try {
          const unwindRes = await this.closeTrade(trade.symbol, trade, trade.entry_price, 'UNPROTECTED_SL_FAILURE');
          if (unwindRes.exitOccurred) {
             this.logger.warn(`[RECOVERY] Successfully closed unprotected ${trade.symbol} position.`);
             this.eventEmitter.emit('trade.exchange_close', {
                symbol: trade.symbol,
                exitPrice: trade.exit_price || trade.entry_price,
                reason: 'UNPROTECTED_SL_FAILURE'
             });
          }
       } catch (unwindErr) {
          this.logger.error(`[FATAL] Emergency unwind FAILED for unprotected ${trade.symbol} position: ${unwindErr instanceof Error ? unwindErr.message : String(unwindErr)}`);
       }
       return false;
    }

    return true;
  }

  /**
   * Cancel an order on Binance
   */
  async cancelBinanceOrder(symbol: string, orderId: string): Promise<boolean> {
    if (this.paperMode || !this.binanceClient) return true;

    try {
      const response = await (this.binanceClient as any).restAPI.tradeApi.cancelOrder({ symbol, orderId });
      this.updateWeight(response?.headers);
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

  public async fetchAllOpenOrders(): Promise<any[]> {
    if (!this.binanceClient) return [];
    try {
      this.monitoringService.incrementApiRequests();
      // Use standard endpoint
      const response = await (this.binanceClient as any).restAPI.tradeApi.currentAllOpenOrders();
      this.updateWeight(response?.headers);
      const data = typeof response?.data === 'function' ? await response.data() : (response?.data || response);
      return Array.isArray(data) ? data : [];
    } catch (err) {
      this.logger.warn(`Failed to fetch all open orders: ${err instanceof Error ? err.message : String(err)}`);
      return [];
    }
  }

  /**
   * @deprecated Algo API removed. Returns empty list.
   */
  public async fetchAllOpenAlgoOrders(): Promise<any[]> {
    return [];
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

  public async fetchAllPositions(): Promise<any[]> {
    if (!this.binanceClient) return [];
    if (!this.paperMode && this.sessionState.isRateLimited(0.95)) return [];
    try {
      this.monitoringService.incrementApiRequests();
      // Finding 7: Use V3 for targeted active positions
      const response = await (this.binanceClient as any).restAPI.tradeApi.positionInformationV3();
      this.updateWeight(response.headers);
      const data = typeof response.data === 'function' ? await response.data() : (response.data || response);
      return Array.isArray(data) ? data : [];
    } catch (err) {
      this.logger.warn(`Failed to fetch all positions: ${err instanceof Error ? err.message : String(err)}`);
      return [];
    }
  }

  public async fetchOpenOrders(symbol: string): Promise<any[]> {
    if (!this.binanceClient) return [];
    if (!this.paperMode && this.sessionState.isRateLimited(0.95)) return [];
    try {
      this.monitoringService.incrementApiRequests();
      const res = await (this.binanceClient as any).restAPI.tradeApi.currentAllOpenOrders({ symbol });
      this.updateWeight(res?.headers);
      const data = typeof res?.data === 'function' ? await res.data() : (res?.data || res);
      return Array.isArray(data) ? data : [];
    } catch (err) {
      this.logger.debug(`[${symbol}] Failed to fetch open orders: ${err instanceof Error ? err.message : String(err)}`);
      return [];
    }
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
      // Finding 7: Use V3 for targeted active positions
      const response = await (this.binanceClient as any).restAPI.tradeApi.positionInformationV3({ symbol });
      this.updateWeight(response?.headers);
      const data = typeof response?.data === 'function' ? await response.data() : (response?.data || response);

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

  private async recoverLastExecutionPrice(symbol: string, trade: Trade, estimate: number): Promise<number> {
    if (!this.binanceClient || this.paperMode) return estimate;
    try {
      const tradesRes = await (this.binanceClient as any).restAPI.tradeApi.accountTradeList({ symbol, limit: 5 });
      const trades = typeof tradesRes?.data === 'function' ? await tradesRes.data() : (tradesRes?.data || tradesRes);
      if (Array.isArray(trades) && trades.length > 0) {
        const closeDirection = trade.direction === 'LONG' ? 'SELL' : 'BUY';
        const closingTrades = trades.filter(t => t.side === closeDirection);
        if (closingTrades.length > 0) {
          const lastFill = closingTrades.sort((a, b) => b.time - a.time)[0];
          const fillPrice = parseFloat(lastFill.price);
          if (fillPrice > 0) {
            this.logger.log(`[${(trade.id || 'N/A').substring(0, 8)}] Sync Recovery: Found fill price ${fillPrice} (Estimate: ${estimate})`);
            return fillPrice;
          }
        }
      }
    } catch (e: any) {
      this.logger.debug(`[${(trade.id || 'N/A').substring(0, 8)}] Execution price recovery failed: ${e.message}`);
    }
    return estimate;
  }

  async closeTrade(
    symbol: string,
    trade: Trade,
    exitPrice: number,
    exitReason: string,
    paperMode = this.paperMode,
    localOnly = false,
  ): Promise<{ trade: Trade; exitOccurred: boolean; closeBlocked?: boolean }> {
    try {
      if (trade.close_blocked) {
         return { trade, exitOccurred: false, closeBlocked: true };
      }

      // Structural Close Attempt Throttling & Backoff
      const nowTs = Date.now();
      const attempts = trade.close_attempts || 0;
      const lastAttempt = trade.last_close_attempt_ts || 0;
      const MAX_CLOSE_ATTEMPTS = 5;

      if (!paperMode && attempts > 0) {
         const backoffMs = Math.min(300000, 5000 * Math.pow(2, attempts - 1));
         if (nowTs - lastAttempt < backoffMs) {
            this.logger.debug(`[${symbol}] Close attempt deferred (Backoff: ${backoffMs}ms, Attempt: ${attempts})`);
            return { trade, exitOccurred: false };
         }
      }

      if (!paperMode && this.binanceClient && (exitPrice === 0 || (localOnly && exitReason === 'EXCHANGE_SYNC'))) {
        const tickerPrice = this.tickerCache.getPrice(symbol);
        const estimate = exitPrice || tickerPrice || trade.current_sl;
        exitPrice = await this.recoverLastExecutionPrice(symbol, trade, estimate);
        if (exitReason === 'EXCHANGE_SYNC') exitReason = 'EXCHANGE_SYNC_RECOVERY';
      }

      // In live mode, place close order with reduce-only for safety
      if (!paperMode && !localOnly && this.binanceClient && trade.binance_order_id) {
        trade.close_attempts = attempts + 1;
        trade.last_close_attempt_ts = nowTs;

        try {
          // If there is an exchange stop loss, cancel it to prevent orphans
          if (trade.binance_stop_order_id) {
            await this.cancelBinanceOrder(symbol, trade.binance_stop_order_id);
            trade.binance_stop_order_id = undefined;
          }

          const closeDirection = trade.direction === 'LONG' ? 'SELL' : 'BUY';
          try {
            const filters = this.marketFeed.getSymbolFilters(symbol);
            const lotSize = filters?.filters.find((f: any) => f.filterType === 'LOT_SIZE');
            const stepSize = parseFloat(lotSize?.stepSize || '0');
            const precision = stepSize > 0 ? Math.max(0, Math.round(-Math.log10(stepSize))) : 8;

            const clientOrderId = `cls-${trade.id.replace(/-/g, '').substring(0, 20)}`;
            const response = await (this.binanceClient as any).restAPI.tradeApi.newOrder({
              symbol,
              side: closeDirection as any,
              type: 'MARKET',
              quantity: (trade.qty || 0).toFixed(precision),
              reduceOnly: true,
              newOrderRespType: 'RESULT',
              newClientOrderId: clientOrderId,
              selfTradePreventionMode: 'EXPIRE_MAKER', // Hardening: Prevent self-trading
            });

            this.updateWeight(response?.headers);
            const orderData = typeof response?.data === 'function' ? await response.data() : (response?.data || response);

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
            // Finding 1: Canonical fill price extraction is cumQuote / executedQty
            let absoluteExitPrice = 0;
            if (orderData.cumQuote && orderData.executedQty) {
               const cumQuote = parseFloat(orderData.cumQuote);
               const executedQty = parseFloat(orderData.executedQty);
               if (executedQty > 0) {
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

            // DATA-CONSISTENCY: Fallback for 0 price responses - Query exchange for authoritative fill price
            if (absoluteExitPrice === 0 && trade.binance_close_order_id) {
               try {
                  this.logger.log(`Binance returned 0 price for ${symbol} exit. Fetching authoritative price via queryOrder...`);
                  const queryRes = await (this.binanceClient as any).restAPI.tradeApi.queryOrder({ symbol, orderId: trade.binance_close_order_id });
                  const queryData = typeof queryRes.data === 'function' ? await queryRes.data() : (queryRes.data || queryRes);
                  absoluteExitPrice = parseFloat(queryData.avgPrice || queryData.price || '0');
                  if (absoluteExitPrice > 0) this.logger.log(`Successfully fetched authoritative exit price: ${absoluteExitPrice}`);
               } catch (queryErr) {
                  this.logger.warn(`Failed to fetch authoritative price for ${symbol}: ${queryErr instanceof Error ? queryErr.message : String(queryErr)}`);
               }
            }

            // FINAL FALLBACK: If still 0, use estimated price
            if (absoluteExitPrice === 0) {
               this.logger.warn(`Authoritative price query failed for ${symbol} exit. Using estimated price ${exitPrice}.`);
               absoluteExitPrice = exitPrice;
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
                  this.logger.log(`[${(trade.id || 'N/A').substring(0, 8)}] Confirmed: ${symbol} position is already zero. Triggering Sync Recovery.`);
                  exitPrice = await this.recoverLastExecutionPrice(symbol, trade, exitPrice);
                  trade.exit_reason = trade.exit_reason === 'EXCHANGE_SYNC' ? 'EXCHANGE_SYNC_RECOVERY' : 'EXCHANGE_SL_OR_MANUAL';
                  // Use actual taker fee rate for live mode recovery
                  const exitFee = roundEight(exitPrice * trade.qty * this.takerFeeRate);
                  trade.realized_fee = roundEight((trade.realized_fee || 0) + exitFee);
               } else {
                  this.logger.warn(`Binance close order failed but position still exists for ${symbol}: ${errMsg}`);
                  throw err;
               }
            } else if (upperMsg.includes('PERCENT_PRICE')) {
               const tip = `The price is currently outside Binance's protection bands. This usually happens during extreme volatility. Manual intervention on Binance website may be required if the engine cannot close the trade.`;
               this.logger.error(`${symbol}: Close failed due to PERCENT_PRICE filter (Attempt ${trade.close_attempts}/${MAX_CLOSE_ATTEMPTS}). ${tip}`);

               if (trade.close_attempts && trade.close_attempts >= MAX_CLOSE_ATTEMPTS) {
                  trade.close_blocked = true;
                  const blockMsg = `CRITICAL: ${symbol} close attempt ceiling reached. Automated closes are now BLOCKED for this symbol. Please intervene manually on Binance.`;
                  this.logger.error(blockMsg);
                  this.eventEmitter.emit(ENGINE_EVENTS.LOG_MESSAGE, { msg: blockMsg, level: 'error' });
               } else {
                  this.eventEmitter.emit(ENGINE_EVENTS.LOG_MESSAGE, { msg: `CRITICAL: ${symbol} close failed (Price Protection). Retrying with backoff.`, level: 'error' });
               }
               throw err;
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

      const finalGrossPnl = finalPnlPoints * (trade.qty || 0);
      const finalNetPnl = finalGrossPnl - (trade.realized_fee || 0) - (trade.funding_fee || 0);

      // DATA-CONSISTENCY: pnl_pct now reflects Net PnL relative to notional value
      const notional = trade.entry_price * (trade.qty || 0);
      const finalPnlPct = (notional !== 0) ? (finalNetPnl / notional) * 100 : 0;
      trade.pnl_pct = roundEight(Number.isFinite(finalPnlPct) ? finalPnlPct : 0);

      this.logger.log(`[PnL Calculation] ${symbol}: ${trade.direction} Exit=${exitPrice}, Entry=${trade.entry_price}, Qty=${trade.qty}, Gross=${finalGrossPnl.toFixed(4)}, Fee=${trade.realized_fee?.toFixed(4)}, Net=${finalNetPnl.toFixed(4)}`);

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
