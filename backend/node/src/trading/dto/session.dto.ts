import { IsOptional, IsBoolean, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { SessionConfig } from '../../models/SessionConfig';

export class StartSessionDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => SessionConfig)
  config?: SessionConfig;

  @IsOptional()
  @IsBoolean()
  paper_mode?: boolean;

  @IsOptional()
  @IsString()
  sessionId?: string;
}

export class UpdateSessionDto {
  @ValidateNested()
  @Type(() => SessionConfig)
  config: SessionConfig;
}
