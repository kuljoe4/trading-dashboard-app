import {
  Injectable,
  Logger,
  Inject,
  forwardRef,
  OnApplicationShutdown,
} from "@nestjs/common";
import { EventEmitter2, OnEvent } from "@nestjs/event-emitter";
import { SessionConfig } from "../models/SessionConfig";
import { Trade } from "../models/Trade";
import { TickerCacheService } from "./ticker_cache.service";
import { KlineStoreService } from "./kline_store.service";
import { SignalEngineService } from "./signalEngine";
import { RiskEngineService } from "./riskEngine";
import { PositionTrackerService } from "./positionTracker";
import { OrderManagerService } from "./orderManager";
import { MarketFeedService } from "./market_feed.service";
import { MomentumScannerService } from "./momentum_scanner.service";
import { MonitoringService } from "./monitoring.service";
import { AnalyticsService } from "./analytics.service";
import { ExecutionService } from "./execution.service";
import { SessionLifecycleService } from "./session-lifecycle.service";
import { BroadcastService } from "./broadcast.service";
import { SessionStateService } from "./session_state.service";
import { ENGINE_EVENTS } from "./events";
import { v4 as uuid } from "uuid";
import { roundEight, roundTo } from "../lib/math";
import {
  ENGINE_CONSTANTS,
  CONFIG_LIMITS,
  EXIT_REASONS,
} from "../models/constants";
import { VariantAnalyticsService } from "./variant-analytics.service";
import { EngineBroadcasterService } from "./engine-broadcaster.service";
import { GatingService } from "./gating.service";
import { MaintenanceService } from "./maintenance.service";
import { AuditLogService } from "../trading/audit-log.service";
import { TradeSerializationDto } from "../trading/dto/trade-serialization.dto";

function monitoringChangedInternal(curr: any, prev: any): boolean {
  if (!curr || !prev) return true;
  return (
    Math.abs((curr.system?.cpu_usage || 0) - (prev.system?.cpu_usage || 0)) > 8
  );
}

@Injectable()
export class TradingSessionService implements OnApplicationShutdown {
  private readonly logger = new Logger(TradingSessionService.name);

  private running = false;
  private sessionId: string | null = null;
  private config: SessionConfig | null = null;
  private binanceClient: any = null;
  private lastRateLimitCheck = 0;
  private onBalanceUpdate:
    | ((balance: number, pnl: number) => Promise<void> | void)
    | null = null;
  private onTradeUpdate:
    | ((trade: Trade, balance: number) => Promise<void>)
    | null = null;
  private mainLoopInterval: NodeJS.Timeout | null = null;
  private hotLoopInterval: NodeJS.Timeout | null = null;
  private appliedPnL: Map<string, number> = new Map(); // trade.id -> total cumulative pnl applied to balance
  private lastScannerFullBroadcast = 0;
  private lastScannerResultsJson = "";
  private lastScannerResults: any[] = [];
  private lastVariantScannerResults: any[] = [];
  private hotLoopProcessing = false;
  private mainLoopProcessing = false;
  private activeWindows: Map<string, any> = new Map();
  private userDataWs: any = null;
  private listenKey: string | null = null;
  private listenKeyKeepAlive: NodeJS.Timeout | null = null;
  private _lastGateBroadcastTs = 0;
  private _lastGatedScanTs = 0;
  private hibernateGraceTimeout: NodeJS.Timeout | null = null;
  private inFlightExchangeCloses: Set<string> = new Set();

  private cachedStrategyConfigs: SessionConfig[] | null = null;
  private cachedScanSignatures: Map<SessionConfig, string> = new Map();

  private getStrategyLabel(
    config: Partial<SessionConfig> | null | undefined,
    index = 0,
  ): string {
    return (
      config?.strategy_label ||
      (index === 0 ? "Momentum Strategy" : `Strategy ${index + 1}`)
    ).toString();
  }

  private getStrategyConfigs(): SessionConfig[] {
    if (this.cachedStrategyConfigs) return this.cachedStrategyConfigs;
    if (!this.config) return [];
    const base = {
      ...this.config,
      strategy_label: this.getStrategyLabel(this.config, 0),
      strategy_variants: [],
    } as SessionConfig;
    const variants = (this.config.strategy_variants || [])
      .filter((v: any) => v && v.enabled !== false)
      .map(
        (v, i) =>
          ({
            ...this.config,
            ...v,
            strategy_label: this.getStrategyLabel(v, i + 1),
            strategy_variants: [],
          }) as SessionConfig,
      );
    this.cachedStrategyConfigs = [base, ...variants];
    return this.cachedStrategyConfigs;
  }

  private scanSignature(config: SessionConfig): string {
    let s = this.cachedScanSignatures.get(config);
    if (s) return s;
    s = JSON.stringify({
      ge: config.global_scanner_enabled,
      si: config.scan_interval,
      sl: config.scan_lookback,
      st: config.scan_pct_threshold,
      mv: config.scan_min_volume_usdt,
      sm: config.scan_mode,
      ws: config.watchlist_size,
      es: config.entry_side,
      ex: config.excluded_symbols,
      sym: config.symbols,
      ssc: config.single_symbol_configs,
    });
    this.cachedScanSignatures.set(config, s);
    return s;
  }

  constructor(
    private readonly tickerCache: TickerCacheService,
    private readonly klineStore: KlineStoreService,
    private readonly signalEngine: SignalEngineService,
    private readonly riskEngine: RiskEngineService,
    @Inject(forwardRef(() => PositionTrackerService))
    private readonly positionTracker: PositionTrackerService,
    @Inject(forwardRef(() => OrderManagerService))
    private readonly orderManager: OrderManagerService,
    @Inject(forwardRef(() => MarketFeedService))
    private readonly marketFeed: MarketFeedService,
    private readonly momentumScanner: MomentumScannerService,
    private readonly monitoringService: MonitoringService,
    private readonly analyticsService: AnalyticsService,
    private readonly executionService: ExecutionService,
    private readonly sessionLifecycle: SessionLifecycleService,
    private readonly broadcastService: BroadcastService,
    private readonly sessionState: SessionStateService,
    private readonly variantAnalytics: VariantAnalyticsService,
    private readonly engineBroadcaster: EngineBroadcasterService,
    private readonly gatingService: GatingService,
    private readonly maintenanceService: MaintenanceService,
    private readonly auditLog: AuditLogService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  setWsBroadcaster(cb: (data: any) => void) {
    this.broadcastService.setWsBroadcaster(cb);
  }
  async setBinanceClient(client: any, paperMode = true) {
    await this.orderManager.setBinanceClient(client, paperMode);
  }
  isEcoMode(): boolean {
    return this.sessionState.isEcoMode(this.running);
  }
  isGated(): boolean {
    return this.sessionState.isGated();
  }
  setDashboardCount(count: number) {
    this.sessionState.dashboardCount = count;
  }
  setListenerCount(count: number) {
    const prevCount = this.sessionState.listenerCount;
    this.sessionState.listenerCount = count;
    if (this.running && this.config) {
      if (prevCount > 0 && count === 0) {
        const hasTrades = this.positionTracker.activeCount() > 0;
        const ecoMainMs = Math.max(
          hasTrades ? 15000 : 30000,
          this.config.main_loop_interval_ms || CONFIG_LIMITS.MAIN_LOOP_DEFAULT,
        );
        const ecoHotMs = Math.max(
          hasTrades ? 5000 : 10000,
          this.config.hot_loop_interval_ms || CONFIG_LIMITS.HOT_LOOP_DEFAULT,
        );
        this.restartLoops(ecoHotMs, ecoMainMs);
      } else if (prevCount === 0 && count > 0) {
        this.restartLoops(
          this.config.hot_loop_interval_ms || CONFIG_LIMITS.HOT_LOOP_DEFAULT,
          this.config.main_loop_interval_ms || CONFIG_LIMITS.MAIN_LOOP_DEFAULT,
        );
      }
    }
  }

  private restartLoops(hotMs: number, mainMs: number) {
    if (this.hotLoopInterval) clearInterval(this.hotLoopInterval);
    if (this.mainLoopInterval) clearInterval(this.mainLoopInterval);
    this.hotLoopInterval = setInterval(() => this.hotLoop(), hotMs);
    this.mainLoopInterval = setInterval(() => this.mainLoop(), mainMs);
  }

  setBalanceUpdateCallback(cb: (b: number, p: number) => void) {
    this.onBalanceUpdate = cb;
  }
  setTradeUpdateCallback(cb: (t: Trade, b: number) => Promise<void>) {
    this.onTradeUpdate = cb;
  }
  private broadcast(et: string, p: any) {
    this.broadcastService.broadcast(et, p);
  }

  async start(
    config: SessionConfig,
    bc?: any,
    sid?: string,
    hist: Trade[] = [],
    curBal?: number,
    open: Trade[] = [],
  ) {
    this.running = true;
    this.sessionId = sid || null;
    this.config = config;
    this.appliedPnL.clear();

    // DATA-CONSISTENCY: Initialize appliedPnL for resumed trades to prevent double-counting fees
    if (open && open.length > 0) {
      for (const t of open) {
        this.appliedPnL.set(t.id, t.pnl || 0);
      }
    }

    this.cachedStrategyConfigs = null;
    this.cachedScanSignatures.clear();
    this.binanceClient = bc;
    this.activeWindows.clear();
    this.marketFeed.setCandleCloseCallback(this.onCandleClose.bind(this));

    const startMsg = `[Lifecycle] Starting trading engine for session ${this.sessionId} (curBal: ${curBal})`;
    this.logger.log(startMsg);
    this.eventEmitter.emit(ENGINE_EVENTS.LOG_MESSAGE, {
      msg: startMsg,
      level: "info",
    });
    await this.sessionLifecycle.start(config, bc, sid, hist, curBal, open);

    // DATA-07: Recalculate total risk on start to ensure O(1) tracker is in sync with loaded state
    this.positionTracker.recalculateTotalRisk();

    // DATA-07: Immediate risk evaluation on start to detect gating/hibernation state
    // BOLT: Await this before starting loops so we don't start market feed only to stop it immediately
    try {
      await this.refreshRiskGating();
    } catch (e: any) {
      this.logger.error(`Initial risk gating check failed: ${e.message}`);
    }

    const hot = config.hot_loop_interval_ms || 5000;
    this.hotLoopInterval = setInterval(() => this.hotLoop(), hot);
    const main = config.main_loop_interval_ms || 15000;
    this.mainLoopInterval = setInterval(() => this.mainLoop(), main);

    this.broadcastSnapshot("started");
    return { status: "started" };
  }

  async stop() {
    this.running = false;
    this.sessionState.paused = false;
    this.sessionState.gateState = null;
    this.sessionState.hibernating = false;
    this.mainLoopProcessing = false;
    this.hotLoopProcessing = false;

    if (this.mainLoopInterval) clearInterval(this.mainLoopInterval);
    if (this.hotLoopInterval) clearInterval(this.hotLoopInterval);

    const mode =
      this.config?.trading_mode || (this.config?.paper_mode ? "paper" : "live");
    const isPaper = mode === "paper";

    // CHRONOS: Resolve in-flight entries before stopping to prevent ghost positions
    if (!isPaper && this.binanceClient) {
      const inFlightSymbols = this.positionTracker.getInFlightSymbols();
      for (const symbol of inFlightSymbols) {
        const t = this.positionTracker.getInFlightEntry(symbol);
        if (t) {
          try {
            const entryOrderId = `ent-${t.id.replace(/-/g, "").substring(0, 20)}`;
            const queryRes = await this.binanceClient.restAPI.queryOrder({
              symbol: t.symbol,
              origClientOrderId: entryOrderId,
            });
            const queryData = (await queryRes.data()) as any;
            if (queryData && queryData.orderId) {
              const executedQty = parseFloat(queryData.executedQty || "0");
              if (executedQty > 0) {
                this.logger.log(
                  `[Shutdown] Promoting filled/partially-filled in-flight entry for ${t.symbol} (Qty: ${executedQty}) to active list for closure.`,
                );
                t.binance_order_id = String(queryData.orderId);
                t.qty = executedQty;
                const avgPrice = parseFloat(
                  queryData.avgPrice || queryData.price || "0",
                );
                if (avgPrice > 0) t.entry_price = avgPrice;

                this.positionTracker.addTrade(t);
              }
            }
          } catch (e: any) {
            this.logger.debug(
              `[Shutdown] In-flight entry check for ${t.symbol} failed (likely order never reached exchange): ${e.message}`,
            );
          }
        }
      }
    }

    const active = this.positionTracker.activeList();

    for (const t of active) {
      const cp = await this.tickerCache.getPrice(t.symbol);
      const ep = cp ?? t.last_price ?? t.entry_price;
      const res = await this.positionTracker.closeTrade(
        t.symbol,
        ep,
        EXIT_REASONS.SESSION_TERMINATED,
        this.config!,
        isPaper,
      );
      if (res.exitOccurred && res.trade) {
        this.sessionState.updateStatsOnClose(
          (res.trade.pnl || 0) > 0,
          res.trade.pnl || 0,
          res.trade.is_reconciliation,
          res.trade.id,
        );
        this.sessionState.addClosedTrade(res.trade);
        await this.updateBalance(res.trade);
        if (this.onTradeUpdate)
          await this.onTradeUpdate(res.trade, this.getBalance());
      } else {
        // If closeTrade failed on exchange (res.exitOccurred is false/falsy),
        // we should NOT fabricate a closed/PnL-final trade with synthetic exit price!
        // Instead, we mark it as CLOSED_ORPHANED because it's orphaned on shutdown,
        // and we DO NOT calculate synthetic realized PnL or fee, nor do we update session balance with a fake PnL.
        t.status = "CLOSED_ORPHANED";
        t.exit_ts = new Date();
        t.exit_reason = EXIT_REASONS.SESSION_TERMINATED;
        t.exit_signal_type = "SESSION_TERMINATED";
        t.exit_signal_reason =
          "Position still live on exchange; orphaned on session shutdown";
        t.exit_price = ep; // reference price at shutdown, but not realized on exchange

        this.sessionState.addClosedTrade(t);
        if (this.onTradeUpdate) await this.onTradeUpdate(t, this.getBalance());
        this.positionTracker.removeTrade(t.symbol);
      }
    }

    await this.sessionLifecycle.stop(
      this.binanceClient,
      this.sessionId || undefined,
      this.config || undefined,
    );

    this.sessionState.setActiveTrades([]);
    // BOLT: Full reset of position tracker to prevent risk leaks
    this.positionTracker.clear();
    // BOLT: Clear appliedPnL on stop as it's session-transient
    this.appliedPnL.clear();
    this.minimizeMemoryUsage();
    this.sessionState.minimize();
    this.tickerCache.clear();
    this.klineStore.clear();

    this.broadcastSnapshot("stopped");
    return { status: "stopped" };
  }

  /**
   * Graceful Shutdown Hook: Triggered by NestJS when the application is shutting down.
   * Ensures that intervals and WebSocket connections are cleared without forcing trade closures.
   */
  async onApplicationShutdown(signal?: string) {
    if (!this.running) return;
    this.logger.log(
      `Application shutdown initiated (${signal || "SIGTERM"}). Stopping trading session gracefully...`,
    );

    this.running = false;

    if (this.mainLoopInterval) clearInterval(this.mainLoopInterval);
    if (this.hotLoopInterval) clearInterval(this.hotLoopInterval);

    // Stop lifecycle (WS connections, streams) without closing trades
    await this.sessionLifecycle.stop(
      this.binanceClient,
      this.sessionId || undefined,
      this.config || undefined,
    );

    this.logger.log(
      "Graceful shutdown: Session stopped, trades left open on exchange for protection.",
    );
  }

  private async hotLoop() {
    if (!this.running || !this.config || this.hotLoopProcessing) return;
    if (
      this.sessionState.listenerCount === 0 &&
      this.positionTracker.activeCount() === 0
    ) {
      this.monitoringService.recordHotLoop(0);
      return;
    }

    this.hotLoopProcessing = true;
    const start = performance.now();
    try {
      await this.checkExits();
      this.engineBroadcaster.broadcastTick(
        this.positionTracker.activeList(),
        this.config!,
        this.getStrategyConfigs(),
        this.isEcoMode(),
        () => this.getActiveWindows(),
        () => this.getBinanceRateLimit(),
      );
      this.monitoringService.recordHotLoop(performance.now() - start);
    } catch (error) {
      this.logger.error(
        `Error in hot loop: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      this.hotLoopProcessing = false;
    }
  }

  @OnEvent(ENGINE_EVENTS.TRADE_UPDATED)
  async handleTradeUpdate(payload: { trade: Trade; pnlDelta?: number }) {
    const trade = payload.trade;

    // DATA-05: Delta-based balance updates to prevent double-counting
    // Use provided delta, or calculate from appliedPnL if available.
    const currentPnl = trade.pnl || 0;
    const prevApplied = this.appliedPnL.get(trade.id) || 0;
    const pnlDelta = payload.pnlDelta ?? roundEight(currentPnl - prevApplied);

    if (pnlDelta !== 0) {
      const mode =
        this.config?.trading_mode ||
        (this.config?.paper_mode ? "paper" : "live");
      if (mode === "paper") {
        this.sessionState.balancePaper = roundEight(
          this.sessionState.balancePaper + pnlDelta,
        );
      } else {
        // CHRONOS: Stop applying PnL delta to balanceLive in real-time.
        // ACCOUNT_UPDATE provides the authoritative absolute wallet balance (Zero Weight).
        // Applying deltas here risks double-counting if the UDS event arrived first.
        this.logger.debug(
          `[PnL Integrity] Skipping delta application to balanceLive for ${trade.symbol}. Authoritative UDS will sync absolute balance.`,
        );
      }
      // Update appliedPnL to reflect the change
      this.appliedPnL.set(trade.id, roundEight(prevApplied + pnlDelta));

      // SRE: Update sessionStats to include realized PnL from active trades (fees/funding/partial hits)
      this.sessionState.updateStatsOnClose(false, trade.pnl, false, trade.id);
    }

    if (this.onTradeUpdate) await this.onTradeUpdate(trade, this.getBalance());
  }

  @OnEvent(ENGINE_EVENTS.RISK_GATES_UPDATED)
  async refreshRiskGating() {
    if (!this.running || !this.config) return;
    const activeTrades = this.positionTracker.activeList();
    const prevGateState = this.sessionState.gateState;
    const isInsideWindow = this.gatingService.isInsideTradingWindow(
      this.config!,
    );

    const riskResult = this.riskEngine.canEnter(
      activeTrades,
      this.sessionState.closedTrades,
      this.getBalance(),
      "DUMMY",
      this.config!,
      this.positionTracker.totalRisk(),
    );
    const hasUnscheduledMonitors = this.config.single_symbol_configs?.some(
      (sc) => sc.enabled && sc.follow_schedule === false,
    );

    if (!isInsideWindow && !hasUnscheduledMonitors) {
      this.sessionState.gateState = "sleeping";
      this.sessionState.isAdaptiveTightened =
        riskResult.isAdaptiveTightened || false;
    } else if (!riskResult.canEnter) {
      // If gating is due to risk (not just symbol max trades), update gateState
      // BOLT: Only update gateState if the reason is NOT a per-symbol limit.
      // Per-symbol limits should not trigger a global 'gated' UI state.
      if (!riskResult.reason.includes("Max open trades for")) {
        this.sessionState.gateState = this.gatingService.mapGateState(
          riskResult.reason,
        );
      } else {
        // If it was gated but now it's only a per-symbol limit, clear the global gateState
        this.sessionState.gateState = null;
      }
      this.sessionState.isAdaptiveTightened =
        riskResult.isAdaptiveTightened || false;
    } else {
      this.sessionState.gateState = null;
      this.sessionState.isAdaptiveTightened =
        riskResult.isAdaptiveTightened || false;
    }

    const shouldHibernate = this.isGated() && activeTrades.length === 0;

    // Transition to Hibernation
    if (
      shouldHibernate &&
      !this.sessionState.hibernating &&
      !this.hibernateGraceTimeout
    ) {
      const mode = this.config.hibernation_mode || "adaptive";

      if (mode === "adaptive") {
        const graceSec = this.config.hibernation_grace_period_sec || 30;
        // BOLT: Adaptive Hibernation. Implement a configurable grace period ("Light Sleep") before full cache purge.
        // This prevents the expensive "Resumption Burst" if gating is brief (e.g., cooling down after a hit).
        this.logger.log(
          `[Gating] Entering LIGHT SLEEP (Grace Period). DEEP SLEEP scheduled in ${graceSec}s if conditions persist.`,
        );
        this.hibernateGraceTimeout = setTimeout(async () => {
          this.hibernateGraceTimeout = null;
          try {
            if (
              this.isGated() &&
              this.positionTracker.activeCount() === 0 &&
              !this.sessionState.hibernating
            ) {
              this.logger.log(
                `[Gating] Transitioning to DEEP SLEEP. Reason: ${riskResult.reason || "Session gated and idle"}`,
              );
              await this.gatingService.enterHibernation(
                riskResult.reason || "Session gated and idle",
                this.config!,
                this.positionTracker.activeList(),
              );
              this.minimizeMemoryUsage();
            }
          } catch (error) {
            this.logger.error(
              `Failed to transition to DEEP SLEEP: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
        }, graceSec * 1000);
      } else {
        // Immediate entry for 'light' or 'deep' modes
        const label = mode === "light" ? "LIGHT SLEEP" : "DEEP SLEEP";
        this.logger.log(`[Gating] Entering ${label} immediately.`);
        await this.gatingService.enterHibernation(
          riskResult.reason || "Session gated and idle",
          this.config!,
          activeTrades,
        );
        if (mode === "deep") this.minimizeMemoryUsage();
      }
    }
    // Transition out of Hibernation
    else if (!shouldHibernate) {
      if (this.hibernateGraceTimeout) {
        this.logger.log(
          `[Gating] LIGHT SLEEP cancelled. Gating cleared before DEEP SLEEP transition.`,
        );
        clearTimeout(this.hibernateGraceTimeout);
        this.hibernateGraceTimeout = null;
      }

      if (this.sessionState.hibernating) {
        const mode = this.config.hibernation_mode || "adaptive";
        const label = mode === "light" ? "LIGHT SLEEP" : "DEEP SLEEP";
        this.logger.log(
          `[Gating] Exiting ${label}. Reason: Gating conditions cleared.`,
        );
        const exitStart = Date.now();
        // SRE: Pre-emptive metadata refresh check before exiting hibernation
        await this.marketFeed.fetchExchangeInfo();
        await this.gatingService.exitHibernation(this.config!);
        this.logger.log(
          `[Gating] ${label} exit completed in ${Date.now() - exitStart}ms`,
        );
      }
    }

    const prevReason = this.sessionState.gateReason;
    this.sessionState.gateReason = riskResult.reason;

    if (
      this.sessionState.gateState !== prevGateState ||
      riskResult.reason !== prevReason
    ) {
      if (this.sessionState.gateState !== prevGateState) {
        const msg = `[Gating] State changed: ${prevGateState || "ACTIVE"} -> ${this.sessionState.gateState || "ACTIVE"}. Reason: ${riskResult.reason}`;
        this.logger.log(msg);
        this.eventEmitter.emit(ENGINE_EVENTS.LOG_MESSAGE, {
          msg,
          level: "info",
        });
      }

      // BOLT: Throttled broadcast of gating reasons to avoid flooding UI with countdowns.
      // Reduced to 5s interval to minimize network egress while gated.
      const now = Date.now();
      if (
        this.sessionState.gateState !== prevGateState ||
        now - this._lastGateBroadcastTs > 5000
      ) {
        this._lastGateBroadcastTs = now;
        this.broadcast("gate", {
          gateState: this.sessionState.gateState,
          reason: riskResult.reason,
          isAdaptiveTightened: riskResult.isAdaptiveTightened,
          nextSlotTs: riskResult.nextSlotTs,
          scannerPaused:
            this.sessionState.gateState === "max_trades" ||
            this.sessionState.gateState === "sl_guard" ||
            this.sessionState.gateState === "max_trades_period" ||
            this.sessionState.paused,
        });
      }

      // BOLT: Allow watchlist updates during hibernation if in light sleep to prevent "drop to zero" bug
      const hibMode = this.config.hibernation_mode || "adaptive";
      if (!this.sessionState.hibernating || hibMode === "light") {
        this.eventEmitter.emit(
          ENGINE_EVENTS.WATCHLIST_NEEDS_UPDATE,
          this.config,
        );
      }
    }
    return riskResult;
  }

  private async mainLoop() {
    if (!this.running || !this.config || this.mainLoopProcessing) return;
    this.mainLoopProcessing = true;

    try {
      const activeTrades = this.positionTracker.activeList();
      await this.refreshRiskGating();
      const now = Date.now();

      // PERF: Adaptive Scanning Frequency.
      // When gated (Light Sleep), we throttle scanning to 3x the normal interval.
      // This balances UI "freshness" with CPU/API resource conservation.
      if (this.isGated() && !this.sessionState.hibernating) {
        const baseInterval = this.config.main_loop_interval_ms || 15000;
        if (now - this._lastGatedScanTs < baseInterval * 3) {
          // If we recently scanned while gated, skip this iteration
          this.mainLoopProcessing = false;
          return;
        }
        this._lastGatedScanTs = now;
      }

      // BOLT: Allow scanning even when gated (Light Sleep) to keep UI fresh.
      // Deep Sleep (hibernating) still pauses scanning for resource efficiency.
      if (this.sessionState.hibernating) {
        // CODE-04: Ensure active windows are refreshed even when gated to clear expired opportunities
        this.refreshActiveWindows([]);

        if (this.sessionState.listenerCount > 0) {
          const now = Date.now();
          const isFull = now - this.lastScannerFullBroadcast > 30000;
          if (isFull) this.lastScannerFullBroadcast = now;
          this.broadcast("scanner", {
            count: this.lastScannerResults.length,
            hibernating: true,
            last_scan_ts: this.sessionState.last_scan_ts,
            opportunities: this.lastScannerResults.slice(0, 5).map((o) => {
              if (isFull) return o;
              const { history, ...rest } = o;
              return rest;
            }),
            variant_opportunities: this.lastVariantScannerResults.map((v) => ({
              ...v,
              opportunities: v.opportunities.slice(0, 5).map((o: any) => {
                if (isFull) return o;
                const { history, ...rest } = o;
                return rest;
              }),
            })),
            activeWindows: this.getActiveWindows(),
          });
        }
        this.mainLoopProcessing = false;
        return;
      }

      const start = performance.now();
      const strategyConfigs = this.getStrategyConfigs();
      const opportunitiesBySignature = new Map<string, any[]>();
      let primaryOpportunities: any[] = [];
      this.monitoringService.setLoopStage("SCANNING");
      for (const sc of strategyConfigs) {
        const sig = this.scanSignature(sc);
        if (!opportunitiesBySignature.has(sig))
          opportunitiesBySignature.set(sig, this.momentumScanner.scan(sc));
        if (primaryOpportunities.length === 0)
          primaryOpportunities = opportunitiesBySignature.get(sig) || [];
      }
      const scannerData = strategyConfigs.map((c) => ({
        strategy_label: c.strategy_label,
        opportunities:
          opportunitiesBySignature.get(this.scanSignature(c)) || [],
      }));

      if (this.sessionState.dashboardCount > 0) {
        const baseConfig = strategyConfigs[0];
        // BOLT: Process all Top 15 opportunities (matching UI) for entry signals and telemetry.
        const opportunitiesWithSignals = primaryOpportunities
          .slice(0, ENGINE_CONSTANTS.SCANNER_MAX_RESULTS)
          .map((opp) => {
            const signalResult = this.signalEngine.checkEntry(
              opp.symbol,
              baseConfig,
              baseConfig.scan_interval || "1m",
              opp.direction.toUpperCase() as "LONG" | "SHORT",
              "entry",
            );
            return { ...opp, signalResult };
          });
        this.updateScannerResults(opportunitiesWithSignals);
        this.lastVariantScannerResults = scannerData;
        const now = Date.now();
        const isFull = now - this.lastScannerFullBroadcast > 30000;
        const nextResultsJson = JSON.stringify(
          this.lastScannerResults.map((o) => o.symbol + o.direction + o.score),
        );
        const resultsChanged = nextResultsJson !== this.lastScannerResultsJson;
        this.lastScannerResultsJson = nextResultsJson;

        const resultsPriceChanged = () => {
          const prevResults = this.engineBroadcaster.getLastScannerResults();
          if (!prevResults || prevResults.length === 0) return false;
          return this.lastScannerResults.some((o, i) => {
            const prev = prevResults[i];
            return prev && Math.abs(o.price - prev.price) / prev.price > 0.001;
          });
        };

        if (isFull || resultsChanged || resultsPriceChanged()) {
          if (isFull) this.lastScannerFullBroadcast = now;
          this.lastScannerResultsJson = nextResultsJson;
          this.sessionState.last_scan_ts = Date.now();
          this.broadcast("scanner", {
            count: this.lastScannerResults.length,
            last_scan_ts: this.sessionState.last_scan_ts,
            // BOLT: Expand broadcast to Top 15 (matching UI "Top 15 results") and ensure full telemetry is sent during full broadcasts
            opportunities: this.lastScannerResults
              .slice(0, ENGINE_CONSTANTS.SCANNER_MAX_RESULTS)
              .map((o) => {
                if (isFull) return o;
                const { history, ohlc_history, ...rest } = o;
                return rest;
              }),
            variant_opportunities: this.lastVariantScannerResults.map((v) => ({
              ...v,
              opportunities: v.opportunities
                .slice(0, ENGINE_CONSTANTS.SCANNER_MAX_RESULTS)
                .map((o: any) => {
                  if (isFull) return o;
                  const { history, ohlc_history, ...rest } = o;
                  return rest;
                }),
            })),
            activeWindows: this.getActiveWindows(),
          });
        }
      } else this.refreshActiveWindows(primaryOpportunities);

      if (this.isGated()) {
        this.mainLoopProcessing = false;
        return;
      }

      for (const sc of strategyConfigs) {
        const opps = opportunitiesBySignature.get(this.scanSignature(sc)) || [];
        await this.executionService.processEntries(
          opps,
          sc,
          sc.strategy_label || "Momentum Strategy",
          async (t) => {
            // Immediately deduct entry fee from session balance to keep total PnL accurate
            await this.updateBalance(t);
            if (this.onTradeUpdate)
              await this.onTradeUpdate(t, this.getBalance());
          },
        );
      }
      this.monitoringService.setLoopStage("IDLE");
      this.monitoringService.recordMainLoop(performance.now() - start);
    } catch (error) {
      this.monitoringService.setLoopStage("IDLE");
      this.logger.error(
        `Error in main loop: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      this.mainLoopProcessing = false;
    }
  }

  private async checkExits() {
    await this.executionService.checkExits(this.config!, async (t) => {
      await this.updateBalance(t);
      if (this.onTradeUpdate) await this.onTradeUpdate(t, this.getBalance());
    });
  }

  private async onCandleClose(symbol: string) {
    if (!this.running || !this.config) return;
    if (this.config.debug_mode)
      this.logger.verbose(`Candle closed for ${symbol}`);
  }

  private updateScannerResults(opportunities: any[]) {
    this.lastScannerResults = opportunities.map((o) => ({
      symbol: o.symbol,
      price: o.price,
      pct: roundTo(o.momentum, 2),
      momentum: roundTo(o.momentum, 2),
      direction: o.direction.toLowerCase(),
      dir: o.direction.toLowerCase(),
      vol: o.volume_24h,
      volume_usdt: o.volume_24h,
      volume_rank: o.volume_rank,
      score: roundTo(o.score, 1),
      history: o.history,
      ohlc_history: o.ohlc_history,
      signalResult: o.signalResult,
      score_breakdown: o.score_breakdown ? {
        momentum: roundTo(o.score_breakdown.momentum, 1),
        volatility: roundTo(o.score_breakdown.volatility, 1),
        trend: roundTo(o.score_breakdown.trend, 1),
      } : undefined,
    }));
    this.refreshActiveWindows(this.lastScannerResults);
  }

  private refreshActiveWindows(opportunities: any[]) {
    if (this.config?.scan_mode !== "active_window") {
      this.activeWindows.clear();
      return;
    }
    const now = Date.now();
    const durationMs = (this.config.scan_window_duration_sec || 90) * 1000;
    opportunities.forEach((opp) => {
      const existing = this.activeWindows.get(opp.symbol);
      this.activeWindows.set(opp.symbol, {
        symbol: opp.symbol,
        direction: opp.dir,
        pct_change: opp.pct,
        opened_at: existing?.opened_at || now,
        expires_at: existing?.expires_at || now + durationMs,
        checks: (existing?.checks || 0) + 1,
        entries: existing?.entries || 0,
      });
    });
    for (const [symbol, window] of this.activeWindows.entries()) {
      if (window.expires_at <= now || this.positionTracker.hasSymbol(symbol))
        this.activeWindows.delete(symbol);
    }
  }

  private getActiveWindows() {
    const now = Date.now();
    return Array.from(this.activeWindows.values()).map((window) => ({
      ...window,
      remaining_ms: Math.max(0, window.expires_at - now),
    }));
  }

  private broadcastSnapshot(status: "started" | "stopped") {
    const mode =
      this.config?.trading_mode || (this.config?.paper_mode ? "paper" : "live");
    if (status === "stopped") {
      this.broadcast("session_terminated", {
        reason: EXIT_REASONS.SESSION_TERMINATED,
        endedAt: new Date().toISOString(),
      });
      return;
    }
    this.broadcast("session", {
      status,
      running: this.running,
      paused: this.sessionState.paused,
      mode: this.config?.paper_mode ? "PAPER" : "LIVE",
      tradingMode: mode,
      balance: this.getBalance(),
      config: this.config,
      hibernation_mode: this.config?.hibernation_mode || "adaptive",
      gateState: this.sessionState.gateState,
      isAdaptiveTightened: this.sessionState.isAdaptiveTightened,
      scannerPaused:
        this.sessionState.gateState === "max_trades" ||
        this.sessionState.gateState === "sl_guard" ||
        this.sessionState.gateState === "max_trades_period" ||
        this.sessionState.paused,
      activeTrades: this.positionTracker
        .activeList()
        .map((t) => this.engineBroadcaster.serializeTrade(t, this.config!)),
      scannerResults: this.lastScannerResults,
      activeWindows: this.getActiveWindows(),
      apiStatus: this.sessionState.apiStatus,
      tradesInPeriod:
        this.engineBroadcaster.getLastRiskResult()?.tradesInPeriod,
      maxTradesPeriod:
        this.engineBroadcaster.getLastRiskResult()?.maxTradesPeriod,
      tradesIn24h: this.engineBroadcaster.getLastRiskResult()?.tradesIn24h,
      maxTrades24h: this.engineBroadcaster.getLastRiskResult()?.maxTrades24h,
      nextSlotTs: this.engineBroadcaster.getLastRiskResult()?.nextSlotTs,
    });
  }

  private async updateBalance(t: Trade, isEntry = false, isFunding = false) {
    const mode =
      this.config?.trading_mode || (this.config?.paper_mode ? "paper" : "live");

    // DATA-05: Delta-based balance updates to prevent double-counting of fees/PnL
    const totalPnl = t.pnl || 0;
    const previouslyApplied = this.appliedPnL.get(t.id) || 0;
    const pnlDelta = roundEight(totalPnl - previouslyApplied);

    if (mode === "paper") {
      if (pnlDelta !== 0) {
        this.sessionState.balancePaper = roundEight(
          this.sessionState.balancePaper + pnlDelta,
        );
        this.appliedPnL.set(t.id, totalPnl);
      }
    } else if (this.binanceClient) {
      if (pnlDelta !== 0) {
        this.appliedPnL.set(t.id, totalPnl);
      } else if (previouslyApplied === totalPnl) {
        return;
      }

      // CITADEL: 100% Reliance on User Data Stream.
      // We explicitly skip all reactive REST balance polling to preserve IP reputation
      // and weight. BalanceLive is updated asynchronously by handleAccountUpdate.
      if (this.onBalanceUpdate)
        this.onBalanceUpdate(this.getBalance(), t.pnl || 0);

      if (pnlDelta !== 0) {
        this.sessionState.updateStatsOnClose(false, totalPnl, false, t.id);
      }
      return;
    }

    if (pnlDelta !== 0) {
      this.sessionState.updateStatsOnClose(false, totalPnl, false, t.id);
    }

    if (this.onBalanceUpdate)
      this.onBalanceUpdate(this.getBalance(), t.pnl || 0);
  }
  private getBalance(): number {
    return this.sessionState.getBalance(this.config?.paper_mode ?? true);
  }
  private async rollbackTradeClosure(
    t: Trade,
    pp: number,
    pl: number,
    pa: number,
  ) {
    this.logger.warn(`Rolling back trade closure for ${t.symbol}.`);
    this.sessionState.balancePaper = pp;
    this.sessionState.balanceLive = pl;
    this.appliedPnL.set(t.id, pa);
    this.sessionState.rollbackClosedTrade(t);
    t.status = "OPEN";
    this.positionTracker.addTrade(t);
    if (this.onBalanceUpdate) await this.onBalanceUpdate(this.getBalance(), 0);
  }

  getActiveTradeCount(): number {
    return this.positionTracker.activeCount();
  }
  getActiveTradeSymbols(): string[] {
    return this.positionTracker.activeList().map((t) => t.symbol);
  }
  getActiveTradesRaw(): Trade[] {
    return this.positionTracker.activeList();
  }
  addTrade(trade: Trade) {
    this.positionTracker.addTrade(trade);
  }
  seedActiveTrades(trades: Trade[]) {
    this.sessionState.setActiveTrades(trades);
  }

  async startUds(client: any) {
    await this.sessionLifecycle.startUserDataStream(client);
  }

  startBuffering() {
    this.sessionLifecycle.startBuffering();
  }

  async replayBuffer() {
    await this.sessionLifecycle.replayBuffer();
  }

  /**
   * BOLT OPTIMIZATION: Clears transient caches and state to minimize RAM footprint
   * during Deep Sleep or after session termination.
   */
  minimizeMemoryUsage() {
    this.activeWindows.clear();
    this.lastScannerResults = [];
    this.lastVariantScannerResults = [];
    this.lastScannerResultsJson = "";
    this.cachedStrategyConfigs = null;
    this.cachedScanSignatures.clear();
    this.monitoringService.clearAppMetrics();
    this.engineBroadcaster.minimize();
    this.logger.verbose(
      "TradingSessionService: Transient memory caches cleared",
    );
  }

  getStatus() {
    const mode =
      this.config?.trading_mode || (this.config?.paper_mode ? "paper" : "live");
    const startingBalance =
      mode === "paper"
        ? this.config?.paper_starting_balance || 10000
        : this.config?.live_starting_balance || 0;
    const currentBalance = this.getBalance();

    // DATA-CONSISTENCY: Use mode-specific profit calculation.
    // Live mode uses internal PnL tracking to ignore deposits.
    const totalPnl =
      mode === "paper"
        ? roundEight(currentBalance - startingBalance)
        : roundEight(this.sessionState.stats.totalPnl || 0);

    const lastRisk = this.engineBroadcaster.getLastRiskResult();

    return {
      running: this.running,
      paused: this.sessionState.paused,
      mode: this.config?.paper_mode ? "PAPER" : "LIVE",
      tradingMode: mode,
      balance_paper: this.sessionState.balancePaper,
      balance_live: this.sessionState.balanceLive,
      total_pnl: totalPnl,
      stats: this.sessionState.stats,
      activeTrades: this.positionTracker
        .activeList()
        .map((t) => this.engineBroadcaster.serializeTrade(t, this.config!)),
      total_risk: this.positionTracker.totalRisk(),
      variant_stats: this.variantAnalytics.calculateVariantStats(
        this.positionTracker.activeList(),
        currentBalance,
        this.sessionState.cachedClosedTradesStats,
        this.getStrategyConfigs(),
      ),
      scannerResults: this.lastScannerResults,
      activeWindows: this.getActiveWindows(),
      gateState: this.sessionState.gateState,
      hibernating: this.sessionState.hibernating,
      isAdaptiveTightened: lastRisk?.isAdaptiveTightened ?? false,
      tradesInPeriod: lastRisk?.tradesInPeriod,
      maxTradesPeriod: lastRisk?.maxTradesPeriod,
      tradesIn24h: lastRisk?.tradesIn24h,
      maxTrades24h: lastRisk?.maxTrades24h,
      nextSlotTs: lastRisk?.nextSlotTs,
      apiStatus: this.sessionState.apiStatus,
      scannerPaused:
        this.sessionState.gateState === "max_trades" ||
        this.sessionState.gateState === "sl_guard" ||
        this.sessionState.gateState === "max_trades_period" ||
        this.sessionState.paused,
      history: this.sessionState.closedTrades
        .slice(0, 50)
        .map((t) =>
          this.engineBroadcaster.serializeTrade(t, this.config!, t.exit_price),
        ),
    };
  }

  setPaused(paused: boolean) {
    this.sessionState.paused = paused;
    this.broadcast("tick", { paused });
  }
  updateConfig(config: SessionConfig) {
    const prev = this.config;
    this.config = config;
    this.cachedStrategyConfigs = null;
    this.cachedScanSignatures.clear();
    if (
      prev &&
      (prev.hot_loop_interval_ms !== config.hot_loop_interval_ms ||
        prev.main_loop_interval_ms !== config.main_loop_interval_ms)
    ) {
      const isEco = this.sessionState.listenerCount === 0;
      const mainMs = isEco
        ? Math.max(15000, config.main_loop_interval_ms || 15000)
        : config.main_loop_interval_ms || 15000;
      const hotMs = isEco
        ? Math.max(5000, config.hot_loop_interval_ms || 5000)
        : config.hot_loop_interval_ms || 5000;
      this.restartLoops(hotMs, mainMs);
    }

    // DATA-07: Trigger immediate risk re-evaluation when config is updated (e.g., risk_pct_per_trade changed from 2% during gating)
    if (this.running) {
      this.refreshRiskGating().catch((e) =>
        this.logger.error(
          `Failed to refresh gating after config update: ${e.message}`,
        ),
      );
    }

    this.auditLog.log({
      action: "UPDATE_CONFIG",
      resourceId: this.sessionId || undefined,
      details: { strategy: config.strategy_label },
    });

    this.broadcast("tick", { config: this.config });
  }

  async fetchTickerPrice(symbol: string): Promise<number | null> {
    return this.tickerCache.getPrice(symbol);
  }

  /**
   * SRE: Triggers a full state reconciliation audit.
   * Delegates to MaintenanceService to keep the engine decoupled from persistence events.
   */
  async reconcileLiveState() {
    if (!this.running || !this.config) return;
    await this.maintenanceService.reconcileLiveState(this.running, this.config);
  }

  async fetchPosition(symbol: string): Promise<any | null> {
    return this.orderManager.fetchPosition(symbol);
  }
  async fetchAllPositions(): Promise<any[]> {
    return this.orderManager.fetchAllPositions();
  }
  seedRealTimePosition(symbol: string, amount: number, entryPrice: number) {
    this.sessionState.realTimePositions.set(symbol, { amount, entryPrice });
  }

  updateRateLimit(used1m: number) {
    this.sessionState.updateRateLimit(used1m);
  }
  isRateLimited(): boolean {
    return this.sessionState.isRateLimited();
  }

  reconcileMilestoneFromSl(
    trade: Trade,
    slPrice: number,
    config: SessionConfig,
  ): number {
    return this.positionTracker.reconcileMilestoneFromSl(
      trade,
      slPrice,
      config,
    );
  }
  getBinanceRateLimit() {
    return this.sessionState.getBinanceRateLimit();
  }
  getClosedTrades(): Trade[] {
    return this.sessionState.closedTrades;
  }

  getTrade(idOrSymbol: string): Trade | undefined {
    const active = this.positionTracker
      .activeList()
      .find((t) => t.id === idOrSymbol || t.symbol === idOrSymbol);
    if (active) return active;
    return this.sessionState.closedTrades.find(
      (t) => t.id === idOrSymbol || t.symbol === idOrSymbol,
    );
  }

  @OnEvent("watchdog.request_symbol_audit")
  async handleWatchdogSymbolAudit(payload: { symbol: string }) {
    if (!this.running || !this.config) return;
    await this.maintenanceService.protectionWatchdog(
      this.running,
      this.config,
      payload.symbol,
    );
  }

  @OnEvent("binance.api_limit_reached")
  async handleApiLimitReached(payload: {
    type: "BAN" | "RATE_LIMIT";
    message: string;
    until: number;
  }) {
    this.sessionState.apiStatus.isBanned = payload.type === "BAN";
    this.sessionState.apiStatus.isRateLimited = payload.type === "RATE_LIMIT";
    this.sessionState.apiStatus.banUntil = payload.until;
    this.sessionState.apiStatus.lastErrorMessage = payload.message;

    const level = payload.type === "BAN" ? "error" : "warn";
    const msg = `[API] ${payload.type} DETECTED: ${payload.message}. Cooldown until ${new Date(payload.until).toLocaleTimeString()}`;
    this.logger.log(msg);
    this.eventEmitter.emit(ENGINE_EVENTS.LOG_MESSAGE, { msg, level });
    this.broadcast("api_status", this.sessionState.apiStatus);
  }

  @OnEvent(ENGINE_EVENTS.EXCHANGE_CLOSE)
  async handleExchangeClose(payload: {
    symbol: string;
    exitPrice: number;
    reason: string;
    isReconciliation?: boolean;
    orderId?: string;
    feesAlreadyAccounted?: boolean;
    alreadyRealized?: boolean;
    needsMarketClose?: boolean;
  }) {
    if (!this.running) return;
    const {
      symbol,
      exitPrice,
      reason,
      isReconciliation,
      feesAlreadyAccounted,
      alreadyRealized,
      needsMarketClose,
    } = payload;

    // SRE: Idempotency guard - check if we are already closing this symbol
    if (
      this.inFlightExchangeCloses.has(symbol) ||
      this.positionTracker.isClosing(symbol)
    ) {
      this.logger.debug(
        `[Idempotency] Dropping redundant exchange_close event for ${symbol} (Reason: ${reason}). Already in-flight or closing.`,
      );
      return;
    }

    let trade = this.positionTracker
      .activeList()
      .find((t) => t.symbol === symbol);

    // CHRONOS: Race condition guard - check in-flight entries if not in active list
    if (!trade) {
      trade = this.positionTracker.getInFlightEntry(symbol);
      if (trade) {
        this.logger.debug(
          `[Chronos] Matched in-flight entry for ${symbol} closure.`,
        );
        // Note: positionTracker.closeTrade handles trades not in the active Map
      }
    }

    if (!trade) return;

    this.inFlightExchangeCloses.add(symbol);

    try {
      if (!trade) return;

      this.logger.log(
        `Handling exchange-triggered close for ${symbol} @ ${exitPrice} (${reason})`,
      );

      // Determination: Should we only update local state or attempt an exchange close?
      // Reasons like SL_HIT, EXCHANGE_FILL, and EXCHANGE_SYNC (ghost positions) imply the exchange is already at 0.
      // WATCHDOG_NUCLEAR_CLOSE however requires an active market close order.
      // CHRONOS: needsMarketClose explicitly forces localOnly = false for rejected SLs.
      const localOnly =
        !needsMarketClose && reason !== EXIT_REASONS.WATCHDOG_NUCLEAR_CLOSE;
      const ignoreBlocked =
        reason === EXIT_REASONS.WATCHDOG_NUCLEAR_CLOSE || needsMarketClose;

      const res = await this.positionTracker.closeTrade(
        symbol,
        exitPrice,
        reason,
        this.config!,
        this.config?.paper_mode ?? true,
        localOnly,
        {
          ignoreBlocked,
          orderId: payload.orderId,
          feesAlreadyAccounted,
          alreadyRealized,
        },
      );

      if (res.exitOccurred && res.trade) {
        if (isReconciliation) res.trade.is_reconciliation = true;
        // BOLT: Prioritize the more specific reason and price recovered from the exchange (e.g. SL_HIT vs EXCHANGE_SYNC)
        const finalizedReason = res.trade.exit_reason || reason;
        const finalizedPrice = res.trade.exit_price || exitPrice;
        await this.finalizeTradeClosure(
          res.trade,
          finalizedPrice,
          finalizedReason,
        );
      }
    } finally {
      this.inFlightExchangeCloses.delete(symbol);
    }
  }

  private async finalizeTradeClosure(
    trade: Trade,
    exitPrice: number,
    reason: string,
  ) {
    // SRE: Immediate cooldown on exit (Issue 3). Defaults to 2m if min_trade_interval_min is 0/undefined.
    const mode =
      this.config?.trading_mode || (this.config?.paper_mode ? "paper" : "live");
    const cooldownMin = this.config?.min_trade_interval_min || 2;
    this.executionService.setCooldown(trade.symbol, mode, cooldownMin);

    this.sessionState.updateStatsOnClose(
      (trade.pnl || 0) > 0,
      trade.pnl || 0,
      trade.is_reconciliation,
      trade.id,
    );
    await this.updateBalance(trade);
    this.sessionState.addClosedTrade(trade);
    if (this.onTradeUpdate) await this.onTradeUpdate(trade, this.getBalance());
    this.sessionState.setActiveTrades(this.positionTracker.activeList());
    this.eventEmitter.emit(ENGINE_EVENTS.WATCHLIST_NEEDS_UPDATE, this.config!);

    // CODE-002: Prefer pre-calculated analytics from the Broadcaster cache to avoid redundant recalculation
    let analytics = this.engineBroadcaster.getLastAnalyticsResult();
    if (!analytics) {
      const mode =
        this.config?.trading_mode ||
        (this.config?.paper_mode ? "paper" : "live");
      const startingBalance =
        mode === "paper"
          ? this.config?.paper_starting_balance || 10000
          : this.config?.live_starting_balance || 0;
      analytics = this.analyticsService.calculateAnalytics(
        this.sessionState.closedTrades as any,
        startingBalance,
      );
    }

    this.broadcast("trade_event", {
      event: "closed",
      symbol: trade.symbol,
      reason: reason,
      trade: this.engineBroadcaster.serializeTrade(
        trade,
        this.config!,
        exitPrice,
      ),
      pnl: trade.pnl,
      stats: this.sessionState.stats,
      analytics: analytics
        ? {
            maxDrawdown: roundTo(analytics.maxDrawdown, 2),
            maxDrawdownPct: roundTo(analytics.maxDrawdownPct, 2),
            overallWinRate: roundTo(analytics.overallWinRate, 2),
            cumulativePnL: analytics.cumulativePnL
              .slice(-20)
              .map((p: any) => ({ ...p, pnl: roundTo(p.pnl, 2) })),
          }
        : undefined,
    });
  }

  async closeTradeManually(
    symbol: string,
  ): Promise<{ success: boolean; trade?: Trade; error?: string }> {
    if (!this.running) return { success: false, error: "No session running" };
    const trade = this.positionTracker
      .activeList()
      .find((t) => t.symbol === symbol);
    if (!trade)
      return { success: false, error: `No open position for ${symbol}` };
    const cp = await this.tickerCache.getPrice(symbol);
    if (!cp)
      return { success: false, error: `Could not fetch price for ${symbol}` };
    const res = await this.positionTracker.closeTrade(
      symbol,
      cp,
      EXIT_REASONS.MANUAL_CLOSE,
      this.config!,
      this.config?.paper_mode ?? true,
    );
    if (res.exitOccurred && res.trade) {
      const pp = this.sessionState.balancePaper;
      const pl = this.sessionState.balanceLive;
      const pa = this.appliedPnL.get(res.trade.id) || 0;
      try {
        const finalizedPrice = res.trade.exit_price || cp;
        await this.finalizeTradeClosure(
          res.trade,
          finalizedPrice,
          EXIT_REASONS.MANUAL_CLOSE,
        );
        await this.auditLog.log({
          action: "MANUAL_TRADE_CLOSE",
          resourceId: res.trade.id,
          details: { symbol, pnl: res.trade.pnl },
        });
        return { success: true, trade: res.trade };
      } catch (err: any) {
        await this.rollbackTradeClosure(res.trade, pp, pl, pa);
        return { success: false, error: err.message };
      }
    }
    return { success: false, error: "Failed to close trade" };
  }

  public updatePaperBalance(balance: number) {
    this.sessionState.balancePaper = balance;
  }
}
