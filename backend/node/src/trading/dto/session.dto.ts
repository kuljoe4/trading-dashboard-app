
import { IsOptional, IsBoolean, IsString, ValidateNested, IsUUID, IsNotEmpty, IsObject, IsArray, IsNumber, ArrayMaxSize } from 'class-validator';
import { Type } from 'class-transformer';
import { SessionConfig } from '../../models/SessionConfig';

export class StartSessionDto {
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => SessionConfig)
  config?: SessionConfig;

  @IsOptional()
  @IsBoolean()
  paper_mode?: boolean;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @IsUUID()
  sessionId?: string;
}

export class PauseSessionDto {
  @IsBoolean()
  @IsNotEmpty()
  paused: boolean;
}

export class UpdateSessionDto {
  @IsObject()
  @IsNotEmpty()
  config: Record<string, any>;
}

export class AdoptPositionDto {
  @IsString()
  @IsNotEmpty()
  symbol: string;

  @IsString()
  @IsNotEmpty()
  strategyLabel: string;

  @IsOptional()
  @IsNumber()
  initialSl?: number;

  @IsOptional()
  @IsNumber()
  currentSl?: number;
}

export class UpdateTradeConfigDto {
  @IsOptional()
  @IsNumber()
  current_sl?: number;

  @IsOptional()
  @IsArray()
  @IsNumber({}, { each: true })
  @ArrayMaxSize(10, { message: 'live_rr_sequence cannot exceed 10 elements' })
  live_rr_sequence?: number[];

  @IsOptional()
  @IsArray()
  @IsNumber({}, { each: true })
  @ArrayMaxSize(10, { message: 'exit_rr_sequence cannot exceed 10 elements' })
  exit_rr_sequence?: number[];

  @IsOptional()
  @IsObject()
  strategy_config?: Record<string, any>;
}
