import { Controller, Get, UseGuards } from '@nestjs/common';
import { MonitoringService } from '../engine/monitoring.service';
import { ApiKeyGuard } from '../lib/api-key.guard';

@Controller('monitoring')
@UseGuards(ApiKeyGuard)
export class MonitoringController {
  constructor(private readonly monitoringService: MonitoringService) {}

  @Get('stats')
  getStats() {
    return this.monitoringService.getMetrics();
  }
}
