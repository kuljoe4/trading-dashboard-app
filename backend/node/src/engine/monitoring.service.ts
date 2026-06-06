import { Injectable, Logger } from '@nestjs/common';
import { roundTo } from '../lib/math';

@Injectable()
export class MonitoringService {
  private readonly logger = new Logger(MonitoringService.name);

  private hotLoopExecutionTime = 0;
  private mainLoopExecutionTime = 0;
  private apiRequestCount = 0;

  constructor() {
    // BOLT: System health monitoring (CPU, RAM, Event Loop Lag) removed per requirement
  }

  /**
   * BOLT OPTIMIZATION: Clears application-level loop timing metrics.
   * Useful when entering Deep Sleep to ensure stale metrics aren't reported.
   */
  clearAppMetrics() {
    this.hotLoopExecutionTime = 0;
    this.mainLoopExecutionTime = 0;
    this.logger.verbose('MonitoringService: Application loop metrics cleared');
  }

  getMetrics() {
    // BOLT: Returns only application-level metrics, system health metrics removed
    return {
      application: {
        hot_loop_ms: this.hotLoopExecutionTime,
        main_loop_ms: this.mainLoopExecutionTime,
        api_requests_total: this.apiRequestCount,
      }
    };
  }

  recordHotLoop(ms: number) {
    this.hotLoopExecutionTime = Math.round(ms);
  }

  recordMainLoop(ms: number) {
    this.mainLoopExecutionTime = Math.round(ms);
  }

  incrementApiRequests() {
    this.apiRequestCount++;
  }
}
