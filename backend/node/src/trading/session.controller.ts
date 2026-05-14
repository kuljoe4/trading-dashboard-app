import { Controller, Post, Get, Body, Patch, Delete, Param } from '@nestjs/common';
import { SessionService } from './session.service';
import { SessionConfig } from '../models/SessionConfig';

@Controller('session')
export class SessionController {
  constructor(private readonly sessionService: SessionService) {}

  @Post('start')
  async startSession(@Body() body: { config?: SessionConfig; paper_mode?: boolean; sessionId?: string }) {
    if (body.sessionId) {
      return this.sessionService.startSession(body.config || {} as any, body.paper_mode ?? true, body.sessionId);
    }
    const config = Object.assign(new SessionConfig(), body.config);
    return this.sessionService.startSession(config, body.paper_mode ?? true);
  }

  @Get('list')
  async listSessions() {
    return this.sessionService.listSessions();
  }

  @Post('stop')
  async stopSession() {
    return this.sessionService.stopSession();
  }

  @Patch(':id')
  async updateSession(@Param('id') id: string, @Body() body: { config: SessionConfig }) {
    return this.sessionService.updateSession(id, body.config);
  }

  @Post('pause')
  async pauseSession(@Body() body: { paused: boolean }) {
    return this.sessionService.pauseSession(body.paused);
  }

  @Delete(':id')
  async deleteSession(@Param('id') id: string) {
    return this.sessionService.deleteSession(id);
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
