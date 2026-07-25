import { IsString, IsNumber, IsOptional, IsEnum, IsArray, IsBoolean, Min, Max, IsObject, ValidateNested, MaxLength, ArrayMaxSize, Matches } from 'class-validator';
import { Type, Transform } from 'class-transformer';
import { CONFIG_LIMITS } from './constants';

export class SingleSymbolConfig {
  @IsString()
  @MaxLength(20)
  @Matches(/^[a-zA-Z0-9_\-]*$/, { message: 'Symbol must contain only alphanumeric characters, underscores, or hyphens' })
  symbol: string = "";

  @IsBoolean()
  @IsOptional()
  enabled: boolean = true;

  @IsBoolean()
  @IsOptional()
  follow_schedule: boolean = true;

  @IsBoolean()
  @IsOptional()
  use_custom_config: boolean = false;

  @IsObject()
  @IsOptional()
  @ValidateNested()
  @Type(() => SessionConfig)
  custom_config?: Partial<SessionConfig>;
}

export class SessionConfig {
  @IsString()
  @IsOptional()
  @MaxLength(100)
  @Matches(/^[a-zA-Z0-9_\s.\-()><=%+,\[\]]*$/, { message: 'Strategy label can only contain alphanumeric characters, spaces, underscores, dots, hyphens, and safe descriptive characters like (), ><=, %, +, ,, and []' })
  @Matches(/^(?!.*<[a-zA-Z!/]).*$/, { message: 'Strategy label cannot contain HTML tags or tag-like structures' })
  strategy_label?: string = "Momentum Strategy";

  @IsArray()
  @IsOptional()
  @ArrayMaxSize(CONFIG_LIMITS.MAX_VARIANTS)
  @ValidateNested({ each: true })
  @Type(() => SessionConfig)
  strategy_variants?: Partial<SessionConfig>[] = [];

  @IsBoolean()
  @IsOptional()
  global_scanner_enabled: boolean = true;

  @IsBoolean()
  @IsOptional()
  smart_watchlist_enabled?: boolean = false;

  @IsNumber()
  @IsOptional()
  @Min(0.1)
  @Max(1.0)
  smart_watchlist_sensitivity?: number = 0.7;

  @IsArray()
  @IsOptional()
  @ArrayMaxSize(CONFIG_LIMITS.MAX_SINGLE_SYMBOL_MONITORS)
  @ValidateNested({ each: true })
  @Type(() => SingleSymbolConfig)
  single_symbol_configs: SingleSymbolConfig[] = [];

  @IsString()
  @IsOptional()
  @MaxLength(10)
  @Matches(/^(1m|3m|5m|15m|30m|1h|2h|4h|6h|8h|12h|1d|3d|1w|1M)$/, { message: 'scan_interval must be a valid Binance kline interval' })
  scan_interval: string = "5m";

  @IsNumber()
  @Min(1)
  @IsOptional()
  scan_lookback: number = 3;

  @IsNumber()
  @Min(1)
  @Max(50)
  @IsOptional()
  scanner_signal_depth?: number = 10;

  @IsNumber()
  @Min(CONFIG_LIMITS.SCAN_PCT_THRESHOLD_MIN)
  @IsOptional()
  scan_pct_threshold: number = 2.0;

  @IsNumber()
  @Min(0)
  @IsOptional()
  scan_min_volume_usdt?: number = 500000;

  @IsEnum(['interval', 'active_window'])
  @IsOptional()
  scan_mode?: 'interval' | 'active_window' = 'interval';

  @IsNumber()
  @Min(1)
  @IsOptional()
  scan_window_duration_sec?: number = 90;

  @IsNumber()
  @Min(1)
  @IsOptional()
  scan_check_interval_sec?: number = 5;

  @IsNumber()
  @Min(CONFIG_LIMITS.WATCHLIST_MIN)
  @Max(CONFIG_LIMITS.WATCHLIST_MAX)
  @IsOptional()
  watchlist_size: number = CONFIG_LIMITS.WATCHLIST_DEFAULT;

  @IsNumber()
  @Min(0)
  @Max(100)
  @IsOptional()
  watchlist_offset?: number = 0;

  @IsEnum(['volume', 'change_pct'])
  @IsOptional()
  discovery_mode?: 'volume' | 'change_pct' = 'volume';

  @IsEnum(['both', 'long', 'short'])
  @IsOptional()
  entry_side?: 'both' | 'long' | 'short' = 'both';

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  @ArrayMaxSize(100)
  @MaxLength(20, { each: true })
  @Matches(/^[a-zA-Z0-9_\-]*$/, { each: true, message: 'Symbols must contain only alphanumeric characters, underscores, or hyphens' })
  excluded_symbols?: string[];

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  @ArrayMaxSize(100)
  @MaxLength(20, { each: true })
  @Matches(/^[a-zA-Z0-9_\-]*$/, { each: true, message: 'Symbols must contain only alphanumeric characters, underscores, or hyphens' })
  symbols?: string[];

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  @ArrayMaxSize(CONFIG_LIMITS.MAX_SIGNALS)
  @MaxLength(50, { each: true })
  @Matches(/^[a-zA-Z0-9_]*$/, { each: true, message: 'Signals must contain only alphanumeric characters and underscores' })
  enabled_signals?: string[] = ['momentum_pct'];

  @IsEnum(['any', 'all'])
  @IsOptional()
  signal_logic?: 'any' | 'all' = 'all';

  @IsObject()
  @IsOptional()
  @Transform(({ value }) => {
    if (typeof value === 'string') {
      try { return JSON.parse(value); } catch (e) { return {}; }
    }
    return value === null ? undefined : value;
  })
  signal_params?: Record<string, any>;

  @IsEnum(['range', 'body', 'strict', 'close_range', 'close_body', 'soft_range', 'soft_body'])
  @IsOptional()
  engulfing_mode?: 'range' | 'body' | 'strict' | 'close_range' | 'close_body' | 'soft_range' | 'soft_body' = 'range';

  @IsEnum(['is_opportunity', 'after_opportunity'])
  @IsOptional()
  engulfing_timing?: 'is_opportunity' | 'after_opportunity' = 'is_opportunity';

  @IsBoolean()
  @IsOptional()
  engulfing_volume_confirm?: boolean = false;

  @IsNumber()
  @Min(1)
  @Max(20)
  @IsOptional()
  engulfing_lookback?: number = 1;

  @IsNumber()
  @Min(1)
  @Max(10)
  @IsOptional()
  engulfing_streak?: number = 1;

  @IsBoolean()
  @IsOptional()
  engulfing_sequential?: boolean = true;

  // Stop Loss Configuration
  @IsEnum(['pct', 'lookback_low/high', 'engulfing_boundary', 'streak_extreme', 'trailing', 'supertrend'])
  @IsOptional()
  sl_type?: 'pct' | 'lookback_low/high' | 'engulfing_boundary' | 'streak_extreme' | 'trailing' | 'supertrend' = "pct";

  @IsNumber()
  @Min(CONFIG_LIMITS.SL_DISTANCE_MIN)
  @Max(CONFIG_LIMITS.SL_DISTANCE_MAX)
  @IsOptional()
  sl_distance_pct?: number = CONFIG_LIMITS.SL_DISTANCE_DEFAULT;

  @IsNumber()
  @Min(1)
  @IsOptional()
  sl_lookback_period?: number = 5;

  @IsString()
  @IsOptional()
  @MaxLength(10)
  @Matches(/^(1m|3m|5m|15m|30m|1h|2h|4h|6h|8h|12h|1d|3d|1w|1M)$/, { message: 'sl_lookback_timeframe must be a valid Binance kline interval' })
  sl_lookback_timeframe?: string = "5m";

  @IsNumber()
  @Min(0.1)
  @IsOptional()
  sl_pct_limit?: number = 1.0;

  @IsNumber()
  @Min(0.1)
  @IsOptional()
  sl_min_pct?: number = 0.3;

  @IsNumber()
  @Min(0.1)
  @IsOptional()
  sl_max_pct?: number = 3.0;

  @IsEnum(['clamp', 'reject'])
  @IsOptional()
  sl_out_of_bounds_action?: 'clamp' | 'reject' = 'clamp';

  @IsEnum(['fixed', 'exp_rr_seq'])
  @IsOptional()
  tp_mode?: 'fixed' | 'exp_rr_seq' = 'fixed';

  @IsNumber()
  @Min(CONFIG_LIMITS.TP_RATIO_MIN)
  @IsOptional()
  tp_ratio?: number = CONFIG_LIMITS.TP_RATIO_DEFAULT;

  // Exponential RR Sequence for Profit Locking
  @IsArray()
  @IsNumber({}, { each: true })
  @IsOptional()
  @ArrayMaxSize(10)
  live_rr_sequence?: number[] = [1.0, 2.0, 4.0];

  @IsArray()
  @IsNumber({}, { each: true })
  @IsOptional()
  @ArrayMaxSize(10)
  exit_rr_sequence?: number[] = [0.0, 1.0, 2.0];

  // Exit Signal Configuration - ANY exit signal fires close
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  @ArrayMaxSize(CONFIG_LIMITS.MAX_SIGNALS)
  @MaxLength(50, { each: true })
  @Matches(/^[a-zA-Z0-9_]*$/, { each: true, message: 'Signals must contain only alphanumeric characters and underscores' })
  exit_signals?: string[] = [];

  @IsEnum(['any', 'all'])
  @IsOptional()
  exit_signal_logic?: 'any' | 'all' = 'any';

  @IsBoolean()
  @IsOptional()
  exit_signals_override_ratchet?: boolean = false;

  @IsObject()
  @IsOptional()
  exit_signal_delays?: Record<string, number> = {};

  @IsObject()
  @IsOptional()
  exit_signal_actions?: Record<string, 'close' | 'lock_sl'> = {};

  @IsObject()
  @IsOptional()
  signal_timeframes?: Record<string, string> = {};

  // Risk Management
  @IsNumber()
  @Min(CONFIG_LIMITS.RISK_PER_TRADE_MIN)
  @Max(CONFIG_LIMITS.RISK_PER_TRADE_MAX)
  @IsOptional()
  risk_pct_per_trade?: number = CONFIG_LIMITS.RISK_PER_TRADE_DEFAULT;

  @IsNumber()
  @Min(CONFIG_LIMITS.MAX_OPEN_TRADES_MIN)
  @IsOptional()
  max_open_trades?: number = CONFIG_LIMITS.MAX_OPEN_TRADES_DEFAULT;

  @IsNumber()
  @Min(1)
  @IsOptional()
  max_open_trades_per_symbol?: number = 1;

  @IsNumber()
  @Min(0)
  @IsOptional()
  max_trades_per_period?: number = 0;

  @IsNumber()
  @Min(1)
  @IsOptional()
  trades_period_min?: number = 60;

  @IsNumber()
  @Min(0)
  @IsOptional()
  max_trades_24h?: number = CONFIG_LIMITS.MAX_TRADES_24H_DEFAULT;

  @IsNumber()
  @Min(0)
  @IsOptional()
  min_trade_interval_min?: number = 0;

  @IsNumber()
  @Min(0)
  @Max(100)
  @IsOptional()
  trades_jitter_pct?: number = 0;

  @IsBoolean()
  @IsOptional()
  trades_jitter_market_aware?: boolean = false;

  @IsBoolean()
  @IsOptional()
  frequency_shaping_enabled?: boolean = false;

  @IsBoolean()
  @IsOptional()
  frequency_tod_integration?: boolean = false;

  @IsNumber()
  @Min(CONFIG_LIMITS.MAX_TOTAL_RISK_MIN)
  @Max(CONFIG_LIMITS.MAX_TOTAL_RISK_MAX)
  @IsOptional()
  max_total_risk_pct?: number = CONFIG_LIMITS.MAX_TOTAL_RISK_DEFAULT;

  @IsNumber()
  @Min(0)
  @IsOptional()
  total_sl_guard_usdt?: number = CONFIG_LIMITS.TOTAL_SL_GUARD_DEFAULT;

  @IsBoolean()
  @IsOptional()
  auto_scale_min_notional?: boolean = true;

  @IsBoolean()
  @IsOptional()
  risk_hardening_enabled?: boolean = false;

  @IsNumber()
  @IsOptional()
  @Min(0.1)
  @Max(100.0)
  max_single_trade_risk_pct?: number = 20.0;

  // Balance & Mode Configuration
  @IsBoolean()
  @IsOptional()
  paper_mode?: boolean = true;

  @IsEnum(['paper', 'testnet', 'live'])
  @IsOptional()
  trading_mode?: 'paper' | 'testnet' | 'live' = 'paper';

  @IsNumber()
  @Min(0)
  @IsOptional()
  paper_starting_balance?: number = CONFIG_LIMITS.PAPER_STARTING_BALANCE_DEFAULT;

  @IsNumber()
  @Min(0)
  @IsOptional()
  testnet_starting_balance?: number = 10000.0;

  @IsNumber()
  @Min(0)
  @IsOptional()
  live_starting_balance?: number = CONFIG_LIMITS.LIVE_STARTING_BALANCE_DEFAULT;

  // API & Monitoring
  @IsBoolean()
  @IsOptional()
  track_binance_rate_limits?: boolean = true;

  // Schedule & Advanced Risk
  @IsArray()
  @IsOptional()
  @ArrayMaxSize(CONFIG_LIMITS.MAX_TRADING_WINDOWS)
  @IsObject({ each: true })
  trading_windows?: { start: string; end: string }[] = [];

  @IsBoolean()
  @IsOptional()
  risk_use_tod_stats?: boolean = false;

  @IsNumber()
  @IsOptional()
  tod_min_winrate?: number = 40.0;

  // Performance & Debug
  @IsNumber()
  @IsOptional()
  @Min(CONFIG_LIMITS.HOT_LOOP_MIN)
  hot_loop_interval_ms?: number = CONFIG_LIMITS.HOT_LOOP_DEFAULT;

  @IsNumber()
  @IsOptional()
  @Min(CONFIG_LIMITS.MAIN_LOOP_MIN)
  main_loop_interval_ms?: number = CONFIG_LIMITS.MAIN_LOOP_DEFAULT;

  @IsNumber()
  @IsOptional()
  @Min(CONFIG_LIMITS.LEVERAGE_MIN)
  @Max(CONFIG_LIMITS.LEVERAGE_MAX)
  leverage: number = CONFIG_LIMITS.LEVERAGE_DEFAULT;

  @IsNumber()
  @IsOptional()
  @Min(0)
  slippage_warning_threshold: number = CONFIG_LIMITS.SLIPPAGE_THRESHOLD_DEFAULT;

  @IsNumber()
  @IsOptional()
  @Min(0)
  @Max(CONFIG_LIMITS.SLIPPAGE_ABORT_MAX)
  slippage_abort_threshold: number = CONFIG_LIMITS.SLIPPAGE_ABORT_DEFAULT;

  @IsBoolean()
  @IsOptional()
  debug_mode?: boolean = false;

  @IsEnum(['deep', 'light', 'adaptive'])
  @IsOptional()
  hibernation_mode?: 'deep' | 'light' | 'adaptive' = 'adaptive';

  @IsNumber()
  @Min(5)
  @Max(3600)
  @IsOptional()
  hibernation_grace_period_sec?: number = 30;

  @IsNumber()
  @IsOptional()
  @Min(CONFIG_LIMITS.TRAILING_GUARD_MIN)
  @Max(CONFIG_LIMITS.TRAILING_GUARD_MAX)
  trailing_guard_buffer_pct?: number = CONFIG_LIMITS.TRAILING_GUARD_DEFAULT;

  @IsBoolean()
  @IsOptional()
  trailing_stop_enabled?: boolean = false;

  @IsNumber()
  @IsOptional()
  @Min(0.1)
  @Max(10.0)
  trailing_stop_distance_pct?: number = 1.0;

  @IsObject()
  @IsOptional()
  scanner_weights?: {
    momentum: number;
    volatility: number;
    trend: number;
  } = {
    momentum: 0.5,
    volatility: 0.3,
    trend: 0.2
  };
}
