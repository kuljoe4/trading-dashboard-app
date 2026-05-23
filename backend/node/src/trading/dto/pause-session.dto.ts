import { IsBoolean } from 'class-validator';

export class PauseSessionDto {
  @IsBoolean()
  paused: boolean;
}
