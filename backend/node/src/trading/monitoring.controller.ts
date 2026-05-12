import { Controller, Get } from '@nestjs/common';
import { MonitoringService } from '../engine/monitoring.service';

@Controller('monitoring')
export class MonitoringController {
  constructor(private readonly monitoringService: MonitoringService) {}

  @Get('stats')
  getStats() {
    return this.monitoringService.getMetrics();
  }
}
