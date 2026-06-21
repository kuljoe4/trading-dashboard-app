import { IsString, IsNotEmpty, IsObject, MaxLength } from 'class-validator';

export class CreateStrategyPresetDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  @IsObject()
  @IsNotEmpty()
  config: any;
}

export class UpdateStrategyPresetDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  @IsObject()
  @IsNotEmpty()
  config: any;
}
