import { Field, ObjectType } from '@nestjs/graphql';
import { IsString, IsNumber, IsOptional, IsBoolean, IsList } from 'class-validator';

@ObjectType()
export class SessionConfig {
  // Scanner Configuration
  @Field()
  @IsString()
  scan_interval: string = "5m";

  @Field()
  @IsNumber()
  @IsOptional()
  scan_lookback: number = 3;

  @Field()
  @IsNumber()
  @IsOptional()
  scan_pct_threshold: number = 2.0;

  @Field()
  @IsNumber()
  @IsOptional()
  watchlist_size: number = 50;

  @Field()
  @IsList()
  @IsOptional()
  excluded_symbols?: string[];

  @Field()
  @IsList()
  @IsOptional()
  symbols?: string[];

  // Signal Configuration - ALL signals must fire for entry (AND logic)
  @Field()
  @IsList()
  @IsOptional()
  enabled_signals?: string[];

  @Field()
  @IsOptional()
  @IsString()
  signal_params?: string;  // JSON string for signal parameters

  // Stop Loss Configuration
  @Field()
  @IsString()
  @IsOptional()
  sl_type?: string = "pct";

  @Field()
  @IsNumber()
  @IsOptional()
  sl_distance_pct?: number = 0.8;

  @Field()
  @IsNumber()
  @IsOptional()
  sl_lookback_period?: number = 5;

  @Field()
  @IsString()
  @IsOptional()
  sl_lookback_timeframe?: string = "5m";

  @Field()
  @IsNumber()
  @IsOptional()
  sl_pct_limit?: number = 1.0;

  // Exponential RR Sequence for Profit Locking
  @Field()
  @IsList()
  @IsOptional()
  live_rr_sequence?: number[] = [1.0, 2.0];

  @Field()
  @IsList()
  @IsOptional()
  exit_rr_sequence?: number[] = [0.0, 1.0];

  // Exit Signal Configuration - ANY exit signal fires close
  @Field()
  @IsList()
  @IsOptional()
  exit_signals?: string[] = [];

  // Risk Management
  @Field()
  @IsNumber()
  @IsOptional()
  risk_pct_per_trade?: number = 1.0;

  @Field()
  @IsNumber()
  @IsOptional()
  max_open_trades?: number = 5;

  @Field()
  @IsNumber()
  @IsOptional()
  max_open_trades_per_symbol?: number = 1;

  @Field()
  @IsNumber()
  @IsOptional()
  max_total_risk_pct?: number = 5.0;

  @Field()
  @IsNumber()
  @IsOptional()
  total_sl_guard_usdt?: number = 200.0;

  // Balance & Mode Configuration
  @Field()
  @IsBoolean()
  @IsOptional()
  paper_mode?: boolean = true;

  @Field()
  @IsNumber()
  @IsOptional()
  paper_starting_balance?: number = 10000.0;

  @Field()
  @IsNumber()
  @IsOptional()
  live_starting_balance?: number = 10000.0;

  // API & Monitoring
  @Field()
  @IsBoolean()
  @IsOptional()
  track_binance_rate_limits?: boolean = true;
}