import { Controller, Post, Get, Body } from '@nestjs/common';
import { SessionService } from './session.service';
import { SessionConfig } from '../models/SessionConfig';

@Controller('session')
export class SessionController {
  constructor(private readonly sessionService: SessionService) {}

  @Post('start')
  async startSession(@Body() body: { config: SessionConfig; paper_mode?: boolean }) {
    const config = Object.assign(new SessionConfig(), body.config);
    return this.sessionService.startSession(config, body.paper_mode ?? true);
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

  @Get('history')
  async getHistory() {
    return this.sessionService.getHistory();
  }
}
