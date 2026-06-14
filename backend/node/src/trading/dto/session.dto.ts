
import { IsOptional, IsBoolean, IsString, ValidateNested, IsUUID, IsNotEmpty, IsObject } from 'class-validator';
import { Type } from 'class-transformer';
import { SessionConfig } from '../../models/SessionConfig';

export class StartSessionDto {
  @IsOptional()
  @IsObject()
  config?: any;

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
  config: any;
}
