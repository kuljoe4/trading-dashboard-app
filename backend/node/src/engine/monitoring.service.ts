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
  private enabled = true;

  constructor() {
    this.measureEventLoopLag();
    // Update CPU metrics every 5 seconds to reduce overhead
    setInterval(() => {
      if (this.enabled) this.updateCpuMetrics();
    }, 5000);
  }

  setEnabled(enabled: boolean) {
    if (this.enabled !== enabled) {
      this.logger.log(`Monitoring ${enabled ? 'enabled' : 'disabled'} based on client preferences`);
    }
    this.enabled = enabled;
  }

  private measureEventLoopLag() {
    if (!this.enabled) {
      setTimeout(() => this.measureEventLoopLag(), 5000);
      return;
    }
    const start = Date.now();
    const delay = 5000; // Increased delay to 5s
    setTimeout(() => {
      if (!this.enabled) {
        this.measureEventLoopLag();
        return;
      }
      const end = Date.now();
      const lag = Math.max(0, end - start - delay);
      this.eventLoopLag = lag;
      if (this.eventLoopLag > 150) { // Increased warning threshold
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
