import { Field, ObjectType } from '@nestjs/graphql';
import { IsString, IsNumber, IsOptional, IsDate, IsBoolean } from 'class-validator';

@ObjectType()
export class Trade {
  @Field()
  @IsString()
  id: string;

  @Field()
  @IsString()
  symbol: string;

  @Field()
  @IsString()
  direction: 'LONG' | 'SHORT';

  @Field()
  @IsNumber()
  entry_price: number;

  @Field()
  @IsNumber()
  qty: number;

  @Field()
  @IsNumber()
  initial_sl: number;

  @Field()
  @IsNumber()
  current_sl: number;

  @Field()
  @IsNumber()
  max_rr_achieved: number;

  @Field()
  @IsNumber()
  rr_sequence_index: number;

  @Field()
  @IsOptional()
  @IsDate()
  entry_ts?: Date;

  @Field()
  @IsNumber()
  tp: number;

  @Field()
  @IsNumber()
  pnl: number;

  @Field()
  @IsString()
  status: 'OPEN' | 'CLOSED' | 'CLOSED_SL' | 'CLOSED_TP' | 'CLOSED_SIGNAL';

  @Field()
  @IsOptional()
  @IsDate()
  exit_ts?: Date;

  @Field()
  @IsOptional()
  @IsNumber()
  exit_price?: number;

  @Field()
  @IsOptional()
  @IsString()
  exit_reason?: string;

  @Field()
  @IsOptional()
  @IsString()
  exit_signal_type?: string;

  @Field()
  @IsOptional()
  @IsString()
  exit_signal_reason?: string;

  @Field()
  @IsOptional()
  @IsString()
  entry_signal_type?: string;

  @Field()
  @IsNumber()
  entry_signal_confidence: number;

  @Field()
  @IsOptional()
  @IsArray()
  sl_adjustments?: { timestamp: string; prev_sl: number; new_sl: number; reason: string; milestone_index: number }[];
}