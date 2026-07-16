import { Controller, Get, UseGuards, HttpException, HttpStatus } from '@nestjs/common';
import { MonitoringService } from '../engine/monitoring.service';
import { SessionStateService } from '../engine/session_state.service';
import { ApiKeyGuard } from '../lib/api-key.guard';

@Controller()
export class MonitoringController {
  constructor(
    private readonly monitoringService: MonitoringService,
    private readonly sessionState: SessionStateService
  ) {}

  @Get('monitoring/stats')
  @UseGuards(ApiKeyGuard)
  getStats() {
    return this.monitoringService.getMetrics();
  }

  /**
   * SRE: /healthz/liveness probe
   * Returns 200 OK as long as the NestJS application loop isn't deadlocked.
   */
  @Get('healthz/liveness')
  getLiveness() {
    return { status: 'OK', timestamp: new Date().toISOString() };
  }

  /**
   * SRE: /healthz/readiness probe
   * Evaluates active pipeline dependencies: UDS status and Rate Limit utilization.
   */
  @Get('healthz/readiness')
  getReadiness() {
    const metrics = this.monitoringService.getMetrics();
    const rateLimit = this.sessionState.getBinanceRateLimit();

    const hasActiveSession = !!this.sessionState.config;
    const isUdsHealthy = !hasActiveSession || metrics.application.exchange_uds_status === 'CONNECTED';
    const isWeightHealthy = (rateLimit.used_weight_1m / (rateLimit.weight_limit || 2400)) < 0.9;

    if (!isUdsHealthy) {
       throw new HttpException({
         status: 'UNREADY',
         reason: 'UDS_STALL',
         lastPing: metrics.application.last_uds_ping_sec
       }, HttpStatus.SERVICE_UNAVAILABLE);
    }

    if (!isWeightHealthy) {
       throw new HttpException({
         status: 'UNREADY',
         reason: 'RATE_LIMIT_EXCEEDED',
         usage: rateLimit.used_weight_1m
       }, HttpStatus.SERVICE_UNAVAILABLE);
    }

    return { status: 'READY', uds: hasActiveSession ? 'CONNECTED' : 'INACTIVE', weight: rateLimit.used_weight_1m };
  }
}
