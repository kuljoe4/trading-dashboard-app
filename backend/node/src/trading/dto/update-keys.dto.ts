import { IsString, IsOptional, MaxLength } from 'class-validator';

export class UpdateKeysDto {
  @IsString()
  @IsOptional()
  @MaxLength(500)
  api_key?: string;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  api_secret?: string;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  testnet_api_key?: string;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  testnet_api_secret?: string;
}
