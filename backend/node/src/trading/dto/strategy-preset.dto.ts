import { IsString, IsNotEmpty, IsObject, MaxLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { SessionConfig } from '../../models/SessionConfig';

export class CreateStrategyPresetDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
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
  name: string;

  @IsObject()
  @IsNotEmpty()
  @ValidateNested()
  @Type(() => SessionConfig)
  config: SessionConfig;
}
