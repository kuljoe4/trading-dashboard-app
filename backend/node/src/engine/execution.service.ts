import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { Trade } from '../models/Trade';
import { SessionConfig } from '../models/SessionConfig';
import { TickerCacheService } from './ticker_cache.service';
import { KlineStoreService } from './kline_store.service';
import { SignalEngineService } from './signalEngine';
import { RiskEngineService } from './riskEngine';
import { PositionTrackerService } from './positionTracker';
import { OrderManagerService } from './orderManager';
import { SessionStateService } from './session_state.service';
import { GatingService } from './gating.service';
import { BroadcastService } from './broadcast.service';
import { EngineBroadcasterService } from './engine-broadcaster.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ENGINE_EVENTS } from './events';
import { AnalyticsService } from './analytics.service';
import { v4 as uuid } from 'uuid';
import { roundTo, roundEight } from '../lib/math';
import { ExecutionStatus } from '../models/ExecutionResult';

@Injectable()
export class ExecutionService {
  private readonly logger = new Logger(ExecutionService.name);
  // BOLT: Mode-aware cooldowns to ensure Live mode failures don't block Paper mode testing
  private entryCooldowns: Map<string, number> = new Map();

  constructor(
    private readonly tickerCache: TickerCacheService,
    private readonly klineStore: KlineStoreService,
    private readonly signalEngine: SignalEngineService,
    private readonly riskEngine: RiskEngineService,
    @Inject(forwardRef(() => PositionTrackerService))
    private readonly positionTracker: PositionTrackerService,
    @Inject(forwardRef(() => OrderManagerService))
    private readonly orderManager: OrderManagerService,
    private readonly sessionState: SessionStateService,
    private readonly gatingService: GatingService,
    private readonly broadcastService: BroadcastService,
    private readonly engineBroadcaster: EngineBroadcasterService,
    private readonly eventEmitter: EventEmitter2,
    private readonly analyticsService: AnalyticsService,
  ) {}

  public setCooldown(symbol: string, mode: string, minutes: number) {
    this.entryCooldowns.set(`${mode}:${symbol}`, Date.now() + minutes * 60 * 1000);
  }

  async checkExits(config: SessionConfig, onTradeUpdate?: (t: Trade, b: number) => Promise<void>) {
    if (this.positionTracker.activeCount() === 0) return;
    const activeTrades = this.positionTracker.activeList();
    const balance = this.sessionState.getBalance(config.paper_mode ?? true);

    for (const trade of activeTrades) {
      try {
        // SRE-01: Skip blocked trades in the normal exit loop to save CPU and avoid alert spam.
        // Blocked trades require manual intervention on the exchange.
        if (trade.close_blocked) continue;

        const currentPrice = this.tickerCache.getPrice(trade.symbol);
        if (!currentPrice) continue;

        const tradeConfig = { ...config, ...(trade.strategy_config || {}) } as SessionConfig;
        await this.positionTracker.checkRrSequenceAdjustments(trade.symbol, currentPrice, tradeConfig);

        const exitInterval = tradeConfig.scan_interval || '1m';
        const exitCondition = this.positionTracker.checkExitConditions(trade.symbol, currentPrice, tradeConfig, exitInterval);

        if (exitCondition?.exitOccurred) {
          const result = await this.positionTracker.closeTrade(trade.symbol, currentPrice, exitCondition.exitReason, tradeConfig);
          if (result.closeBlocked) {
            this.broadcastService.broadcast('alert', {
               level: 'error',
               title: 'Close Blocked',
               message: `CRITICAL: ${trade.symbol} close attempts exhausted. Automated closes are BLOCKED. Manual intervention required.`,
               symbol: trade.symbol
            });
          }
          if (result.exitOccurred && result.trade) {
            const closedTrade = result.trade;
            this.sessionState.updateStatsOnClose((closedTrade.pnl || 0) > 0, closedTrade.pnl || 0, closedTrade.is_reconciliation);

            this.sessionState.addClosedTrade(closedTrade);
            this.sessionState.setActiveTrades(this.positionTracker.activeList());
            this.eventEmitter.emit(ENGINE_EVENTS.WATCHLIST_NEEDS_UPDATE, tradeConfig);

            // SRE: Immediate cooldown on exit (Issue 3). Uses config.min_trade_interval_min || 2m.
            const mode = config.trading_mode || (config.paper_mode ? 'paper' : 'live');
            const cooldownMin = config.min_trade_interval_min || 2;
            this.setCooldown(trade.symbol, mode, cooldownMin);

            const analytics = this.analyticsService.calculateAnalytics(
              this.sessionState.closedTrades as any,
              config.paper_mode ? config.paper_starting_balance : config.live_starting_balance
            );

            this.eventEmitter.emit(ENGINE_EVENTS.RISK_GATES_UPDATED);
            this.broadcastService.broadcast('trade_event', {
              event: 'closed',
              symbol: closedTrade.symbol,
              reason: exitCondition.exitReason,
              trade: this.engineBroadcaster.serializeTrade(closedTrade, config, currentPrice),
              pnl: closedTrade.pnl,
              stats: this.sessionState.stats,
              analytics: {
                maxDrawdown: roundTo(analytics.maxDrawdown, 2),
                maxDrawdownPct: roundTo(analytics.maxDrawdownPct, 2),
                overallWinRate: roundTo(analytics.overallWinRate, 2),
                cumulativePnL: analytics.cumulativePnL.slice(-20).map((p: any) => ({ ...p, pnl: roundTo(p.pnl, 2) })),
              }
            });

            if (onTradeUpdate) await onTradeUpdate(closedTrade, balance);
          }
        }
      } catch (err) {
        this.logger.error(`[${(trade.id || 'N/A').substring(0, 8)}] Critical Error in checkExits for ${trade.symbol}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  async processEntries(opportunities: any[], config: SessionConfig, strategyLabel: string, onTradeUpdate?: (t: Trade, b: number) => Promise<void>) {
    const symbolConfigs = config.single_symbol_configs;
    const symbolConfigMap = (symbolConfigs && symbolConfigs.length > 0) ? new Map(symbolConfigs.map(sc => [sc.symbol, sc])) : null;
    const balance = this.sessionState.getBalance(config.paper_mode ?? true);

    const now = Date.now();
    const maxOpportunities = Math.min(opportunities.length, config.scanner_signal_depth || 10);

    // BOLT: Sequential processing of opportunities ensures that RiskEngine spacing
    // and frequency limits are correctly enforced between each entry.
    let count = 0;
    for (const opp of opportunities) {
      count++;
      this.monitoringService.setLoopStage('EVALUATING', opp.symbol, (count / opportunities.length) * 100);

      // SRE: Global Entry Lock check. If an entry is already in flight, defer all other evaluations
      // until the current one confirms and risk gating state is updated.
      if (this.sessionState.entryInProgress) {
        this.logger.debug(`Entry pipeline locked. Deferring evaluation for ${opp.symbol}.`);
        break; // Exit loop to avoid rapid-fire evaluation spam while locked
      }

      try {
        const rtPos = this.sessionState.realTimePositions.get(opp.symbol);
        const hasExchangePos = rtPos && Math.abs(rtPos.amount) > 0;

        if (this.positionTracker.hasSymbol(opp.symbol) || hasExchangePos) {
          this.logger.debug(`${opp.symbol}: Entry skipped - already in position (Local: ${this.positionTracker.hasSymbol(opp.symbol)}, Exchange: ${!!hasExchangePos}) or entering.`);
          continue;
        }

        const mode = config.trading_mode || (config.paper_mode ? 'paper' : 'live');
        const cooldownKey = `${mode}:${opp.symbol}`;
        const cooldownExpiry = this.entryCooldowns.get(cooldownKey);
        if (cooldownExpiry && now < cooldownExpiry) {
          this.logger.debug(`${opp.symbol}: Entry skipped (${mode}) - symbol is in cooldown for ${Math.ceil((cooldownExpiry - now) / 1000)}s`);
          continue;
        } else if (cooldownExpiry) {
          this.entryCooldowns.delete(cooldownKey);
        }

        const sc = symbolConfigMap?.get(opp.symbol);
        const symbolConfig = (sc?.use_custom_config && sc.custom_config) ? { ...config, ...sc.custom_config } as SessionConfig : config;

        // "After Opportunity" timing check:
        // If timing is 'after_opportunity', the momentum event must have happened in the PREVIOUS candle.
        if (symbolConfig.engulfing_timing === 'after_opportunity') {
           const candles = this.klineStore.getRawCandles(opp.symbol, symbolConfig.scan_interval || '1m');
           if (candles.length < 2) continue;

           const prevCandle = candles[candles.length - 2];
           const prevPrevCandle = candles[candles.length - 3];
           if (!prevPrevCandle) continue;

           const prevMomentum = ((prevCandle.close - prevPrevCandle.close) / prevPrevCandle.close) * 100;
           const threshold = symbolConfig.scan_pct_threshold ?? 0;
           const momentumMatched = opp.direction === 'LONG' ? prevMomentum >= threshold : prevMomentum <= -threshold;

           if (!momentumMatched) {
             this.logger.debug(`${opp.symbol}: After-Opp Timing failed. Previous candle did not match momentum threshold.`);
             continue;
           }
        }

        // BOLT OPTIMIZATION: Enable minimal mode (6th arg) to trigger early-return in signal engine.
        // This avoids expensive metadata/description construction during the high-frequency entry scan.
        const signalResult = this.signalEngine.checkEntry(opp.symbol, config, config.scan_interval || '1m', opp.direction.toUpperCase() as any, 'entry', true);
        if (!signalResult.allFired) {
          if (signalResult.reason.includes('warm-up')) {
            this.logger.debug(`${opp.symbol}: Entry blocked - ${signalResult.reason}`);
          }
          continue;
        }

        this.monitoringService.setLoopStage('RISK_CHECK', opp.symbol);
        const activeTrades = this.positionTracker.activeList();
        const enteringCount = this.positionTracker.enteringCount();
        const riskResult = this.riskEngine.canEnter(activeTrades, this.sessionState.closedTrades, balance, opp.symbol, symbolConfig, this.positionTracker.totalRisk(), enteringCount, opp.score);

        if (!riskResult.canEnter) {
          if (riskResult.reason.includes('Max open trades')) {
             this.logger.debug(`${opp.symbol}: Entry skipped - ${riskResult.reason}`);
          }

          if (!riskResult.reason.includes('Max open trades for')) {
            this.sessionState.gateState = this.gatingService.mapGateState(riskResult.reason);
            this.broadcastService.broadcast('gate', {
              gateState: this.sessionState.gateState,
              reason: riskResult.reason,
              scannerPaused: this.sessionState.gateState === 'max_trades' || this.sessionState.gateState === 'sl_guard' || this.sessionState.gateState === 'max_trades_period' || this.sessionState.paused
            });
          }
          continue;
        }

        const price = this.tickerCache.getPrice(opp.symbol);
        if (!price) continue;

        const lookback = this.klineStore.getLookbackExtremes(opp.symbol, symbolConfig.sl_lookback_timeframe || '1m', symbolConfig.sl_lookback_period || 20);
        let slPrice = this.riskEngine.computeSl(price, opp.direction.toUpperCase() as any, symbolConfig, lookback.minLow, lookback.maxHigh, opp.symbol);

        const slFiltered = this.orderManager.applyFilters(opp.symbol, slPrice, 1, {
          priceRounding: opp.direction.toUpperCase() === 'LONG' ? 'floor' : 'ceil',
          skipNotionalCheck: true
        });
        slPrice = slFiltered.price;

        const qty = this.riskEngine.computePositionSize(balance, price, slPrice, opp.direction.toUpperCase() as any, symbolConfig, opp.symbol);

        if (qty <= 0) {
          this.logger.debug(`${opp.symbol}: Position size is 0 after SL filtering. SL: ${slPrice}, Entry: ${price}`);
          continue;
        }
        const tpPrice = this.riskEngine.computeTp(price, slPrice, opp.direction.toUpperCase() as any, symbolConfig);

        const reservedRisk = roundEight(Math.abs(price - slPrice) * qty);

        const ticker = this.tickerCache.getTicker(opp.symbol);
        const openPrice = ticker?.open_24h || price;
        const dailyChangeAtEntry = ((price - openPrice) / openPrice) * 100 * (opp.direction.toUpperCase() === 'LONG' ? 1 : -1);

        this.monitoringService.setLoopStage('EXECUTING', opp.symbol);
        this.logger.log(`[Risk Integrity] Reserving ${Number(reservedRisk || 0).toFixed(2)} USDT risk for ${opp.symbol} entry attempt.`);

        // SRE: Lock the entry pipeline before dispatching to Binance
        this.sessionState.entryInProgress = true;
        this.positionTracker.setEntering(opp.symbol, true, reservedRisk);

        try {
          const result = await this.orderManager.enter(
            (this.sessionState.config as any)?.sessionId || uuid().substring(0, 8),
            opp.symbol,
            opp.direction.toUpperCase() as any,
            price,
            qty,
            slPrice,
            tpPrice,
            {
              strategy_label: strategyLabel,
              strategy_config: symbolConfig,
              entry_daily_change_pct: dailyChangeAtEntry
            }
          );

          if (result.status === ExecutionStatus.SUCCESS && result.data) {
            const trade = result.data;
            this.positionTracker.addTrade(trade);
            this.sessionState.updateStatsOnEntry();

            if (onTradeUpdate) {
              await onTradeUpdate(trade, balance);
            }

            this.sessionState.setActiveTrades(this.positionTracker.activeList());
            this.eventEmitter.emit(ENGINE_EVENTS.WATCHLIST_NEEDS_UPDATE, config);

            this.eventEmitter.emit(ENGINE_EVENTS.RISK_GATES_UPDATED);
            this.broadcastService.broadcast('trade_event', {
              event: 'opened',
              symbol: opp.symbol,
              trade: this.engineBroadcaster.serializeTrade(trade, config, price),
              stats: this.sessionState.stats
            });
          } else {
            // Entry failed but didn't throw (e.g. ORDER_REJECTED)
            const cooldownMinutes = 5;
            const mode = config.trading_mode || (config.paper_mode ? 'paper' : 'live');
            this.entryCooldowns.set(`${mode}:${opp.symbol}`, Date.now() + cooldownMinutes * 60 * 1000);
            this.logger.warn(`${opp.symbol}: Entry failed (${mode}) with status ${result.status}. Cooling down for ${cooldownMinutes}m. Error: ${result.error}`);

            this.broadcastService.broadcast('alert', {
              level: 'warn',
              title: 'Entry Failed',
              message: `${opp.symbol}: ${result.error || 'Order rejected by exchange'}. Skipping for ${cooldownMinutes}m.`,
              symbol: opp.symbol
            });
          }
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          this.logger.error(`Failed to process entry for ${opp.symbol}: ${errMsg}`);

          // Also cooldown on exceptions to avoid tight-looping on unexpected errors
          const cooldownMinutes = 2;
          const mode = config.trading_mode || (config.paper_mode ? 'paper' : 'live');
          this.entryCooldowns.set(`${mode}:${opp.symbol}`, Date.now() + cooldownMinutes * 60 * 1000);
        } finally {
          this.positionTracker.setEntering(opp.symbol, false);
          // SRE: Release the entry pipeline lock
          this.sessionState.entryInProgress = false;
        }
      } catch (oppErr) {
        this.logger.error(`Critical Error processing opportunity for ${opp.symbol}: ${oppErr instanceof Error ? oppErr.message : String(oppErr)}`);
      }
    }
  }
}
