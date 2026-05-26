import { Controller, Post, Get, Body, Patch, Delete, Param, ParseUUIDPipe, Query, BadRequestException } from '@nestjs/common';
import { SessionService } from './session.service';
import { SessionConfig } from '../models/SessionConfig';
import { StartSessionDto, UpdateSessionDto } from './dto/session.dto';
import { PauseSessionDto } from './dto/pause-session.dto';

@Controller('session')
export class SessionController {
  constructor(private readonly sessionService: SessionService) {}

  @Post('start')
  async startSession(@Body() body: StartSessionDto) {
    if (body.sessionId) {
      return this.sessionService.startSession(body.config || {} as any, body.paper_mode ?? true, body.sessionId);
    }
    const config = Object.assign(new SessionConfig(), body.config);
    
    // Parse signal_params if it's a JSON string
    if (config.signal_params && typeof config.signal_params === 'string') {
      try {
        config.signal_params = JSON.parse(config.signal_params);
      } catch (e) {
        // If parsing fails, keep as is
      }
    }
    
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
  async updateSession(@Param('id', ParseUUIDPipe) id: string, @Body() body: UpdateSessionDto) {
    const config = Object.assign(new SessionConfig(), body.config);
    
    // Parse signal_params if it's a JSON string
    if (config.signal_params && typeof config.signal_params === 'string') {
      try {
        config.signal_params = JSON.parse(config.signal_params);
      } catch (e) {
        // If parsing fails, keep as is
      }
    }
    
    return this.sessionService.updateSession(id, config);
  }

  @Post('pause')
  async pauseSession(@Body() body: PauseSessionDto) {
    return this.sessionService.pauseSession(body.paused);
  }

  @Delete(':id')
  async deleteSession(@Param('id', ParseUUIDPipe) id: string) {
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

  @Post('trade/:symbol/close')
  async closeTradeManually(@Param('symbol') symbol: string) {
    // Basic input hardening: ensure symbol matches expected Binance format
    if (!/^[A-Z0-9]{3,20}$/.test(symbol)) {
      throw new BadRequestException('Invalid symbol format');
    }
    return this.sessionService.closeTradeManually(symbol);
  }

  @Get('analytics')
  async getAnalytics() {
    return this.sessionService.getAnalytics();
  }

  @Get('lifetime-analytics')
  async getLifetimeAnalytics(@Query('mode') mode: 'paper' | 'testnet' | 'live') {
    return this.sessionService.getLifetimeAnalytics(mode || 'paper');
  }

  @Post('reset-paper-balance')
  async resetPaperBalance() {
    return this.sessionService.resetPaperBalance();
  }
}
