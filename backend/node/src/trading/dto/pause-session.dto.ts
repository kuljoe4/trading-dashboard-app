import { IsBoolean, IsOptional, IsString, MaxLength, Matches } from 'class-validator';

export class PauseSessionDto {
  @IsBoolean()
  paused: boolean;

  @IsString()
  @IsOptional()
  @MaxLength(100, { message: 'Strategy label cannot exceed 100 characters' })
  @Matches(/^[a-zA-Z0-9_\s.\-()><=%+,\[\]]*$/, { message: 'Strategy label can only contain alphanumeric characters, spaces, underscores, dots, hyphens, and safe descriptive characters like (), ><=, %, +, ,, and []' })
  @Matches(/^(?!.*<[a-zA-Z!/]).*$/, { message: 'Strategy label cannot contain HTML tags or tag-like structures' })
  strategyLabel?: string;
}
