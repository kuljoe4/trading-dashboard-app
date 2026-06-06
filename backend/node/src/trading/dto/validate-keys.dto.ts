import { IsString, IsOptional } from 'class-validator';

export class ValidateKeysDto {
  @IsString()
  @IsOptional()
  api_key?: string;

  @IsString()
  @IsOptional()
  testnet_api_key?: string;
}
