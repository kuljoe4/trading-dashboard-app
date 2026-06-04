import { Injectable, Logger } from '@nestjs/common';
import { roundTo } from '../lib/math';

@Injectable()
export class MonitoringService {
  private readonly logger = new Logger(MonitoringService.name);
  private lastCpuUsage = process.cpuUsage();
  private lastCpuTime = Date.now();
  private currentCpuPercent = 0;
  private cachedSystemMetrics: any = {
    cpu_usage: 0,
    memory_rss: 0,
    memory_heap_used: 0,
    uptime: 0,
    event_loop_lag: 0,
  };

  private hotLoopExecutionTime = 0;
  private mainLoopExecutionTime = 0;
  private apiRequestCount = 0;
  private eventLoopLag = 0;
  private enabled = true;

  constructor() {
    this.measureEventLoopLag();
    // Update CPU metrics at a low cadence to reduce overhead
    const cpuTimer = setInterval(() => {
      if (this.enabled) this.updateCpuMetrics();
    }, 10000);
    cpuTimer.unref?.();
  }

  setEnabled(enabled: boolean) {
    if (this.enabled !== enabled) {
      this.logger.log(`Monitoring ${enabled ? 'enabled' : 'disabled'} based on client preferences`);
    }
    this.enabled = enabled;
  }

  private measureEventLoopLag() {
    if (!this.enabled) {
      const disabledTimer = setTimeout(() => this.measureEventLoopLag(), 10000);
      disabledTimer.unref?.();
      return;
    }
    const start = Date.now();
    const delay = 10000; // Low-overhead sampling cadence
    const lagTimer = setTimeout(() => {
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
    lagTimer.unref?.();
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

    // BOLT OPTIMIZATION: Update cached system metrics here to avoid syscalls in getMetrics()
    const mem = process.memoryUsage();
    this.cachedSystemMetrics = {
      cpu_usage: roundTo(this.currentCpuPercent, 2),
      memory_rss: roundTo(mem.rss / 1024 / 1024, 2),
      memory_heap_used: roundTo(mem.heapUsed / 1024 / 1024, 2),
      uptime: Math.floor(process.uptime()),
      event_loop_lag: this.eventLoopLag,
    };
  }

  getMetrics() {
    // BOLT OPTIMIZATION: Return cached metrics to avoid expensive syscalls in high-freq tick loop
    if (!this.enabled) {
      return {
        system: {
          cpu_usage: 0,
          memory_rss: 0,
          memory_heap_used: 0,
          uptime: Math.floor(process.uptime()),
          event_loop_lag: 0,
        },
        application: {
          hot_loop_ms: 0,
          main_loop_ms: 0,
          api_requests_total: this.apiRequestCount,
        }
      };
    }

    return {
      system: this.cachedSystemMetrics,
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
