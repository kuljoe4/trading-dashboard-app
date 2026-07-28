
import { IsOptional, IsBoolean, IsString, ValidateNested, IsUUID, IsNotEmpty, IsObject, IsArray, IsNumber } from 'class-validator';
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

export class UpdateTradeConfigDto {
  @IsOptional()
  @IsNumber()
  current_sl?: number;

  @IsOptional()
  @IsArray()
  @IsNumber({}, { each: true })
  live_rr_sequence?: number[];

  @IsOptional()
  @IsArray()
  @IsNumber({}, { each: true })
  exit_rr_sequence?: number[];

  @IsOptional()
  @IsObject()
  strategy_config?: Record<string, any>;
}
