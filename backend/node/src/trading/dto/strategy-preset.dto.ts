import { IsString, IsNotEmpty, IsObject, MaxLength, ValidateNested, Matches } from 'class-validator';
import { Type } from 'class-transformer';
import { SessionConfig } from '../../models/SessionConfig';

export class CreateStrategyPresetDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  @Matches(/^[a-zA-Z0-9_\s.\-]+$/, { message: 'Preset name can only contain alphanumeric characters, spaces, underscores, dots, and hyphens' })
  name: string;

  @IsObject()
  @IsNotEmpty()
  @ValidateNested()
  @Type(() => SessionConfig)
  config: SessionConfig;
}

export class UpdateStrategyPresetDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  @Matches(/^[a-zA-Z0-9_\s.\-]+$/, { message: 'Preset name can only contain alphanumeric characters, spaces, underscores, dots, and hyphens' })
  name: string;

  @IsObject()
  @IsNotEmpty()
  @ValidateNested()
  @Type(() => SessionConfig)
  config: SessionConfig;
}
