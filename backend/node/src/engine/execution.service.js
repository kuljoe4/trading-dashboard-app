var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
var ExecutionService_1;
import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
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
let ExecutionService = ExecutionService_1 = class ExecutionService {
    tickerCache;
    klineStore;
    signalEngine;
    riskEngine;
    positionTracker;
    orderManager;
    sessionState;
    gatingService;
    broadcastService;
    monitoringService;
    engineBroadcaster;
    eventEmitter;
    analyticsService;
    marketFeedService;
    logger = new Logger(ExecutionService_1.name);
    // BOLT: Mode-aware cooldowns to ensure Live mode failures don't block Paper mode testing
    entryCooldowns = new Map();
    entryCooldownReasons = new Map();
    consecutiveFailures = new Map();
    loggedAntiWhipsawMap = new Map();
    loggedEntrySkipMap = new Map();
    emitEntrySkipLog(symbol, strategyLabel, reasonKey, reasonText, level = 'info', cooldownMs = 60000) {
        const now = Date.now();
        const mapKey = `${strategyLabel}:${symbol}:${reasonKey}`;
        const expiry = this.loggedEntrySkipMap.get(mapKey) || 0;
        if (now < expiry)
            return;
        if (this.loggedEntrySkipMap.size >= 300 && !this.loggedEntrySkipMap.has(mapKey)) {
            for (const [k, exp] of this.loggedEntrySkipMap.entries()) {
                if (exp <= now || this.loggedEntrySkipMap.size >= 300) {
                    this.loggedEntrySkipMap.delete(k);
                }
                if (this.loggedEntrySkipMap.size < 250)
                    break;
            }
        }
        this.loggedEntrySkipMap.set(mapKey, now + cooldownMs);
        const msg = `[Decision] ${symbol} (${strategyLabel}): Entry skipped - ${reasonText}`;
        this.eventEmitter?.emit?.(ENGINE_EVENTS.LOG_MESSAGE, { msg, level, symbol });
    }
    constructor(tickerCache, klineStore, signalEngine, riskEngine, positionTracker, orderManager, sessionState, gatingService, broadcastService, monitoringService, engineBroadcaster, eventEmitter, analyticsService, marketFeedService) {
        this.tickerCache = tickerCache;
        this.klineStore = klineStore;
        this.signalEngine = signalEngine;
        this.riskEngine = riskEngine;
        this.positionTracker = positionTracker;
        this.orderManager = orderManager;
        this.sessionState = sessionState;
        this.gatingService = gatingService;
        this.broadcastService = broadcastService;
        this.monitoringService = monitoringService;
        this.engineBroadcaster = engineBroadcaster;
        this.eventEmitter = eventEmitter;
        this.analyticsService = analyticsService;
        this.marketFeedService = marketFeedService;
    }
    setCooldown(symbol, mode, minutes, strategyLabel, reason) {
        if (!Number.isFinite(minutes) || minutes <= 0)
            return;
        const key = strategyLabel ? `${mode}:${strategyLabel}:${symbol}` : `${mode}:${symbol}`;
        this.entryCooldowns.set(key, Date.now() + minutes * 60 * 1000);
        if (reason) {
            this.entryCooldownReasons.set(key, reason);
        }
        else {
            this.entryCooldownReasons.delete(key);
        }
    }
    getTimeframeMs(tf) {
        if (!tf)
            return 60 * 1000;
        const trimmed = tf.trim();
        const match = trimmed.match(/^(\d+)([mhdwM])$/);
        if (!match)
            return 60 * 1000;
        const num = parseInt(match[1], 10);
        const unit = match[2];
        if (unit === 'm')
            return num * 60 * 1000;
        if (unit === 'h')
            return num * 60 * 60 * 1000;
        if (unit === 'd')
            return num * 24 * 60 * 60 * 1000;
        if (unit === 'w')
            return num * 7 * 24 * 60 * 60 * 1000;
        if (unit === 'M')
            return num * 30 * 24 * 60 * 60 * 1000;
        return 60 * 1000;
    }
    lastChecklistLogTs = 0;
    runPrerequisiteChecklist(config) {
        const activeTrades = this.positionTracker.activeList();
        if (activeTrades.length === 0)
            return;
        const now = Date.now();
        const intervalMin = config?.rate_limit_warning_interval_min || 5;
        const intervalMs = Math.max(5, intervalMin) * 60 * 1000;
        // Throttle prerequisite checklist warnings using configured rate_limit_warning_interval_min (default: 5m)
        if (now - this.lastChecklistLogTs < intervalMs)
            return;
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
            const activeConfig = { ...config, ...(trade.strategy_config || {}) };
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
                        const isShortHistory = typeof this.marketFeedService.isBackfillShortHistory === 'function'
                            && this.marketFeedService.isBackfillShortHistory(trade.symbol, exitInterval);
                        if (!isBanned && !isShortHistory) {
                            this.marketFeedService.queueBackfill(trade.symbol, exitInterval, requiredWarmup);
                        }
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
    async checkExits(config, onTradeUpdate) {
        if (this.positionTracker.activeCount() === 0)
            return;
        // Run Pre-Flight Prerequisite Checklist BEFORE checking exits
        this.runPrerequisiteChecklist(config);
        const activeTrades = this.positionTracker.activeList();
        const balance = this.sessionState.getBalance(config.paper_mode ?? true);
        for (const trade of activeTrades) {
            try {
                // SRE-01: Skip blocked trades in the normal exit loop to save CPU and avoid alert spam.
                // Blocked trades require manual intervention on the exchange.
                if (trade.close_blocked)
                    continue;
                const currentPrice = this.tickerCache.getPrice(trade.symbol);
                if (!currentPrice)
                    continue;
                if (typeof this.klineStore?.syncLivePrice === 'function') {
                    this.klineStore.syncLivePrice(trade.symbol, currentPrice);
                }
                const tradeConfig = { ...config, ...(trade.strategy_config || {}) };
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
                        // Only apply explicit interval cooldown if min_trade_interval_min > 0 (otherwise let Strategy Tab anti-whipsaw govern)
                        const mode = config.trading_mode || (config.paper_mode ? 'paper' : 'live');
                        const configuredMin = Number(tradeConfig.min_trade_interval_min || 0);
                        if (configuredMin > 0) {
                            const scopeLabel = tradeConfig.anti_whipsaw_per_strategy !== false ? trade.strategy_label : undefined;
                            this.setCooldown(trade.symbol, mode, configuredMin, scopeLabel);
                        }
                        const analytics = this.analyticsService.calculateAnalytics(this.sessionState.closedTrades, config.paper_mode ? config.paper_starting_balance : config.live_starting_balance);
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
                                cumulativePnL: analytics.cumulativePnL.slice(-20).map((p) => ({ ...p, pnl: roundTo(p.pnl, 2) })),
                            }
                        });
                        if (onTradeUpdate)
                            await onTradeUpdate(closedTrade, balance);
                    }
                }
            }
            catch (err) {
                this.logger.error(`[${(trade.id || 'N/A').substring(0, 8)}] Critical Error in checkExits for ${trade.symbol}: ${err instanceof Error ? err.message : String(err)}`);
            }
        }
    }
    lastBanLogTs = 0;
    toTimestampMs(val) {
        if (!val)
            return 0;
        if (typeof val === 'number')
            return val < 1e11 ? val * 1000 : val;
        if (val instanceof Date)
            return val.getTime();
        if (typeof val === 'string') {
            const trimmed = val.trim();
            if (!trimmed)
                return 0;
            if (!isNaN(Number(trimmed))) {
                const num = Number(trimmed);
                return num < 1e11 ? num * 1000 : num;
            }
            const parsed = Date.parse(trimmed);
            if (!isNaN(parsed))
                return parsed;
            const normalized = trimmed.includes(' ') ? trimmed.replace(' ', 'T') : trimmed;
            const iso = (!normalized.endsWith('Z') && !normalized.includes('+') && !normalized.includes(' -')) ? normalized + 'Z' : normalized;
            const parsedFallback = Date.parse(iso);
            return isNaN(parsedFallback) ? 0 : parsedFallback;
        }
        return 0;
    }
    async processEntries(opportunities, config, strategyLabel, onTradeUpdate, globalSlGuardOverride) {
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
                    const remSec = Math.ceil((cooldownExpiry - now) / 1000);
                    const triggerReason = this.entryCooldownReasons.get(cooldownKey);
                    const msgSuffix = triggerReason ? ` — ${triggerReason}` : '';
                    this.logger.debug(`${opp.symbol}: Entry skipped (${mode}) - symbol is in cooldown for ${remSec}s${msgSuffix}`);
                    this.emitEntrySkipLog(opp.symbol, strategyLabel || opp.strategy_label || config.strategy_label || 'Momentum Strategy', 'cooldown', `cooldown active (${remSec}s remaining${msgSuffix})`);
                    continue;
                }
                else if (cooldownExpiry) {
                    this.entryCooldowns.delete(cooldownKey);
                    this.entryCooldownReasons.delete(cooldownKey);
                }
                const sc = symbolConfigMap?.get(opp.symbol);
                const symbolConfig = (sc?.use_custom_config && sc.custom_config) ? { ...config, ...sc.custom_config } : config;
                let currentStrategyLabel = symbolConfig.strategy_label || strategyLabel || 'Momentum Strategy';
                let resolvedConfig = symbolConfig;
                if (opp.strategy_label && opp.strategy_label !== currentStrategyLabel) {
                    const variant = (config.strategy_variants || []).find((v) => v.strategy_label === opp.strategy_label);
                    if (variant) {
                        currentStrategyLabel = variant.strategy_label || opp.strategy_label;
                        resolvedConfig = {
                            ...symbolConfig,
                            ...variant,
                            signal_params: {
                                ...(symbolConfig?.signal_params || {}),
                                ...(variant?.signal_params || {}),
                            },
                            signal_timeframes: {
                                ...(symbolConfig?.signal_timeframes || {}),
                                ...(variant?.signal_timeframes || {}),
                            },
                        };
                    }
                }
                const scopedCooldownKey = `${mode}:${currentStrategyLabel}:${opp.symbol}`;
                const scopedCooldownExpiry = this.entryCooldowns.get(scopedCooldownKey);
                if (scopedCooldownExpiry && now < scopedCooldownExpiry) {
                    const remSec = Math.ceil((scopedCooldownExpiry - now) / 1000);
                    const triggerReason = this.entryCooldownReasons.get(scopedCooldownKey);
                    const reasonLabel = triggerReason
                        ? `cooldown active (${remSec}s remaining — ${triggerReason})`
                        : `strategy interval cooldown (${remSec}s remaining)`;
                    this.logger.debug(`${opp.symbol} (${currentStrategyLabel}): Entry skipped (${mode}) - ${reasonLabel}`);
                    this.emitEntrySkipLog(opp.symbol, currentStrategyLabel, triggerReason ? 'cooldown' : 'scoped_cooldown', reasonLabel);
                    continue;
                }
                else if (scopedCooldownExpiry) {
                    this.entryCooldowns.delete(scopedCooldownKey);
                    this.entryCooldownReasons.delete(scopedCooldownKey);
                }
                // Fast-fail resource optimization: Skip entries if this strategy is paused
                if (this.sessionState.isStrategyPaused ? this.sessionState.isStrategyPaused(currentStrategyLabel) : (this.sessionState.paused || (this.sessionState.pausedStrategies && this.sessionState.pausedStrategies.has(currentStrategyLabel)))) {
                    this.logger.debug(`Strategy "${currentStrategyLabel}" is paused. Skipping entries for ${opp.symbol}.`);
                    continue;
                }
                // Enforce allowed entry side ('both' | 'long' | 'short')
                const allowedSide = (resolvedConfig.entry_side || 'both').toLowerCase();
                const oppDirection = (opp.direction || '').toUpperCase();
                if (allowedSide === 'long' && oppDirection !== 'LONG') {
                    this.logger.debug(`${opp.symbol}: Entry skipped - strategy only allows LONG positions (candidate: ${oppDirection})`);
                    this.emitEntrySkipLog(opp.symbol, currentStrategyLabel, 'entry_side', `${oppDirection} disallowed (LONG only)`);
                    continue;
                }
                if (allowedSide === 'short' && oppDirection !== 'SHORT') {
                    this.logger.debug(`${opp.symbol}: Entry skipped - strategy only allows SHORT positions (candidate: ${oppDirection})`);
                    this.emitEntrySkipLog(opp.symbol, currentStrategyLabel, 'entry_side', `${oppDirection} disallowed (SHORT only)`);
                    continue;
                }
                // Anti-whipsaw / same-candle re-entry protection (evaluated against resolvedConfig so variants override base cleanly)
                const uniqueTimeframes = new Set();
                const rawExplicitTfs = Array.isArray(resolvedConfig.anti_whipsaw_timeframes)
                    ? resolvedConfig.anti_whipsaw_timeframes
                    : (typeof resolvedConfig.anti_whipsaw_timeframes === 'string'
                        ? String(resolvedConfig.anti_whipsaw_timeframes).split(',').map(s => s.trim()).filter(Boolean)
                        : []);
                if (rawExplicitTfs.length > 0) {
                    for (const rawTf of rawExplicitTfs) {
                        const resolved = this.marketFeedService.resolveInterval(rawTf, resolvedConfig);
                        if (resolved)
                            uniqueTimeframes.add(resolved);
                    }
                }
                else {
                    const resolvedScan = this.marketFeedService.resolveInterval(resolvedConfig.scan_interval || '1m', resolvedConfig);
                    if (resolvedScan)
                        uniqueTimeframes.add(resolvedScan);
                    const maxTf = resolvedConfig.anti_whipsaw_max_tf || '4h';
                    const maxTfMs = maxTf === 'none' ? Infinity : this.getTimeframeMs(maxTf);
                    if (resolvedConfig.enabled_signals) {
                        for (const sig of resolvedConfig.enabled_signals) {
                            const tf = resolvedConfig.signal_timeframes?.[sig];
                            if (tf && tf !== 'default') {
                                const resolvedTf = this.marketFeedService.resolveInterval(tf, resolvedConfig);
                                if (resolvedTf) {
                                    const tfMs = this.getTimeframeMs(resolvedTf);
                                    // Exclude timeframes exceeding max anti-whipsaw cap (default: '4h') unless explicitly specified
                                    if (tfMs <= maxTfMs) {
                                        uniqueTimeframes.add(resolvedTf);
                                    }
                                }
                            }
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
                    const t = closedTrades[i];
                    if (t && t.symbol === opp.symbol) {
                        const status = t.status;
                        const isFailedOrCancelled = status === 'ENTRY_FAILED' || status === 'CANCELLED' || status === 'REJECTED' || Boolean(t.is_reconciliation);
                        const isDifferentStrategy = Boolean((resolvedConfig.anti_whipsaw_per_strategy !== false) && t.strategy_label && t.strategy_label !== currentStrategyLabel);
                        if (!isFailedOrCancelled && !isDifferentStrategy) {
                            hasClosedForSymbol = true;
                            symbolClosedTrades.push(t);
                        }
                    }
                }
                const candleDelay = Math.max(0, Number(resolvedConfig.anti_whipsaw_candle_delay ?? 1));
                const tfDelayMin = Math.max(0, Number(resolvedConfig.anti_whipsaw_tf_delay_min ?? 0));
                if (hasClosedForSymbol && (candleDelay > 0 || tfDelayMin > 0)) {
                    // Check if candidate opportunity is a knife trade prior to anti-whipsaw checks
                    let isCandidateKnife = false;
                    if (resolvedConfig.anti_whipsaw_allow_knife) {
                        try {
                            const knifeCheck = this.signalEngine.knifeCatchSignal(opp.symbol, resolvedConfig, resolvedConfig.scan_interval || '1m', opp.direction.toUpperCase(), 'entry', undefined, true);
                            isCandidateKnife = typeof knifeCheck === 'boolean' ? knifeCheck : knifeCheck.fired;
                        }
                        catch (e) {
                            this.logger.debug(`Knife check for anti-whipsaw bypass skipped for ${opp.symbol}: ${e instanceof Error ? e.message : String(e)}`);
                        }
                    }
                    let sameCandleGated = false;
                    let gatedTimeframe = '';
                    let gateReason = '';
                    const nowMs = Date.now();
                    const tfDelayMs = tfDelayMin * 60 * 1000;
                    for (const tf of uniqueTimeframes) {
                        const tfCandles = this.klineStore.getRawCandles(opp.symbol, tf);
                        const tfDurationMs = this.getTimeframeMs(tf);
                        const wallCandleStart = Math.floor(nowMs / tfDurationMs) * tfDurationMs;
                        let currentCandleStart = wallCandleStart;
                        if (tfCandles.length > 0) {
                            const rawLastCandleTime = Number(tfCandles[tfCandles.length - 1].time || 0);
                            currentCandleStart = rawLastCandleTime > 1e11
                                ? Math.max(rawLastCandleTime, wallCandleStart)
                                : rawLastCandleTime;
                        }
                        const candleGateStart = candleDelay > 0
                            ? currentCandleStart - (candleDelay - 1) * tfDurationMs
                            : Infinity;
                        for (let i = 0; i < symbolClosedTrades.length; i++) {
                            const t = symbolClosedTrades[i];
                            // If anti_whipsaw_allow_knife is active, candidate is knife, and closed trade was a knife trade, bypass gating
                            if (resolvedConfig.anti_whipsaw_allow_knife && isCandidateKnife && t.is_knife) {
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
                            const rawEntryTs = t.entry_ts || t.opened_at || t.timestamp || t.created_at;
                            if (rawEntryTs) {
                                const entryTsMs = this.toTimestampMs(rawEntryTs);
                                const isSameCandle = candleDelay > 0 && entryTsMs >= candleGateStart;
                                const isInTimeDelay = tfDelayMs > 0 && nowMs < entryTsMs + tfDelayMs;
                                if (entryTsMs > 0 && entryTsMs <= nowMs + 60000 && (isSameCandle || isInTimeDelay)) {
                                    sameCandleGated = true;
                                    gatedTimeframe = tf;
                                    gateReason = isSameCandle
                                        ? (candleDelay > 1
                                            ? `entered within the last ${candleDelay} ${tf} candle periods`
                                            : `entered during the current ${tf} candle period`)
                                        : `entered within the ${tfDelayMin}m cooldown window`;
                                    break;
                                }
                            }
                            const rawExitTs = t.exit_ts || t.closed_at;
                            if (rawExitTs) {
                                const exitTsMs = this.toTimestampMs(rawExitTs);
                                const validExitTsMs = exitTsMs > nowMs ? nowMs : exitTsMs;
                                const isSameCandle = candleDelay > 0 && validExitTsMs >= candleGateStart;
                                const isInTimeDelay = tfDelayMs > 0 && nowMs < validExitTsMs + tfDelayMs;
                                if (validExitTsMs > 0 && (isSameCandle || isInTimeDelay)) {
                                    sameCandleGated = true;
                                    gatedTimeframe = tf;
                                    gateReason = isSameCandle
                                        ? (candleDelay > 1
                                            ? `exited within the last ${candleDelay} ${tf} candle periods`
                                            : `exited during the active ${tf} candle`)
                                        : `exited within the ${tfDelayMin}m timeframe cooldown window`;
                                    break;
                                }
                            }
                        }
                        if (sameCandleGated)
                            break;
                    }
                    if (sameCandleGated) {
                        const gateMsg = `[Anti-Whipsaw] ${opp.symbol} (${currentStrategyLabel}): Entry skipped - a trade was already ${gateReason}.`;
                        this.logger.debug(gateMsg);
                        const nowTs = Date.now();
                        const logKey = `${currentStrategyLabel}:${opp.symbol}:${gatedTimeframe}`;
                        const lastLoggedExpiry = this.loggedAntiWhipsawMap.get(logKey) || 0;
                        if (nowTs > lastLoggedExpiry) {
                            // Deduplicate alert & decision log emission once per gating window
                            const dedupeDurationMs = tfDelayMs > 0 && candleDelay === 0 ? tfDelayMs : this.getTimeframeMs(gatedTimeframe);
                            this.loggedAntiWhipsawMap.set(logKey, nowTs + dedupeDurationMs);
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
                if (resolvedConfig.engulfing_timing === 'after_opportunity' && resolvedConfig.enabled_signals?.includes('engulfing')) {
                    const scanInterval = this.marketFeedService.resolveInterval(resolvedConfig.scan_interval || '1m', resolvedConfig) || '1m';
                    const candles = this.klineStore.getRawCandles(opp.symbol, scanInterval);
                    if (candles.length < 2)
                        continue;
                    const prevCandle = candles[candles.length - 2];
                    const prevPrevCandle = candles[candles.length - 3];
                    if (!prevPrevCandle)
                        continue;
                    const prevMomentum = ((prevCandle.close - prevPrevCandle.close) / prevPrevCandle.close) * 100;
                    const threshold = resolvedConfig.scan_pct_threshold ?? 0;
                    const momentumMatched = opp.direction === 'LONG' ? prevMomentum >= threshold : prevMomentum <= -threshold;
                    if (!momentumMatched) {
                        this.logger.debug(`${opp.symbol}: After-Opp Timing failed. Previous candle did not match momentum threshold.`);
                        this.emitEntrySkipLog(opp.symbol, currentStrategyLabel, 'after_opp', `previous candle did not match ±${threshold}% threshold for after_opportunity timing`);
                        continue;
                    }
                }
                // BOLT OPTIMIZATION: Enable minimal mode (6th arg) to trigger early-return in signal engine.
                // This avoids expensive metadata/description construction during the high-frequency entry scan.
                const entryScanInterval = this.marketFeedService.resolveInterval(resolvedConfig.scan_interval || '1m', resolvedConfig) || '1m';
                let signalResult = this.signalEngine.checkEntry(opp.symbol, resolvedConfig, entryScanInterval, opp.direction.toUpperCase(), 'entry', true);
                if (!signalResult.allFired) {
                    if (signalResult.reason.includes('warm-up')) {
                        this.logger.debug(`${opp.symbol}: Entry blocked - ${signalResult.reason}`);
                        this.emitEntrySkipLog(opp.symbol, currentStrategyLabel, 'warmup', signalResult.reason, 'info', 120000);
                    }
                    continue;
                }
                // If signal fired, re-check with minimal=false to get technical details (e.g. engulfing boundaries)
                // required for structural Stop Loss calculations and full telemetry.
                signalResult = this.signalEngine.checkEntry(opp.symbol, resolvedConfig, entryScanInterval, opp.direction.toUpperCase(), 'entry', false);
                const price = this.tickerCache.getPrice(opp.symbol);
                if (!price)
                    continue;
                // Apply SL distance pct override if switch mode is active and threshold met
                let effectiveSlDistancePct = resolvedConfig.sl_distance_pct;
                if (resolvedConfig.tp_mode === 'exp_rr_seq_switch' && resolvedConfig.switched_sl_distance_pct && resolvedConfig.peak_rr_switch_threshold) {
                    const stratLabel = resolvedConfig.strategy_label || 'Momentum Strategy';
                    const hits = this.positionTracker.peakRrSwitchHits.get(stratLabel) || 0;
                    if (hits >= (resolvedConfig.peak_rr_switch_count || 1)) {
                        effectiveSlDistancePct = resolvedConfig.switched_sl_distance_pct;
                    }
                }
                // Pass the effective SL distance pct explicitly instead of mutating the config
                const overriddenConfig = { ...resolvedConfig, sl_distance_pct: effectiveSlDistancePct };
                const rawSlTimeframe = (!resolvedConfig.sl_lookback_timeframe || resolvedConfig.sl_lookback_timeframe === 'default')
                    ? (resolvedConfig.scan_interval || '1m')
                    : resolvedConfig.sl_lookback_timeframe;
                const slTimeframe = this.marketFeedService.resolveInterval(rawSlTimeframe, resolvedConfig) || '5m';
                const includeForming = Boolean(resolvedConfig.sl_include_forming_candle);
                let lookback = this.klineStore.getLookbackExtremes(opp.symbol, slTimeframe, lookbackPeriod, includeForming);
                // Auto-heal missing data chunks if lookback failed due to a time gap, stale data, or too few candles
                if ((lookback.reason || lookback.minLow <= 0) && !(this.sessionState.isBanned() || this.sessionState.isGeoBlocked())) {
                    this.logger.debug(`[Lookback Auto-heal] Ensuring klines available for ${opp.symbol} ${slTimeframe} due to reason: ${lookback.reason || 'minLow <= 0'}`);
                    await this.marketFeedService.ensureKlinesAvailable(opp.symbol, slTimeframe, Math.max(lookbackPeriod + 2, 20));
                    lookback = this.klineStore.getLookbackExtremes(opp.symbol, slTimeframe, lookbackPeriod, includeForming);
                }
                // Extract structural pattern details if available (engulfing, macd_pbc, etc.)
                const engulfingDetail = signalResult.details?.engulfing;
                const macdPbcKey = Object.keys(signalResult.details || {}).find(k => k === 'macd_pbc' || k.startsWith('macd_pbc_'));
                const macdPbcDetail = macdPbcKey ? signalResult.details?.[macdPbcKey] : undefined;
                const patternLow = engulfingDetail?.pattern_low ?? macdPbcDetail?.pattern_low;
                const patternHigh = engulfingDetail?.pattern_high ?? macdPbcDetail?.pattern_high;
                const bodyLow = engulfingDetail?.body_low ?? macdPbcDetail?.body_low;
                const bodyHigh = engulfingDetail?.body_high ?? macdPbcDetail?.body_high;
                const supertrendDetail = signalResult.details?.supertrend || signalResult.details?.['exit_supertrend'];
                const supertrendSlPrice = supertrendDetail?.slPrice;
                const macdPbcSlPrice = macdPbcDetail?.slPrice;
                const slResult = this.riskEngine.computeSl(price, opp.direction.toUpperCase(), overriddenConfig, lookback.minLow, lookback.maxHigh, opp.symbol, patternLow, patternHigh, bodyLow, bodyHigh, supertrendSlPrice, macdPbcSlPrice);
                if (slResult.rejected) {
                    this.logger.log(`${opp.symbol}: Entry skipped - ${slResult.reason}`);
                    this.emitEntrySkipLog(opp.symbol, currentStrategyLabel, 'sl_rejected', slResult.reason || 'SL out of bounds', 'warn');
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
                    this.emitEntrySkipLog(opp.symbol, currentStrategyLabel, 'sl_zero', `computed SL price ${slPrice} is non-positive`, 'warn');
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
                    this.emitEntrySkipLog(opp.symbol, currentStrategyLabel, 'tick_size', `tick size (${tickSize}) > 10% of SL distance`);
                    continue;
                }
                slPrice = slFiltered.price;
                const sizeResult = this.riskEngine.computePositionSize(balance, price, slPrice, opp.direction.toUpperCase(), resolvedConfig, opp.symbol, closedTrades);
                if (sizeResult.qty <= 0) {
                    if (sizeResult.rejected) {
                        const rejectMsg = `[Execution] ${opp.symbol} (${currentStrategyLabel}): Entry skipped - ${sizeResult.reason}`;
                        this.logger.warn(rejectMsg);
                        this.emitEntrySkipLog(opp.symbol, currentStrategyLabel, 'risk_size_rejected', sizeResult.reason || 'position sizing rejected', 'warn');
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
                    }
                    else {
                        this.logger.debug(`${opp.symbol}: Position size is 0 after SL filtering. SL: ${slPrice}, Entry: ${price}`);
                        this.emitEntrySkipLog(opp.symbol, currentStrategyLabel, 'qty_zero', `position size rounded to 0 (SL: ${slPrice}, Entry: ${price})`);
                    }
                    continue;
                }
                const qty = sizeResult.qty;
                const tpPrice = this.riskEngine.computeTp(price, slPrice, opp.direction.toUpperCase(), resolvedConfig);
                if (tpPrice !== null && tpPrice <= 0) {
                    this.logger.warn(`${opp.symbol}: Skip entry opportunity - computed TP price ${tpPrice} is non-positive.`);
                    this.emitEntrySkipLog(opp.symbol, currentStrategyLabel, 'tp_zero', `computed TP price ${tpPrice} is non-positive`, 'warn');
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
                    this.emitEntrySkipLog(opp.symbol, currentStrategyLabel, 'fee_drag', feeDragReason);
                    continue;
                }
                this.monitoringService.setLoopStage('RISK_CHECK', opp.symbol);
                const activeTrades = this.positionTracker.activeList();
                const enteringCount = this.positionTracker.enteringCount();
                const riskResult = this.riskEngine.canEnter(activeTrades, this.sessionState.closedTrades, balance, opp.symbol, resolvedConfig, this.positionTracker.totalRisk(), enteringCount, opp.score, prospectiveRiskPct, globalSlGuardOverride);
                if (!riskResult.canEnter) {
                    // BOLT: Only log symbol-specific rejections as debug.
                    // Do NOT update global sessionState.gateState here as it causes log/UI flapping.
                    // Global gating is handled by TradingSessionService.refreshRiskGating().
                    this.logger.debug(`${opp.symbol}: Entry skipped - ${riskResult.reason}`);
                    this.emitEntrySkipLog(opp.symbol, currentStrategyLabel, 'risk_gate', riskResult.reason || 'risk gate rejected');
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
                // Extract trigger candle metrics for trigger_candle_exit / reference
                let triggerCandleLow;
                let triggerCandleHigh;
                let triggerCandleOpen;
                let triggerCandleClose;
                let triggerCandleTime;
                let triggerCandleTf = resolvedConfig.htf_breakout_trigger_timeframe || resolvedConfig.trigger_candle_exit_timeframe || resolvedConfig.scan_interval || '1h';
                if (triggerCandleTf === 'default')
                    triggerCandleTf = resolvedConfig.scan_interval || '1h';
                const htfDetails = signalResult.details?.htf_breakout?.details || signalResult.details?.prev_day_breakout?.details;
                if (htfDetails && htfDetails.trigger_candle_low !== undefined) {
                    triggerCandleLow = htfDetails.trigger_candle_low;
                    triggerCandleHigh = htfDetails.trigger_candle_high;
                    triggerCandleOpen = htfDetails.trigger_candle_open;
                    triggerCandleClose = htfDetails.trigger_candle_close;
                    triggerCandleTime = htfDetails.trigger_candle_time;
                }
                else {
                    // General fallback: fetch candles on the trigger timeframe
                    const triggerCandles = this.klineStore?.getRawCandles(opp.symbol, triggerCandleTf) || [];
                    if (triggerCandles.length > 0) {
                        const lastCandle = triggerCandles[triggerCandles.length - 1];
                        const completedCandle = triggerCandles.length > 1 ? triggerCandles[triggerCandles.length - 2] : lastCandle;
                        triggerCandleLow = completedCandle.low;
                        triggerCandleHigh = completedCandle.high;
                        triggerCandleOpen = completedCandle.open;
                        triggerCandleClose = completedCandle.close;
                        triggerCandleTime = completedCandle.time;
                    }
                }
                try {
                    const result = await this.orderManager.enter(this.sessionState.currentSessionId || uuid().substring(0, 8), opp.symbol, opp.direction.toUpperCase(), price, qty, slPrice, tpPrice, {
                        strategy_label: currentStrategyLabel,
                        strategy_config: { ...resolvedConfig, ...(sizeResult.isNominalOvershoot ? { is_nominal_overshoot: true } : {}) },
                        entry_daily_change_pct: dailyChangeAtEntry,
                        entry_reason: signalResult.reason,
                        entry_signal_type: signalResult.firedSignals?.join(', ') || 'combo',
                        entry_signal_reason: signalResult.reason,
                        entry_signal_snapshot: {
                            captured_at_ms: Date.now(),
                            symbol: opp.symbol,
                            direction: opp.direction.toUpperCase(),
                            candidate_price: price,
                            candidate_momentum: opp.momentum,
                            candidate_score: opp.score,
                            breakout_rank: opp.breakout_rank,
                            cap_respected: opp.breakout_rank ? opp.breakout_rank.status !== 'past_cap' : undefined,
                            config: {
                                scan_interval: resolvedConfig.scan_interval,
                                scan_pct_threshold: resolvedConfig.scan_pct_threshold,
                                scan_lookback: resolvedConfig.scan_lookback,
                                entry_side: resolvedConfig.entry_side,
                                enabled_signals: resolvedConfig.enabled_signals,
                                required_signals: resolvedConfig.required_signals,
                                signal_logic: resolvedConfig.signal_logic,
                                signal_timeframes: resolvedConfig.signal_timeframes,
                                signal_params: resolvedConfig.signal_params,
                                htf_breakout_ref_timeframe: resolvedConfig.htf_breakout_ref_timeframe,
                                htf_breakout_trigger_timeframe: resolvedConfig.htf_breakout_trigger_timeframe,
                                htf_breakout_lookback: resolvedConfig.htf_breakout_lookback,
                                htf_breakout_mode: resolvedConfig.htf_breakout_mode,
                                htf_breakout_reference_level: resolvedConfig.htf_breakout_reference_level,
                                htf_breakout_buffer_pct: resolvedConfig.htf_breakout_buffer_pct,
                                htf_breakout_max_expansion_pct: resolvedConfig.htf_breakout_max_expansion_pct,
                            },
                            signalResult: {
                                allFired: signalResult.allFired,
                                firedSignals: signalResult.firedSignals || [],
                                reason: signalResult.reason,
                                signals: signalResult.details || {},
                            },
                        },
                        trigger_candle_low: triggerCandleLow,
                        trigger_candle_high: triggerCandleHigh,
                        trigger_candle_open: triggerCandleOpen,
                        trigger_candle_close: triggerCandleClose,
                        trigger_candle_time: triggerCandleTime,
                        trigger_candle_timeframe: triggerCandleTf,
                    });
                    if (result.status === ExecutionStatus.SUCCESS && result.data) {
                        const trade = result.data;
                        // Evaluate if entry candle is a knife / velocity burst
                        // 1. Direct knife_catch signal check
                        let isKnifeTrade = signalResult.firedSignals?.includes('knife_catch') || signalResult.details?.knife_catch?.fired || false;
                        // 2. Proactive entry candle ROC check for other entry strategies
                        if (!isKnifeTrade) {
                            try {
                                const knifeRes = this.signalEngine.knifeCatchSignal(opp.symbol, resolvedConfig, resolvedConfig.scan_interval || '1m', opp.direction.toUpperCase(), 'entry', undefined, true);
                                isKnifeTrade = typeof knifeRes === 'boolean' ? knifeRes : knifeRes.fired;
                            }
                            catch (e) {
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
                    }
                    else {
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
                            this.emitEntrySkipLog(opp.symbol, currentStrategyLabel, 'circuit_open', `entry blocked by global circuit breaker (${result.error || result.status})`, 'warn');
                        }
                        else {
                            const failureKey = `${mode}:${currentStrategyLabel}:${opp.symbol}`;
                            const failures = (this.consecutiveFailures.get(failureKey) || 0) + 1;
                            this.consecutiveFailures.set(failureKey, failures);
                            let cooldownMinutes = 5;
                            if (failures === 2)
                                cooldownMinutes = 15;
                            else if (failures >= 3)
                                cooldownMinutes = 60;
                            const failReason = String(result.error || result.status || 'Order rejected by exchange').slice(0, 140);
                            this.entryCooldowns.set(failureKey, Date.now() + cooldownMinutes * 60 * 1000);
                            this.entryCooldownReasons.set(failureKey, `prior entry failed: ${failReason}`);
                            this.logger.warn(`${opp.symbol} (${currentStrategyLabel}): Entry failed (${mode}) with status ${result.status}. Consecutive failures: ${failures}. Cooling down for ${cooldownMinutes}m. Error: ${result.error}`);
                            this.emitEntrySkipLog(opp.symbol, currentStrategyLabel, 'entry_failed', `entry failed (${failReason}); cooling down ${cooldownMinutes}m`, 'warn', 5000);
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
                        const successKey = `${mode}:${currentStrategyLabel}:${opp.symbol}`;
                        this.consecutiveFailures.delete(successKey);
                        this.entryCooldownReasons.delete(successKey);
                        this.consecutiveFailures.delete(`${mode}:${opp.symbol}`);
                        this.entryCooldownReasons.delete(`${mode}:${opp.symbol}`);
                    }
                }
                catch (err) {
                    const errMsg = err instanceof Error ? err.message : String(err);
                    this.logger.error(`Failed to process entry for ${opp.symbol}: ${errMsg}`);
                    // Also cooldown on exceptions to avoid tight-looping on unexpected errors
                    const cooldownMinutes = 2;
                    const mode = config.trading_mode || (config.paper_mode ? 'paper' : 'live');
                    const errKey = `${mode}:${currentStrategyLabel}:${opp.symbol}`;
                    const shortErr = errMsg.slice(0, 140);
                    this.entryCooldowns.set(errKey, Date.now() + cooldownMinutes * 60 * 1000);
                    this.entryCooldownReasons.set(errKey, `prior exception: ${shortErr}`);
                    this.emitEntrySkipLog(opp.symbol, currentStrategyLabel, 'entry_exception', `entry exception (${shortErr}); cooling down ${cooldownMinutes}m`, 'warn', 5000);
                }
                finally {
                    this.positionTracker.setEntering(opp.symbol, false);
                    // SRE: Release the entry pipeline lock
                    this.sessionState.entryInProgress = false;
                }
            }
            catch (oppErr) {
                this.logger.error(`Critical Error processing opportunity for ${opp.symbol}: ${oppErr instanceof Error ? oppErr.message : String(oppErr)}`);
            }
        }
    }
};
ExecutionService = ExecutionService_1 = __decorate([
    Injectable(),
    __param(4, Inject(forwardRef(() => PositionTrackerService))),
    __param(5, Inject(forwardRef(() => OrderManagerService))),
    __param(13, Inject(forwardRef(() => MarketFeedService))),
    __metadata("design:paramtypes", [TickerCacheService,
        KlineStoreService,
        SignalEngineService,
        RiskEngineService,
        PositionTrackerService,
        OrderManagerService,
        SessionStateService,
        GatingService,
        BroadcastService,
        MonitoringService,
        EngineBroadcasterService,
        EventEmitter2,
        AnalyticsService,
        MarketFeedService])
], ExecutionService);
export { ExecutionService };
