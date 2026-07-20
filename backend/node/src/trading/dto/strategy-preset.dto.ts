import { IsString, IsNotEmpty, IsObject, MaxLength, ValidateNested, Matches } from 'class-validator';
import { Type } from 'class-transformer';
import { SessionConfig } from '../../models/SessionConfig';

export class CreateStrategyPresetDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  @Matches(/^[a-zA-Z0-9_\s.\-()><=%+,\[\]]+$/, { message: 'Preset name can only contain alphanumeric characters, spaces, underscores, dots, hyphens, and safe descriptive characters like (), ><=, %, +, ,, and []' })
  @Matches(/^(?!.*<[a-zA-Z!/]).*$/, { message: 'Preset name cannot contain HTML tags or tag-like structures' })
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
  @Matches(/^[a-zA-Z0-9_\s.\-()><=%+,\[\]]+$/, { message: 'Preset name can only contain alphanumeric characters, spaces, underscores, dots, hyphens, and safe descriptive characters like (), ><=, %, +, ,, and []' })
  @Matches(/^(?!.*<[a-zA-Z!/]).*$/, { message: 'Preset name cannot contain HTML tags or tag-like structures' })
  name: string;

  @IsObject()
  @IsNotEmpty()
  @ValidateNested()
  @Type(() => SessionConfig)
  config: SessionConfig;
}
