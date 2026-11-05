var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
import { IsString, IsNumber, IsOptional, IsEnum, IsArray, IsBoolean, Min, Max, IsObject, ValidateNested, MaxLength, ArrayMaxSize, Matches, IsIn } from 'class-validator';
import { Type, Transform } from 'class-transformer';
import { CONFIG_LIMITS } from './constants';
export class SingleSymbolConfig {
    symbol = "";
    enabled = true;
    follow_schedule = true;
    use_custom_config = false;
    custom_config;
}
__decorate([
    IsString(),
    MaxLength(20),
    Matches(/^[a-zA-Z0-9_\-]*$/, { message: 'Symbol must contain only alphanumeric characters, underscores, or hyphens' }),
    __metadata("design:type", String)
], SingleSymbolConfig.prototype, "symbol", void 0);
__decorate([
    IsBoolean(),
    IsOptional(),
    __metadata("design:type", Boolean)
], SingleSymbolConfig.prototype, "enabled", void 0);
__decorate([
    IsBoolean(),
    IsOptional(),
    __metadata("design:type", Boolean)
], SingleSymbolConfig.prototype, "follow_schedule", void 0);
__decorate([
    IsBoolean(),
    IsOptional(),
    __metadata("design:type", Boolean)
], SingleSymbolConfig.prototype, "use_custom_config", void 0);
__decorate([
    IsObject(),
    IsOptional(),
    ValidateNested(),
    Type(() => SessionConfig),
    __metadata("design:type", Object)
], SingleSymbolConfig.prototype, "custom_config", void 0);
export class TradingWindow {
    start = "";
    end = "";
}
__decorate([
    IsString(),
    Matches(/^(?:[01]\d|2[0-3]):[0-5]\d$/, { message: 'Start time must be in HH:MM format (24-hour)' }),
    __metadata("design:type", String)
], TradingWindow.prototype, "start", void 0);
__decorate([
    IsString(),
    Matches(/^(?:[01]\d|2[0-3]):[0-5]\d$/, { message: 'End time must be in HH:MM format (24-hour)' }),
    __metadata("design:type", String)
], TradingWindow.prototype, "end", void 0);
export class SessionConfig {
    paused;
    paused_strategies;
    is_nominal_overshoot;
    strategy_label = "Momentum Strategy";
    strategy_variants = [];
    global_scanner_enabled = true;
    smart_watchlist_enabled = false;
    smart_watchlist_sensitivity = 0.7;
    single_symbol_configs = [];
    scan_interval = "5m";
    scan_lookback = 3;
    scanner_signal_depth = 10;
    scan_pct_threshold = 2.0;
    scan_min_volume_usdt = 500000;
    scan_mode = 'interval';
    scan_window_duration_sec = 90;
    scan_check_interval_sec = 5;
    watchlist_size = CONFIG_LIMITS.WATCHLIST_DEFAULT;
    watchlist_offset = 0;
    watchlist_max_symbols;
    watchlist_auto_rotate;
    watchlist_locked;
    watchlist_rotate_interval_min;
    watchlist_min_score;
    watchlist_last_rotated_ts;
    discovery_mode = 'volume';
    entry_side = 'both';
    excluded_symbols;
    symbols;
    enabled_signals = ['momentum_pct'];
    signal_logic = 'all';
    required_signals = [];
    signal_params;
    engulfing_mode = 'range';
    engulfing_timing = 'is_opportunity';
    engulfing_volume_confirm = false;
    engulfing_lookback = 1;
    engulfing_streak = 1;
    engulfing_sequential = true;
    engulfing_max_expansion_pct = 0;
    macd_pbc_trend_ema = 50;
    macd_pbc_lookback = 10;
    macd_pbc_max_continuation = 2;
    // HTF / Previous-Day Breakout Configuration
    htf_breakout_ref_timeframe = "1d";
    htf_breakout_trigger_timeframe = "1h";
    htf_breakout_mode = 'close_break';
    htf_breakout_reference_level = 'high_low';
    htf_breakout_lookback = 1;
    htf_breakout_buffer_pct = 0;
    htf_breakout_max_expansion_pct = 0;
    // Trigger Candle Exit Configuration
    trigger_candle_exit_enabled = false;
    trigger_candle_exit_n = 0;
    trigger_candle_exit_offset_mode = 'prev_and_next';
    trigger_candle_exit_mode = 'close';
    trigger_candle_exit_timeframe = "default";
    trigger_candle_exit_buffer_pct = 0;
    // Stop Loss Configuration
    sl_type = "pct";
    sl_distance_pct = CONFIG_LIMITS.SL_DISTANCE_DEFAULT;
    sl_lookback_period = 5;
    sl_lookback_timeframe = "5m";
    sl_pct_limit = 1.0;
    sl_min_pct = 0.3;
    sl_max_pct = 3.0;
    sl_out_of_bounds_action = 'clamp';
    reject_entry_if_sl_exceeds_max = true;
    htf_ema_cross_boost_enabled = true;
    htf_ema_cross_interval = "4h";
    htf_ema_cross_count = 4;
    htf_ema_fast_period = 9;
    htf_ema_slow_period = 21;
    htf_ema_cross_max_boost = 25.0;
    htf_ema_cross_rr_weight = 1.5;
    tp_mode = 'fixed';
    tp_ratio = CONFIG_LIMITS.TP_RATIO_DEFAULT;
    // Exponential RR Sequence for Profit Locking
    live_rr_sequence = [1.0, 2.0, 4.0];
    exit_rr_sequence = [0.0, 1.0, 2.0];
    // Dynamic RR Milestone Switch Options
    peak_rr_switch_threshold = 5.0;
    peak_rr_switch_count = 1;
    switched_sl_distance_pct;
    switched_live_rr_sequence = [1.0, 2.0, 3.0];
    switched_exit_rr_sequence = [0.0, 1.0, 1.5];
    // Exit Signal Configuration - ANY exit signal fires close
    exit_signals = [];
    exit_signal_logic = 'any';
    required_exit_signals = [];
    exit_signals_override_ratchet = false;
    exit_signal_delays = {};
    exit_signal_actions = {};
    signal_timeframes = {};
    // Risk Management
    risk_pct_per_trade = CONFIG_LIMITS.RISK_PER_TRADE_DEFAULT;
    max_open_trades = CONFIG_LIMITS.MAX_OPEN_TRADES_DEFAULT;
    max_open_trades_per_symbol = 1;
    max_trades_per_period = 0;
    trades_period_min = 60;
    max_trades_24h = CONFIG_LIMITS.MAX_TRADES_24H_DEFAULT;
    min_trade_interval_min = 0;
    trades_jitter_pct = 0;
    trades_jitter_market_aware = false;
    frequency_shaping_enabled = false;
    frequency_tod_integration = false;
    max_total_risk_pct = CONFIG_LIMITS.MAX_TOTAL_RISK_DEFAULT;
    martingale_enabled = false;
    martingale_multiplier = 2.0;
    martingale_reset_threshold_pct = 4.0;
    martingale_max_steps = 3;
    martingale_post_reset_behavior = 'wait';
    total_sl_guard_usdt = CONFIG_LIMITS.TOTAL_SL_GUARD_DEFAULT;
    auto_scale_min_notional = true;
    auto_scale_max_overshoot = 3.0;
    risk_hardening_enabled = false;
    max_single_trade_risk_pct = 20.0;
    // Balance & Mode Configuration
    paper_mode = true;
    trading_mode = 'paper';
    paper_starting_balance = CONFIG_LIMITS.PAPER_STARTING_BALANCE_DEFAULT;
    testnet_starting_balance = 10000.0;
    live_starting_balance = CONFIG_LIMITS.LIVE_STARTING_BALANCE_DEFAULT;
    // API & Monitoring
    track_binance_rate_limits = true;
    telemetry_enabled = true;
    rate_limit_warning_interval_min = 5;
    // Schedule & Advanced Risk
    trading_windows = [];
    risk_use_tod_stats = false;
    tod_min_winrate = 40.0;
    // Performance & Debug
    hot_loop_interval_ms = CONFIG_LIMITS.HOT_LOOP_DEFAULT;
    main_loop_interval_ms = CONFIG_LIMITS.MAIN_LOOP_DEFAULT;
    leverage = CONFIG_LIMITS.LEVERAGE_DEFAULT;
    slippage_warning_threshold = CONFIG_LIMITS.SLIPPAGE_THRESHOLD_DEFAULT;
    slippage_abort_threshold = CONFIG_LIMITS.SLIPPAGE_ABORT_DEFAULT;
    debug_mode = false;
    hibernation_mode = 'adaptive';
    hibernation_grace_period_sec = 30;
    trailing_guard_buffer_pct = CONFIG_LIMITS.TRAILING_GUARD_DEFAULT;
    trailing_execution_mode = 'exchange';
    trailing_stop_enabled = false;
    trailing_stop_type = 'pct';
    trailing_stop_distance_pct = 1.0;
    trailing_stop_rr = 1.0;
    trailing_activation_rr = 0.0;
    knife_trailing_enabled = true;
    knife_trailing_distance_pct = 0.5;
    knife_auto_ratchet_be_rr = 0.5;
    knife_auto_ratchet_lock_rr = 1.0;
    anti_whipsaw_allow_knife = false;
    anti_whipsaw_per_strategy = true;
    anti_whipsaw_timeframes;
    anti_whipsaw_max_tf = "4h";
    anti_whipsaw_candle_delay = 1;
    anti_whipsaw_tf_delay_min = 0;
    allow_knife_when_gated = false;
    auto_adjust_max_trades_enabled = false;
    auto_adjust_max_trades_min = 1;
    auto_adjust_max_trades_max = 5;
    auto_adjust_max_trades_step = 1;
    force_risk_release = false;
    release_risk_on_est_pnl_be = false;
    scanner_weights = {
        momentum: 0.5,
        volatility: 0.3,
        trend: 0.2
    };
}
__decorate([
    IsBoolean(),
    IsOptional(),
    __metadata("design:type", Boolean)
], SessionConfig.prototype, "paused", void 0);
__decorate([
    IsArray(),
    IsString({ each: true }),
    IsOptional(),
    ArrayMaxSize(100),
    MaxLength(100, { each: true }),
    Matches(/^[a-zA-Z0-9_ .\-()><=%+,\[\]]*$/, { each: true, message: 'Paused strategies can only contain alphanumeric characters, spaces, underscores, dots, hyphens, and safe descriptive characters like (), ><=, %, +, ,, and []' }),
    Matches(/^(?!.*<[a-zA-Z!/]).*$/, { each: true, message: 'Paused strategies cannot contain HTML tags or tag-like structures' }),
    __metadata("design:type", Array)
], SessionConfig.prototype, "paused_strategies", void 0);
__decorate([
    IsBoolean(),
    IsOptional(),
    __metadata("design:type", Boolean)
], SessionConfig.prototype, "is_nominal_overshoot", void 0);
__decorate([
    IsString(),
    IsOptional(),
    MaxLength(100),
    Matches(/^[a-zA-Z0-9_ .\-()><=%+,\[\]]*$/, { message: 'Strategy label can only contain alphanumeric characters, spaces, underscores, dots, hyphens, and safe descriptive characters like (), ><=, %, +, ,, and []' }),
    Matches(/^(?!.*<[a-zA-Z!/]).*$/, { message: 'Strategy label cannot contain HTML tags or tag-like structures' }),
    __metadata("design:type", String)
], SessionConfig.prototype, "strategy_label", void 0);
__decorate([
    IsArray(),
    IsOptional(),
    ArrayMaxSize(CONFIG_LIMITS.MAX_VARIANTS),
    ValidateNested({ each: true }),
    Type(() => SessionConfig),
    __metadata("design:type", Array)
], SessionConfig.prototype, "strategy_variants", void 0);
__decorate([
    IsBoolean(),
    IsOptional(),
    __metadata("design:type", Boolean)
], SessionConfig.prototype, "global_scanner_enabled", void 0);
__decorate([
    IsBoolean(),
    IsOptional(),
    __metadata("design:type", Boolean)
], SessionConfig.prototype, "smart_watchlist_enabled", void 0);
__decorate([
    IsNumber(),
    IsOptional(),
    Min(0.1),
    Max(1.0),
    __metadata("design:type", Number)
], SessionConfig.prototype, "smart_watchlist_sensitivity", void 0);
__decorate([
    IsArray(),
    IsOptional(),
    ArrayMaxSize(CONFIG_LIMITS.MAX_SINGLE_SYMBOL_MONITORS),
    ValidateNested({ each: true }),
    Type(() => SingleSymbolConfig),
    __metadata("design:type", Array)
], SessionConfig.prototype, "single_symbol_configs", void 0);
__decorate([
    IsString(),
    IsOptional(),
    MaxLength(10),
    Matches(/^(1m|3m|5m|15m|30m|1h|2h|4h|6h|8h|12h|1d|3d|1w|1M)$/, { message: 'scan_interval must be a valid Binance kline interval' }),
    __metadata("design:type", String)
], SessionConfig.prototype, "scan_interval", void 0);
__decorate([
    IsNumber(),
    Min(1),
    IsOptional(),
    __metadata("design:type", Number)
], SessionConfig.prototype, "scan_lookback", void 0);
__decorate([
    IsNumber(),
    Min(1),
    Max(50),
    IsOptional(),
    __metadata("design:type", Number)
], SessionConfig.prototype, "scanner_signal_depth", void 0);
__decorate([
    IsNumber(),
    Min(CONFIG_LIMITS.SCAN_PCT_THRESHOLD_MIN),
    IsOptional(),
    __metadata("design:type", Number)
], SessionConfig.prototype, "scan_pct_threshold", void 0);
__decorate([
    IsNumber(),
    Min(0),
    IsOptional(),
    __metadata("design:type", Number)
], SessionConfig.prototype, "scan_min_volume_usdt", void 0);
__decorate([
    IsEnum(['interval', 'active_window']),
    IsOptional(),
    __metadata("design:type", String)
], SessionConfig.prototype, "scan_mode", void 0);
__decorate([
    IsNumber(),
    Min(1),
    IsOptional(),
    __metadata("design:type", Number)
], SessionConfig.prototype, "scan_window_duration_sec", void 0);
__decorate([
    IsNumber(),
    Min(1),
    IsOptional(),
    __metadata("design:type", Number)
], SessionConfig.prototype, "scan_check_interval_sec", void 0);
__decorate([
    IsNumber(),
    Min(CONFIG_LIMITS.WATCHLIST_MIN),
    Max(CONFIG_LIMITS.WATCHLIST_MAX),
    IsOptional(),
    __metadata("design:type", Number)
], SessionConfig.prototype, "watchlist_size", void 0);
__decorate([
    IsNumber(),
    Min(0),
    Max(100),
    IsOptional(),
    __metadata("design:type", Number)
], SessionConfig.prototype, "watchlist_offset", void 0);
__decorate([
    IsNumber(),
    Min(0),
    Max(100),
    IsOptional(),
    __metadata("design:type", Number)
], SessionConfig.prototype, "watchlist_max_symbols", void 0);
__decorate([
    IsBoolean(),
    IsOptional(),
    __metadata("design:type", Boolean)
], SessionConfig.prototype, "watchlist_auto_rotate", void 0);
__decorate([
    IsBoolean(),
    IsOptional(),
    __metadata("design:type", Boolean)
], SessionConfig.prototype, "watchlist_locked", void 0);
__decorate([
    IsNumber(),
    Min(1),
    Max(10080),
    IsOptional(),
    __metadata("design:type", Number)
], SessionConfig.prototype, "watchlist_rotate_interval_min", void 0);
__decorate([
    IsNumber(),
    Min(0),
    Max(100),
    IsOptional(),
    __metadata("design:type", Number)
], SessionConfig.prototype, "watchlist_min_score", void 0);
__decorate([
    IsNumber(),
    Min(0),
    IsOptional(),
    __metadata("design:type", Number)
], SessionConfig.prototype, "watchlist_last_rotated_ts", void 0);
__decorate([
    IsEnum(['volume', 'change_pct', 'abs_change_pct']),
    IsOptional(),
    __metadata("design:type", String)
], SessionConfig.prototype, "discovery_mode", void 0);
__decorate([
    IsEnum(['both', 'long', 'short']),
    IsOptional(),
    __metadata("design:type", String)
], SessionConfig.prototype, "entry_side", void 0);
__decorate([
    IsArray(),
    IsString({ each: true }),
    IsOptional(),
    ArrayMaxSize(100),
    MaxLength(20, { each: true }),
    Matches(/^[a-zA-Z0-9_\-]*$/, { each: true, message: 'Symbols must contain only alphanumeric characters, underscores, or hyphens' }),
    __metadata("design:type", Array)
], SessionConfig.prototype, "excluded_symbols", void 0);
__decorate([
    IsArray(),
    IsString({ each: true }),
    IsOptional(),
    ArrayMaxSize(100),
    MaxLength(20, { each: true }),
    Matches(/^[a-zA-Z0-9_\-]*$/, { each: true, message: 'Symbols must contain only alphanumeric characters, underscores, or hyphens' }),
    __metadata("design:type", Array)
], SessionConfig.prototype, "symbols", void 0);
__decorate([
    IsArray(),
    IsString({ each: true }),
    IsOptional(),
    ArrayMaxSize(CONFIG_LIMITS.MAX_SIGNALS),
    MaxLength(50, { each: true }),
    Matches(/^[a-zA-Z0-9_]*$/, { each: true, message: 'Signals must contain only alphanumeric characters and underscores' }),
    __metadata("design:type", Array)
], SessionConfig.prototype, "enabled_signals", void 0);
__decorate([
    IsEnum(['any', 'all', 'combo']),
    IsOptional(),
    __metadata("design:type", String)
], SessionConfig.prototype, "signal_logic", void 0);
__decorate([
    IsArray(),
    IsString({ each: true }),
    IsOptional(),
    ArrayMaxSize(CONFIG_LIMITS.MAX_SIGNALS),
    MaxLength(50, { each: true }),
    Matches(/^[a-zA-Z0-9_]*$/, { each: true, message: 'Signals must contain only alphanumeric characters and underscores' }),
    __metadata("design:type", Array)
], SessionConfig.prototype, "required_signals", void 0);
__decorate([
    IsObject(),
    IsOptional(),
    Transform(({ value }) => {
        if (typeof value === 'string') {
            try {
                return JSON.parse(value);
            }
            catch (e) {
                return {};
            }
        }
        return value === null ? undefined : value;
    }),
    __metadata("design:type", Object)
], SessionConfig.prototype, "signal_params", void 0);
__decorate([
    IsEnum(['range', 'body', 'strict', 'close_range', 'close_body', 'soft_range', 'soft_body']),
    IsOptional(),
    __metadata("design:type", String)
], SessionConfig.prototype, "engulfing_mode", void 0);
__decorate([
    IsEnum(['is_opportunity', 'after_opportunity']),
    IsOptional(),
    __metadata("design:type", String)
], SessionConfig.prototype, "engulfing_timing", void 0);
__decorate([
    IsBoolean(),
    IsOptional(),
    __metadata("design:type", Boolean)
], SessionConfig.prototype, "engulfing_volume_confirm", void 0);
__decorate([
    IsNumber(),
    Min(1),
    Max(20),
    IsOptional(),
    __metadata("design:type", Number)
], SessionConfig.prototype, "engulfing_lookback", void 0);
__decorate([
    IsNumber(),
    Min(1),
    Max(10),
    IsOptional(),
    __metadata("design:type", Number)
], SessionConfig.prototype, "engulfing_streak", void 0);
__decorate([
    IsBoolean(),
    IsOptional(),
    __metadata("design:type", Boolean)
], SessionConfig.prototype, "engulfing_sequential", void 0);
__decorate([
    IsNumber(),
    Min(0),
    Max(100),
    IsOptional(),
    __metadata("design:type", Number)
], SessionConfig.prototype, "engulfing_max_expansion_pct", void 0);
__decorate([
    IsNumber(),
    Min(2),
    Max(200),
    IsOptional(),
    __metadata("design:type", Number)
], SessionConfig.prototype, "macd_pbc_trend_ema", void 0);
__decorate([
    IsNumber(),
    Min(1),
    Max(50),
    IsOptional(),
    __metadata("design:type", Number)
], SessionConfig.prototype, "macd_pbc_lookback", void 0);
__decorate([
    IsNumber(),
    Min(1),
    Max(50),
    IsOptional(),
    __metadata("design:type", Number)
], SessionConfig.prototype, "macd_pbc_max_continuation", void 0);
__decorate([
    IsString(),
    IsOptional(),
    MaxLength(10),
    Matches(/^(1m|3m|5m|15m|30m|1h|2h|4h|6h|8h|12h|1d|3d|1w|1M)$/, { message: 'htf_breakout_ref_timeframe must be a valid Binance kline interval' }),
    __metadata("design:type", String)
], SessionConfig.prototype, "htf_breakout_ref_timeframe", void 0);
__decorate([
    IsString(),
    IsOptional(),
    MaxLength(10),
    Matches(/^(default|1m|3m|5m|15m|30m|1h|2h|4h|6h|8h|12h|1d|3d|1w|1M)$/, { message: 'htf_breakout_trigger_timeframe must be a valid Binance kline interval or default' }),
    __metadata("design:type", String)
], SessionConfig.prototype, "htf_breakout_trigger_timeframe", void 0);
__decorate([
    IsEnum(['close_break', 'closed_candle_confirm', 'wick_break']),
    IsOptional(),
    __metadata("design:type", String)
], SessionConfig.prototype, "htf_breakout_mode", void 0);
__decorate([
    IsEnum(['high_low', 'open_close_body', 'close_only']),
    IsOptional(),
    __metadata("design:type", String)
], SessionConfig.prototype, "htf_breakout_reference_level", void 0);
__decorate([
    IsNumber(),
    Min(1),
    Max(100),
    IsOptional(),
    __metadata("design:type", Number)
], SessionConfig.prototype, "htf_breakout_lookback", void 0);
__decorate([
    IsNumber(),
    Min(0),
    Max(100),
    IsOptional(),
    __metadata("design:type", Number)
], SessionConfig.prototype, "htf_breakout_buffer_pct", void 0);
__decorate([
    IsNumber(),
    Min(0),
    Max(100),
    IsOptional(),
    __metadata("design:type", Number)
], SessionConfig.prototype, "htf_breakout_max_expansion_pct", void 0);
__decorate([
    IsBoolean(),
    IsOptional(),
    __metadata("design:type", Boolean)
], SessionConfig.prototype, "trigger_candle_exit_enabled", void 0);
__decorate([
    IsNumber(),
    Min(0),
    Max(50),
    IsOptional(),
    __metadata("design:type", Number)
], SessionConfig.prototype, "trigger_candle_exit_n", void 0);
__decorate([
    IsEnum(['prev_and_next', 'prev_only', 'next_only']),
    IsOptional(),
    __metadata("design:type", String)
], SessionConfig.prototype, "trigger_candle_exit_offset_mode", void 0);
__decorate([
    IsEnum(['close', 'wick']),
    IsOptional(),
    __metadata("design:type", String)
], SessionConfig.prototype, "trigger_candle_exit_mode", void 0);
__decorate([
    IsString(),
    IsOptional(),
    MaxLength(10),
    Matches(/^(default|1m|3m|5m|15m|30m|1h|2h|4h|6h|8h|12h|1d|3d|1w|1M)$/, { message: 'trigger_candle_exit_timeframe must be a valid Binance kline interval or default' }),
    __metadata("design:type", String)
], SessionConfig.prototype, "trigger_candle_exit_timeframe", void 0);
__decorate([
    IsNumber(),
    Min(0),
    Max(100),
    IsOptional(),
    __metadata("design:type", Number)
], SessionConfig.prototype, "trigger_candle_exit_buffer_pct", void 0);
__decorate([
    IsEnum(['pct', 'lookback_low/high', 'engulfing_boundary', 'streak_extreme', 'trailing', 'supertrend']),
    IsOptional(),
    __metadata("design:type", String)
], SessionConfig.prototype, "sl_type", void 0);
__decorate([
    IsNumber(),
    Min(CONFIG_LIMITS.SL_DISTANCE_MIN),
    Max(CONFIG_LIMITS.SL_DISTANCE_MAX),
    IsOptional(),
    __metadata("design:type", Number)
], SessionConfig.prototype, "sl_distance_pct", void 0);
__decorate([
    IsNumber(),
    Min(1),
    IsOptional(),
    __metadata("design:type", Number)
], SessionConfig.prototype, "sl_lookback_period", void 0);
__decorate([
    IsString(),
    IsOptional(),
    MaxLength(10),
    Matches(/^(1m|3m|5m|15m|30m|1h|2h|4h|6h|8h|12h|1d|3d|1w|1M)$/, { message: 'sl_lookback_timeframe must be a valid Binance kline interval' }),
    __metadata("design:type", String)
], SessionConfig.prototype, "sl_lookback_timeframe", void 0);
__decorate([
    IsNumber(),
    Min(0.1),
    IsOptional(),
    __metadata("design:type", Number)
], SessionConfig.prototype, "sl_pct_limit", void 0);
__decorate([
    IsNumber(),
    Min(0.1),
    IsOptional(),
    __metadata("design:type", Number)
], SessionConfig.prototype, "sl_min_pct", void 0);
__decorate([
    IsNumber(),
    Min(0.1),
    IsOptional(),
    __metadata("design:type", Number)
], SessionConfig.prototype, "sl_max_pct", void 0);
__decorate([
    IsEnum(['clamp', 'reject']),
    IsOptional(),
    __metadata("design:type", String)
], SessionConfig.prototype, "sl_out_of_bounds_action", void 0);
__decorate([
    IsBoolean(),
    IsOptional(),
    __metadata("design:type", Boolean)
], SessionConfig.prototype, "reject_entry_if_sl_exceeds_max", void 0);
__decorate([
    IsBoolean(),
    IsOptional(),
    __metadata("design:type", Boolean)
], SessionConfig.prototype, "htf_ema_cross_boost_enabled", void 0);
__decorate([
    IsString(),
    IsOptional(),
    MaxLength(10),
    Matches(/^(1m|3m|5m|15m|30m|1h|2h|4h|6h|8h|12h|1d|3d|1w|1M)$/, { message: 'htf_ema_cross_interval must be a valid Binance kline interval' }),
    __metadata("design:type", String)
], SessionConfig.prototype, "htf_ema_cross_interval", void 0);
__decorate([
    IsNumber(),
    Min(1),
    Max(20),
    IsOptional(),
    __metadata("design:type", Number)
], SessionConfig.prototype, "htf_ema_cross_count", void 0);
__decorate([
    IsNumber(),
    Min(2),
    Max(200),
    IsOptional(),
    __metadata("design:type", Number)
], SessionConfig.prototype, "htf_ema_fast_period", void 0);
__decorate([
    IsNumber(),
    Min(2),
    Max(200),
    IsOptional(),
    __metadata("design:type", Number)
], SessionConfig.prototype, "htf_ema_slow_period", void 0);
__decorate([
    IsNumber(),
    Min(0),
    Max(50),
    IsOptional(),
    __metadata("design:type", Number)
], SessionConfig.prototype, "htf_ema_cross_max_boost", void 0);
__decorate([
    IsNumber(),
    Min(0),
    Max(10),
    IsOptional(),
    __metadata("design:type", Number)
], SessionConfig.prototype, "htf_ema_cross_rr_weight", void 0);
__decorate([
    IsEnum(['fixed', 'exp_rr_seq', 'exp_rr_seq_switch']),
    IsOptional(),
    __metadata("design:type", String)
], SessionConfig.prototype, "tp_mode", void 0);
__decorate([
    IsNumber(),
    Min(CONFIG_LIMITS.TP_RATIO_MIN),
    IsOptional(),
    __metadata("design:type", Number)
], SessionConfig.prototype, "tp_ratio", void 0);
__decorate([
    IsArray(),
    IsNumber({}, { each: true }),
    IsOptional(),
    ArrayMaxSize(10),
    __metadata("design:type", Array)
], SessionConfig.prototype, "live_rr_sequence", void 0);
__decorate([
    IsArray(),
    IsNumber({}, { each: true }),
    IsOptional(),
    ArrayMaxSize(10),
    __metadata("design:type", Array)
], SessionConfig.prototype, "exit_rr_sequence", void 0);
__decorate([
    IsNumber(),
    Min(0.1),
    IsOptional(),
    __metadata("design:type", Number)
], SessionConfig.prototype, "peak_rr_switch_threshold", void 0);
__decorate([
    IsNumber(),
    Min(1),
    IsOptional(),
    __metadata("design:type", Number)
], SessionConfig.prototype, "peak_rr_switch_count", void 0);
__decorate([
    IsNumber(),
    Min(0.1),
    Max(CONFIG_LIMITS.SL_DISTANCE_MAX),
    IsOptional(),
    __metadata("design:type", Number)
], SessionConfig.prototype, "switched_sl_distance_pct", void 0);
__decorate([
    IsArray(),
    IsNumber({}, { each: true }),
    IsOptional(),
    ArrayMaxSize(10),
    __metadata("design:type", Array)
], SessionConfig.prototype, "switched_live_rr_sequence", void 0);
__decorate([
    IsArray(),
    IsNumber({}, { each: true }),
    IsOptional(),
    ArrayMaxSize(10),
    __metadata("design:type", Array)
], SessionConfig.prototype, "switched_exit_rr_sequence", void 0);
__decorate([
    IsArray(),
    IsString({ each: true }),
    IsOptional(),
    ArrayMaxSize(CONFIG_LIMITS.MAX_SIGNALS),
    MaxLength(50, { each: true }),
    Matches(/^[a-zA-Z0-9_]*$/, { each: true, message: 'Signals must contain only alphanumeric characters and underscores' }),
    __metadata("design:type", Array)
], SessionConfig.prototype, "exit_signals", void 0);
__decorate([
    IsEnum(['any', 'all', 'combo']),
    IsOptional(),
    __metadata("design:type", String)
], SessionConfig.prototype, "exit_signal_logic", void 0);
__decorate([
    IsArray(),
    IsString({ each: true }),
    IsOptional(),
    ArrayMaxSize(CONFIG_LIMITS.MAX_SIGNALS),
    MaxLength(50, { each: true }),
    Matches(/^[a-zA-Z0-9_]*$/, { each: true, message: 'Signals must contain only alphanumeric characters and underscores' }),
    __metadata("design:type", Array)
], SessionConfig.prototype, "required_exit_signals", void 0);
__decorate([
    IsBoolean(),
    IsOptional(),
    __metadata("design:type", Boolean)
], SessionConfig.prototype, "exit_signals_override_ratchet", void 0);
__decorate([
    IsObject(),
    IsOptional(),
    __metadata("design:type", Object)
], SessionConfig.prototype, "exit_signal_delays", void 0);
__decorate([
    IsObject(),
    IsOptional(),
    __metadata("design:type", Object)
], SessionConfig.prototype, "exit_signal_actions", void 0);
__decorate([
    IsObject(),
    IsOptional(),
    __metadata("design:type", Object)
], SessionConfig.prototype, "signal_timeframes", void 0);
__decorate([
    IsNumber(),
    Min(CONFIG_LIMITS.RISK_PER_TRADE_MIN),
    Max(CONFIG_LIMITS.RISK_PER_TRADE_MAX),
    IsOptional(),
    __metadata("design:type", Number)
], SessionConfig.prototype, "risk_pct_per_trade", void 0);
__decorate([
    IsNumber(),
    Min(CONFIG_LIMITS.MAX_OPEN_TRADES_MIN),
    IsOptional(),
    __metadata("design:type", Number)
], SessionConfig.prototype, "max_open_trades", void 0);
__decorate([
    IsNumber(),
    Min(1),
    IsOptional(),
    __metadata("design:type", Number)
], SessionConfig.prototype, "max_open_trades_per_symbol", void 0);
__decorate([
    IsNumber(),
    Min(0),
    IsOptional(),
    __metadata("design:type", Number)
], SessionConfig.prototype, "max_trades_per_period", void 0);
__decorate([
    IsNumber(),
    Min(1),
    IsOptional(),
    __metadata("design:type", Number)
], SessionConfig.prototype, "trades_period_min", void 0);
__decorate([
    IsNumber(),
    Min(0),
    IsOptional(),
    __metadata("design:type", Number)
], SessionConfig.prototype, "max_trades_24h", void 0);
__decorate([
    IsNumber(),
    Min(0),
    IsOptional(),
    __metadata("design:type", Number)
], SessionConfig.prototype, "min_trade_interval_min", void 0);
__decorate([
    IsNumber(),
    Min(0),
    Max(100),
    IsOptional(),
    __metadata("design:type", Number)
], SessionConfig.prototype, "trades_jitter_pct", void 0);
__decorate([
    IsBoolean(),
    IsOptional(),
    __metadata("design:type", Boolean)
], SessionConfig.prototype, "trades_jitter_market_aware", void 0);
__decorate([
    IsBoolean(),
    IsOptional(),
    __metadata("design:type", Boolean)
], SessionConfig.prototype, "frequency_shaping_enabled", void 0);
__decorate([
    IsBoolean(),
    IsOptional(),
    __metadata("design:type", Boolean)
], SessionConfig.prototype, "frequency_tod_integration", void 0);
__decorate([
    IsNumber(),
    Min(CONFIG_LIMITS.MAX_TOTAL_RISK_MIN),
    Max(CONFIG_LIMITS.MAX_TOTAL_RISK_MAX),
    IsOptional(),
    __metadata("design:type", Number)
], SessionConfig.prototype, "max_total_risk_pct", void 0);
__decorate([
    IsBoolean(),
    IsOptional(),
    __metadata("design:type", Boolean)
], SessionConfig.prototype, "martingale_enabled", void 0);
__decorate([
    IsNumber(),
    Min(1.0),
    Max(10.0),
    IsOptional(),
    __metadata("design:type", Number)
], SessionConfig.prototype, "martingale_multiplier", void 0);
__decorate([
    IsNumber(),
    Min(CONFIG_LIMITS.RISK_PER_TRADE_MIN),
    Max(CONFIG_LIMITS.RISK_PER_TRADE_MAX),
    IsOptional(),
    __metadata("design:type", Number)
], SessionConfig.prototype, "martingale_reset_threshold_pct", void 0);
__decorate([
    IsNumber(),
    Min(1),
    Max(20),
    IsOptional(),
    __metadata("design:type", Number)
], SessionConfig.prototype, "martingale_max_steps", void 0);
__decorate([
    IsString(),
    IsIn(['restart', 'wait']),
    IsOptional(),
    __metadata("design:type", String)
], SessionConfig.prototype, "martingale_post_reset_behavior", void 0);
__decorate([
    IsNumber(),
    Min(0),
    IsOptional(),
    __metadata("design:type", Number)
], SessionConfig.prototype, "total_sl_guard_usdt", void 0);
__decorate([
    IsBoolean(),
    IsOptional(),
    __metadata("design:type", Boolean)
], SessionConfig.prototype, "auto_scale_min_notional", void 0);
__decorate([
    IsNumber(),
    IsOptional(),
    Min(1.0),
    Max(10.0),
    __metadata("design:type", Number)
], SessionConfig.prototype, "auto_scale_max_overshoot", void 0);
__decorate([
    IsBoolean(),
    IsOptional(),
    __metadata("design:type", Boolean)
], SessionConfig.prototype, "risk_hardening_enabled", void 0);
__decorate([
    IsNumber(),
    IsOptional(),
    Min(0.1),
    Max(100.0),
    __metadata("design:type", Number)
], SessionConfig.prototype, "max_single_trade_risk_pct", void 0);
__decorate([
    IsBoolean(),
    IsOptional(),
    __metadata("design:type", Boolean)
], SessionConfig.prototype, "paper_mode", void 0);
__decorate([
    IsEnum(['paper', 'testnet', 'live', 'backtest']),
    IsOptional(),
    __metadata("design:type", String)
], SessionConfig.prototype, "trading_mode", void 0);
__decorate([
    IsNumber(),
    Min(0),
    IsOptional(),
    __metadata("design:type", Number)
], SessionConfig.prototype, "paper_starting_balance", void 0);
__decorate([
    IsNumber(),
    Min(0),
    IsOptional(),
    __metadata("design:type", Number)
], SessionConfig.prototype, "testnet_starting_balance", void 0);
__decorate([
    IsNumber(),
    Min(0),
    IsOptional(),
    __metadata("design:type", Number)
], SessionConfig.prototype, "live_starting_balance", void 0);
__decorate([
    IsBoolean(),
    IsOptional(),
    __metadata("design:type", Boolean)
], SessionConfig.prototype, "track_binance_rate_limits", void 0);
__decorate([
    IsBoolean(),
    IsOptional(),
    __metadata("design:type", Boolean)
], SessionConfig.prototype, "telemetry_enabled", void 0);
__decorate([
    IsNumber(),
    Min(5),
    Max(60),
    IsOptional(),
    __metadata("design:type", Number)
], SessionConfig.prototype, "rate_limit_warning_interval_min", void 0);
__decorate([
    IsArray(),
    IsOptional(),
    ArrayMaxSize(CONFIG_LIMITS.MAX_TRADING_WINDOWS),
    ValidateNested({ each: true }),
    Type(() => TradingWindow),
    __metadata("design:type", Array)
], SessionConfig.prototype, "trading_windows", void 0);
__decorate([
    IsBoolean(),
    IsOptional(),
    __metadata("design:type", Boolean)
], SessionConfig.prototype, "risk_use_tod_stats", void 0);
__decorate([
    IsNumber(),
    IsOptional(),
    __metadata("design:type", Number)
], SessionConfig.prototype, "tod_min_winrate", void 0);
__decorate([
    IsNumber(),
    IsOptional(),
    Min(CONFIG_LIMITS.HOT_LOOP_MIN),
    __metadata("design:type", Number)
], SessionConfig.prototype, "hot_loop_interval_ms", void 0);
__decorate([
    IsNumber(),
    IsOptional(),
    Min(CONFIG_LIMITS.MAIN_LOOP_MIN),
    __metadata("design:type", Number)
], SessionConfig.prototype, "main_loop_interval_ms", void 0);
__decorate([
    IsNumber(),
    IsOptional(),
    Min(CONFIG_LIMITS.LEVERAGE_MIN),
    Max(CONFIG_LIMITS.LEVERAGE_MAX),
    __metadata("design:type", Number)
], SessionConfig.prototype, "leverage", void 0);
__decorate([
    IsNumber(),
    IsOptional(),
    Min(0),
    __metadata("design:type", Number)
], SessionConfig.prototype, "slippage_warning_threshold", void 0);
__decorate([
    IsNumber(),
    IsOptional(),
    Min(0),
    Max(CONFIG_LIMITS.SLIPPAGE_ABORT_MAX),
    __metadata("design:type", Number)
], SessionConfig.prototype, "slippage_abort_threshold", void 0);
__decorate([
    IsBoolean(),
    IsOptional(),
    __metadata("design:type", Boolean)
], SessionConfig.prototype, "debug_mode", void 0);
__decorate([
    IsEnum(['deep', 'light', 'adaptive']),
    IsOptional(),
    __metadata("design:type", String)
], SessionConfig.prototype, "hibernation_mode", void 0);
__decorate([
    IsNumber(),
    Min(5),
    Max(3600),
    IsOptional(),
    __metadata("design:type", Number)
], SessionConfig.prototype, "hibernation_grace_period_sec", void 0);
__decorate([
    IsNumber(),
    IsOptional(),
    Min(CONFIG_LIMITS.TRAILING_GUARD_MIN),
    Max(CONFIG_LIMITS.TRAILING_GUARD_MAX),
    __metadata("design:type", Number)
], SessionConfig.prototype, "trailing_guard_buffer_pct", void 0);
__decorate([
    IsEnum(['exchange', 'local', 'native']),
    IsOptional(),
    __metadata("design:type", String)
], SessionConfig.prototype, "trailing_execution_mode", void 0);
__decorate([
    IsBoolean(),
    IsOptional(),
    __metadata("design:type", Boolean)
], SessionConfig.prototype, "trailing_stop_enabled", void 0);
__decorate([
    IsIn(['pct', 'rr']),
    IsOptional(),
    __metadata("design:type", String)
], SessionConfig.prototype, "trailing_stop_type", void 0);
__decorate([
    IsNumber(),
    IsOptional(),
    Min(0.1),
    Max(10.0),
    __metadata("design:type", Number)
], SessionConfig.prototype, "trailing_stop_distance_pct", void 0);
__decorate([
    IsNumber(),
    IsOptional(),
    Min(0.1),
    Max(10.0),
    __metadata("design:type", Number)
], SessionConfig.prototype, "trailing_stop_rr", void 0);
__decorate([
    IsNumber(),
    IsOptional(),
    Min(0.0),
    Max(10.0),
    __metadata("design:type", Number)
], SessionConfig.prototype, "trailing_activation_rr", void 0);
__decorate([
    IsBoolean(),
    IsOptional(),
    __metadata("design:type", Boolean)
], SessionConfig.prototype, "knife_trailing_enabled", void 0);
__decorate([
    IsNumber(),
    IsOptional(),
    Min(0.1),
    Max(10.0),
    __metadata("design:type", Number)
], SessionConfig.prototype, "knife_trailing_distance_pct", void 0);
__decorate([
    IsNumber(),
    IsOptional(),
    Min(0.1),
    Max(5.0),
    __metadata("design:type", Number)
], SessionConfig.prototype, "knife_auto_ratchet_be_rr", void 0);
__decorate([
    IsNumber(),
    IsOptional(),
    Min(0.1),
    Max(10.0),
    __metadata("design:type", Number)
], SessionConfig.prototype, "knife_auto_ratchet_lock_rr", void 0);
__decorate([
    IsBoolean(),
    IsOptional(),
    __metadata("design:type", Boolean)
], SessionConfig.prototype, "anti_whipsaw_allow_knife", void 0);
__decorate([
    IsBoolean(),
    IsOptional(),
    __metadata("design:type", Boolean)
], SessionConfig.prototype, "anti_whipsaw_per_strategy", void 0);
__decorate([
    IsArray(),
    IsString({ each: true }),
    IsOptional(),
    ArrayMaxSize(10),
    Matches(/^(1m|3m|5m|15m|30m|1h|2h|4h|6h|8h|12h|1d|3d|1w|1M)$/, { each: true, message: 'anti_whipsaw_timeframes must be valid Binance kline intervals' }),
    __metadata("design:type", Array)
], SessionConfig.prototype, "anti_whipsaw_timeframes", void 0);
__decorate([
    IsString(),
    IsOptional(),
    Matches(/^(1m|3m|5m|15m|30m|1h|2h|4h|6h|8h|12h|1d|3d|1w|1M|none)$/),
    __metadata("design:type", String)
], SessionConfig.prototype, "anti_whipsaw_max_tf", void 0);
__decorate([
    IsNumber(),
    Min(0),
    Max(20),
    IsOptional(),
    __metadata("design:type", Number)
], SessionConfig.prototype, "anti_whipsaw_candle_delay", void 0);
__decorate([
    IsNumber(),
    Min(0),
    Max(1440),
    IsOptional(),
    __metadata("design:type", Number)
], SessionConfig.prototype, "anti_whipsaw_tf_delay_min", void 0);
__decorate([
    IsBoolean(),
    IsOptional(),
    __metadata("design:type", Boolean)
], SessionConfig.prototype, "allow_knife_when_gated", void 0);
__decorate([
    IsBoolean(),
    IsOptional(),
    __metadata("design:type", Boolean)
], SessionConfig.prototype, "auto_adjust_max_trades_enabled", void 0);
__decorate([
    IsNumber(),
    Min(1),
    Max(20),
    IsOptional(),
    __metadata("design:type", Number)
], SessionConfig.prototype, "auto_adjust_max_trades_min", void 0);
__decorate([
    IsNumber(),
    Min(1),
    Max(50),
    IsOptional(),
    __metadata("design:type", Number)
], SessionConfig.prototype, "auto_adjust_max_trades_max", void 0);
__decorate([
    IsNumber(),
    Min(1),
    Max(5),
    IsOptional(),
    __metadata("design:type", Number)
], SessionConfig.prototype, "auto_adjust_max_trades_step", void 0);
__decorate([
    IsBoolean(),
    IsOptional(),
    __metadata("design:type", Boolean)
], SessionConfig.prototype, "force_risk_release", void 0);
__decorate([
    IsBoolean(),
    IsOptional(),
    __metadata("design:type", Boolean)
], SessionConfig.prototype, "release_risk_on_est_pnl_be", void 0);
__decorate([
    IsObject(),
    IsOptional(),
    __metadata("design:type", Object)
], SessionConfig.prototype, "scanner_weights", void 0);
