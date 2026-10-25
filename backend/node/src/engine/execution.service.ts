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
import { MonitoringService } from './monitoring.service';
import { EngineBroadcasterService } from './engine-broadcaster.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ENGINE_EVENTS } from './events';
import { AnalyticsService } from './analytics.service';
import { MarketFeedService } from './market_feed.service';
import { v4 as uuid } from 'uuid';
import { roundTo, roundEight } from '../lib/math';
import { ExecutionStatus } from '../models/ExecutionResult';

@Injectable()
export class ExecutionService {
  private readonly logger = new Logger(ExecutionService.name);
  // BOLT: Mode-aware cooldowns to ensure Live mode failures don't block Paper mode testing
  private entryCooldowns: Map<string, number> = new Map();
  private consecutiveFailures: Map<string, number> = new Map();
  private loggedAntiWhipsawMap: Map<string, number> = new Map();

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
    private readonly monitoringService: MonitoringService,
    private readonly engineBroadcaster: EngineBroadcasterService,
    private readonly eventEmitter: EventEmitter2,
    private readonly analyticsService: AnalyticsService,
    @Inject(forwardRef(() => MarketFeedService))
    private readonly marketFeedService: MarketFeedService,
  ) {}

  public setCooldown(symbol: string, mode: string, minutes: number) {
    this.entryCooldowns.set(`${mode}:${symbol}`, Date.now() + minutes * 60 * 1000);
  }

  private getTimeframeMs(tf: string): number {
    if (!tf) return 60 * 1000;
    const match = tf.toLowerCase().match(/^(\d+)([mhd])$/);
    if (!match) return 60 * 1000;
    const num = parseInt(match[1], 10);
    const unit = match[2];
    if (unit === 'm') return num * 60 * 1000;
    if (unit === 'h') return num * 60 * 60 * 1000;
    if (unit === 'd') return num * 24 * 60 * 60 * 1000;
    return 60 * 1000;
  }

  private lastChecklistLogTs = 0;

  public runPrerequisiteChecklist(config: SessionConfig) {
    const activeTrades = this.positionTracker.activeList();
    if (activeTrades.length === 0) return;

    const now = Date.now();
    const intervalMin = config?.rate_limit_warning_interval_min || 5;
    const intervalMs = Math.max(5, intervalMin) * 60 * 1000;

    // Throttle prerequisite checklist warnings using configured rate_limit_warning_interval_min (default: 5m)
    if (now - this.lastChecklistLogTs < intervalMs) return;
    this.lastChecklistLogTs = now;

    const isLive = !config.paper_mode;
    const isBanned = isLive && (this.sessionState.isBanned() || this.sessionState.isGeoBlocked());

    // 1. Active Ban / Geo-Restriction Checklist Warning
    if (isBanned) {
      const isGeo = this.sessionState.isGeoBlocked();
      const banUntilStr = this.sessionState.apiStatus.banUntil
        ? new Date(this.sessionState.apiStatus.banUntil).toLocaleTimeString()
        : 'unknown';
      const banMsg = isGeo
        ? `⚠️ [Prerequisite Warning] Binance Regional Geo-Restriction (HTTP 451) active! Entries and ratcheting are PAUSED. Configure proxy or switch mode. Active positions: ${activeTrades.map(t => t.symbol).join(', ')}`
        : `⚠️ [Prerequisite Warning] Active Binance IP Ban detected until ${banUntilStr}! Exit monitoring and SL ratcheting are PAUSED in Live/Testnet mode. Active positions: ${activeTrades.map(t => t.symbol).join(', ')}`;
      this.logger.warn(banMsg);
      this.eventEmitter.emit(ENGINE_EVENTS.LOG_MESSAGE, { msg: banMsg, level: 'warn' });
      this.broadcastService.broadcast('alert', {
        level: 'warning',
        title: isGeo ? 'Execution Paused (Geo-Restricted)' : 'Exit Monitoring Paused (IP Ban)',
        message: banMsg,
      });
    }

    // 2. Per-trade Prerequisite Checks
    for (const trade of activeTrades) {
      const activeConfig = { ...config, ...(trade.strategy_config || {}) } as SessionConfig;

      // a) Missing / Zero Stop Loss Warning
      const currentSl = Number(trade.current_sl || trade.sl_price || 0);
      const initialSl = Number(trade.initial_sl || 0);
      if (currentSl <= 0 && initialSl <= 0) {
        const slMsg = `⚠️ [Prerequisite Warning] Active trade ${trade.symbol} (${trade.direction}) has NO valid Stop Loss configured! Position is unprotected against adverse market swings.`;
        this.logger.warn(slMsg);
        this.eventEmitter.emit(ENGINE_EVENTS.LOG_MESSAGE, { msg: slMsg, level: 'warn' });
        this.broadcastService.broadcast('alert', {
          level: 'warning',
          title: 'Unprotected Position',
          message: slMsg,
          symbol: trade.symbol,
        });
      }

      // b) Indicator Warmup / Data Starvation Check for Exit Signals
      const exitSignals = activeConfig.exit_signals || [];
      if (exitSignals.length > 0) {
        const requiredWarmup = this.signalEngine.getRequiredWarmup(activeConfig);
        for (const exitSig of exitSignals) {
          const rawTf = activeConfig.signal_timeframes?.[exitSig];
          const rawExitInterval = (!rawTf || rawTf === 'default') ? (activeConfig.scan_interval || '1m') : rawTf;
          const exitInterval = this.marketFeedService.resolveInterval(rawExitInterval, activeConfig) || '1m';
          const candles = this.klineStore.getRawCandles(trade.symbol, exitInterval);

          if (candles.length < requiredWarmup) {
            const warmupMsg = `⚠️ [Prerequisite Notice] Trade ${trade.symbol}: Exit indicator warmup in progress (${candles.length}/${requiredWarmup} candles for ${exitInterval}). Exit signals (${exitSig}) will NOT fire until candle buffer converges.`;
            this.logger.log(warmupMsg);
            this.eventEmitter.emit(ENGINE_EVENTS.LOG_MESSAGE, { msg: warmupMsg, level: 'info' });
          }
        }
      }

      // c) Disconnected Price Stream Warning
      const currentPrice = this.tickerCache.getPrice(trade.symbol);
      if (!currentPrice || currentPrice <= 0) {
        const streamMsg = `⚠️ [Prerequisite Warning] Trade ${trade.symbol}: Price ticker feed is unavailable/stalled. Real-time exit monitoring for ${trade.symbol} is degraded.`;
        this.logger.warn(streamMsg);
        this.eventEmitter.emit(ENGINE_EVENTS.LOG_MESSAGE, { msg: streamMsg, level: 'warn' });
      }

      // d) Strategy Paused Notice
      const stratLabel = trade.strategy_label || 'Momentum Strategy';
      if (this.sessionState.isStrategyPaused ? this.sessionState.isStrategyPaused(stratLabel) : false) {
        const pauseMsg = `ℹ️ [Prerequisite Notice] Strategy "${stratLabel}" for active trade ${trade.symbol} is PAUSED. New entries are disabled, but exit monitoring & stop loss protection remain active.`;
        this.logger.log(pauseMsg);
        this.eventEmitter.emit(ENGINE_EVENTS.LOG_MESSAGE, { msg: pauseMsg, level: 'info' });
      }
    }
  }

  async checkExits(config: SessionConfig, onTradeUpdate?: (t: Trade, b: number) => Promise<void>) {
    if (this.positionTracker.activeCount() === 0) return;

    // Run Pre-Flight Prerequisite Checklist BEFORE checking exits
    this.runPrerequisiteChecklist(config);

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
        await this.positionTracker.checkKnifeTrailingStop(trade.symbol, currentPrice, tradeConfig);
        await this.positionTracker.checkRrSequenceAdjustments(trade.symbol, currentPrice, tradeConfig);
        await this.positionTracker.checkTrailingStop(trade.symbol, currentPrice, tradeConfig);

        const exitInterval = this.marketFeedService.resolveInterval(tradeConfig.scan_interval || '1m', tradeConfig) || '1m';
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
            this.sessionState.updateStatsOnClose((closedTrade.pnl || 0) > 0, closedTrade.pnl || 0, closedTrade.is_reconciliation, closedTrade.id, closedTrade.strategy_label);

            this.sessionState.addClosedTrade(closedTrade);
            this.sessionState.setActiveTrades(this.positionTracker.activeList());
            this.eventEmitter.emit(ENGINE_EVENTS.WATCHLIST_NEEDS_UPDATE, tradeConfig);

            // SRE: Immediate cooldown on exit strictly per-symbol.
            // Uses max of config.min_trade_interval_min and all active strategy candle timeframe durations (e.g. 60m for 1h candle).
            const mode = config.trading_mode || (config.paper_mode ? 'paper' : 'live');
            let maxTfMs = this.getTimeframeMs(tradeConfig.scan_interval || '1m');
            if (tradeConfig.enabled_signals) {
              for (const sig of tradeConfig.enabled_signals) {
                const tf = tradeConfig.signal_timeframes?.[sig];
                if (tf && tf !== 'default') {
                  const ms = this.getTimeframeMs(tf);
                  if (ms > maxTfMs) maxTfMs = ms;
                }
              }
            }
            const tfCooldownMin = Math.ceil(maxTfMs / (60 * 1000));
            const configuredMin = tradeConfig.min_trade_interval_min || 2;
            const cooldownMin = Math.max(configuredMin, tfCooldownMin);
            this.setCooldown(trade.symbol, mode, cooldownMin);

            const analytics = this.analyticsService.calculateAnalytics(
              this.sessionState.closedTrades as any[],
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

  private lastBanLogTs = 0;



  private toTimestampMs(val: any): number {
    if (!val) return 0;
    if (typeof val === 'number') return val;
    if (val instanceof Date) return val.getTime();
    if (typeof val === 'string') {
      const parsed = Date.parse(val);
      if (!isNaN(parsed)) return parsed;
      const trimmed = val.trim();
      if (!trimmed) return 0;
      const normalized = trimmed.includes(' ') ? trimmed.replace(' ', 'T') : trimmed;
      const iso = (!normalized.endsWith('Z') && !normalized.includes('+') && !normalized.includes(' -')) ? normalized + 'Z' : normalized;
      const parsedFallback = Date.parse(iso);
      return isNaN(parsedFallback) ? 0 : parsedFallback;
    }
    return 0;
  }

  async processEntries(opportunities: any[], config: SessionConfig, strategyLabel: string, onTradeUpdate?: (t: Trade, b: number) => Promise<void>, globalSlGuardOverride?: number) {
    const symbolConfigs = config.single_symbol_configs;
    const symbolConfigMap = (symbolConfigs && symbolConfigs.length > 0) ? new Map(symbolConfigs.map(sc => [sc.symbol, sc])) : null;
    const balance = this.sessionState.getBalance(config.paper_mode ?? true);

    const now = Date.now();

    // BOLT: Global Ban / Geo-Restriction Guard. If the system is banned or geo-blocked, skip processing all entries
    // to save CPU, avoid rejected orders, and fail closed safely.
    if (!config.paper_mode && (this.sessionState.isBanned() || this.sessionState.isGeoBlocked())) {
      if (now - this.lastBanLogTs > 60000) {
        const isGeo = this.sessionState.isGeoBlocked();
        this.logger.warn(`Execution pipeline gated: ${isGeo ? 'Regional Geo-Restriction active (HTTP 451)' : 'Active IP ban detected'}. New entries are blocked.`);
        this.lastBanLogTs = now;
      }
      return;
    }

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

        let currentStrategyLabel = symbolConfig.strategy_label || strategyLabel || 'Momentum Strategy';
        let resolvedConfig = symbolConfig;

        if (opp.strategy_label && opp.strategy_label !== currentStrategyLabel) {
          const variant = (config.strategy_variants || []).find((v: any) => v.strategy_label === opp.strategy_label);
          if (variant) {
            currentStrategyLabel = variant.strategy_label || opp.strategy_label;
            resolvedConfig = {
              ...symbolConfig,
              ...variant,
              signal_params: {
                ...(symbolConfig?.signal_params || {}),
                ...(variant?.signal_params || {}),
              },
            } as SessionConfig;
          }
        }

        // Fast-fail resource optimization: Skip entries if this strategy is paused
        if (this.sessionState.isStrategyPaused ? this.sessionState.isStrategyPaused(currentStrategyLabel) : (this.sessionState.paused || (this.sessionState.pausedStrategies && this.sessionState.pausedStrategies.has(currentStrategyLabel)))) {
          this.logger.debug(`Strategy "${currentStrategyLabel}" is paused. Skipping entries for ${opp.symbol}.`);
          continue;
        }

        // Anti-whipsaw / same-candle re-entry protection
        const uniqueTimeframes = new Set<string>();
        const resolvedScan = this.marketFeedService.resolveInterval(symbolConfig.scan_interval || '1m', symbolConfig);
        if (resolvedScan) uniqueTimeframes.add(resolvedScan);

        if (symbolConfig.enabled_signals) {
          for (const sig of symbolConfig.enabled_signals) {
            const tf = symbolConfig.signal_timeframes?.[sig];
            if (tf && tf !== 'default') {
              const resolvedTf = this.marketFeedService.resolveInterval(tf, symbolConfig);
              if (resolvedTf) uniqueTimeframes.add(resolvedTf);
            }
          }
        }

        // BOLT OPTIMIZATION: Loop-fused anti-whipsaw same-candle re-entry check.
        // Replaces intermediate .filter() array allocation, .some() closure, and redundant new Date() parsing
        // with a single-pass traversal over closedTrades using numeric timestamps.
        const closedTrades = this.sessionState.closedTrades;
        let hasClosedForSymbol = false;

        const symbolClosedTrades = [];
        for (let i = 0; i < closedTrades.length; i++) {
          if (closedTrades[i].symbol === opp.symbol) {
            hasClosedForSymbol = true;
            symbolClosedTrades.push(closedTrades[i]);
          }
        }

        if (hasClosedForSymbol) {
          // Check if candidate opportunity is a knife trade prior to anti-whipsaw checks
          let isCandidateKnife = false;
          if (symbolConfig.anti_whipsaw_allow_knife) {
            try {
              const knifeCheck = this.signalEngine.knifeCatchSignal(
                opp.symbol,
                symbolConfig,
                symbolConfig.scan_interval || '1m',
                opp.direction.toUpperCase() as 'LONG' | 'SHORT',
                'entry',
                undefined,
                true
              );
              isCandidateKnife = typeof knifeCheck === 'boolean' ? knifeCheck : knifeCheck.fired;
            } catch (e) {
              this.logger.debug(`Knife check for anti-whipsaw bypass skipped for ${opp.symbol}: ${e instanceof Error ? e.message : String(e)}`);
            }
          }

          let sameCandleGated = false;
          let gatedTimeframe = '';
          let gateReason = '';



          for (const tf of uniqueTimeframes) {
            const tfCandles = this.klineStore.getRawCandles(opp.symbol, tf);
            const tfDurationMs = this.getTimeframeMs(tf);

            if (tfCandles.length > 0) {
              const currentCandleStart = tfCandles[tfCandles.length - 1].time;

              const candleDelay = symbolConfig.anti_whipsaw_candle_delay ?? 1;
              const tfDelayMin = symbolConfig.anti_whipsaw_tf_delay_min ?? 0;
              const effectiveDelayMs = Math.max(candleDelay * tfDurationMs, tfDelayMin * 60 * 1000);

              if (effectiveDelayMs > 0) {
                const nowMs = Date.now();
                const cooldownMins = Math.ceil(effectiveDelayMs / 60000);

                for (let i = 0; i < symbolClosedTrades.length; i++) {
                  const t = symbolClosedTrades[i];

                  // If anti_whipsaw_allow_knife is active, candidate is knife, and closed trade was a knife trade, bypass gating
                  if (symbolConfig.anti_whipsaw_allow_knife && isCandidateKnife && t.is_knife) {
                    const bypassMsg = `[Anti-Whipsaw Bypass] ${opp.symbol}: Knife re-entry allowed for closed knife trade.`;
                    this.logger.log(bypassMsg);
                    this.eventEmitter.emit(ENGINE_EVENTS.LOG_MESSAGE, { msg: bypassMsg, level: 'info' });
                    this.broadcastService.broadcast('alert', {
                      level: 'info',
                      title: 'Anti-Whipsaw Knife Bypass',
                      message: bypassMsg,
                      symbol: opp.symbol
                    });
                    continue;
                  }

                  if (t.entry_ts) {
                    const entryTsMs = this.toTimestampMs(t.entry_ts);
                    if (entryTsMs > 0 && (entryTsMs >= currentCandleStart || nowMs < entryTsMs + effectiveDelayMs)) {
                      sameCandleGated = true;
                      gatedTimeframe = tf;
                      gateReason = `entered during the current ${tf} candle period`;
                      break;
                    }
                  }

                  if (t.exit_ts) {
                    const exitTsMs = this.toTimestampMs(t.exit_ts);
                    const validExitTsMs = exitTsMs > nowMs ? nowMs : exitTsMs;
                    if (validExitTsMs > 0 && (validExitTsMs >= currentCandleStart || nowMs < validExitTsMs + effectiveDelayMs)) {
                      sameCandleGated = true;
                      gatedTimeframe = tf;
                      gateReason = validExitTsMs >= currentCandleStart
                        ? `exited during the active ${tf} candle`
                        : `exited within the ${cooldownMins}m timeframe cooldown window`;
                      break;
                    }
                  }
                }
              }
              if (sameCandleGated) break;
            }
          }

          if (sameCandleGated) {
            const gateMsg = `[Anti-Whipsaw] ${opp.symbol}: Entry skipped - a trade was already ${gateReason}.`;
            this.logger.debug(gateMsg);

            const nowTs = Date.now();
            const logKey = `${opp.symbol}:${gatedTimeframe}`;
            const lastLoggedExpiry = this.loggedAntiWhipsawMap.get(logKey) || 0;

            if (nowTs > lastLoggedExpiry) {
              // Deduplicate alert & decision log emission once per gating window
              const tfDurationMs = this.getTimeframeMs(gatedTimeframe);
              this.loggedAntiWhipsawMap.set(logKey, nowTs + tfDurationMs);

              this.eventEmitter.emit(ENGINE_EVENTS.LOG_MESSAGE, { msg: gateMsg, level: 'info' });
              this.broadcastService.broadcast('alert', {
                level: 'info',
                title: 'Anti-Whipsaw Protection',
                message: gateMsg,
                symbol: opp.symbol
              });
            }
            continue;
          }
        }

        // "After Opportunity" timing check:
        // If timing is 'after_opportunity', the momentum event must have happened in the PREVIOUS candle.
        // GATED: Only apply if engulfing is actually enabled.
        if (symbolConfig.engulfing_timing === 'after_opportunity' && symbolConfig.enabled_signals?.includes('engulfing')) {
           const scanInterval = this.marketFeedService.resolveInterval(symbolConfig.scan_interval || '1m', symbolConfig) || '1m';
           const candles = this.klineStore.getRawCandles(opp.symbol, scanInterval);
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
        const entryScanInterval = this.marketFeedService.resolveInterval(resolvedConfig.scan_interval || '1m', resolvedConfig) || '1m';
        let signalResult = this.signalEngine.checkEntry(opp.symbol, resolvedConfig, entryScanInterval, opp.direction.toUpperCase() as 'LONG' | 'SHORT', 'entry', true);
        if (!signalResult.allFired) {
          if (signalResult.reason.includes('warm-up')) {
            this.logger.debug(`${opp.symbol}: Entry blocked - ${signalResult.reason}`);
          }
          continue;
        }

        // If signal fired, re-check with minimal=false to get technical details (e.g. engulfing boundaries)
        // required for structural Stop Loss calculations and full telemetry.
        signalResult = this.signalEngine.checkEntry(opp.symbol, resolvedConfig, entryScanInterval, opp.direction.toUpperCase() as 'LONG' | 'SHORT', 'entry', false);

        const price = this.tickerCache.getPrice(opp.symbol);
        if (!price) continue;

        // Apply SL distance pct override if switch mode is active and threshold met
        let effectiveSlDistancePct = symbolConfig.sl_distance_pct;
        if (symbolConfig.tp_mode === 'exp_rr_seq_switch' && symbolConfig.switched_sl_distance_pct && symbolConfig.peak_rr_switch_threshold) {
          const stratLabel = symbolConfig.strategy_label || 'Momentum Strategy';
          const hits = this.positionTracker.peakRrSwitchHits.get(stratLabel) || 0;
          if (hits >= (symbolConfig.peak_rr_switch_count || 1)) {
            effectiveSlDistancePct = symbolConfig.switched_sl_distance_pct;
          }
        }

        // Pass the effective SL distance pct explicitly instead of mutating the config
        const overriddenConfig = { ...symbolConfig, sl_distance_pct: effectiveSlDistancePct };

        const rawSlTimeframe = (!symbolConfig.sl_lookback_timeframe || symbolConfig.sl_lookback_timeframe === 'default')
          ? (symbolConfig.scan_interval || '1m')
          : symbolConfig.sl_lookback_timeframe;
        const slTimeframe = this.marketFeedService.resolveInterval(rawSlTimeframe, symbolConfig) || '5m';
        const lookback = this.klineStore.getLookbackExtremes(opp.symbol, slTimeframe, symbolConfig.sl_lookback_period || 20);

        // Auto-heal missing data chunks if lookback failed due to a time gap, stale data, or too few candles
        if (lookback.reason === 'time_gap' || lookback.reason === 'stale_data' || lookback.reason === 'too_few_candles') {
          this.logger.debug(`[Lookback Auto-heal] Requesting backfill for ${opp.symbol} ${slTimeframe} due to ${lookback.reason}`);
          this.marketFeedService.queueBackfill(opp.symbol, slTimeframe, symbolConfig.sl_lookback_period || 20);
        }

        // Extract engulfing pattern details if available
        const engulfingDetail = signalResult.details?.engulfing;
        const patternLow = engulfingDetail?.pattern_low;
        const patternHigh = engulfingDetail?.pattern_high;
        const bodyLow = engulfingDetail?.body_low;
        const bodyHigh = engulfingDetail?.body_high;

        const supertrendDetail = signalResult.details?.supertrend || signalResult.details?.['exit_supertrend'];
        const supertrendSlPrice = supertrendDetail?.slPrice;
        const macdPbcDetail = signalResult.details?.macd_pbc;
        const macdPbcSlPrice = macdPbcDetail?.slPrice;

        const slResult = this.riskEngine.computeSl(
          price,
          opp.direction.toUpperCase() as 'LONG' | 'SHORT',
          overriddenConfig,
          lookback.minLow,
          lookback.maxHigh,
          opp.symbol,
          patternLow,
          patternHigh,
          bodyLow,
          bodyHigh,
          supertrendSlPrice,
          macdPbcSlPrice
        );

        if (slResult.rejected) {
           this.logger.log(`${opp.symbol}: Entry skipped - ${slResult.reason}`);
           this.broadcastService.broadcast('gate', {
             gateState: 'sl_out_of_bounds',
             reason: slResult.reason,
             scannerPaused: false
           });
           continue;
        }

        let slPrice = slResult.slPrice;
        if (slPrice <= 0) {
           this.logger.warn(`${opp.symbol}: Skip entry opportunity - computed SL price ${slPrice} is non-positive.`);
           continue;
        }

        const slFiltered = this.orderManager.applyFilters(opp.symbol, slPrice, 1, {
          priceRounding: opp.direction.toUpperCase() === 'LONG' ? 'floor' : 'ceil',
          skipNotionalCheck: true
        });

        // Ticking filtering: Reject if a single price tick represents more than 10% of the SL distance
        const tickSize = this.marketFeedService.getSymbolFilters(opp.symbol)?.tickSize || 0;
        const rawSlDistance = Math.abs(price - slPrice);
        if (tickSize > 0 && rawSlDistance > 0 && (tickSize / rawSlDistance) > 0.1) {
           this.logger.debug(`${opp.symbol}: Entry skipped - tick size granularity (${tickSize}) is too large relative to SL distance (${rawSlDistance}).`);
           continue;
        }

        slPrice = slFiltered.price;

        const sizeResult = this.riskEngine.computePositionSize(balance, price, slPrice, opp.direction.toUpperCase() as 'LONG' | 'SHORT', symbolConfig, opp.symbol, closedTrades);

        if (sizeResult.qty <= 0) {
          if (sizeResult.rejected) {
             const rejectMsg = `[Execution] Entry skipped for ${opp.symbol}: ${sizeResult.reason}`;
             this.logger.warn(rejectMsg);
             this.eventEmitter.emit(ENGINE_EVENTS.LOG_MESSAGE, { msg: rejectMsg, level: 'warn' });
             this.broadcastService.broadcast('alert', {
                level: 'warn',
                title: 'Entry Rejected',
                message: rejectMsg,
                symbol: opp.symbol
             });

             this.broadcastService.broadcast('gate', {
               gateState: 'risk_rejected',
               reason: sizeResult.reason,
               scannerPaused: false
             });

             // Telemetry for oversized risk rejections
             this.broadcastService.broadcast('trade_event', {
                event: 'entry_rejected',
                symbol: opp.symbol,
                reason: sizeResult.reason,
                details: { balance, price, sl: slPrice }
             });
          } else {
             this.logger.debug(`${opp.symbol}: Position size is 0 after SL filtering. SL: ${slPrice}, Entry: ${price}`);
          }
          continue;
        }
        const qty = sizeResult.qty;
        const tpPrice = this.riskEngine.computeTp(price, slPrice, opp.direction.toUpperCase() as 'LONG' | 'SHORT', symbolConfig);

        if (tpPrice !== null && tpPrice <= 0) {
           this.logger.warn(`${opp.symbol}: Skip entry opportunity - computed TP price ${tpPrice} is non-positive.`);
           continue;
        }

        const prospectiveRiskUsdt = Math.abs(price - slPrice) * qty;
        const prospectiveRiskPct = balance > 0 ? (prospectiveRiskUsdt / balance) * 100 : 0;

        // BOLT: Fee Drag Gate for Small Accounts
        // Reject entries where the round-trip fee eats a massive chunk of 1R.
        // Assuming ~0.04% taker fee each way -> 0.08% round trip total notional fee.
        const notional = price * qty;
        const estimatedFeeUsdt = notional * 0.0008;
        if (prospectiveRiskUsdt > 0 && (estimatedFeeUsdt / prospectiveRiskUsdt) > 0.05) {
           const feeDragReason = `Fee drag too high (${((estimatedFeeUsdt / prospectiveRiskUsdt) * 100).toFixed(1)}% of 1R risk).`;
           this.logger.debug(`${opp.symbol}: Entry skipped - ${feeDragReason}`);
           continue;
        }

        this.monitoringService.setLoopStage('RISK_CHECK', opp.symbol);
        const activeTrades = this.positionTracker.activeList();
        const enteringCount = this.positionTracker.enteringCount();
        const riskResult = this.riskEngine.canEnter(
          activeTrades,
          this.sessionState.closedTrades,
          balance,
          opp.symbol,
          symbolConfig,
          this.positionTracker.totalRisk(),
          enteringCount,
          opp.score,
          prospectiveRiskPct,
          globalSlGuardOverride
        );

        if (!riskResult.canEnter) {
          // BOLT: Only log symbol-specific rejections as debug.
          // Do NOT update global sessionState.gateState here as it causes log/UI flapping.
          // Global gating is handled by TradingSessionService.refreshRiskGating().
          this.logger.debug(`${opp.symbol}: Entry skipped - ${riskResult.reason}`);
          continue;
        }

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
            this.sessionState.currentSessionId || uuid().substring(0, 8),
            opp.symbol,
            opp.direction.toUpperCase() as 'LONG' | 'SHORT',
            price,
            qty,
            slPrice,
            tpPrice,
            {
              strategy_label: currentStrategyLabel,
              strategy_config: { ...resolvedConfig, ...(sizeResult.isNominalOvershoot ? { is_nominal_overshoot: true } : {}) },
              entry_daily_change_pct: dailyChangeAtEntry,
              entry_reason: signalResult.reason,
              entry_signal_type: signalResult.firedSignals?.join(', ') || 'combo',
              entry_signal_reason: signalResult.reason,
            }
          );

          if (result.status === ExecutionStatus.SUCCESS && result.data) {
            const trade = result.data;

            // Evaluate if entry candle is a knife / velocity burst
            // 1. Direct knife_catch signal check
            let isKnifeTrade = signalResult.firedSignals?.includes('knife_catch') || signalResult.details?.knife_catch?.fired || false;

            // 2. Proactive entry candle ROC check for other entry strategies
            if (!isKnifeTrade) {
              try {
                const knifeRes = this.signalEngine.knifeCatchSignal(
                  opp.symbol,
                  symbolConfig,
                  symbolConfig.scan_interval || '1m',
                  opp.direction.toUpperCase() as 'LONG' | 'SHORT',
                  'entry',
                  undefined,
                  true
                );
                isKnifeTrade = typeof knifeRes === 'boolean' ? knifeRes : knifeRes.fired;
              } catch (e) {
                this.logger.debug(`Proactive knife detection check skipped for ${opp.symbol}: ${e instanceof Error ? e.message : String(e)}`);
              }
            }

            if (isKnifeTrade) {
              trade.is_knife = true;
              this.logger.log(`[Knife Engine] ${opp.symbol} tagged as IS_KNIFE trade on entry. High-frequency velocity trailing & auto-ratchet engaged.`);
            }

            if (sizeResult.martingaleActive) {
              trade.is_martingale = true;
              trade.martingale_multiplier = sizeResult.activeMultiplier;
              trade.martingale_step = sizeResult.consecutiveLosses;
            }

            if (sizeResult.martingaleThresholdReset) {
              trade.martingale_threshold_reset = true;
            }

            this.positionTracker.addTrade(trade);
            this.sessionState.updateStatsOnEntry(trade.id, trade.strategy_label);

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
            // Entry failed but didn't throw (e.g. ORDER_REJECTED or SL_FAILED)
            const mode = config.trading_mode || (config.paper_mode ? 'paper' : 'live');

            // Handle ghost row tracking: If UDS already saved the trade to DB before unwind,
            // we must mark it as ENTRY_FAILED so history & stats ignore it.
            if (result.data) {
              const trade = result.data;
              trade.status = 'ENTRY_FAILED';
              trade.exit_signal_reason = result.error || 'Entry Failed';
              // Update DB
              if (onTradeUpdate) {
                await onTradeUpdate(trade, balance);
              }
            }

            // BOLT: Only apply symbol-specific cooldown if it wasn't a global circuit breaker trip (e.g. ban/weight)
            const isCircuitOpen = result.status === ExecutionStatus.CIRCUIT_OPEN;

            if (isCircuitOpen) {
              this.logger.warn(`${opp.symbol}: Entry blocked (${mode}) due to global circuit breaker (${result.status}). Error: ${result.error}`);
            } else {
              const cooldownKey = `${mode}:${opp.symbol}`;
              const failures = (this.consecutiveFailures.get(cooldownKey) || 0) + 1;
              this.consecutiveFailures.set(cooldownKey, failures);

              let cooldownMinutes = 5;
              if (failures === 2) cooldownMinutes = 15;
              else if (failures >= 3) cooldownMinutes = 60;

              this.entryCooldowns.set(cooldownKey, Date.now() + cooldownMinutes * 60 * 1000);
              this.logger.warn(`${opp.symbol}: Entry failed (${mode}) with status ${result.status}. Consecutive failures: ${failures}. Cooling down for ${cooldownMinutes}m. Error: ${result.error}`);

              this.broadcastService.broadcast('alert', {
                level: 'warn',
                title: 'Entry Failed',
                message: `${opp.symbol}: ${result.error || 'Order rejected by exchange'}. Skipping for ${cooldownMinutes}m.`,
                symbol: opp.symbol
              });
            }
          }

          // Reset consecutive failures on success
          if (result.status === ExecutionStatus.SUCCESS) {
            const mode = config.trading_mode || (config.paper_mode ? 'paper' : 'live');
            this.consecutiveFailures.delete(`${mode}:${opp.symbol}`);
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
