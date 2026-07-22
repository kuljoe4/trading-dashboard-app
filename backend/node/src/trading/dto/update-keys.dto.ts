import { IsString, IsOptional, MaxLength, Matches } from 'class-validator';

export class UpdateKeysDto {
  @IsString()
  @IsOptional()
  @MaxLength(500)
  @Matches(/^[a-zA-Z0-9_\-\.\+/= ]*$/, { message: 'API key contains invalid characters' })
  api_key?: string;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  @Matches(/^[a-zA-Z0-9_\-\.\+/= ]*$/, { message: 'API secret contains invalid characters' })
  api_secret?: string;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  @Matches(/^[a-zA-Z0-9_\-\.\+/= ]*$/, { message: 'Testnet API key contains invalid characters' })
  testnet_api_key?: string;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  @Matches(/^[a-zA-Z0-9_\-\.\+/= ]*$/, { message: 'Testnet API secret contains invalid characters' })
  testnet_api_secret?: string;
}
