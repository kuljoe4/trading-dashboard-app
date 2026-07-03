import { Injectable, Logger } from '@nestjs/common';
import { roundTo } from '../lib/math';

@Injectable()
export class MonitoringService {
  private readonly logger = new Logger(MonitoringService.name);

  private hotLoopExecutionTime = 0;
  private mainLoopExecutionTime = 0;
  private apiRequestCount = 0;
  private lastUdsPing = 0;
  private udsStatus: 'CONNECTED' | 'DISCONNECTED' | 'LAGGING' = 'DISCONNECTED';

  // SRE: Loop Pipeline State tracking for real-time UI observability
  private loopPipeline: {
    stage: 'IDLE' | 'SCANNING' | 'EVALUATING' | 'RISK_CHECK' | 'EXECUTING' | 'COOLING_DOWN';
    symbol?: string;
    progress?: number;
    ts: number;
  } = { stage: 'IDLE', ts: Date.now() };

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
    this.loopPipeline = { stage: 'IDLE', ts: Date.now() };
    this.logger.verbose('MonitoringService: Application loop metrics cleared');
  }

  setLoopStage(stage: typeof this.loopPipeline.stage, symbol?: string, progress?: number) {
    this.loopPipeline = { stage, symbol, progress, ts: Date.now() };
  }

  getMetrics() {
    // SRE: Monitor User Data Stream (UDS) health to detect event-loop degradation
    const now = Date.now();
    // BOLT/SRE: Increased LAGGING threshold to 180s to align with relaxed stall detection
    const currentUdsStatus = (this.lastUdsPing > 0 && (now - this.lastUdsPing > 180000)) ? 'LAGGING' : this.udsStatus;

    return {
      application: {
        hot_loop_ms: this.hotLoopExecutionTime,
        main_loop_ms: this.mainLoopExecutionTime,
        api_requests_total: this.apiRequestCount,
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
      // Reset stale clock on fresh connection —
      // UDS legitimately silent on idle accounts
      this.lastUdsPing = Date.now();
    }
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
