import {
  IsOptional,
  IsBoolean,
  IsString,
  ValidateNested,
  IsUUID,
  IsNotEmpty,
  IsObject,
  IsArray,
  IsNumber,
  ArrayMaxSize,
  MaxLength,
  Matches,
} from "class-validator";
import { Type } from "class-transformer";
import { SessionConfig } from "../../models/SessionConfig";

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
  @MaxLength(20, { message: "Symbol cannot exceed 20 characters" })
  @Matches(/^[A-Z0-9]{3,20}$/, {
    message:
      "Symbol must be a valid uppercase alphanumeric string between 3 and 20 characters",
  })
  symbol: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100, { message: "Strategy label cannot exceed 100 characters" })
  @Matches(/^[a-zA-Z0-9_\s.\-()><=%+,\[\]]*$/, {
    message:
      "Strategy label can only contain alphanumeric characters, spaces, underscores, dots, hyphens, and safe descriptive characters like (), ><=, %, +, ,, and []",
  })
  @Matches(/^(?!.*<[a-zA-Z!/]).*$/, {
    message: "Strategy label cannot contain HTML tags or tag-like structures",
  })
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
  @ArrayMaxSize(10, { message: "live_rr_sequence cannot exceed 10 elements" })
  live_rr_sequence?: number[];

  @IsOptional()
  @IsArray()
  @IsNumber({}, { each: true })
  @ArrayMaxSize(10, { message: "exit_rr_sequence cannot exceed 10 elements" })
  exit_rr_sequence?: number[];

  @IsOptional()
  @IsObject()
  strategy_config?: Record<string, any>;
}
