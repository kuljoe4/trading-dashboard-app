import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class MonitoringService {
  private readonly logger = new Logger(MonitoringService.name);
  private lastCpuUsage = process.cpuUsage();
  private lastCpuTime = Date.now();
  private currentCpuPercent = 0;

  private hotLoopExecutionTime = 0;
  private mainLoopExecutionTime = 0;
  private apiRequestCount = 0;
  private eventLoopLag = 0;

  constructor() {
    this.measureEventLoopLag();
    // Update CPU metrics every 2 seconds to avoid jitter from multiple callers
    setInterval(() => this.updateCpuMetrics(), 2000);
  }

  private measureEventLoopLag() {
    const start = Date.now();
    const delay = 1000;
    setTimeout(() => {
      const end = Date.now();
      const lag = Math.max(0, end - start - delay);
      this.eventLoopLag = lag;
      if (this.eventLoopLag > 100) {
        this.logger.warn(`High event loop lag detected: ${this.eventLoopLag}ms`);
      }
      this.measureEventLoopLag();
    }, delay);
  }

  private updateCpuMetrics() {
    const cpuUsage = process.cpuUsage(this.lastCpuUsage);
    const now = Date.now();
    const timeDelta = (now - this.lastCpuTime) * 1000; // microseconds

    if (timeDelta > 0) {
      this.currentCpuPercent = (cpuUsage.user + cpuUsage.system) / timeDelta * 100;
    }

    this.lastCpuUsage = process.cpuUsage();
    this.lastCpuTime = now;
  }

  getMetrics() {
    const mem = process.memoryUsage();

    return {
      system: {
        cpu_usage: Number(this.currentCpuPercent.toFixed(2)),
        memory_rss: Number((mem.rss / 1024 / 1024).toFixed(2)),
        memory_heap_used: Number((mem.heapUsed / 1024 / 1024).toFixed(2)),
        uptime: Math.floor(process.uptime()),
        event_loop_lag: this.eventLoopLag,
      },
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
