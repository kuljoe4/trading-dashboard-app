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
var SessionStateService_1;
import { Injectable, Logger, Optional } from '@nestjs/common';
import { OnEvent, EventEmitter2 } from '@nestjs/event-emitter';
import { ENGINE_EVENTS } from './events';
import { roundEight } from '../lib/math';
let SessionStateService = class SessionStateService {
    static { SessionStateService_1 = this; }
    eventEmitter;
    logger = new Logger(SessionStateService_1.name);
    constructor(eventEmitter) {
        this.eventEmitter = eventEmitter;
    }
    static DEFAULT_STRATEGY_LABEL = 'Momentum Strategy';
    balancePaper = 0;
    balanceLive = 0;
    lastExchangeBalance = 0;
    lastUdsBalanceUpdate = 0;
    paused = false;
    binanceRateLimit = { used_1m: 0, limit: 2400 };
    binanceOrderLimit = {
        used_10s: 0,
        limit_10s: 300,
        used_1m: 0,
        limit_1m: 1200
    };
    apiStatus = {
        isBanned: false,
        isRateLimited: false,
        isGeoBlocked: false,
        banUntil: null,
        lastErrorMessage: null
    };
    stats = {
        entryCount: 0,
        hitCount: 0,
        totalPnl: 0,
        totalRealizedFee: 0,
        totalFundingFee: 0,
    };
    statsVersion = 0;
    gateState = null;
    gateReason = null;
    pausedStrategies = new Set();
    strategyGateStates = new Map();
    hibernating = false;
    agreementRequired = false;
    isAdaptiveTightened = false;
    last_scan_ts = 0;
    next_scan_ts = 0;
    scan_interval_ms = 15000;
    realTimePositions = new Map();
    realTimeOrders = new Map();
    // Idempotency tracking
    appliedGlobalPnL = new Map();
    countedGlobalEntries = new Set();
    countedGlobalHits = new Set();
    appliedStrategyPnL = new Map();
    countedStrategyEntries = new Set();
    countedStrategyHits = new Set();
    config = null;
    closedTrades = [];
    _activeTrades = [];
    activeTradesBySymbol = new Map();
    activeTradesById = new Map();
    get activeTrades() {
        return this._activeTrades;
    }
    set activeTrades(trades) {
        this._activeTrades = trades;
        this.activeTradesBySymbol.clear();
        this.activeTradesById.clear();
        if (trades) {
            for (const t of trades) {
                this.activeTradesBySymbol.set(t.symbol, t);
                this.activeTradesById.set(t.id, t);
            }
        }
    }
    cachedClosedTradesStats = {};
    appliedStatsPnL = new Map(); // trade.id -> pnl portion already in stats.totalPnl
    listenerCount = 0;
    dashboardCount = 0;
    // SRE: Entry Pipeline Lock to prevent concurrent entry evaluations and dispatches
    entryInProgress = false;
    udsConfirmedClosedTrades = new Set();
    localTradePnLAdjustments = new Map();
    currentSessionId = null;
    assetBalances = new Map();
    isStrategyPaused(label) {
        return this.paused || (this.pausedStrategies ? this.pausedStrategies.has(label) : false);
    }
    setStrategyPaused(label, paused) {
        if (!this.pausedStrategies) {
            this.pausedStrategies = new Set();
        }
        if (paused) {
            this.pausedStrategies.add(label);
        }
        else {
            this.pausedStrategies.delete(label);
        }
    }
    reset(config, initialHistory = [], currentBalance, sessionId, initialOpen = []) {
        this.config = config;
        this.currentSessionId = sessionId || null;
        this.assetBalances.clear();
        this.statsVersion = 0;
        this.closedTrades = initialHistory;
        this.activeTrades = initialOpen;
        this.gateState = null;
        this.gateReason = null;
        this.pausedStrategies = new Set(config?.paused_strategies || []);
        this.strategyGateStates.clear();
        this.hibernating = false;
        this.agreementRequired = false;
        this.isAdaptiveTightened = false;
        this.paused = !!config?.paused;
        // SRE: Preserve the existing weight limit during reset to ensure persistent dynamic limits (Issue 5)
        const currentLimit = this.binanceRateLimit.limit || 2400;
        this.binanceRateLimit = { used_1m: 0, limit: currentLimit };
        this.apiStatus = { isBanned: false, isRateLimited: false, banUntil: null, lastErrorMessage: null };
        this.cachedClosedTradesStats = {};
        this.appliedStatsPnL.clear();
        this.realTimePositions.clear();
        this.realTimeOrders.clear();
        this.appliedGlobalPnL.clear();
        this.countedGlobalEntries.clear();
        this.countedGlobalHits.clear();
        this.appliedStrategyPnL.clear();
        this.countedStrategyEntries.clear();
        this.countedStrategyHits.clear();
        this.udsConfirmedClosedTrades.clear();
        this.localTradePnLAdjustments.clear();
        let totalPnlAcc = 0;
        let totalRealizedFeeAcc = 0;
        let totalFundingFeeAcc = 0;
        const processedTradeIds = new Set();
        const processTrade = (trade) => {
            if (processedTradeIds.has(trade.id))
                return;
            processedTradeIds.add(trade.id);
            const label = trade.strategy_label || config.strategy_label || SessionStateService_1.DEFAULT_STRATEGY_LABEL;
            if (!trade.strategy_label)
                trade.strategy_label = label;
            if (!this.cachedClosedTradesStats[label]) {
                this.cachedClosedTradesStats[label] = { pnl: 0, count: 0, hits: 0 };
            }
            const pnl = trade.pnl || 0;
            totalPnlAcc += pnl;
            totalRealizedFeeAcc += Number(trade.realized_fee) || 0;
            totalFundingFeeAcc += Number(trade.funding_fee) || 0;
            // Populate idempotency maps/sets to prevent double-counting
            if (!trade.is_reconciliation) {
                this.countedGlobalEntries.add(trade.id);
                this.countedStrategyEntries.add(trade.id);
                if (trade.status !== 'OPEN') {
                    if (pnl > 0) {
                        this.countedGlobalHits.add(trade.id);
                        this.countedStrategyHits.add(trade.id);
                    }
                }
            }
            // Realized portion (fees/funding) is tracked even for OPEN trades
            this.appliedGlobalPnL.set(trade.id, pnl);
            this.appliedStrategyPnL.set(trade.id, pnl);
            this.appliedStatsPnL.set(trade.id, pnl);
            // Populate strategy-specific stats (only for closed trades to prevent double-counting upon session resume)
            if (trade.status !== 'OPEN') {
                const stats = this.cachedClosedTradesStats[label];
                stats.pnl = roundEight(stats.pnl + pnl);
                if (!trade.is_reconciliation) {
                    stats.count++;
                    if (pnl > 0) {
                        stats.hits++;
                    }
                }
            }
        };
        // BOLT: Optimize by using loop fusion and avoiding intermediate array spreads
        // Filter by sessionId during processing to preserve session isolation
        for (let i = 0; i < initialHistory.length; i++) {
            if (!sessionId || !initialHistory[i].sessionId || initialHistory[i].sessionId === sessionId) {
                processTrade(initialHistory[i]);
            }
        }
        for (let i = 0; i < initialOpen.length; i++) {
            if (!sessionId || !initialOpen[i].sessionId || initialOpen[i].sessionId === sessionId) {
                processTrade(initialOpen[i]);
            }
        }
        // Finalize session stats
        this.stats = {
            entryCount: this.countedGlobalEntries.size,
            hitCount: this.countedGlobalHits.size,
            totalPnl: roundEight(totalPnlAcc),
            totalRealizedFee: roundEight(totalRealizedFeeAcc),
            totalFundingFee: roundEight(totalFundingFeeAcc)
        };
        const mode = config.trading_mode || (config.paper_mode ? 'paper' : 'live');
        if (currentBalance !== undefined) {
            if (mode === 'paper') {
                this.balancePaper = currentBalance;
                this.balanceLive = config.live_starting_balance || 0;
            }
            else if (mode === 'testnet') {
                this.balanceLive = currentBalance;
                this.balancePaper = config.paper_starting_balance || 10000;
            }
            else {
                this.balanceLive = currentBalance;
                this.balancePaper = config.paper_starting_balance || 10000;
            }
        }
        else {
            this.balancePaper = config.paper_starting_balance || 10000;
            if (mode === 'testnet') {
                this.balanceLive = config.testnet_starting_balance || 0;
            }
            else {
                this.balanceLive = config.live_starting_balance || 0;
            }
        }
    }
    getBalance(paperMode) {
        return paperMode ? this.balancePaper : this.balanceLive;
    }
    isGated() {
        if (this.paused)
            return true;
        if (this.strategyGateStates && this.strategyGateStates.size > 0) {
            for (const [label, state] of this.strategyGateStates.entries()) {
                const isPaused = this.pausedStrategies ? this.pausedStrategies.has(label) : false;
                const isGated = ['max_trades', 'sl_guard', 'max_trades_period', 'sleeping', 'risk_pct', 'tod_risk', 'risk'].includes(state.gateState || '');
                if (!isPaused && !isGated) {
                    return false; // at least one enabled strategy is NOT gated or paused
                }
            }
            return true; // all strategies are gated or paused
        }
        return ['max_trades', 'sl_guard', 'max_trades_period', 'sleeping', 'risk_pct', 'tod_risk', 'risk'].includes(this.gateState || '');
    }
    highWeightEvents = [];
    restCallTimestamps = [];
    last80PctWarningTs = 0;
    lastSurgeWarningTs = 0;
    handleRestRequest() {
        this.recordRestRequest();
    }
    recordRestRequest() {
        const now = Date.now();
        this.restCallTimestamps.push(now);
        // Prune calls older than 10 seconds
        const tenSecAgo = now - 10000;
        this.restCallTimestamps = this.restCallTimestamps.filter(t => t >= tenSecAgo);
        const intervalMin = this.config?.rate_limit_warning_interval_min || 5;
        const intervalMs = Math.max(5, intervalMin) * 60 * 1000;
        if (this.restCallTimestamps.length > 30 && now - this.lastSurgeWarningTs > intervalMs) {
            this.lastSurgeWarningTs = now;
            const surgeMsg = `⚠️ [Rate Surge Warning] Rapid REST API call surge detected (${this.restCallTimestamps.length} calls in 10s)! Slowing down background tasks to protect IP reputation.`;
            this.logger.warn(surgeMsg);
            if (this.eventEmitter) {
                this.eventEmitter.emit(ENGINE_EVENTS.LOG_MESSAGE, { msg: surgeMsg, level: 'warn' });
                this.eventEmitter.emit(ENGINE_EVENTS.ALERT, {
                    level: 'warning',
                    title: 'REST API Surge Warning',
                    message: surgeMsg,
                });
            }
        }
    }
    updateRateLimit(used1m, limit) {
        this.binanceRateLimit.used_1m = used1m;
        const effectiveLimit = limit || this.binanceRateLimit.limit || 2400;
        if (limit) {
            this.binanceRateLimit.limit = limit;
            // SRE: Proactively sync with static gateway queue
            try {
                const { BinanceRequestQueue } = require('../lib/binanceClientFactory');
                if (BinanceRequestQueue && typeof BinanceRequestQueue.setWeightLimit === 'function') {
                    BinanceRequestQueue.setWeightLimit(limit);
                }
            }
            catch (e) {
                // Fallback or ignore if module not loaded
            }
        }
        // Rate Limit Surge Guard: Detect when 80%+ weight limit is hit repeatedly
        const now = Date.now();
        const ratio = effectiveLimit > 0 ? used1m / effectiveLimit : 0;
        if (ratio >= 0.8) {
            this.highWeightEvents.push(now);
            // Prune events older than 60s
            this.highWeightEvents = this.highWeightEvents.filter(t => t >= now - 60000);
            const intervalMin = this.config?.rate_limit_warning_interval_min || 5;
            const intervalMs = Math.max(5, intervalMin) * 60 * 1000;
            if (this.highWeightEvents.length >= 3 && now - this.last80PctWarningTs > intervalMs) {
                this.last80PctWarningTs = now;
                const spikeMsg = `⚠️ [Rate Surge Alert] High API Weight Spike detected! Used weight reached ${(ratio * 100).toFixed(1)}% (${used1m}/${effectiveLimit}) ${this.highWeightEvents.length} times in the last minute. Proactive request throttling engaged.`;
                this.logger.warn(spikeMsg);
                if (this.eventEmitter) {
                    this.eventEmitter.emit(ENGINE_EVENTS.LOG_MESSAGE, { msg: spikeMsg, level: 'warn' });
                    this.eventEmitter.emit(ENGINE_EVENTS.ALERT, {
                        level: 'warning',
                        title: 'High API Weight Spike',
                        message: spikeMsg,
                    });
                }
            }
        }
    }
    handleOrderLimitUpdate(payload) {
        this.updateOrderRateLimits(payload.headers);
    }
    handleApiLimitCleared() {
        this.apiStatus = {
            isBanned: false,
            isRateLimited: false,
            isGeoBlocked: false,
            banUntil: null,
            lastErrorMessage: null
        };
        this.logger.log(`API Status restored: Recovery event received from Gateway.`);
    }
    handleApiLimitReached(payload) {
        const isGeo = payload.type === 'GEO_BLOCKED';
        const isBan = payload.type ? (payload.type === 'BAN') : !isGeo;
        const isRateLimit = payload.type ? (payload.type === 'RATE_LIMIT') : false;
        const until = payload.until !== undefined ? payload.until : payload.banUntil;
        const message = payload.message !== undefined ? payload.message : payload.reason;
        this.apiStatus.isBanned = isBan;
        this.apiStatus.isRateLimited = isRateLimit;
        this.apiStatus.isGeoBlocked = isGeo;
        this.apiStatus.banUntil = until || null;
        this.apiStatus.lastErrorMessage = message || null;
        const untilStr = until && !isNaN(until) ? new Date(until).toISOString() : 'unknown';
        this.logger.warn(`[SessionState] Centralized ${isGeo ? 'geo-restriction' : 'ban'} event received: Until ${untilStr}, Reason: ${message}`);
    }
    updateOrderRateLimits(headers, limits) {
        if (limits) {
            if (limits.limit10s)
                this.binanceOrderLimit.limit_10s = limits.limit10s;
            if (limits.limit1m)
                this.binanceOrderLimit.limit_1m = limits.limit1m;
            return;
        }
        if (!headers)
            return;
        const getHeader = (name) => {
            return (headers && typeof headers.get === 'function')
                ? headers.get(name)
                : (headers ? (headers[name.toLowerCase()] || headers[name]) : null);
        };
        const used10s = getHeader('X-FAPI-ORDER-COUNT-10S') || getHeader('X-MBX-ORDER-COUNT-10S');
        const used1m = getHeader('X-FAPI-ORDER-COUNT-1M') || getHeader('X-MBX-ORDER-COUNT-1M');
        if (used10s) {
            const parts = used10s.split(',');
            if (parts.length > 0) {
                this.binanceOrderLimit.used_10s = parseInt(parts[0], 10);
            }
        }
        if (used1m) {
            const parts = used1m.split(',');
            if (parts.length > 0) {
                this.binanceOrderLimit.used_1m = parseInt(parts[0], 10);
            }
        }
    }
    isGeoBlocked() {
        return !!this.apiStatus.isGeoBlocked;
    }
    isRateLimited(threshold = 0.8) {
        if (this.isBanned() || this.isGeoBlocked())
            return true;
        const used = this.binanceRateLimit.used_1m;
        const limit = this.binanceRateLimit.limit;
        return (used / limit) > threshold;
    }
    isBanned() {
        // SRE: Proactive ban expiration. If the ban time has passed, treat it as cleared
        // regardless of the isBanned status bit.
        if (this.apiStatus.isBanned) {
            if (!this.apiStatus.banUntil || Date.now() < this.apiStatus.banUntil) {
                return true;
            }
        }
        return false;
    }
    /**
     * CHRONOS: Verify if there are enough order slots available for a multi-part operation.
     * Priority:
     * 0 - Emergency (always true unless absolute 0 remains)
     * 1 - Normal (requires at least 5% buffer + requiredCount)
     * 2 - Low (requires at least 15% buffer + requiredCount)
     */
    hasOrderCapacity(requiredCount, priority) {
        const limit10s = this.binanceOrderLimit.limit_10s;
        const remaining10s = limit10s - this.binanceOrderLimit.used_10s;
        const limit1m = this.binanceOrderLimit.limit_1m;
        const remaining1m = limit1m - this.binanceOrderLimit.used_1m;
        const buffer10s = priority === 0 ? 1 : (priority === 1 ? Math.ceil(limit10s * 0.05) : Math.ceil(limit10s * 0.15));
        const buffer1m = priority === 0 ? 5 : (priority === 1 ? Math.ceil(limit1m * 0.05) : Math.ceil(limit1m * 0.15));
        if (remaining10s < (requiredCount + buffer10s))
            return false;
        if (remaining1m < (requiredCount + buffer1m))
            return false;
        return true;
    }
    /**
     * Check if order rate limits are approaching thresholds based on priority.
     * Priority:
     * 0 - Emergency (Closes, first SL) - Never throttles
     * 1 - Normal (Significant ratchets, entries)
     * 2 - Low (Small ratchets)
     */
    isOrderRateLimited(priority) {
        if (priority <= 0)
            return false;
        const usage10s = this.binanceOrderLimit.used_10s / this.binanceOrderLimit.limit_10s;
        const usage1m = this.binanceOrderLimit.used_1m / this.binanceOrderLimit.limit_1m;
        const maxUsage = Math.max(usage10s, usage1m);
        if (priority === 1) {
            return maxUsage > 0.9; // Block entries/significant ratchets at 90%
        }
        if (priority >= 2) {
            return maxUsage > 0.8; // Throttle low priority at 80%
        }
        return false;
    }
    getBinanceRateLimit() {
        return {
            used_weight_1m: this.binanceRateLimit.used_1m,
            limit: this.binanceRateLimit.limit,
            weight_limit: this.binanceRateLimit.limit,
            used_order_10s: this.binanceOrderLimit.used_10s,
            order_limit_10s: this.binanceOrderLimit.limit_10s,
            used_order_1m: this.binanceOrderLimit.used_1m,
            order_limit_1m: this.binanceOrderLimit.limit_1m,
            last_update: new Date().toISOString(),
        };
    }
    getStrategyLabelForTrade(tradeId) {
        const active = this.activeTrades.find(t => t.id === tradeId);
        if (active)
            return active.strategy_label || this.config?.strategy_label || SessionStateService_1.DEFAULT_STRATEGY_LABEL;
        const closed = this.closedTrades.find(t => t.id === tradeId);
        if (closed)
            return closed.strategy_label || this.config?.strategy_label || SessionStateService_1.DEFAULT_STRATEGY_LABEL;
        return this.config?.strategy_label || SessionStateService_1.DEFAULT_STRATEGY_LABEL;
    }
    updateStatsOnEntry(tradeId, strategyLabel) {
        if (tradeId) {
            if (!this.countedGlobalEntries.has(tradeId)) {
                this.stats.entryCount++;
                this.countedGlobalEntries.add(tradeId);
                // Update Strategy Stats
                const label = strategyLabel || this.getStrategyLabelForTrade(tradeId);
                if (label) {
                    if (!this.cachedClosedTradesStats[label]) {
                        this.cachedClosedTradesStats[label] = { pnl: 0, count: 0, hits: 0 };
                    }
                    const stats = this.cachedClosedTradesStats[label];
                    if (!this.countedStrategyEntries.has(tradeId)) {
                        stats.count++;
                        this.countedStrategyEntries.add(tradeId);
                    }
                }
            }
        }
        else {
            this.stats.entryCount++;
        }
        this.statsVersion++;
    }
    updateStatsOnClose(isWin, pnl = 0, isReconciliation = false, tradeId, strategyLabel) {
        if (tradeId) {
            if (!isReconciliation && isWin && !this.countedGlobalHits.has(tradeId)) {
                this.stats.hitCount++;
                this.countedGlobalHits.add(tradeId);
            }
            const applied = this.appliedGlobalPnL.get(tradeId) || 0;
            const delta = roundEight(pnl - applied);
            this.stats.totalPnl = roundEight(this.stats.totalPnl + delta);
            this.appliedGlobalPnL.set(tradeId, pnl);
            // Update Strategy Stats
            const label = strategyLabel || this.getStrategyLabelForTrade(tradeId);
            if (label) {
                if (!this.cachedClosedTradesStats[label]) {
                    this.cachedClosedTradesStats[label] = { pnl: 0, count: 0, hits: 0 };
                }
                const stats = this.cachedClosedTradesStats[label];
                const appliedStr = this.appliedStrategyPnL.get(tradeId) || 0;
                const deltaStr = roundEight(pnl - appliedStr);
                stats.pnl = roundEight(stats.pnl + deltaStr);
                this.appliedStrategyPnL.set(tradeId, pnl);
                if (!isReconciliation && isWin && !this.countedStrategyHits.has(tradeId)) {
                    stats.hits++;
                    this.countedStrategyHits.add(tradeId);
                }
            }
        }
        else {
            if (!isReconciliation && isWin)
                this.stats.hitCount++;
            this.stats.totalPnl = roundEight(this.stats.totalPnl + pnl);
        }
        this.statsVersion++;
    }
    addClosedTrade(trade) {
        const label = trade.strategy_label || this.config?.strategy_label || SessionStateService_1.DEFAULT_STRATEGY_LABEL;
        if (!trade.strategy_label)
            trade.strategy_label = label;
        // Reconciliation trades should contribute to PnL (for accurate balance) but NOT to counts/hits
        // to avoid penalizing or artificially boosting strategy performance metrics.
        if (!this.cachedClosedTradesStats[label]) {
            this.cachedClosedTradesStats[label] = { pnl: 0, count: 0, hits: 0 };
        }
        const stats = this.cachedClosedTradesStats[label];
        const applied = this.appliedStrategyPnL.get(trade.id) || 0;
        const delta = roundEight((trade.pnl || 0) - applied);
        stats.pnl = roundEight(stats.pnl + delta);
        this.appliedStrategyPnL.set(trade.id, trade.pnl || 0);
        if (!trade.is_reconciliation) {
            if (!this.countedStrategyEntries.has(trade.id)) {
                stats.count++;
                this.countedStrategyEntries.add(trade.id);
            }
            if ((trade.pnl || 0) > 0 && !this.countedStrategyHits.has(trade.id)) {
                stats.hits++;
                this.countedStrategyHits.add(trade.id);
            }
        }
        // Prevent duplicate entries in closedTrades array
        const existingIndex = this.closedTrades.findIndex(t => t.id === trade.id);
        if (existingIndex !== -1) {
            this.closedTrades[existingIndex] = trade;
        }
        else {
            this.closedTrades.unshift(trade);
            if (this.closedTrades.length > 500) {
                this.closedTrades = this.closedTrades.slice(0, 500);
                this.pruneIdempotencyCaches();
            }
        }
    }
    rollbackClosedTrade(trade, prevAppliedPnL = 0) {
        const label = trade.strategy_label || SessionStateService_1.DEFAULT_STRATEGY_LABEL;
        // Rollback Strategy Stats
        const appliedStr = this.appliedStrategyPnL.get(trade.id) || 0;
        if (this.cachedClosedTradesStats[label]) {
            const stats = this.cachedClosedTradesStats[label];
            stats.pnl = roundEight(stats.pnl - appliedStr);
            if (!trade.is_reconciliation) {
                if (this.countedStrategyEntries.has(trade.id)) {
                    stats.count--;
                    this.countedStrategyEntries.delete(trade.id);
                }
                if (this.countedStrategyHits.has(trade.id)) {
                    stats.hits--;
                    this.countedStrategyHits.delete(trade.id);
                }
            }
        }
        this.appliedStrategyPnL.delete(trade.id);
        // Rollback Global Stats
        const appliedGl = this.appliedGlobalPnL.get(trade.id) || 0;
        this.stats.totalPnl = roundEight(this.stats.totalPnl - appliedGl);
        this.appliedGlobalPnL.delete(trade.id);
        if (this.countedGlobalEntries.has(trade.id)) {
            this.stats.entryCount--;
            this.countedGlobalEntries.delete(trade.id);
        }
        if (this.countedGlobalHits.has(trade.id)) {
            this.stats.hitCount--;
            this.countedGlobalHits.delete(trade.id);
        }
        this.statsVersion++;
        const idx = this.closedTrades.findIndex(t => t.id === trade.id);
        if (idx !== -1) {
            this.closedTrades.splice(idx, 1);
        }
    }
    isEcoMode(running) {
        return running && this.listenerCount === 0;
    }
    setActiveTrades(trades) {
        this.activeTrades = trades;
    }
    /**
     * CHRONOS: Prunes idempotency maps and sets to prevent unbounded growth during long sessions.
     * Keeps data for trades currently in history or active list.
     */
    pruneIdempotencyCaches() {
        const validIds = new Set([
            ...this.activeTrades.map(t => t.id),
            ...this.closedTrades.map(t => t.id)
        ]);
        for (const tradeId of this.appliedGlobalPnL.keys()) {
            if (!validIds.has(tradeId))
                this.appliedGlobalPnL.delete(tradeId);
        }
        for (const tradeId of this.countedGlobalEntries) {
            if (!validIds.has(tradeId))
                this.countedGlobalEntries.delete(tradeId);
        }
        for (const tradeId of this.countedGlobalHits) {
            if (!validIds.has(tradeId))
                this.countedGlobalHits.delete(tradeId);
        }
        for (const tradeId of this.appliedStrategyPnL.keys()) {
            if (!validIds.has(tradeId))
                this.appliedStrategyPnL.delete(tradeId);
        }
        for (const tradeId of this.countedStrategyEntries) {
            if (!validIds.has(tradeId))
                this.countedStrategyEntries.delete(tradeId);
        }
        for (const tradeId of this.countedStrategyHits) {
            if (!validIds.has(tradeId))
                this.countedStrategyHits.delete(tradeId);
        }
        for (const tradeId of this.appliedStatsPnL.keys()) {
            if (!validIds.has(tradeId))
                this.appliedStatsPnL.delete(tradeId);
        }
        this.logger.debug(`Idempotency caches pruned. Valid trades: ${validIds.size}`);
    }
    /**
     * BOLT OPTIMIZATION: Clears non-essential state when session stops.
     * Keeps starting balances and history (required for risk gating) but clears transient caches.
     */
    minimize() {
        this.activeTrades = [];
        this.binanceRateLimit = { used_1m: 0, limit: 2400 };
        this.realTimePositions.clear();
        this.realTimeOrders.clear();
        // DATA-07: Preserve stats during hibernation so dashboard remains accurate
        this.statsVersion++;
        // Suggest explicit GC if --expose-gc is enabled
        if (typeof global !== 'undefined' && global.gc) {
            try {
                global.gc();
                this.logger.log('Manual Garbage Collection triggered');
            }
            catch (e) { }
        }
        this.logger.verbose('SessionStateService: Memory minimized');
    }
};
__decorate([
    OnEvent('binance.rest_request'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], SessionStateService.prototype, "handleRestRequest", null);
__decorate([
    OnEvent('binance.weight_update'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, Number]),
    __metadata("design:returntype", void 0)
], SessionStateService.prototype, "updateRateLimit", null);
__decorate([
    OnEvent('binance.order_limit_update'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], SessionStateService.prototype, "handleOrderLimitUpdate", null);
__decorate([
    OnEvent('binance.api_limit_cleared'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], SessionStateService.prototype, "handleApiLimitCleared", null);
__decorate([
    OnEvent('binance.api_limit_reached'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], SessionStateService.prototype, "handleApiLimitReached", null);
SessionStateService = SessionStateService_1 = __decorate([
    Injectable(),
    __param(0, Optional()),
    __metadata("design:paramtypes", [EventEmitter2])
], SessionStateService);
export { SessionStateService };
