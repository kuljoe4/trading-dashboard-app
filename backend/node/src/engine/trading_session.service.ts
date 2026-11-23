import { resolveStrategyConfig } from './strategyConfig';
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
import { rankByBreakoutOpportunity } from "./breakout-ranking";
import { scannerResultsFingerprint, scannerVariantsFingerprint } from "./scanner-fingerprint";

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
  private uiPulseInterval: NodeJS.Timeout | null = null;
  private appliedPnL: Map<string, number> = new Map(); // trade.id -> total cumulative pnl applied to balance
  private lastScannerFullBroadcast = 0;
  private lastScannerResultsJson = "";
  private lastScannerResults: any[] = [];
  private lastVariantScannerResults: any[] = [];
  private hotLoopProcessing = false;
  private mainLoopProcessing = false;
  private uiPulseProcessing = false;
  private activeWindows: Map<string, any> = new Map();
  private userDataWs: any = null;
  private listenKey: string | null = null;
  private listenKeyKeepAlive: NodeJS.Timeout | null = null;
  private _lastGateBroadcastTs = 0;
  private _lastGatedScanTs = 0;
  private hibernateGraceTimeout: NodeJS.Timeout | null = null;
  private inFlightExchangeCloses: Set<string> = new Set();
  private lastFullReconciliationTs = 0;
  private lastWatchdogTs = 0;
  private lastMemoryMaintenanceTs = 0;
  private loggedKnifeBypassMap: Map<string, number> = new Map();
  private nearTargetCandidatesByStrategy: Map<string, Map<string, { score: number; pct: number; direction: string; allFired: boolean; firedCount: number; ts: number }>> = new Map();
  private loggedCandidateDropMap: Map<string, number> = new Map();
  private _lastGateTransitionKey = '';
  private _lastGateStateLogTs = 0;

  private cachedStrategyConfigs: SessionConfig[] | null = null;
  private cachedScanSignatures: Map<SessionConfig, string> = new Map();

  private trackAndLogRemovedCandidates(
    strategyConfigs: SessionConfig[],
    scannerData: { strategy_label?: string; opportunities: any[] }[],
    activePositionSymbols: Set<string> | string[],
  ) {
    const activeSet = activePositionSymbols instanceof Set
      ? activePositionSymbols
      : new Set(activePositionSymbols || []);
    const now = Date.now();
    const dropCooldownMs = 90000;

    for (let i = 0; i < strategyConfigs.length; i++) {
      const sc = strategyConfigs[i];
      const label = sc.strategy_label || "Momentum Strategy";
      const isPaused = this.sessionState.isStrategyPaused
        ? this.sessionState.isStrategyPaused(label)
        : Boolean(this.sessionState.pausedStrategies?.has(label));
      if (isPaused) continue;

      const opps = scannerData[i]?.opportunities || [];
      const currentSymbols = new Set<string>();
      for (let j = 0; j < opps.length; j++) {
        if (opps[j]?.symbol) currentSymbols.add(opps[j].symbol);
      }

      const prevMap = this.nearTargetCandidatesByStrategy.get(label);
      if (prevMap && prevMap.size > 0) {
        for (const [sym, prev] of prevMap.entries()) {
          if (currentSymbols.has(sym) || activeSet.has(sym)) continue;
          const dropKey = `${label}:${sym}`;
          const nextAllowed = this.loggedCandidateDropMap.get(dropKey) || 0;
          if (now < nextAllowed) continue;

          if (this.loggedCandidateDropMap.size >= 250) {
            for (const [k, exp] of this.loggedCandidateDropMap.entries()) {
              if (exp <= now || this.loggedCandidateDropMap.size >= 200) {
                this.loggedCandidateDropMap.delete(k);
              }
            }
          }
          this.loggedCandidateDropMap.set(dropKey, now + dropCooldownMs);

          const preReason = typeof (this.momentumScanner as any)?.getPreFilterReason === 'function'
            ? (this.momentumScanner as any).getPreFilterReason(sym, label)
            : undefined;
          const cutoffLimit = Number(sc.watchlist_size || ENGINE_CONSTANTS.SCANNER_MAX_RESULTS);
          const reasonText = preReason?.reason
            || `dropped outside top-${cutoffLimit} watchlist cutoff`;
          const pctStr = `${prev.pct >= 0 ? '+' : ''}${Number(prev.pct || 0).toFixed(2)}%`;
          const firedText = prev.allFired ? 'all signals fired' : prev.firedCount > 0 ? `${prev.firedCount} signal(s) fired` : `score ${Math.round(prev.score)}`;
          const msg = `[Scanner] ${sym} (${label}): Candidate removed (${reasonText}; prior ${pctStr}, ${firedText}).`;

          this.logger.debug(msg);
          this.eventEmitter?.emit?.(ENGINE_EVENTS.LOG_MESSAGE, {
            msg,
            level: preReason?.code === 'sl_bounds' ? 'warn' : 'info',
            symbol: sym,
          });
        }
      }

      const nextNearMap = new Map<string, { score: number; pct: number; direction: string; allFired: boolean; firedCount: number; ts: number }>();
      const pctThreshold = Number(sc.scan_pct_threshold ?? 2.0);
      for (let j = 0; j < opps.length && nextNearMap.size < 25; j++) {
        const opp = opps[j];
        if (!opp?.symbol) continue;
        const absPct = Math.abs(Number(opp.momentum ?? opp.pct ?? 0));
        const allFired = Boolean(opp.signalResult?.allFired);
        const firedCount = Array.isArray(opp.signalResult?.firedSignals) ? opp.signalResult.firedSignals.length : 0;
        const score = Number(opp.score || 0);
        const isNearTarget = allFired || firedCount > 0 || score >= 65 || (pctThreshold > 0 && absPct >= pctThreshold * 0.75);
        if (isNearTarget) {
          nextNearMap.set(opp.symbol, {
            score,
            pct: Number(opp.momentum ?? opp.pct ?? 0),
            direction: (opp.direction || opp.dir || 'LONG').toUpperCase(),
            allFired,
            firedCount,
            ts: now,
          });
        }
      }
      this.nearTargetCandidatesByStrategy.set(label, nextNearMap);
    }
  }

  private getStrategyLabel(
    config: Partial<SessionConfig> | null | undefined,
    index = 0,
  ): string {
    return (
      config?.strategy_label ||
      (index === 0 ? "Momentum Strategy" : `Strategy ${index + 1}`)
    ).toString();
  }

  public invalidateStrategyCache() {
    this.cachedStrategyConfigs = null;
    this.cachedScanSignatures.clear();
  }

  private getStrategyConfigs(): SessionConfig[] {
    if (this.cachedStrategyConfigs) return this.cachedStrategyConfigs;
    if (!this.config) return [];
    const baseLabel = this.getStrategyLabel(this.config, 0);
    const base = {
      ...this.config,
      strategy_label: baseLabel,
      base_strategy_label: baseLabel,
      strategy_variants: [],
    } as SessionConfig;

    const baseSymbols = Array.isArray(this.config.symbols) ? this.config.symbols : [];

    const variants = (this.config.strategy_variants || [])
      .filter((v: any) => v && v.enabled !== false)
      .map(
        (v, i) => {
          const hasVariantSymbols = Array.isArray(v.symbols);
          const hasVariantScannerOverride =
            v.watchlist_size !== undefined ||
            v.watchlist_offset !== undefined ||
            v.discovery_mode !== undefined ||
            v.scan_interval !== undefined ||
            v.global_scanner_enabled !== undefined ||
            v.smart_watchlist_enabled !== undefined ||
            v.smart_watchlist_sensitivity !== undefined;

          // If variant explicitly provides symbols (including [] for discovery), use them.
          // If variant overrides scanner config without specifying symbols, avoid leaking base static symbols.
          // Otherwise, inherit baseSymbols.
          const variantSymbols = hasVariantSymbols
            ? v.symbols
            : (hasVariantScannerOverride ? [] : baseSymbols);

          return ({
            ...resolveStrategyConfig(this.config, v),
            symbols: variantSymbols,
            strategy_label: this.getStrategyLabel(v, i + 1),
            base_strategy_label: baseLabel,
            strategy_variants: [],
          }) as SessionConfig;
        },
      );
    this.cachedStrategyConfigs = [base, ...variants];
    return this.cachedStrategyConfigs;
  }

  private scanSignature(config: SessionConfig): string {
    let s = this.cachedScanSignatures.get(config);
    if (s) return s;
    s = JSON.stringify({
      ge: config.global_scanner_enabled,
      dm: config.discovery_mode,
      si: config.scan_interval,
      sl: config.scan_lookback,
      st: config.scan_pct_threshold,
      mv: config.scan_min_volume_usdt,
      sm: config.scan_mode,
      ws: config.watchlist_size,
      wo: config.watchlist_offset,
      swe: config.smart_watchlist_enabled,
      sws: config.smart_watchlist_sensitivity,
      sw: config.scanner_weights,
      slt: config.sl_type,
      sld: config.sl_distance_pct,
      slm: config.sl_max_pct,
      slo: config.sl_out_of_bounds_action,
      slr: config.reject_entry_if_sl_exceeds_max,
      sltf: config.sl_lookback_timeframe,
      slp: config.sl_lookback_period,
      elb: config.engulfing_lookback,
      tpr: config.tp_ratio,
      htfb: config.htf_ema_cross_boost_enabled,
      htfi: config.htf_ema_cross_interval,
      htfc: config.htf_ema_cross_count,
      htff: config.htf_ema_fast_period,
      htfs: config.htf_ema_slow_period,
      htfm: config.htf_ema_cross_max_boost,
      htfr: config.htf_ema_cross_rr_weight,
      htfp: config.htf_ema_cross_prefer_fresh,
      htfmb: config.htf_ema_cross_max_bars,
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
    public readonly sessionState: SessionStateService,
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
  private areAllStrategiesGated(activeTrades = this.positionTracker.activeList()): boolean {
    if (this.sessionState.paused) return true;
    const strategyConfigs = this.getStrategyConfigs();
    if (
      strategyConfigs.length > 1 &&
      this.sessionState.strategyGateStates &&
      this.sessionState.strategyGateStates.size > 0
    ) {
      const GATING_STATES = new Set([
        "max_trades",
        "sl_guard",
        "max_trades_period",
        "max_trades_24h",
        "sleeping",
        "risk_pct",
        "tod_risk",
        "risk",
      ]);
      const activeKnifeTradesCount = activeTrades.filter((t: any) => t.is_knife).length;
      for (const sc of strategyConfigs) {
        const label = sc.strategy_label || "Momentum Strategy";
        const isPaused = this.sessionState.isStrategyPaused
          ? this.sessionState.isStrategyPaused(label)
          : Boolean(this.sessionState.pausedStrategies?.has(label));
        if (isPaused) continue;
        const gateInfo = this.sessionState.strategyGateStates.get(label);
        const isScGated = Boolean(gateInfo?.gateState && GATING_STATES.has(gateInfo.gateState));
        const allowKnifeGatedBypass =
          (sc.allow_knife_when_gated ?? false) && activeKnifeTradesCount === 0;
        if (!isScGated || allowKnifeGatedBypass) {
          return false;
        }
      }
      return true;
    }
    return this.isGated();
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
    if (this.uiPulseInterval) {
      clearInterval(this.uiPulseInterval);
      this.uiPulseInterval = null;
    }
    this.hotLoopInterval = setInterval(() => this.hotLoop(), hotMs);
    if (this.hotLoopInterval?.unref) this.hotLoopInterval.unref();
    this.mainLoopInterval = setInterval(() => this.mainLoop(), mainMs);
    if (this.mainLoopInterval?.unref) this.mainLoopInterval.unref();
    if (this.sessionState.listenerCount > 0) {
      this.uiPulseInterval = setInterval(() => this.uiPulseLoop(), 1000);
      if (this.uiPulseInterval?.unref) this.uiPulseInterval.unref();
    }
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
        this.appliedPnL.set(t.id, Number(t.pnl) || 0);
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

    if (open && open.length > 0) {
      const summaryList = open.map(t => `${t.symbol} (SL: ${t.current_sl || t.initial_sl}, Peak RR: ${t.max_rr_achieved || 0}R)`).join(', ');
      this.eventEmitter.emit(ENGINE_EVENTS.ALERT, {
        level: "info",
        title: "Active Trailing Stops Resumed",
        message: `Restored trailing stop levels for ${open.length} position(s): ${summaryList}`,
      });
    }

    await this.sessionLifecycle.start(config, bc, sid, hist, curBal, open);

    // DATA-07: Recalculate total risk on start to ensure O(1) tracker is in sync with loaded state
    this.positionTracker.recalculateTotalRisk();

    // AGENTS.md §8: Startup reconciliation already established baseline; prevent redundant T+15s bulk REST burst
    const startTs = Date.now();
    this.lastFullReconciliationTs = startTs;
    this.lastWatchdogTs = startTs;

    // DATA-07: Immediate risk evaluation on start to detect gating/hibernation state
    // BOLT: Await this before starting loops so we don't start market feed only to stop it immediately
    try {
      await this.refreshRiskGating();
    } catch (e: any) {
      this.logger.error(`Initial risk gating check failed: ${e.message}`);
    }

    const hasTrades = this.positionTracker.activeCount() > 0;
    const isEco = this.sessionState.listenerCount === 0;
    const hot = isEco
      ? Math.max(hasTrades ? 5000 : 10000, config.hot_loop_interval_ms || 5000)
      : (config.hot_loop_interval_ms || 5000);
    const main = isEco
      ? Math.max(hasTrades ? 15000 : 30000, config.main_loop_interval_ms || 15000)
      : (config.main_loop_interval_ms || 15000);
    this.restartLoops(hot, main);

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
    this.uiPulseProcessing = false;

    if (this.mainLoopInterval) clearInterval(this.mainLoopInterval);
    if (this.hotLoopInterval) clearInterval(this.hotLoopInterval);
    if (this.uiPulseInterval) {
      clearInterval(this.uiPulseInterval);
      this.uiPulseInterval = null;
    }

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
          res.trade.strategy_label
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
    if (this.uiPulseInterval) {
      clearInterval(this.uiPulseInterval);
      this.uiPulseInterval = null;
    }

    // Flush active trades' latest peak RR / mark_price to DB before shutdown
    if (this.onTradeUpdate) {
      const active = this.positionTracker.activeList();
      const bal = this.getBalance();
      for (const t of active) {
        try {
          await this.onTradeUpdate(t, bal);
        } catch (err: any) {
          this.logger.warn(
            `Failed to flush open trade ${t.symbol} on shutdown: ${err?.message || err}`,
          );
        }
      }
    }

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

  /**
   * Startup Rollback: Cleans up any partially-initialized intervals or streams
   * if SessionService.startSession throws before startup completes, without closing active positions.
   */
  async rollbackStartup() {
    this.running = false;
    this.mainLoopProcessing = false;
    this.hotLoopProcessing = false;
    this.uiPulseProcessing = false;

    if (this.mainLoopInterval) {
      clearInterval(this.mainLoopInterval);
      this.mainLoopInterval = null as any;
    }
    if (this.hotLoopInterval) {
      clearInterval(this.hotLoopInterval);
      this.hotLoopInterval = null as any;
    }
    if (this.uiPulseInterval) {
      clearInterval(this.uiPulseInterval);
      this.uiPulseInterval = null as any;
    }

    try {
      await this.sessionLifecycle.stop(
        this.binanceClient,
        this.sessionId || undefined,
        this.config || undefined,
      );
    } catch (e: any) {
      this.logger.debug(
        `Startup rollback lifecycle cleanup warning: ${e instanceof Error ? e.message : String(e)}`,
      );
    }

    this.sessionState.setActiveTrades([]);
    this.positionTracker.clear();
    this.appliedPnL.clear();
    this.sessionId = null;
  }

  /**
   * 1-Second In-Memory UI Live Pulse:
   * - Active only when at least one UI client is connected (`listenerCount > 0`) and not hibernating/paused.
   * - Zero Binance REST calls and zero DB queries: reads 100% from in-memory `tickerCache` and `klineStore`
   *   (which are continuously fed by Binance WebSocket streams).
   * - Refreshes active trade ticks/exit signals AND top scanner candidates' live prices, momentum, and signal evaluations at 1s.
   */
  private uiPulseLoop() {
    if (
      !this.running ||
      !this.config ||
      this.uiPulseProcessing ||
      this.hotLoopProcessing ||
      this.mainLoopProcessing ||
      this.sessionState.listenerCount === 0 ||
      this.sessionState.hibernating ||
      this.sessionState.paused
    ) {
      return;
    }

    this.uiPulseProcessing = true;
    try {
      const strategyConfigs = this.getStrategyConfigs();

      // 1. Live 1s Active Trade & Exit Signal Pulse (in-memory only)
      const activeTrades = this.positionTracker.activeList();
      if (activeTrades.length > 0) {
        for (let i = 0; i < activeTrades.length; i++) {
          const t = activeTrades[i];
          const livePx = typeof (this.tickerCache as any)?.getPrice === "function"
            ? this.tickerCache.getPrice(t.symbol)
            : null;
          if (livePx && livePx > 0) {
            t.last_price = livePx;
            t.mark_price = livePx;
            if (typeof (this.klineStore as any)?.syncLivePrice === "function") {
              (this.klineStore as any).syncLivePrice(t.symbol, livePx);
            }
          }
          const sc = t.strategy_config || strategyConfigs.find((c) => c.strategy_label === t.strategy_label) || this.config;
          const hasExitRules = Boolean(
            (sc as any)?.use_exit_signals ||
            sc?.trigger_candle_exit_enabled ||
            (Array.isArray(sc?.exit_signals) && sc.exit_signals.length > 0)
          );
          if (hasExitRules && typeof (this.orderManager as any)?.checkExitSignals === "function") {
            try {
              (this.orderManager as any).checkExitSignals(t.symbol, t, sc, sc.scan_interval || "1m");
            } catch (_) {}
          }
        }
        this.engineBroadcaster.broadcastTick(
          activeTrades,
          this.config,
          strategyConfigs,
          this.isEcoMode(),
          () => this.getActiveWindows(),
          () => this.getBinanceRateLimit(),
        );
      }

      // 2. Live 1s Top Candidate Entry Gauge & Breakout Ladder Pulse (in-memory only)
      if (this.sessionState.dashboardCount > 0 && this.lastVariantScannerResults.length > 0) {
        const pulseNow = Date.now();
        let anyCandidateChanged = false;
        const configByLabel = new Map<string, SessionConfig>();
        for (let i = 0; i < strategyConfigs.length; i++) {
          const sc = strategyConfigs[i];
          configByLabel.set(sc.strategy_label || "Momentum Strategy", sc);
        }

        for (let vIdx = 0; vIdx < this.lastVariantScannerResults.length; vIdx++) {
          const vEntry = this.lastVariantScannerResults[vIdx];
          if (!vEntry || !Array.isArray(vEntry.opportunities) || vEntry.opportunities.length === 0) continue;
          const sc = configByLabel.get(vEntry.strategy_label || "Momentum Strategy") || this.config;
          const scanTf = sc.scan_interval || "1m";
          const lookback = Math.max(1, Number(sc.scan_lookback || 1));
          const limit = Math.min(ENGINE_CONSTANTS.SCANNER_MAX_RESULTS || 15, vEntry.opportunities.length);

          for (let oIdx = 0; oIdx < limit; oIdx++) {
            const opp = vEntry.opportunities[oIdx];
            if (!opp?.symbol) continue;
            const livePx = typeof (this.tickerCache as any)?.getPrice === "function"
              ? this.tickerCache.getPrice(opp.symbol)
              : null;
            if (!livePx || livePx <= 0) continue;

            if (typeof (this.klineStore as any)?.syncLivePrice === "function") {
              (this.klineStore as any).syncLivePrice(opp.symbol, livePx);
            }

            opp.price = livePx;
            opp.last_update = pulseNow;

            if (typeof (this.klineStore as any)?.getRawCandles === "function") {
              const candles = this.klineStore.getRawCandles(opp.symbol, scanTf);
              if (Array.isArray(candles) && candles.length > lookback) {
                const prevClose = Number(candles[candles.length - 1 - lookback]?.close || 0);
                if (prevClose > 0) {
                  const mom = roundTo(((livePx - prevClose) / prevClose) * 100, 2);
                  opp.pct = mom;
                  opp.momentum = mom;
                }
              }
            }

            if (Array.isArray(opp.ohlc_history) && opp.ohlc_history.length > 0) {
              const lastBar = opp.ohlc_history[opp.ohlc_history.length - 1];
              if (lastBar) {
                lastBar.close = livePx;
                if (livePx > Number(lastBar.high || 0)) lastBar.high = livePx;
                if (livePx < Number(lastBar.low || Infinity)) lastBar.low = livePx;
              }
            }
            if (Array.isArray(opp.history) && opp.history.length > 0) {
              opp.history[opp.history.length - 1] = livePx;
            }

            if (typeof (this.signalEngine as any)?.checkEntry === "function") {
              const dir = String(opp.direction || opp.dir || "LONG").toUpperCase() as "LONG" | "SHORT";
              opp.signalResult = this.signalEngine.checkEntry(opp.symbol, sc, scanTf, dir, "entry");
            }
            anyCandidateChanged = true;
          }
        }

        if (this.lastVariantScannerResults[0]?.opportunities) {
          this.lastScannerResults = this.lastVariantScannerResults[0].opportunities;
        }

        if (anyCandidateChanged) {
          const nextResultsJson = `${scannerResultsFingerprint(this.lastScannerResults)}|${scannerVariantsFingerprint(this.lastVariantScannerResults)}`;
          if (nextResultsJson !== this.lastScannerResultsJson) {
            this.lastScannerResultsJson = nextResultsJson;
            this.broadcast("scanner", {
              count: this.lastScannerResults.length,
              last_scan_ts: pulseNow,
              next_scan_ts: this.sessionState.next_scan_ts,
              scan_interval_ms: this.sessionState.scan_interval_ms,
              opportunities: this.lastScannerResults
                .slice(0, ENGINE_CONSTANTS.SCANNER_MAX_RESULTS)
                .map((o) => {
                  const { ohlc_history, history, ...rest } = o;
                  return rest;
                }),
              variant_opportunities: this.lastVariantScannerResults.map((v) => ({
                ...v,
                opportunities: (v.opportunities || [])
                  .slice(0, ENGINE_CONSTANTS.SCANNER_MAX_RESULTS)
                  .map((o: any) => {
                    const { ohlc_history, history, ...rest } = o;
                    return rest;
                  }),
              })),
              activeWindows: this.getActiveWindows(),
            });
          }
        }
      }
    } catch (err) {
      this.logger.debug(`UI pulse error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      this.uiPulseProcessing = false;
    }
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
        // HYBRID PNL MODEL fallback (Option A):
        // Rather than skipping delta application entirely, we apply a temporary, fee-approximate
        // local estimate to balanceLive to bridge the latency gap until the absolute UDS event arrives.
        // Once UDS ACCOUNT_UPDATE absolute balance is received, it authoritatively overwrites balanceLive,
        // correcting any minor fee/commission drift. To prevent double-counting, we guard with udsConfirmedClosedTrades.
        const udsAlreadyApplied = this.sessionState.udsConfirmedClosedTrades.has(trade.id);
        if (udsAlreadyApplied) {
          this.logger.debug(
            `[PnL Integrity] UDS ACCOUNT_UPDATE already arrived and set absolute balance for ${trade.symbol}. Skipping local fallback delta.`,
          );
        } else {
          this.logger.log(
            `[PnL Integrity] Applying temporary local fallback PnL delta (fee-approximate) of ${pnlDelta} to balanceLive for ${trade.symbol} (UDS pending).`,
          );
          this.sessionState.balanceLive = roundEight(
            this.sessionState.balanceLive + pnlDelta,
          );

          // Track this local adjustment
          const existingAdjustment = this.sessionState.localTradePnLAdjustments.get(trade.id) || 0;
          this.sessionState.localTradePnLAdjustments.set(
            trade.id,
            roundEight(existingAdjustment + pnlDelta),
          );

          this.broadcastService.broadcast('balance_update', { balance: this.sessionState.balanceLive });
        }
      }
      // Update appliedPnL to reflect the change
      this.appliedPnL.set(trade.id, roundEight(prevApplied + pnlDelta));

      // SRE: Update sessionStats to include realized PnL from active trades (fees/funding/partial hits)
      this.sessionState.updateStatsOnClose(false, trade.pnl, false, trade.id, trade.strategy_label);
    }

    if (this.onTradeUpdate) await this.onTradeUpdate(trade, this.getBalance());
  }

  @OnEvent(ENGINE_EVENTS.RISK_GATES_UPDATED)
  async refreshRiskGating() {
    if (!this.running || !this.config) return;
    const activeTrades = this.positionTracker.activeList();
    const prevGateState = this.sessionState.gateState;
    const strategyConfigs = this.getStrategyConfigs();

    let baseGateState: string | null = null;
    let baseGateReason: string | null = null;
    let baseRiskResult: any = null;

    for (const sc of strategyConfigs) {
      const label = sc.strategy_label || 'Momentum Strategy';
      const isInsideWindow = this.gatingService.isInsideTradingWindow(sc);
      const riskResult = this.riskEngine.canEnter(
        activeTrades,
        this.sessionState.closedTrades,
        this.getBalance(),
        "DUMMY",
        sc,
        this.positionTracker.totalRisk(),
        0,
        undefined,
        undefined,
        this.config?.total_sl_guard_usdt
      );

      let gateState: string | null = null;
      let gateReason: string | null = null;

      const hasUnscheduledMonitors = sc.single_symbol_configs?.some(
        (ssc) => ssc.enabled && ssc.follow_schedule === false,
      );

      if (!isInsideWindow && !hasUnscheduledMonitors) {
        gateState = "sleeping";
      } else if (!riskResult.canEnter) {
        if (!riskResult.reason.includes("Max open trades for")) {
          gateState = this.gatingService.mapGateState(riskResult.reason);
        }
      }

      gateReason = riskResult.reason;

      if (this.sessionState.strategyGateStates) {
        this.sessionState.strategyGateStates.set(label, {
          gateState,
          gateReason,
          isAdaptiveTightened: riskResult.isAdaptiveTightened || false,
        });
      }

      if (label === (this.config.strategy_label || 'Momentum Strategy')) {
        baseGateState = gateState;
        baseGateReason = gateReason;
        baseRiskResult = riskResult;
        this.sessionState.isAdaptiveTightened = riskResult.isAdaptiveTightened || false;
      }
    }

    this.sessionState.gateState = baseGateState;
    const riskResultToUse = baseRiskResult || { reason: 'OK', isAdaptiveTightened: false, nextSlotTs: null };

    const shouldHibernate = this.areAllStrategiesGated(activeTrades) && activeTrades.length === 0;

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
              this.areAllStrategiesGated() &&
              this.positionTracker.activeCount() === 0 &&
              !this.sessionState.hibernating
            ) {
              this.logger.log(
                `[Gating] Transitioning to DEEP SLEEP. Reason: ${riskResultToUse.reason || "Session gated and idle"}`,
              );
              await this.gatingService.enterHibernation(
                riskResultToUse.reason || "Session gated and idle",
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
          riskResultToUse.reason || "Session gated and idle",
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
    this.sessionState.gateReason = riskResultToUse.reason;

    if (
      this.sessionState.gateState !== prevGateState ||
      riskResultToUse.reason !== prevReason
    ) {
      if (this.sessionState.gateState !== prevGateState) {
        const now = Date.now();
        const transitionKey = `${prevGateState || "ACTIVE"}->${this.sessionState.gateState || "ACTIVE"}:${riskResultToUse.reason}`;
        if (this._lastGateTransitionKey !== transitionKey || now - this._lastGateStateLogTs > 2000) {
          this._lastGateTransitionKey = transitionKey;
          this._lastGateStateLogTs = now;
          const msg = `[Gating] State changed: ${prevGateState || "ACTIVE"} -> ${this.sessionState.gateState || "ACTIVE"}. Reason: ${riskResultToUse.reason}`;
          this.logger.log(msg);
          this.eventEmitter.emit(ENGINE_EVENTS.LOG_MESSAGE, {
            msg,
            level: "info",
          });
        }
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
          reason: riskResultToUse.reason,
          isAdaptiveTightened: riskResultToUse.isAdaptiveTightened,
          nextSlotTs: riskResultToUse.nextSlotTs,
          scannerPaused:
            this.areAllStrategiesGated(activeTrades) &&
            (this.sessionState.gateState === "max_trades" ||
              this.sessionState.gateState === "sl_guard" ||
              this.sessionState.gateState === "max_trades_period" ||
              this.sessionState.paused),
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
    return riskResultToUse;
  }

  private async mainLoop() {
    if (!this.running || !this.config || this.mainLoopProcessing) return;
    this.mainLoopProcessing = true;

    try {
      const activeTrades = this.positionTracker.activeList();
      await this.refreshRiskGating();
      const now = Date.now();

      // AGENTS.md §8: Periodic REST polling for account state is FORBIDDEN when UDS is healthy.
      // Only run fallback reconciliation if the User Data Stream is disconnected/unhealthy.
      const udsHealthy = this.sessionLifecycle?.isUdsConnected === true;
      const fiveMinutes = 300000;
      if (!udsHealthy && (!this.lastFullReconciliationTs || now - this.lastFullReconciliationTs >= fiveMinutes)) {
        this.lastFullReconciliationTs = now;
        this.reconcileLiveState().catch(err => {
          this.logger.error(`[Reconciliation] Periodic fallback reconciliation (UDS down) failed: ${err.message || err}`);
        });
      }

      // SRE: Run periodic micro protection watchdog audit every 2 minutes (120,000ms) when not hibernating flat
      const twoMinutes = 120000;
      if ((!this.sessionState.hibernating || this.positionTracker.activeCount() > 0) && (!this.lastWatchdogTs || now - this.lastWatchdogTs >= twoMinutes)) {
        this.lastWatchdogTs = now;
        this.maintenanceService.protectionWatchdog(this.running, this.config, undefined).catch(err => {
          this.logger.error(`[Watchdog] Periodic micro protection watchdog failed: ${err.message || err}`);
        });
      }

      // PERF: Periodic TTL-based memory & cache maintenance every 5 minutes
      if (!this.lastMemoryMaintenanceTs || now - this.lastMemoryMaintenanceTs >= fiveMinutes) {
        this.lastMemoryMaintenanceTs = now;
        this.performPeriodicMemoryCleanup();
      }

      // PERF: Adaptive Scanning Frequency.
      // When all active strategies are gated (Light Sleep), we throttle scanning to 3x the normal interval.
      // If any variant strategy remains un-gated, maintain normal scan cadence.
      const allStrategiesGated = this.areAllStrategiesGated(activeTrades);
      if (allStrategiesGated && !this.sessionState.hibernating) {
        const baseInterval = this.config.main_loop_interval_ms || 15000;
        if (now - this._lastGatedScanTs < baseInterval * 3) {
          // If we recently scanned while gated, skip this iteration
          this.mainLoopProcessing = false;
          return;
        }
        this._lastGatedScanTs = now;
      }

      const baseScanInterval = this.config.main_loop_interval_ms || 15000;
      const effectiveScanInterval = (allStrategiesGated && !this.sessionState.hibernating)
        ? baseScanInterval * 3
        : baseScanInterval;
      this.sessionState.scan_interval_ms = effectiveScanInterval;
      this.sessionState.next_scan_ts = now + effectiveScanInterval;

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
            next_scan_ts: this.sessionState.next_scan_ts,
            scan_interval_ms: this.sessionState.scan_interval_ms,
            opportunities: this.lastScannerResults.slice(0, 5).map((o) => {
              if (isFull) return o;
              const { ohlc_history, history, ...rest } = o;
              return rest;
            }),
            variant_opportunities: this.lastVariantScannerResults.map((v) => ({
              ...v,
              opportunities: v.opportunities.slice(0, 5).map((o: any) => {
                if (isFull) return o;
                const { ohlc_history, history, ...rest } = o;
                return rest;
              }),
            })),
            activeWindows: this.getActiveWindows(),
          });
        }
        this.mainLoopProcessing = false;
        return;
      }

      // Skip all scanning and entry evaluation when globally paused
      if (this.sessionState.paused) {
        this.refreshActiveWindows([]);
        this.monitoringService.setLoopStage("IDLE");
        this.mainLoopProcessing = false;
        return;
      }

      const start = performance.now();
      const strategyConfigs = this.getStrategyConfigs();
      const activePositionSymbols = this.positionTracker.getPositionSymbols();
      const opportunitiesBySignature = new Map<string, any[]>();
      const rankedOpportunitiesByConfig = new Map<SessionConfig, any[]>();
      let primaryOpportunities: any[] = [];
      const isPausedLabel = (label: string) =>
        this.sessionState.isStrategyPaused
          ? this.sessionState.isStrategyPaused(label)
          : Boolean(this.sessionState.pausedStrategies?.has(label));

      // Prune stale knife-bypass log timestamps for removed strategy labels
      if (this.loggedKnifeBypassMap.size > strategyConfigs.length + 5) {
        const validLabels = new Set(strategyConfigs.map(c => c.strategy_label || "Momentum Strategy"));
        for (const key of Array.from(this.loggedKnifeBypassMap.keys())) {
          if (!validLabels.has(key)) this.loggedKnifeBypassMap.delete(key);
        }
      }

      this.monitoringService.setLoopStage("SCANNING");
      for (const sc of strategyConfigs) {
        const label = sc.strategy_label || "Momentum Strategy";
        if (isPausedLabel(label)) continue;
        const sig = this.scanSignature(sc);
        if (!opportunitiesBySignature.has(sig))
          opportunitiesBySignature.set(sig, this.momentumScanner.scan(sc, activePositionSymbols));
        if (primaryOpportunities.length === 0)
          primaryOpportunities = opportunitiesBySignature.get(sig) || [];
      }
      const scannerData = strategyConfigs.map((c) => {
        const label = c.strategy_label || "Momentum Strategy";
        if (isPausedLabel(label)) {
          return {
            strategy_label: label,
            opportunities: [],
          };
        }
        const scanEvalTs = Date.now();
        const rawOpps = opportunitiesBySignature.get(this.scanSignature(c)) || [];
        const opportunitiesWithSignals = rawOpps
          .map((opp) => {
            const livePrice = this.tickerCache.getPrice(opp.symbol) || opp.price;
            if (livePrice && livePrice > 0 && typeof (this.klineStore as any)?.syncLivePrice === "function") {
              (this.klineStore as any).syncLivePrice(opp.symbol, livePrice);
            }
            const signalResult = this.signalEngine.checkEntry(
              opp.symbol,
              c,
              c.scan_interval || "1m",
              opp.direction.toUpperCase() as "LONG" | "SHORT",
              "entry",
            );
            return { ...opp, price: livePrice || opp.price, signalResult, last_update: scanEvalTs };
          });
        const rankedOpportunities = rankByBreakoutOpportunity(opportunitiesWithSignals, c);
        // Ensure fully-fired candidates always float ahead of unfired candidates within same breakout cap tier
        rankedOpportunities.sort((a: any, b: any) => {
          const aFired = a.signalResult?.allFired ? 1 : 0;
          const bFired = b.signalResult?.allFired ? 1 : 0;
          if (aFired !== bFired) return bFired - aFired;
          return 0;
        });
        rankedOpportunitiesByConfig.set(c, rankedOpportunities);
        return {
          strategy_label: label,
          opportunities: rankedOpportunities.map((o) => this.formatScannerOpportunity(o)),
        };
      });

      this.trackAndLogRemovedCandidates(strategyConfigs, scannerData, activePositionSymbols);

      // Ensure newly discovered leader symbols (e.g. a dark-horse #1 gainer/loser) trigger an immediate
      // watchlist subscription sync if not already in the active kline watchlist.
      if (
        typeof (this.marketFeed as any)?.getActiveWatchlistSymbols === "function" &&
        typeof (this.marketFeed as any)?.updateWatchlist === "function"
      ) {
        const activeWatchlist: Set<string> = (this.marketFeed as any).getActiveWatchlistSymbols();
        if (activeWatchlist && activeWatchlist.size > 0) {
          const hasUnsubscribedLeader = scannerData.some((sd) =>
            sd.opportunities.some((opp: any) => opp?.symbol && !activeWatchlist.has(opp.symbol)),
          );
          if (hasUnsubscribedLeader) {
            Promise.resolve((this.marketFeed as any).updateWatchlist(this.config)).catch((err: any) => {
              this.logger.debug(`Immediate watchlist sync skipped: ${err?.message || err}`);
            });
          }
        }
      }

      const opportunitiesWithSignals = scannerData[0]?.opportunities || [];
      this.updateScannerResults(opportunitiesWithSignals);
      this.lastVariantScannerResults = scannerData;
      const scanDoneNow = Date.now();
      this.sessionState.last_scan_ts = scanDoneNow;
      this.sessionState.next_scan_ts = scanDoneNow + effectiveScanInterval;

      if (this.sessionState.dashboardCount > 0) {
        const isFull = scanDoneNow - this.lastScannerFullBroadcast > 30000;
        const nextResultsJson = `${scannerResultsFingerprint(this.lastScannerResults)}|${scannerVariantsFingerprint(this.lastVariantScannerResults)}`;
        const resultsChanged = nextResultsJson !== this.lastScannerResultsJson;
        this.lastScannerResultsJson = nextResultsJson;

        if (isFull || resultsChanged) {
          if (isFull) this.lastScannerFullBroadcast = scanDoneNow;
          this.lastScannerResultsJson = nextResultsJson;
          this.broadcast("scanner", {
            count: this.lastScannerResults.length,
            last_scan_ts: this.sessionState.last_scan_ts,
            next_scan_ts: this.sessionState.next_scan_ts,
            scan_interval_ms: this.sessionState.scan_interval_ms,
            // BOLT: Expand broadcast to Top 15 (matching UI "Top 15 results") and ensure full telemetry is sent during full broadcasts
            opportunities: this.lastScannerResults
              .slice(0, ENGINE_CONSTANTS.SCANNER_MAX_RESULTS)
              .map((o) => {
                if (isFull) return o;
                const { ohlc_history, history, ...rest } = o;
                return rest;
              }),
            variant_opportunities: this.lastVariantScannerResults.map((v) => ({
              ...v,
              opportunities: v.opportunities
                .slice(0, ENGINE_CONSTANTS.SCANNER_MAX_RESULTS)
                .map((o: any) => {
                  if (isFull) return o;
                  const { ohlc_history, history, ...rest } = o;
                  return rest;
                }),
            })),
            activeWindows: this.getActiveWindows(),
          });
        }
      }

      if (this.sessionState.paused) {
        this.mainLoopProcessing = false;
        return;
      }

      for (const sc of strategyConfigs) {
        const label = sc.strategy_label || "Momentum Strategy";

        // Check if strategy is paused
        if (this.sessionState.isStrategyPaused ? this.sessionState.isStrategyPaused(label) : (this.sessionState.paused || (this.sessionState.pausedStrategies && this.sessionState.pausedStrategies.has(label)))) {
          this.logger.debug(`Strategy ${label} is paused. Skipping entries.`);
          continue;
        }

        // Check if strategy gating is active
        const gateInfo = this.sessionState.strategyGateStates ? this.sessionState.strategyGateStates.get(label) : null;
        const isGated = ['max_trades', 'sl_guard', 'max_trades_period', 'sleeping', 'risk_pct', 'tod_risk', 'risk'].includes(gateInfo?.gateState || '');

        // Allow gated scan evaluating candidate entries if allow_knife_when_gated is active and 0 active knife trades exist
        const activeKnifeTradesCount = this.positionTracker.activeList().filter(t => t.is_knife).length;
        const allowKnifeGatedBypass = (sc.allow_knife_when_gated ?? false) && activeKnifeTradesCount === 0;

        if (isGated && allowKnifeGatedBypass) {
          const nowTs = Date.now();
          const lastLogged = this.loggedKnifeBypassMap.get(label) || 0;
          const gateReasonDetail = gateInfo?.gateReason ? `: "${gateInfo.gateReason}"` : '';
          if (nowTs - lastLogged > 60000) {
            this.loggedKnifeBypassMap.set(label, nowTs);
            const bypassMsg = `[Knife Engine] Strategy "${label}" is gated (${gateInfo?.gateState}${gateReasonDetail}). No position opened yet — candidate opportunities are being evaluated for potential Knife Catch entry because 'allow_knife_when_gated' is active (0 active knife trades).`;
            this.logger.log(bypassMsg);
            this.eventEmitter.emit(ENGINE_EVENTS.LOG_MESSAGE, { msg: bypassMsg, level: 'info' });
          } else {
            this.logger.debug(`[Knife Engine] Strategy "${label}" is gated (${gateInfo?.gateState}${gateReasonDetail}). Candidate opportunities are being evaluated for Knife Catch entry.`);
          }
        }

        if (isGated && !allowKnifeGatedBypass) {
          this.logger.debug(`Strategy ${label} is gated (${gateInfo?.gateState}). Skipping entries.`);
          continue;
        }

        const opps = rankedOpportunitiesByConfig.get(sc) || opportunitiesBySignature.get(this.scanSignature(sc)) || [];
        await this.executionService.processEntries(
          opps,
          sc,
          label,
          async (t) => {
            // Immediately deduct entry fee from session balance to keep total PnL accurate
            await this.updateBalance(t);
            if (this.onTradeUpdate)
              await this.onTradeUpdate(t, this.getBalance());
          },
          this.config?.total_sl_guard_usdt
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

  private formatScannerOpportunity(o: any) {
    const dir = String(o.direction || o.dir || "long").toLowerCase();
    return {
      ...o,
      symbol: o.symbol,
      price: o.price,
      pct: roundTo(Number(o.momentum ?? o.pct) || 0, 2),
      momentum: roundTo(Number(o.momentum ?? o.pct) || 0, 2),
      direction: dir,
      dir,
      vol: o.volume_24h ?? o.vol,
      volume_usdt: o.volume_24h ?? o.volume_usdt,
      volume_rank: o.volume_rank,
      score: roundTo(Number(o.score) || 0, 1),
      history: o.history,
      ohlc_history: o.ohlc_history,
      candle_count: o.candle_count,
      signalResult: o.signalResult,
      breakout_rank: o.breakout_rank,
      last_update: o.last_update,
      score_breakdown: o.score_breakdown ? {
        ...o.score_breakdown,
        momentum: roundTo(Number(o.score_breakdown.momentum) || 0, 1),
        volatility: roundTo(Number(o.score_breakdown.volatility) || 0, 1),
        trend: roundTo(Number(o.score_breakdown.trend) || 0, 1),
      } : undefined,
    };
  }

  private updateScannerResults(opportunities: any[]) {
    this.lastScannerResults = opportunities.map((o) => this.formatScannerOpportunity(o));
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
    const serializedActiveTrades = this.positionTracker
      .activeList()
      .map((t) => this.engineBroadcaster.serializeTrade(t, this.config!));
    const activePnl = serializedActiveTrades.reduce(
      (sum: number, t: any) => sum + (Number(t?.pnl) || 0),
      0,
    );
    const realizedPnl = roundEight(this.sessionState.stats?.totalPnl ?? 0);
    const totalPnl = roundEight(realizedPnl + activePnl);
    const balance = this.getBalance();
    const strategyConfigs = this.getStrategyConfigs();

    this.broadcast("session", {
      status,
      running: this.running,
      paused: this.sessionState.paused,
      paused_strategies: Array.from(this.sessionState.pausedStrategies || []),
      strategy_gate_states: Object.fromEntries(
        Array.from((this.sessionState.strategyGateStates || new Map()).entries()).map(([k, v]) => [k, {
          gateState: v?.gateState || null,
          gateReason: v?.gateReason || null,
          isAdaptiveTightened: v?.isAdaptiveTightened || false
        }])
      ),
      mode: this.config?.paper_mode ? "PAPER" : "LIVE",
      tradingMode: mode,
      balance,
      realized_pnl: roundEight(realizedPnl),
      active_pnl: roundEight(activePnl),
      total_pnl: totalPnl,
      stats: this.sessionState.stats,
      variant_stats: strategyConfigs.length > 0
        ? this.variantAnalytics.calculateVariantStats(
            serializedActiveTrades as any,
            balance,
            this.sessionState.cachedClosedTradesStats,
            strategyConfigs,
          )
        : undefined,
      config: this.config,
      hibernation_mode: this.config?.hibernation_mode || "adaptive",
      gateState: this.sessionState.gateState,
      isAdaptiveTightened: this.sessionState.isAdaptiveTightened,
      agreementRequired: this.sessionState.agreementRequired,
      tradfiAgreementRequired: this.sessionState.tradfiAgreementRequired,
      scannerPaused:
        this.sessionState.gateState === "max_trades" ||
        this.sessionState.gateState === "sl_guard" ||
        this.sessionState.gateState === "max_trades_period" ||
        this.sessionState.paused,
      activeTrades: serializedActiveTrades,
      scannerResults: this.lastScannerResults,
      variant_opportunities: this.lastVariantScannerResults,
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

        // HYBRID PNL MODEL fallback (Option A):
        // Rather than skipping delta application entirely, we apply a temporary, fee-approximate
        // local estimate to balanceLive to bridge the latency gap until the absolute UDS event arrives.
        // Once UDS ACCOUNT_UPDATE absolute balance is received, it authoritatively overwrites balanceLive,
        // correcting any minor fee/commission drift. To prevent double-counting, we guard with udsConfirmedClosedTrades.
        const udsAlreadyApplied = this.sessionState.udsConfirmedClosedTrades.has(t.id);
        if (udsAlreadyApplied) {
          this.logger.debug(
            `[PnL Integrity] UDS ACCOUNT_UPDATE already arrived and set absolute balance for ${t.symbol}. Skipping local fallback delta.`,
          );
        } else {
          this.logger.log(
            `[PnL Integrity] Applying temporary local fallback PnL delta (fee-approximate) of ${pnlDelta} to balanceLive for ${t.symbol} (UDS pending).`,
          );
          this.sessionState.balanceLive = roundEight(
            this.sessionState.balanceLive + pnlDelta,
          );

          // Track this local adjustment
          const existingAdjustment = this.sessionState.localTradePnLAdjustments.get(t.id) || 0;
          this.sessionState.localTradePnLAdjustments.set(
            t.id,
            roundEight(existingAdjustment + pnlDelta),
          );

          this.broadcastService.broadcast('balance_update', { balance: this.sessionState.balanceLive });
        }
      } else if (previouslyApplied === totalPnl) {
        return;
      }

      // NOTE: The registered balance-update callback (SessionService) only persists to the DB
      // when `pnl === 0` (initial balance / funding), so for a live close with non-zero pnl this
      // call is effectively a no-op. Live trade persistence happens via onTradeUpdate / saveTradeAtomic.
      // Kept for symmetry with other modes (and the pnl===0 paths that do persist).
      if (this.onBalanceUpdate)
        this.onBalanceUpdate(this.getBalance(), t.pnl || 0);

      if (pnlDelta !== 0) {
        this.sessionState.updateStatsOnClose(false, totalPnl, false, t.id, t.strategy_label);
      }
      return;
    }

    if (pnlDelta !== 0) {
      this.sessionState.updateStatsOnClose(false, totalPnl, false, t.id, t.strategy_label);
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
    this.sessionState.udsConfirmedClosedTrades.delete(t.id);
    this.sessionState.localTradePnLAdjustments.delete(t.id);
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
    this.nearTargetCandidatesByStrategy.clear();
    this.loggedCandidateDropMap.clear();
    if (typeof (this.momentumScanner as any)?.clearPreFilterReasons === 'function') {
      (this.momentumScanner as any).clearPreFilterReasons();
    }
    this.monitoringService.clearAppMetrics();
    this.engineBroadcaster.minimize();
    if (typeof (this.signalEngine as any)?.clearCaches === "function") {
      (this.signalEngine as any).clearCaches();
    }
    this.logger.verbose(
      "TradingSessionService: Transient memory caches cleared",
    );
  }

  /**
   * Periodic TTL-based cache eviction and closed-trade compaction to keep heap usage bounded during active runs.
   */
  public performPeriodicMemoryCleanup() {
    try {
      const activeTrades = this.positionTracker.activeList();
      const activeSymbols = new Set<string>(activeTrades.map((t) => t.symbol));
      const watchlistSymbols =
        typeof (this.marketFeed as any)?.getActiveWatchlistSymbols === "function"
          ? (this.marketFeed as any).getActiveWatchlistSymbols()
          : new Set<string>();
      for (const s of watchlistSymbols) activeSymbols.add(s);

      const protectedKlineKeys =
        typeof (this.marketFeed as any)?.getActiveWatchlistKeys === "function"
          ? (this.marketFeed as any).getActiveWatchlistKeys()
          : new Set<string>();
      const klineStats =
        typeof (this.klineStore as any)?.getStats === "function"
          ? (this.klineStore as any).getStats()
          : null;
      if (klineStats && Array.isArray(klineStats.keys)) {
        for (const k of klineStats.keys) {
          const sepIdx = k.lastIndexOf("_");
          if (sepIdx > 0 && activeSymbols.has(k.slice(0, sepIdx))) {
            protectedKlineKeys.add(k);
          }
        }
      }
      for (const t of activeTrades) {
        protectedKlineKeys.add(`${t.symbol}_1m`);
      }

      if (typeof (this.klineStore as any)?.pruneStale === "function") {
        (this.klineStore as any).pruneStale(30 * 60 * 1000, protectedKlineKeys);
      }
      if (typeof (this.tickerCache as any)?.prune === "function") {
        (this.tickerCache as any).prune(Array.from(activeSymbols));
      }
      if (typeof (this.signalEngine as any)?.pruneCaches === "function") {
        (this.signalEngine as any).pruneCaches(activeSymbols);
      }
      if (typeof (this.sessionState as any)?.compactStaleClosedTrades === "function") {
        (this.sessionState as any).compactStaleClosedTrades(50);
      }
      if (typeof (this.sessionState as any)?.pruneIdempotencyCaches === "function") {
        (this.sessionState as any).pruneIdempotencyCaches();
      }

      const validTradeIds = new Set<string>([
        ...activeTrades.map((t) => t.id),
        ...(this.sessionState.closedTrades || []).map((t) => t.id),
      ]);
      for (const tradeId of this.appliedPnL.keys()) {
        if (!validTradeIds.has(tradeId)) {
          this.appliedPnL.delete(tradeId);
        }
      }

      const cleanupNow = Date.now();
      for (const [k, exp] of this.loggedCandidateDropMap.entries()) {
        if (exp <= cleanupNow) this.loggedCandidateDropMap.delete(k);
      }
    } catch (err: any) {
      this.logger.debug(
        `Periodic memory cleanup warning: ${err?.message || err}`,
      );
    }
  }

  getStatus() {
    const mode =
      this.config?.trading_mode || (this.config?.paper_mode ? "paper" : "live");
    const currentBalance = this.getBalance();
    const serializedActiveTrades = this.positionTracker
      .activeList()
      .map((t) => {
        const livePrice = (typeof (this.tickerCache as any)?.getPrice === 'function'
          ? (this.tickerCache as any).getPrice(t.symbol)
          : undefined) ?? (t as any).last_price ?? (t as any).mark_price ?? undefined;
        return this.engineBroadcaster.serializeTrade(t, this.config!, livePrice);
      });
    const activePnl = serializedActiveTrades.reduce(
      (sum: number, t: any) => sum + (Number(t?.pnl) || 0),
      0,
    );

    // DATA-CONSISTENCY: Align REST getStatus() with broadcastTick() Session Return (realized + unrealized active PnL)
    const realizedPnl = roundEight(this.sessionState.stats.totalPnl || 0);
    const totalPnl = roundEight(realizedPnl + activePnl);

    const lastRisk = this.engineBroadcaster.getLastRiskResult();

    return {
      running: this.running,
      paused: this.sessionState.paused,
      paused_strategies: Array.from(this.sessionState.pausedStrategies || []),
      strategy_gate_states: Object.fromEntries(
        Array.from((this.sessionState.strategyGateStates || new Map()).entries()).map(([k, v]) => [k, {
          gateState: v?.gateState || null,
          gateReason: v?.gateReason || null,
          isAdaptiveTightened: v?.isAdaptiveTightened || false
        }])
      ),
      mode: this.config?.paper_mode ? "PAPER" : "LIVE",
      tradingMode: mode,
      balance_paper: this.sessionState.balancePaper,
      balance_live: this.sessionState.balanceLive,
      realized_pnl: realizedPnl,
      active_pnl: roundEight(activePnl),
      total_pnl: totalPnl,
      stats: this.sessionState.stats,
      activeTrades: serializedActiveTrades,
      total_risk: this.positionTracker.totalRisk(),
      variant_stats: this.variantAnalytics.calculateVariantStats(
        serializedActiveTrades as any,
        currentBalance,
        this.sessionState.cachedClosedTradesStats,
        this.getStrategyConfigs(),
      ),
      scannerResults: this.lastScannerResults,
      variant_opportunities: this.lastVariantScannerResults,
      activeWindows: this.getActiveWindows(),
      gateState: this.sessionState.gateState,
      hibernating: this.sessionState.hibernating,
      isAdaptiveTightened: lastRisk?.isAdaptiveTightened ?? false,
      agreementRequired: this.sessionState.agreementRequired,
      tradfiAgreementRequired: this.sessionState.tradfiAgreementRequired,
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
          this.engineBroadcaster.serializeTrade(t, this.config!, t.exit_price, true),
        ),
    };
  }

  setTradFiAgreementRequired(required: boolean) {
    this.sessionState.tradfiAgreementRequired = required;
    this.sessionState.tradfiAgreementRequiredSince = required ? Date.now() : null;
    this.broadcast("tick", {
      agreementRequired: this.sessionState.agreementRequired,
      tradfiAgreementRequired: required,
    });
  }

  resetAgreementRequirement() {
    this.sessionState.agreementRequired = false;
    this.sessionState.tradfiAgreementRequired = false;
    this.sessionState.tradfiAgreementRequiredSince = null;
    this.broadcast("tick", {
      agreementRequired: false,
      tradfiAgreementRequired: false,
    });
    return {
      status: "ok",
      agreementRequired: false,
      tradfiAgreementRequired: false,
    };
  }

  setPaused(paused: boolean, strategyLabel?: string) {
    if (strategyLabel) {
      if (!this.sessionState.pausedStrategies) {
        this.sessionState.pausedStrategies = new Set();
      }
      if (paused) {
        this.sessionState.pausedStrategies.add(strategyLabel);
      } else {
        this.sessionState.pausedStrategies.delete(strategyLabel);
      }
    } else {
      this.sessionState.paused = paused;
    }

    // High-visibility logging, Decision Log auditing, and dashboard alerts
    const target = strategyLabel ? `Strategy "${strategyLabel}"` : "Session engine";
    const statusWord = paused ? "PAUSED" : "RESUMED";
    const logMsg = `[Engine Control] ${target} has been ${statusWord} by user command.`;
    this.logger.log(logMsg);

    this.eventEmitter.emit(ENGINE_EVENTS.LOG_MESSAGE, {
      msg: logMsg,
      level: paused ? "warn" : "info"
    });

    this.eventEmitter.emit(ENGINE_EVENTS.ALERT, {
      level: paused ? "warn" : "success",
      title: paused ? "Strategy Paused" : "Strategy Resumed",
      message: `${target} is now ${paused ? "inactive (skipping entries)" : "active (monitoring entries)"}.`
    });

    this.broadcast("tick", {
      paused: this.sessionState.paused,
      paused_strategies: Array.from(this.sessionState.pausedStrategies || [])
    });
  }
  updateConfig(config: SessionConfig) {
    const prev = this.config;
    this.config = config;
    this.sessionState.config = config;
    this.cachedStrategyConfigs = null;
    this.cachedScanSignatures.clear();

    // Hot-reload synchronization of paused status and strategy pause lists
    this.sessionState.paused = !!config.paused;
    this.sessionState.pausedStrategies = new Set(config.paused_strategies || []);
    this.logger.log(`[Config Sync] Synchronized paused states: paused=${this.sessionState.paused}, paused_strategies=[${Array.from(this.sessionState.pausedStrategies).join(', ')}]`);

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

      // SRE: Update MarketFeed watchlist and kline stream subscriptions for the new/edited base & variant configurations
      this.marketFeed.updateWatchlist(config).catch((err) =>
        this.logger.error(
          `Failed to refresh market feed watchlist after config update: ${err.message}`,
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

  async checkTrailingStop(
    symbol: string,
    currentPrice: number,
    config: SessionConfig,
  ): Promise<void> {
    return this.positionTracker.checkTrailingStop(
      symbol,
      currentPrice,
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
      this.logger.warn(
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
    // Only apply explicit interval cooldown if min_trade_interval_min > 0 (otherwise let Strategy Tab anti-whipsaw govern)
    const tradeConfig = {
      ...(this.config || {}),
      ...(trade.strategy_config || {}),
    } as SessionConfig;
    const mode =
      tradeConfig.trading_mode || (tradeConfig.paper_mode ? "paper" : "live");
    const cooldownMin = Number(tradeConfig.min_trade_interval_min || 0);
    if (cooldownMin > 0) {
      const scopeLabel = tradeConfig.anti_whipsaw_per_strategy !== false ? trade.strategy_label : undefined;
      this.executionService.setCooldown(trade.symbol, mode, cooldownMin, scopeLabel);
    }

    this.sessionState.updateStatsOnClose(
      (trade.pnl || 0) > 0,
      trade.pnl || 0,
      trade.is_reconciliation,
      trade.id,
      trade.strategy_label
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
