import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class MonitoringService {
  private readonly logger = new Logger(MonitoringService.name);

  private telemetryEnabled = true;
  private hotLoopExecutionTime = 0;
  private mainLoopExecutionTime = 0;
  private apiRequestCount = 0;
  private apiSuccessCount = 0;
  private apiErrorCount = 0;
  private apiRequestBreakdown: Record<string, number> = {};
  private restTelemetryLogs: { ts: number; label: string; duration: number; weight: number; status: 'ok' | 'error' | 'shed'; errorMsg?: string }[] = [];
  private readonly MAX_LOGS = 50;
  private lastUdsPing = 0;
  private udsStatus: 'CONNECTED' | 'DISCONNECTED' | 'LAGGING' = 'DISCONNECTED';

  // Cache tracking metrics
  private cacheHitsTotal = 0;
  private cacheMissesTotal = 0;
  private cacheBreakdown: Record<string, { hits: number; misses: number }> = {
    uds_positions: { hits: 0, misses: 0 },
    uds_orders: { hits: 0, misses: 0 },
    ticker_cache: { hits: 0, misses: 0 },
    supertrend_cache: { hits: 0, misses: 0 },
    exchange_info: { hits: 0, misses: 0 }
  };

  // Loop Pipeline State tracking
  private loopPipeline: {
    stage: 'IDLE' | 'SCANNING' | 'EVALUATING' | 'RISK_CHECK' | 'EXECUTING' | 'COOLING_DOWN';
    symbol?: string;
    progress?: number;
    ts: number;
  } = { stage: 'IDLE', ts: Date.now() };

  setTelemetryEnabled(enabled: boolean) {
    this.telemetryEnabled = enabled;
  }

  isTelemetryEnabled(): boolean {
    return this.telemetryEnabled;
  }

  recordCacheHit(label = 'general') {
    if (!this.telemetryEnabled) return;
    this.cacheHitsTotal++;
    if (!this.cacheBreakdown[label]) {
      this.cacheBreakdown[label] = { hits: 0, misses: 0 };
    }
    this.cacheBreakdown[label].hits++;
  }

  recordCacheMiss(label = 'general') {
    if (!this.telemetryEnabled) return;
    this.cacheMissesTotal++;
    if (!this.cacheBreakdown[label]) {
      this.cacheBreakdown[label] = { hits: 0, misses: 0 };
    }
    this.cacheBreakdown[label].misses++;
  }

  clearAppMetrics() {
    this.hotLoopExecutionTime = 0;
    this.mainLoopExecutionTime = 0;
    this.apiRequestCount = 0;
    this.apiSuccessCount = 0;
    this.apiErrorCount = 0;
    this.apiRequestBreakdown = {};
    this.restTelemetryLogs = [];
    this.cacheHitsTotal = 0;
    this.cacheMissesTotal = 0;
    this.cacheBreakdown = {
      uds_positions: { hits: 0, misses: 0 },
      uds_orders: { hits: 0, misses: 0 },
      ticker_cache: { hits: 0, misses: 0 },
      supertrend_cache: { hits: 0, misses: 0 },
      exchange_info: { hits: 0, misses: 0 }
    };
    this.loopPipeline = { stage: 'IDLE', ts: Date.now() };
    this.logger.verbose('MonitoringService: Application loop metrics cleared');
  }

  setLoopStage(stage: typeof this.loopPipeline.stage, symbol?: string, progress?: number) {
    this.loopPipeline = { stage, symbol, progress, ts: Date.now() };
  }

  getMetrics() {
    const now = Date.now();
    const currentUdsStatus = this.udsStatus === 'DISCONNECTED' ? 'DISCONNECTED' :
      (this.lastUdsPing > 0 && (now - this.lastUdsPing > 180000)) ? 'LAGGING' : this.udsStatus;

    // Node.js Memory Footprint
    const memUsage = typeof process !== 'undefined' && process.memoryUsage ? process.memoryUsage() : { heapUsed: 0, heapTotal: 0, rss: 0 };
    const heapUsedMb = Math.round((memUsage.heapUsed / 1024 / 1024) * 10) / 10;
    const heapTotalMb = Math.round((memUsage.heapTotal / 1024 / 1024) * 10) / 10;
    const rssMb = Math.round((memUsage.rss / 1024 / 1024) * 10) / 10;

    // Cache hit ratio
    const totalCacheAccesses = this.cacheHitsTotal + this.cacheMissesTotal;
    const cacheHitRatioPct = totalCacheAccesses > 0 ? Math.round((this.cacheHitsTotal / totalCacheAccesses) * 1000) / 10 : 100;

    // API Success Rate
    const totalApiAttempts = this.apiSuccessCount + this.apiErrorCount;
    const apiSuccessRatePct = totalApiAttempts > 0 ? Math.round((this.apiSuccessCount / totalApiAttempts) * 1000) / 10 : 100;

    // Compile Automated SRE Recommendations & Verification Guidance
    const recommendations: string[] = [];
    if (this.udsStatus === 'CONNECTED') {
      recommendations.push('UDS Active: Zero-weight WebSocket cache auditing in steady-state trading.');
    } else {
      recommendations.push('UDS Offline: Active REST reconciliation fallback engaged.');
    }

    if (cacheHitRatioPct >= 90) {
      recommendations.push(`High Cache Efficiency (${cacheHitRatioPct}% hit ratio): Local WebSocket & indicator caches active.`);
    } else {
      recommendations.push(`Notice: Cache hit ratio at ${cacheHitRatioPct}%. Cache warming in progress.`);
    }

    if (this.hotLoopExecutionTime > 100) {
      recommendations.push(`Hot Loop Latency Alert (${this.hotLoopExecutionTime}ms): Consider enabling Master UI Eco Mode.`);
    } else {
      recommendations.push(`Hot Loop Latency Optimal (${this.hotLoopExecutionTime}ms).`);
    }

    return {
      application: {
        telemetry_enabled: this.telemetryEnabled,
        hot_loop_ms: this.hotLoopExecutionTime,
        main_loop_ms: this.mainLoopExecutionTime,
        api_requests_total: this.apiRequestCount,
        api_success_count: this.apiSuccessCount,
        api_error_count: this.apiErrorCount,
        api_success_rate_pct: apiSuccessRatePct,
        api_requests_breakdown: { ...this.apiRequestBreakdown },
        rest_telemetry_logs: this.restTelemetryLogs.slice(-20),
        cache_metrics: {
          hits_total: this.cacheHitsTotal,
          misses_total: this.cacheMissesTotal,
          hit_ratio_pct: cacheHitRatioPct,
          breakdown: { ...this.cacheBreakdown }
        },
        resource_footprints: {
          heap_used_mb: heapUsedMb,
          heap_total_mb: heapTotalMb,
          rss_mb: rssMb,
          hot_loop_ms: this.hotLoopExecutionTime,
          main_loop_ms: this.mainLoopExecutionTime
        },
        recommendations,
        exchange_uds_status: currentUdsStatus,
        last_uds_ping_sec: this.lastUdsPing > 0 ? Math.floor((now - this.lastUdsPing) / 1000) : null,
        loop_pipeline: {
          ...this.loopPipeline,
          age_ms: now - this.loopPipeline.ts
        }
      }
    };
  }

  recordUdsPing() {
    this.lastUdsPing = Date.now();
    this.udsStatus = 'CONNECTED';
  }

  setUdsStatus(status: 'CONNECTED' | 'DISCONNECTED') {
    this.udsStatus = status;
    if (status === 'DISCONNECTED') {
      this.lastUdsPing = 0;
    } else {
      this.lastUdsPing = Date.now();
    }
  }

  recordHotLoop(ms: number) {
    this.hotLoopExecutionTime = Math.round(ms);
  }

  recordMainLoop(ms: number) {
    this.mainLoopExecutionTime = Math.round(ms);
  }

  incrementApiRequests(label?: string) {
    if (!this.telemetryEnabled) return;
    this.apiRequestCount++;
    if (label) {
      this.apiRequestBreakdown[label] = (this.apiRequestBreakdown[label] || 0) + 1;
    }
  }

  recordRestCall(label: string, duration: number, weight: number, status: 'ok' | 'error' | 'shed' = 'ok', errorMsg?: string) {
    if (!this.telemetryEnabled) return;

    if (status === 'ok') {
      this.apiSuccessCount++;
      this.incrementApiRequests(label);
    } else {
      this.apiErrorCount++;
      if (label && !this.apiRequestBreakdown[label]) {
        this.apiRequestBreakdown[label] = this.apiRequestBreakdown[label] || 0;
      }
    }

    const logEntry = {
      ts: Date.now(),
      label,
      duration,
      weight,
      status,
      ...(errorMsg ? { errorMsg } : {})
    };

    this.restTelemetryLogs.push(logEntry);
    if (this.restTelemetryLogs.length > this.MAX_LOGS) {
      this.restTelemetryLogs.shift();
    }
  }
}
