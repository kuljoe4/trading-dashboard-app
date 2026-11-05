var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var SmartOptimizerService_1;
import { Injectable, Logger } from '@nestjs/common';
import { SessionConfig } from '../models/SessionConfig';
import { BacktestService } from './backtest.service';
import { roundTo } from '../lib/math';
import { IsOptional, IsObject, ValidateNested, IsArray, IsString, IsNumber, Min, Max, ArrayMaxSize, MaxLength, Matches } from 'class-validator';
import { Type } from 'class-transformer';
export class RunOptimizationDto {
    baseConfig;
    iterations;
    days;
    startingBalance;
    symbols;
    topCount;
}
__decorate([
    IsOptional(),
    IsObject(),
    ValidateNested(),
    Type(() => SessionConfig),
    __metadata("design:type", SessionConfig)
], RunOptimizationDto.prototype, "baseConfig", void 0);
__decorate([
    IsOptional(),
    IsNumber(),
    Min(1),
    Max(50, { message: 'Iterations cannot exceed 50 per optimization run' }),
    __metadata("design:type", Number)
], RunOptimizationDto.prototype, "iterations", void 0);
__decorate([
    IsOptional(),
    IsNumber(),
    Min(1),
    Max(90),
    __metadata("design:type", Number)
], RunOptimizationDto.prototype, "days", void 0);
__decorate([
    IsOptional(),
    IsNumber(),
    Min(10),
    Max(100000000),
    __metadata("design:type", Number)
], RunOptimizationDto.prototype, "startingBalance", void 0);
__decorate([
    IsOptional(),
    IsArray(),
    IsString({ each: true }),
    ArrayMaxSize(20),
    MaxLength(20, { each: true }),
    Matches(/^[a-zA-Z0-9_\-]{3,20}$/, { each: true, message: 'Symbols must contain only alphanumeric characters, underscores, or hyphens and be at least 3 characters long' }),
    __metadata("design:type", Array)
], RunOptimizationDto.prototype, "symbols", void 0);
__decorate([
    IsOptional(),
    IsNumber(),
    Min(1),
    Max(20),
    __metadata("design:type", Number)
], RunOptimizationDto.prototype, "topCount", void 0);
let SmartOptimizerService = SmartOptimizerService_1 = class SmartOptimizerService {
    backtestService;
    logger = new Logger(SmartOptimizerService_1.name);
    // In-memory store for top recommended strategies so far
    topRecommendations = [];
    constructor(backtestService) {
        this.backtestService = backtestService;
    }
    /**
     * Returns current in-memory top strategy recommendations ranked by composite performance score.
     */
    getTopRecommendations() {
        return [...this.topRecommendations];
    }
    /**
     * Clears in-memory top strategy recommendations.
     */
    clearRecommendations() {
        this.topRecommendations = [];
        this.logger.log('In-memory strategy recommendations cleared.');
    }
    /**
     * Runs smart randomized strategy optimization over paper trade simulations.
     * PERF: Leverages cached kline evaluations across iterations for high-performance throughput.
     */
    async runOptimization(dto) {
        const startMs = Date.now();
        const iterations = dto.iterations || 15;
        const days = dto.days || 14;
        const startingBalance = dto.startingBalance || 10000;
        const symbols = (dto.symbols && dto.symbols.length > 0)
            ? dto.symbols.map(s => s.toUpperCase()).filter(s => s.endsWith('USDT'))
            : ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'];
        const topCount = dto.topCount || 5;
        this.logger.log(`Starting Smart Strategy Optimization (${iterations} iterations, ${days} days, ${symbols.length} symbols)...`);
        const candidates = [];
        const baseConfig = dto.baseConfig || new SessionConfig();
        // 1. Generate Randomized Strategy Configurations
        for (let i = 0; i < iterations; i++) {
            const candidate = this.generateRandomizedConfig(baseConfig, i);
            candidates.push(candidate);
        }
        // 2. Evaluate Each Candidate via Backtest Engine
        const newRecommendations = [];
        for (let i = 0; i < candidates.length; i++) {
            const { config, name } = candidates[i];
            try {
                const backtestResult = await this.backtestService.runBacktest({
                    config,
                    symbols,
                    days,
                    startingBalance,
                    useGlobalScanner: config.global_scanner_enabled !== false,
                });
                const score = this.calculateCompositeScore(backtestResult);
                // Only consider strategies with at least 2 trades to avoid zero-trade noise
                if (backtestResult.totalTrades >= 2) {
                    const rec = {
                        rank: 0, // Will be re-ranked
                        id: `rec_${Date.now()}_${i}_${Math.random().toString(36).substring(2, 7)}`,
                        name,
                        score,
                        config,
                        metrics: {
                            totalTrades: backtestResult.totalTrades,
                            wins: backtestResult.wins,
                            losses: backtestResult.losses,
                            winRate: backtestResult.winRate,
                            totalPnl: backtestResult.totalPnl,
                            pnlPct: backtestResult.pnlPct,
                            profitFactor: backtestResult.profitFactor,
                            maxDrawdown: backtestResult.maxDrawdown,
                            maxDrawdownPct: backtestResult.maxDrawdownPct,
                            sharpeRatio: backtestResult.sharpeRatio,
                            expectancy: backtestResult.expectancy,
                            avgTradePnl: backtestResult.avgTradePnl,
                            totalFees: backtestResult.totalFees,
                            endingBalance: backtestResult.endingBalance,
                        },
                        evaluatedAt: Date.now(),
                    };
                    newRecommendations.push(rec);
                }
            }
            catch (err) {
                this.logger.warn(`Candidate ${name} backtest failed: ${err instanceof Error ? err.message : String(err)}`);
            }
        }
        // 3. Merge with existing in-memory recommendations and sort by score descending
        const merged = [...this.topRecommendations, ...newRecommendations];
        // Deduplicate by config strategy_label or parameter signature if identical
        const uniqueMap = new Map();
        for (const rec of merged) {
            const sigKey = `${rec.config.scan_interval}_${rec.config.enabled_signals?.join(',')}_${rec.config.sl_distance_pct}_${rec.config.tp_ratio}_${rec.config.trailing_stop_enabled}_${rec.metrics.winRate}_${rec.metrics.totalPnl}`;
            if (!uniqueMap.has(sigKey) || uniqueMap.get(sigKey).score < rec.score) {
                uniqueMap.set(sigKey, rec);
            }
        }
        const sorted = Array.from(uniqueMap.values()).sort((a, b) => b.score - a.score);
        // Re-assign ranks 1..topCount
        const finalRecommendations = sorted.slice(0, topCount).map((rec, idx) => ({
            ...rec,
            rank: idx + 1,
        }));
        this.topRecommendations = finalRecommendations;
        const executionTimeMs = Date.now() - startMs;
        this.logger.log(`Smart Strategy Optimization completed in ${executionTimeMs}ms. Updated ${finalRecommendations.length} top recommendations in memory.`);
        return {
            testedCount: candidates.length,
            topRecommendations: this.topRecommendations,
            executionTimeMs,
        };
    }
    /**
     * Generates a smart randomized candidate configuration from base configuration.
     */
    generateRandomizedConfig(baseConfig, index) {
        const cfg = new SessionConfig();
        Object.assign(cfg, JSON.parse(JSON.stringify(baseConfig)));
        // Archetypes of entry signal combinations
        const signalArchetypes = [
            { name: 'EMA Cross', signals: ['ema_cross'], params: { ema_fast: getRandomInt(5, 15), ema_slow: getRandomInt(20, 50) } },
            { name: 'Supertrend', signals: ['supertrend'], params: { supertrend_period: getRandomInt(7, 14), supertrend_multiplier: getRandomFloat(1.5, 3.5, 1) } },
            { name: 'MACD Impulse', signals: ['macd_impulse'], params: { macd_fast: getRandomInt(8, 14), macd_slow: getRandomInt(20, 28), macd_signal: getRandomInt(7, 10) } },
            { name: 'Engulfing', signals: ['engulfing'], params: {} },
            { name: 'Knife Catch', signals: ['knife_catch'], params: { knife_drop_pct: getRandomFloat(1.5, 4.0, 1) } },
            { name: 'Dual EMA Cross', signals: ['ema_dual_cross'], params: { entry_ema_fast: getRandomInt(8, 16), entry_ema_slow: getRandomInt(21, 45) } },
            { name: 'Momentum', signals: ['momentum_pct'], params: {} },
        ];
        const archetype = signalArchetypes[index % signalArchetypes.length];
        cfg.enabled_signals = archetype.signals;
        cfg.signal_params = { ...cfg.signal_params, ...archetype.params };
        // Scan intervals
        const intervals = ['1m', '3m', '5m', '15m'];
        cfg.scan_interval = intervals[getRandomInt(0, intervals.length - 1)];
        // Stop loss variations
        const slTypes = ['pct', 'supertrend', 'lookback_low/high', 'engulfing_boundary'];
        cfg.sl_type = slTypes[getRandomInt(0, slTypes.length - 1)];
        cfg.sl_distance_pct = getRandomFloat(0.6, 3.2, 1);
        // Take profit variations
        cfg.tp_mode = Math.random() > 0.3 ? 'fixed' : 'exp_rr_seq';
        cfg.tp_ratio = getRandomFloat(1.5, 4.0, 1);
        // Trailing Stop Loss
        cfg.trailing_stop_enabled = Math.random() > 0.4;
        cfg.trailing_stop_type = Math.random() > 0.5 ? 'rr' : 'pct';
        cfg.trailing_stop_distance_pct = getRandomFloat(0.5, 2.5, 1);
        cfg.trailing_stop_rr = getRandomFloat(0.8, 2.5, 1);
        cfg.trailing_activation_rr = getRandomFloat(0.0, 2.0, 1);
        // Risk and Cooldown
        cfg.risk_pct_per_trade = getRandomFloat(0.5, 4.0, 1);
        cfg.min_trade_interval_min = [0, 5, 10, 15, 20][getRandomInt(0, 4)];
        cfg.anti_whipsaw_candle_delay = getRandomInt(1, 3);
        // Dynamic Compact Auto-Naming for Preset (10-char budget compliance)
        const slAbbr = `${cfg.sl_distance_pct}SL`;
        const tpAbbr = cfg.trailing_stop_enabled ? 'Trail' : `${cfg.tp_ratio}R`;
        const name = `Smart ${archetype.name.split(' ')[0]} ${slAbbr} ${tpAbbr}`.substring(0, 30);
        cfg.strategy_label = name;
        return { config: cfg, name };
    }
    /**
     * Calculates a composite performance score for ranking strategy candidates.
     * Score = (PF * 25) + (WR * 0.5) + (Expectancy * 10) + (Sharpe * 15) + min(PnlPct, 50) - (MaxDrawdown * 1.5)
     */
    calculateCompositeScore(result) {
        if (result.totalTrades < 2)
            return -1000;
        const pfScore = Math.min(result.profitFactor, 10) * 25;
        const wrScore = result.winRate * 0.5;
        const expScore = Math.max(-50, Math.min(result.expectancy, 100)) * 10;
        const sharpeScore = Math.max(-5, Math.min(result.sharpeRatio, 10)) * 15;
        const pnlScore = Math.min(Math.max(result.pnlPct, -100), 50);
        const ddPenalty = result.maxDrawdownPct * 1.5;
        const score = pfScore + wrScore + expScore + sharpeScore + pnlScore - ddPenalty;
        return roundTo(score, 2);
    }
};
SmartOptimizerService = SmartOptimizerService_1 = __decorate([
    Injectable(),
    __metadata("design:paramtypes", [BacktestService])
], SmartOptimizerService);
export { SmartOptimizerService };
function getRandomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}
function getRandomFloat(min, max, decimals = 1) {
    const str = (Math.random() * (max - min) + min).toFixed(decimals);
    return parseFloat(str);
}
