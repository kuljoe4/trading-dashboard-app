import { IsString, IsNumber, IsOptional, IsEnum, IsArray, IsBoolean, Min, Max, IsObject, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class SingleSymbolConfig {
  @IsString()
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
  strategy_label?: string = "Momentum Strategy";

  @IsArray()
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => SessionConfig)
  strategy_variants?: Partial<SessionConfig>[] = [];

  @IsBoolean()
  @IsOptional()
  global_scanner_enabled: boolean = true;

  @IsArray()
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => SingleSymbolConfig)
  single_symbol_configs: SingleSymbolConfig[] = [];

  @IsString()
  @IsOptional()
  scan_interval: string = "5m";

  @IsNumber()
  @Min(1)
  @IsOptional()
  scan_lookback: number = 3;

  @IsNumber()
  @Min(0)
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
  @Min(1)
  @Max(200)
  @IsOptional()
  watchlist_size: number = 50;

  @IsEnum(['both', 'long', 'short'])
  @IsOptional()
  entry_side?: 'both' | 'long' | 'short' = 'both';

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  excluded_symbols?: string[];

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  symbols?: string[];

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  enabled_signals?: string[] = ['momentum_pct'];

  @IsEnum(['any', 'all'])
  @IsOptional()
  signal_logic?: 'any' | 'all' = 'all';

  @IsString()
  @IsOptional()
  signal_params?: string;

  // Stop Loss Configuration
  @IsEnum(['pct', 'lookback_low/high'])
  @IsOptional()
  sl_type?: 'pct' | 'lookback_low/high' = "pct";

  @IsNumber()
  @Min(0.1)
  @Max(10)
  @IsOptional()
  sl_distance_pct?: number = 0.8;

  @IsNumber()
  @Min(1)
  @IsOptional()
  sl_lookback_period?: number = 5;

  @IsString()
  @IsOptional()
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
  @Min(0.1)
  @IsOptional()
  tp_ratio?: number = 2.0;

  // Exponential RR Sequence for Profit Locking
  @IsArray()
  @IsNumber({}, { each: true })
  @IsOptional()
  live_rr_sequence?: number[] = [1.0, 2.0, 4.0];

  @IsArray()
  @IsNumber({}, { each: true })
  @IsOptional()
  exit_rr_sequence?: number[] = [0.0, 1.0, 2.0];

  // Exit Signal Configuration - ANY exit signal fires close
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  exit_signals?: string[] = [];

  @IsEnum(['any', 'all'])
  @IsOptional()
  exit_signal_logic?: 'any' | 'all' = 'any';

  @IsObject()
  @IsOptional()
  exit_signal_delays?: Record<string, number> = {};

  // Risk Management
  @IsNumber()
  @Min(0.01)
  @Max(100)
  @IsOptional()
  risk_pct_per_trade?: number = 1.0;

  @IsNumber()
  @Min(1)
  @IsOptional()
  max_open_trades?: number = 5;

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
  @Min(0.1)
  @Max(100)
  @IsOptional()
  max_total_risk_pct?: number = 5.0;

  @IsNumber()
  @Min(0)
  @IsOptional()
  total_sl_guard_usdt?: number = 200.0;

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
  paper_starting_balance?: number = 10000.0;

  @IsNumber()
  @Min(0)
  @IsOptional()
  live_starting_balance?: number = 10000.0;

  // API & Monitoring
  @IsBoolean()
  @IsOptional()
  track_binance_rate_limits?: boolean = true;

  // Schedule & Advanced Risk
  @IsArray()
  @IsOptional()
  @IsObject({ each: true })
  trading_windows?: { start: string; end: string }[] = [];

  @IsBoolean()
  @IsOptional()
  risk_use_tod_stats?: boolean = false;

  @IsNumber()
  @IsOptional()
  tod_min_winrate?: number = 40.0;
}
