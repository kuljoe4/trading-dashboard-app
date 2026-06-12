import { IsString, IsNumber, IsOptional, IsEnum, IsArray, IsBoolean, Min, Max, IsObject, ValidateNested, MaxLength, ArrayMaxSize } from 'class-validator';
import { Type } from 'class-transformer';
import { CONFIG_LIMITS } from './constants';

export class SingleSymbolConfig {
  @IsString()
  @MaxLength(20)
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

  @IsArray()
  @IsOptional()
  @ArrayMaxSize(CONFIG_LIMITS.MAX_SINGLE_SYMBOL_MONITORS)
  @ValidateNested({ each: true })
  @Type(() => SingleSymbolConfig)
  single_symbol_configs: SingleSymbolConfig[] = [];

  @IsString()
  @IsOptional()
  @MaxLength(10)
  scan_interval: string = "5m";

  @IsNumber()
  @Min(1)
  @IsOptional()
  scan_lookback: number = 3;

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
  @Min(CONFIG_LIMITS.WATCHLIST_OFFSET_MIN)
  @Max(CONFIG_LIMITS.WATCHLIST_OFFSET_MAX)
  @IsOptional()
  watchlist_offset: number = CONFIG_LIMITS.WATCHLIST_OFFSET_DEFAULT;

  @IsEnum(['both', 'long', 'short'])
  @IsOptional()
  entry_side?: 'both' | 'long' | 'short' = 'both';

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  @ArrayMaxSize(100)
  excluded_symbols?: string[];

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  @ArrayMaxSize(100)
  symbols?: string[];

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  @ArrayMaxSize(CONFIG_LIMITS.MAX_SIGNALS)
  enabled_signals?: string[] = ['momentum_pct'];

  @IsEnum(['any', 'all'])
  @IsOptional()
  signal_logic?: 'any' | 'all' = 'all';

  @IsString()
  @IsOptional()
  @MaxLength(2000)
  signal_params?: string;

  // Stop Loss Configuration
  @IsEnum(['pct', 'lookback_low/high'])
  @IsOptional()
  sl_type?: 'pct' | 'lookback_low/high' = "pct";

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
  exit_signals?: string[] = [];

  @IsEnum(['any', 'all'])
  @IsOptional()
  exit_signal_logic?: 'any' | 'all' = 'any';

  @IsObject()
  @IsOptional()
  exit_signal_delays?: Record<string, number> = {};

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
  max_trades_per_period?: number = 10;

  @IsNumber()
  @Min(1)
  @IsOptional()
  trades_period_min?: number = 60;

  @IsNumber()
  @Min(CONFIG_LIMITS.MAX_TOTAL_RISK_MIN)
  @Max(CONFIG_LIMITS.MAX_TOTAL_RISK_MAX)
  @IsOptional()
  max_total_risk_pct?: number = CONFIG_LIMITS.MAX_TOTAL_RISK_DEFAULT;

  @IsNumber()
  @Min(0)
  @IsOptional()
  total_sl_guard_usdt?: number = CONFIG_LIMITS.TOTAL_SL_GUARD_DEFAULT;

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

  @IsBoolean()
  @IsOptional()
  debug_mode?: boolean = false;
}
