import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class PauseSessionDto {
  @IsBoolean()
  paused: boolean;

  @IsString()
  @IsOptional()
  strategyLabel?: string;
}
