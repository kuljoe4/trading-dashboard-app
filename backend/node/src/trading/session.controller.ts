import { Controller, Post, Get, Body, UseGuards, ParseBoolPipe } from '@nestjs/common';
import { SessionService } from './session.service';
import { SessionConfigDto } from '../dto/session-config.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('session')
export class SessionController {
  constructor(private readonly sessionService: SessionService) {}

  @Post('start')
  async startSession(
    @Body() config: SessionConfigDto,
    @Body('paper_mode', ParseBoolPipe) paperMode: boolean,
  ) {
    return this.sessionService.startSession(config, paperMode);
  }

  @Post('stop')
  async stopSession() {
    return this.sessionService.stopSession();
  }

  @Get('status')
  async getStatus() {
    return this.sessionService.getStatus();
  }

  @Get('binance/rate-limit')
  async getBinanceRateLimit() {
    return this.sessionService.getBinanceRateLimit();
  }
}