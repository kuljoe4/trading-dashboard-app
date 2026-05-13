import { IsString, IsOptional, MaxLength, IsNotEmpty } from 'class-validator';

export class UpdateKeysDto {
  @IsString()
  @IsOptional()
  @IsNotEmpty()
  @MaxLength(500)
  api_key?: string;

  @IsString()
  @IsOptional()
  @IsNotEmpty()
  @MaxLength(500)
  api_secret?: string;
}
