import { Controller, Post, Get, Body, Patch, Delete, Param, ParseUUIDPipe, Query, BadRequestException, UseGuards, Req } from '@nestjs/common';
import { Request } from 'express';
import { SessionService } from './session.service';
import { ApiKeyGuard } from '../lib/api-key.guard';
import { SessionConfig } from '../models/SessionConfig';
import { StartSessionDto, UpdateSessionDto } from './dto/session.dto';
import { PauseSessionDto } from './dto/pause-session.dto';
import { extractIp } from '../lib/throttle';

@Controller('session')
@UseGuards(ApiKeyGuard)
export class SessionController {
  constructor(private readonly sessionService: SessionService) {}

  @Post('start')
  async startSession(@Body() body: StartSessionDto, @Req() req: Request) {
    const ip = req.ip || extractIp(req.headers, req.socket?.remoteAddress || 'unknown');
    const userAgent = req.headers['user-agent'] as string;

    if (body.sessionId) {
      return this.sessionService.startSession(body.config || {} as any, body.paper_mode ?? true, body.sessionId, ip, userAgent);
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
    
    return this.sessionService.startSession(config, body.paper_mode ?? true, undefined, ip, userAgent);
  }

  @Get('list')
  async listSessions() {
    return this.sessionService.listSessions();
  }

  @Post('stop')
  async stopSession(@Req() req: Request) {
    const ip = req.ip || extractIp(req.headers, req.socket?.remoteAddress || 'unknown');
    const userAgent = req.headers['user-agent'] as string;
    return this.sessionService.stopSession(ip, userAgent);
  }

  @Patch(':id')
  async updateSession(@Param('id', ParseUUIDPipe) id: string, @Body() body: UpdateSessionDto, @Req() req: Request) {
    const ip = req.ip || extractIp(req.headers, req.socket?.remoteAddress || 'unknown');
    const userAgent = req.headers['user-agent'] as string;
    const config = Object.assign(new SessionConfig(), body.config);
    
    // Parse signal_params if it's a JSON string
    if (config.signal_params && typeof config.signal_params === 'string') {
      try {
        config.signal_params = JSON.parse(config.signal_params);
      } catch (e) {
        // If parsing fails, keep as is
      }
    }
    
    return this.sessionService.updateSession(id, config, ip, userAgent);
  }

  @Post('pause')
  async pauseSession(@Body() body: PauseSessionDto) {
    return this.sessionService.pauseSession(body.paused);
  }

  @Delete('trades/orphans')
  async deleteOrphanedTrades(@Req() req: Request) {
    const ip = req.ip || extractIp(req.headers, req.socket?.remoteAddress || 'unknown');
    const userAgent = req.headers['user-agent'] as string;
    return this.sessionService.deleteOrphanedTrades(ip, userAgent);
  }

  @Delete(':id')
  async deleteSession(@Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    const ip = req.ip || extractIp(req.headers, req.socket?.remoteAddress || 'unknown');
    const userAgent = req.headers['user-agent'] as string;
    return this.sessionService.deleteSession(id, ip, userAgent);
  }

  @Get('status')
  async getStatus() {
    return this.sessionService.getStatus();
  }

  @Get('trade/:id')
  async getTrade(@Param('id') id: string) {
    return this.sessionService.getTrade(id);
  }

  @Get('binance/rate-limit')
  async getBinanceRateLimit() {
    return this.sessionService.getBinanceRateLimit();
  }

  @Get('history')
  async getHistory(@Query('sessionId') sessionId?: string) {
    return this.sessionService.getHistory(sessionId);
  }

  @Post('trade/:symbol/close')
  async closeTradeManually(@Param('symbol') symbol: string, @Req() req: Request) {
    const ip = req.ip || extractIp(req.headers, req.socket?.remoteAddress || 'unknown');
    const userAgent = req.headers['user-agent'] as string;

    // Basic input hardening: ensure symbol matches expected Binance format
    if (!/^[A-Z0-9]{3,20}$/.test(symbol)) {
      throw new BadRequestException('Invalid symbol format');
    }
    return this.sessionService.closeTradeManually(symbol, ip, userAgent);
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
  async resetPaperBalance(@Req() req: Request) {
    const ip = req.ip || extractIp(req.headers, req.socket?.remoteAddress || 'unknown');
    const userAgent = req.headers['user-agent'] as string;
    return this.sessionService.resetPaperBalance(ip, userAgent);
  }
}
