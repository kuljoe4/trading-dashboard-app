import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { SessionConfig } from '../models/SessionConfig';
import { Trade } from '../models/Trade';
import { TickerCacheService } from './ticker_cache.service';
import { KlineStoreService } from './kline_store.service';
import { SignalEngineService } from './signalEngine';
import { RiskEngineService } from './riskEngine';
import { PositionTrackerService } from './positionTracker';
import { OrderManagerService } from './orderManager';
import { MarketFeedService } from './market_feed.service';
import { MomentumScannerService } from './momentum_scanner.service';
import { MonitoringService } from './monitoring.service';
import { AnalyticsService } from './analytics.service';
import { ExecutionService } from './execution.service';
import { SessionLifecycleService } from './session-lifecycle.service';
import { BroadcastService } from './broadcast.service';
import { SessionStateService } from './session_state.service';
import { ENGINE_EVENTS } from './events';
import { v4 as uuid } from 'uuid';
import { roundEight, roundTo } from '../lib/math';
import { ENGINE_CONSTANTS, CONFIG_LIMITS } from '../models/constants';
import { VariantAnalyticsService } from './variant-analytics.service';
import { EngineBroadcasterService } from './engine-broadcaster.service';
import { GatingService } from './gating.service';
import { AuditLogService } from '../trading/audit-log.service';
import { TradeSerializationDto } from '../trading/dto/trade-serialization.dto';

function monitoringChangedInternal(curr: any, prev: any): boolean {
  if (!curr || !prev) return true;
  return Math.abs((curr.system?.cpu_usage || 0) - (prev.system?.cpu_usage || 0)) > 8;
}

@Injectable()
export class TradingSessionService {
  private readonly logger = new Logger(TradingSessionService.name);

  private running = false;
  private sessionId: string | null = null;
  private config: SessionConfig | null = null;
  private binanceClient: any = null;
  private lastRateLimitCheck = 0;
  private onBalanceUpdate: ((balance: number, pnl: number) => Promise<void> | void) | null = null;
  private onTradeUpdate: ((trade: Trade, balance: number) => Promise<void>) | null = null;
  private mainLoopInterval: NodeJS.Timeout | null = null;
  private hotLoopInterval: NodeJS.Timeout | null = null;
  private fundingCheckInterval: NodeJS.Timeout | null = null;
  private balancePollInterval: NodeJS.Timeout | null = null;
  private balanceFetchTimeout: NodeJS.Timeout | null = null;
  private pendingDeltasDuringFetch = 0;
  private safetySyncTimeout: NodeJS.Timeout | null = null;
  private appliedPnL: Map<string, number> = new Map(); // trade.id -> total cumulative pnl applied to balance
  private lastScannerFullBroadcast = 0;
  private lastScannerResultsJson = '';
  private lastScannerResults: any[] = [];
  private lastVariantScannerResults: any[] = [];
  private hotLoopProcessing = false;
  private mainLoopProcessing = false;
  private activeWindows: Map<string, any> = new Map();
  private userDataWs: any = null;
  private listenKey: string | null = null;
  private listenKeyKeepAlive: NodeJS.Timeout | null = null;

  private cachedStrategyConfigs: SessionConfig[] | null = null;
  private cachedScanSignatures: Map<SessionConfig, string> = new Map();

  private getStrategyLabel(config: Partial<SessionConfig> | null | undefined, index = 0): string {
    return (config?.strategy_label || (index === 0 ? 'Momentum Strategy' : `Strategy ${index + 1}`)).toString();
  }


  private getStrategyConfigs(): SessionConfig[] {
    if (this.cachedStrategyConfigs) return this.cachedStrategyConfigs;
    if (!this.config) return [];
    const base = { ...this.config, strategy_label: this.getStrategyLabel(this.config, 0), strategy_variants: [] } as SessionConfig;
    const variants = (this.config.strategy_variants || []).filter((v: any) => v && v.enabled !== false).map((v, i) => ({ ...this.config, ...v, strategy_label: this.getStrategyLabel(v, i + 1), strategy_variants: [] } as SessionConfig));
    this.cachedStrategyConfigs = [base, ...variants];
    return this.cachedStrategyConfigs;
  }

  private scanSignature(config: SessionConfig): string {
    let s = this.cachedScanSignatures.get(config); if (s) return s;
    s = JSON.stringify({ ge: config.global_scanner_enabled, si: config.scan_interval, sl: config.scan_lookback, st: config.scan_pct_threshold, mv: config.scan_min_volume_usdt, sm: config.scan_mode, ws: config.watchlist_size, es: config.entry_side, ex: config.excluded_symbols, sym: config.symbols, ssc: config.single_symbol_configs });
    this.cachedScanSignatures.set(config, s); return s;
  }

  constructor(
    private readonly tickerCache: TickerCacheService,
    private readonly klineStore: KlineStoreService,
    private readonly signalEngine: SignalEngineService,
    private readonly riskEngine: RiskEngineService,
    @Inject(forwardRef(() => PositionTrackerService)) private readonly positionTracker: PositionTrackerService,
    @Inject(forwardRef(() => OrderManagerService)) private readonly orderManager: OrderManagerService,
    @Inject(forwardRef(() => MarketFeedService)) private readonly marketFeed: MarketFeedService,
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
    private readonly auditLog: AuditLogService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  setWsBroadcaster(cb: (data: any) => void) { this.broadcastService.setWsBroadcaster(cb); }
  async setBinanceClient(client: any, paperMode = true) { await this.orderManager.setBinanceClient(client, paperMode); }
  isEcoMode(): boolean { return this.sessionState.isEcoMode(this.running); }
  isGated(): boolean { return this.sessionState.isGated(); }
  setDashboardCount(count: number) { this.sessionState.dashboardCount = count; }
  setListenerCount(count: number) {
    const prevCount = this.sessionState.listenerCount; this.sessionState.listenerCount = count;
    if (this.running && this.config) {
      if (prevCount > 0 && count === 0) {
        const hasTrades = this.positionTracker.activeCount() > 0;
        const ecoMainMs = Math.max(hasTrades ? 15000 : 30000, this.config.main_loop_interval_ms || CONFIG_LIMITS.MAIN_LOOP_DEFAULT);
        const ecoHotMs = Math.max(hasTrades ? 5000 : 10000, this.config.hot_loop_interval_ms || CONFIG_LIMITS.HOT_LOOP_DEFAULT);
        this.restartLoops(ecoHotMs, ecoMainMs);
      } else if (prevCount === 0 && count > 0) {
        this.restartLoops(this.config.hot_loop_interval_ms || CONFIG_LIMITS.HOT_LOOP_DEFAULT, this.config.main_loop_interval_ms || CONFIG_LIMITS.MAIN_LOOP_DEFAULT);
      }
    }
  }

  private restartLoops(hotMs: number, mainMs: number) {
    if (this.hotLoopInterval) clearInterval(this.hotLoopInterval); if (this.mainLoopInterval) clearInterval(this.mainLoopInterval);
    this.hotLoopInterval = setInterval(() => this.hotLoop(), hotMs); this.mainLoopInterval = setInterval(() => this.mainLoop(), mainMs);
  }

  setBalanceUpdateCallback(cb: (b: number, p: number) => void) { this.onBalanceUpdate = cb; }
  setTradeUpdateCallback(cb: (t: Trade, b: number) => Promise<void>) { this.onTradeUpdate = cb; }
  private broadcast(et: string, p: any) { this.broadcastService.broadcast(et, p); }

  async start(config: SessionConfig, bc?: any, sid?: string, hist: Trade[] = [], curBal?: number, open: Trade[] = []) {
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
    this.eventEmitter.emit(ENGINE_EVENTS.LOG_MESSAGE, { msg: startMsg, level: 'info' });
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

    const hot = config.hot_loop_interval_ms || 5000; this.hotLoopInterval = setInterval(() => this.hotLoop(), hot);
    const main = config.main_loop_interval_ms || 15000; this.mainLoopInterval = setInterval(() => this.mainLoop(), main);
    this.fundingCheckInterval = setInterval(() => this.checkFundingFees(), 60000); // Check every minute

    this.broadcastSnapshot('started'); return { status: 'started' };
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
    if (this.fundingCheckInterval) clearInterval(this.fundingCheckInterval);

    if (this.balanceFetchTimeout) {
      clearTimeout(this.balanceFetchTimeout);
      this.balanceFetchTimeout = null;
    }
    if (this.safetySyncTimeout) {
      clearTimeout(this.safetySyncTimeout);
      this.safetySyncTimeout = null;
    }

    const active = this.positionTracker.activeList();
    for (const t of active) {
      const cp = await this.tickerCache.getPrice(t.symbol); const ep = cp ?? t.last_price ?? t.entry_price;
      const res = await this.positionTracker.closeTrade(t.symbol, ep, 'SESSION_TERMINATED', this.config!, this.config?.paper_mode ?? true);
      if (res.exitOccurred && res.trade) {
        this.sessionState.updateStatsOnClose((res.trade.pnl || 0) > 0); this.sessionState.addClosedTrade(res.trade);
        await this.updateBalance(res.trade); if (this.onTradeUpdate) await this.onTradeUpdate(res.trade, this.getBalance());
      } else {
        t.status = 'CLOSED'; t.exit_ts = new Date(); t.exit_reason = 'SESSION_TERMINATED'; t.exit_price = ep;
        const pnlp = t.direction === 'LONG' ? ep - t.entry_price : t.entry_price - ep;
        // Simulate exit fee (taker rate) for forced closure
        const exitFee = roundEight(ep * t.qty * ENGINE_CONSTANTS.SIMULATED_FEE_RATE);
        t.realized_fee = roundEight((t.realized_fee || 0) + exitFee);
        t.pnl = roundEight((pnlp * t.qty) - t.realized_fee);
        this.sessionState.addClosedTrade(t); this.sessionState.updateStatsOnClose((t.pnl || 0) > 0);
        await this.updateBalance(t); if (this.onTradeUpdate) await this.onTradeUpdate(t, this.getBalance());
        this.positionTracker.removeTrade(t.symbol);
      }
    }

    await this.sessionLifecycle.stop(this.binanceClient, this.sessionId || undefined, this.config || undefined);

    this.sessionState.setActiveTrades([]);
    // BOLT: minimizeMemoryUsage() clears appliedPnL, which is fine after session stop
    this.minimizeMemoryUsage();
    this.sessionState.minimize();
    this.tickerCache.clear();
    this.klineStore.clear();

    this.broadcastSnapshot('stopped'); return { status: 'stopped' };
  }

  private async hotLoop() {
    if (!this.running || !this.config || this.hotLoopProcessing) return;
    if (this.sessionState.listenerCount === 0 && this.positionTracker.activeCount() === 0) { this.monitoringService.recordHotLoop(0); return; }

    this.hotLoopProcessing = true;
    const start = performance.now();
    try {
      await this.checkExits();
      this.engineBroadcaster.broadcastTick(this.positionTracker.activeList(), this.config!, this.getStrategyConfigs(), this.isEcoMode(), () => this.getActiveWindows(), () => this.getBinanceRateLimit());
      this.monitoringService.recordHotLoop(performance.now() - start);
    } catch (error) {
      this.logger.error(`Error in hot loop: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.hotLoopProcessing = false;
    }
  }

  @OnEvent(ENGINE_EVENTS.TRADE_UPDATED)
  async handleTradeUpdate(payload: { trade: Trade, pnlDelta?: number }) {
    const trade = payload.trade;
    const pnlDelta = payload.pnlDelta ?? 0;

    if (pnlDelta !== 0) {
       const mode = this.config?.trading_mode || (this.config?.paper_mode ? 'paper' : 'live');
       if (mode === 'paper') {
         this.sessionState.balancePaper = roundEight(this.sessionState.balancePaper + pnlDelta);
       } else {
         // Live balance is updated via polling/websocket, but we can apply delta as fallback
         this.sessionState.balanceLive = roundEight(this.sessionState.balanceLive + pnlDelta);
       }
       // DATA-05: Update appliedPnL to reflect the change received via event
       const prev = this.appliedPnL.get(trade.id) || 0;
       this.appliedPnL.set(trade.id, roundEight(prev + pnlDelta));
    }

    if (this.onTradeUpdate) await this.onTradeUpdate(trade, this.getBalance());
  }

  @OnEvent(ENGINE_EVENTS.RISK_GATES_UPDATED)
  async refreshRiskGating() {
    if (!this.running || !this.config) return;
    const activeTrades = this.positionTracker.activeList();
    const prevGateState = this.sessionState.gateState;
    const isInsideWindow = this.gatingService.isInsideTradingWindow(this.config!);

    const riskResult = this.riskEngine.canEnter(activeTrades, this.sessionState.closedTrades, this.getBalance(), 'DUMMY', this.config!, this.positionTracker.totalRisk());
    const hasUnscheduledMonitors = this.config.single_symbol_configs?.some(sc => sc.enabled && sc.follow_schedule === false);

    if (!isInsideWindow && !hasUnscheduledMonitors) {
      this.sessionState.gateState = 'sleeping';
    } else if (!riskResult.canEnter) {
      // If gating is due to risk (not just symbol max trades), update gateState
      if (!riskResult.reason.includes('Max open trades for')) {
        this.sessionState.gateState = this.gatingService.mapGateState(riskResult.reason);
      }
    } else {
      this.sessionState.gateState = null;
    }

    const shouldHibernate = this.isGated() && activeTrades.length === 0;

    // Transition to Hibernation
    if (shouldHibernate && !this.sessionState.hibernating) {
      this.logger.log(`[Gating] Transitioning to Deep Sleep. Reason: ${riskResult.reason || 'Session gated and idle'}`);
      await this.gatingService.enterHibernation(riskResult.reason || 'Session gated and idle', this.config!, activeTrades);
      this.minimizeMemoryUsage();
    }
    // Transition out of Hibernation
    else if (!shouldHibernate && this.sessionState.hibernating) {
      this.logger.log(`[Gating] Exiting Deep Sleep. Reason: Gating conditions cleared.`);
      await this.gatingService.exitHibernation(this.config!);
    }

    if (this.sessionState.gateState !== prevGateState) {
      const msg = `[Gating] State changed: ${prevGateState || 'ACTIVE'} -> ${this.sessionState.gateState || 'ACTIVE'}. Reason: ${riskResult.reason}`;
      this.logger.log(msg);
      this.eventEmitter.emit(ENGINE_EVENTS.LOG_MESSAGE, { msg, level: 'info' });

      this.broadcast('gate', { gateState: this.sessionState.gateState, reason: riskResult.reason, scannerPaused: this.sessionState.gateState === 'max_trades' || this.sessionState.gateState === 'sl_guard' || this.sessionState.gateState === 'max_trades_period' || this.sessionState.paused });
      if (!this.sessionState.hibernating) this.eventEmitter.emit(ENGINE_EVENTS.WATCHLIST_NEEDS_UPDATE, this.config);
    }
    return riskResult;
  }

  private async mainLoop() {
    if (!this.running || !this.config || this.mainLoopProcessing) return;
    this.mainLoopProcessing = true;

    try {
      const activeTrades = this.positionTracker.activeList();
      await this.refreshRiskGating();

      if (this.isGated() || this.sessionState.hibernating) {
        if (this.sessionState.listenerCount > 0) {
          const now = Date.now(); const isFull = now - this.lastScannerFullBroadcast > 30000; if (isFull) this.lastScannerFullBroadcast = now;
          this.broadcast('scanner', { count: this.lastScannerResults.length, hibernating: this.sessionState.hibernating, opportunities: this.lastScannerResults.slice(0, 5).map(o => { if (isFull) return o; const { history, ...rest } = o; return rest; }), variant_opportunities: this.lastVariantScannerResults.map(v => ({ ...v, opportunities: v.opportunities.slice(0, 5).map((o: any) => { if (isFull) return o; const { history, ...rest } = o; return rest; }) })), activeWindows: this.getActiveWindows() });
        }
        // DATA-07: Ensure processing flag is reset even on early return during gating
        this.mainLoopProcessing = false;
        return;
      }

      const start = performance.now();
      const strategyConfigs = this.getStrategyConfigs(); const opportunitiesBySignature = new Map<string, any[]>(); let primaryOpportunities: any[] = [];
      for (const sc of strategyConfigs) { const sig = this.scanSignature(sc); if (!opportunitiesBySignature.has(sig)) opportunitiesBySignature.set(sig, this.momentumScanner.scan(sc)); if (primaryOpportunities.length === 0) primaryOpportunities = opportunitiesBySignature.get(sig) || []; }
      const scannerData = strategyConfigs.map(c => ({ strategy_label: c.strategy_label, opportunities: opportunitiesBySignature.get(this.scanSignature(c)) || [] }));

      if (this.sessionState.dashboardCount > 0) {
        const baseConfig = strategyConfigs[0];
        const opportunitiesWithSignals = primaryOpportunities.slice(0, 10).map((opp) => { const signalResult = this.signalEngine.checkEntry(opp.symbol, baseConfig, baseConfig.scan_interval || '1m', opp.direction.toUpperCase() as any, 'entry'); return { ...opp, signalResult }; });
        this.updateScannerResults(opportunitiesWithSignals); this.lastVariantScannerResults = scannerData;
        const now = Date.now(); const isFull = now - this.lastScannerFullBroadcast > 30000;
        const nextResultsJson = JSON.stringify(this.lastScannerResults.map(o => o.symbol + o.direction + o.score));
        const resultsChanged = nextResultsJson !== this.lastScannerResultsJson; this.lastScannerResultsJson = nextResultsJson;

        // REFACTOR: Avoid 'as any' casting and property access on non-existent this.lastTickData
        const resultsPriceChanged = () => {
           const tickData = (this.engineBroadcaster as any).lastTickData;
           if (!tickData?.scannerResults) return false;
           return this.lastScannerResults.some((o, i) => {
              const prev = tickData.scannerResults[i];
              return prev && Math.abs(o.price - prev.price) / prev.price > 0.001;
           });
        };

        if (isFull || resultsChanged || resultsPriceChanged()) {
          if (isFull) this.lastScannerFullBroadcast = now; this.lastScannerResultsJson = nextResultsJson;
          this.broadcast('scanner', { count: this.lastScannerResults.length, opportunities: this.lastScannerResults.slice(0, 5).map(o => { if (isFull) return o; const { history, ...rest } = o; return rest; }), variant_opportunities: this.lastVariantScannerResults.map(v => ({ ...v, opportunities: v.opportunities.slice(0, 5).map((o: any) => { if (isFull) return o; const { history, ...rest } = o; return rest; }) })), activeWindows: this.getActiveWindows() });
        }
      } else this.refreshActiveWindows(primaryOpportunities);

      for (const sc of strategyConfigs) {
        const opps = opportunitiesBySignature.get(this.scanSignature(sc)) || [];
        await this.executionService.processEntries(opps, sc, sc.strategy_label || 'Momentum Strategy', async (t) => {
          // Immediately deduct entry fee from session balance to keep total PnL accurate
          await this.updateBalance(t);
          if (this.onTradeUpdate) await this.onTradeUpdate(t, this.getBalance());
        });
      }
      this.monitoringService.recordMainLoop(performance.now() - start);
    } catch (error) {
      this.logger.error(`Error in main loop: ${error instanceof Error ? error.message : String(error)}`);
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

  private async onCandleClose(symbol: string) { if (!this.running || !this.config) return; if (this.config.debug_mode) this.logger.verbose(`Candle closed for ${symbol}`); }

  private async checkFundingFees() {
    if (!this.running || !this.config) return;
    const now = new Date();
    const isFundingTime = now.getUTCHours() % ENGINE_CONSTANTS.FUNDING_INTERVAL_HOURS === 0 && now.getUTCMinutes() === 0;

    if (isFundingTime) {
      const activeTrades = this.positionTracker.activeList();
      for (const trade of activeTrades) {
        if (this.config.paper_mode) {
          // Simulate funding fee for paper mode
          // Positive rate: Longs pay Shorts.
          const isLong = trade.direction === 'LONG';
          const notional = (trade.mark_price || trade.last_price || trade.entry_price) * trade.qty;
          const fundingDelta = roundEight(notional * ENGINE_CONSTANTS.SIMULATED_FUNDING_RATE * (isLong ? 1 : -1));

          trade.funding_fee = roundEight((trade.funding_fee || 0) + fundingDelta);
          trade.pnl = roundEight(trade.pnl - fundingDelta);
          (trade as any)._last_funding_delta = fundingDelta;

          await this.updateBalance(trade, false, true);
          if (this.onTradeUpdate) await this.onTradeUpdate(trade, this.getBalance());

          this.logger.log(`[Funding] Applied ${fundingDelta} funding fee to ${trade.symbol} (Paper)`);
        }
      }
    }
  }

  private updateScannerResults(opportunities: any[]) {
    this.lastScannerResults = opportunities.map((o) => ({ symbol: o.symbol, price: o.price, pct: roundTo(o.momentum, 2), momentum: roundTo(o.momentum, 2), direction: o.direction.toLowerCase(), dir: o.direction.toLowerCase(), vol: o.volume_24h, volume_usdt: o.volume_24h, score: roundTo(o.score / 10, 1), history: o.history, signalResult: o.signalResult, }));
    this.refreshActiveWindows(this.lastScannerResults);
  }


  private refreshActiveWindows(opportunities: any[]) {
    if (this.config?.scan_mode !== 'active_window') { this.activeWindows.clear(); return; }
    const now = Date.now(); const durationMs = (this.config.scan_window_duration_sec || 90) * 1000;
    opportunities.forEach((opp) => { const existing = this.activeWindows.get(opp.symbol); this.activeWindows.set(opp.symbol, { symbol: opp.symbol, direction: opp.dir, pct_change: opp.pct, opened_at: existing?.opened_at || now, expires_at: existing?.expires_at || now + durationMs, checks: (existing?.checks || 0) + 1, entries: existing?.entries || 0 }); });
    for (const [symbol, window] of this.activeWindows.entries()) { if (window.expires_at <= now || this.positionTracker.hasSymbol(symbol)) this.activeWindows.delete(symbol); }
  }

  private getActiveWindows() { const now = Date.now(); return Array.from(this.activeWindows.values()).map((window) => ({ ...window, remaining_ms: Math.max(0, window.expires_at - now) })); }

  private broadcastSnapshot(status: 'started' | 'stopped') {
    const mode = this.config?.trading_mode || (this.config?.paper_mode ? 'paper' : 'live');
    if (status === 'stopped') { this.broadcast('session_terminated', { reason: 'SESSION_TERMINATED', endedAt: new Date().toISOString() }); return; }
    this.broadcast('session', { status, running: this.running, paused: this.sessionState.paused, mode: this.config?.paper_mode ? 'PAPER' : 'LIVE', tradingMode: mode, balance: this.getBalance(), config: this.config, gateState: this.sessionState.gateState, scannerPaused: this.sessionState.gateState === 'max_trades' || this.sessionState.gateState === 'sl_guard' || this.sessionState.gateState === 'max_trades_period', activeTrades: this.positionTracker.activeList().map((t) => this.engineBroadcaster.serializeTrade(t, this.config!)), scannerResults: this.lastScannerResults, activeWindows: this.getActiveWindows(), });
  }

  async fetchBinanceBalance(): Promise<number> {
    if (!this.binanceClient) return 0;
    try {
      this.monitoringService.incrementApiRequests();
      const res = await this.binanceClient.restAPI.accountApi.futuresAccountBalanceV2();
      const data = typeof res.data === 'function' ? await res.data() : (res.data || res);
      const usdt = Array.isArray(data) ? data.find((b: any) => b.asset === 'USDT') : null;
      return usdt ? parseFloat(usdt.balance || 0) : 0;
    } catch (e: any) {
      this.logger.error(`Balance fetch failed: ${e.message}`);
      return 0;
    }
  }
  private async updateBalance(t: Trade, isEntry = false, isFunding = false) {
    const mode = this.config?.trading_mode || (this.config?.paper_mode ? 'paper' : 'live');

    // DATA-05: Delta-based balance updates to prevent double-counting of fees/PnL
    const totalPnl = t.pnl || 0;
    const previouslyApplied = this.appliedPnL.get(t.id) || 0;
    const pnlDelta = roundEight(totalPnl - previouslyApplied);

    if (mode === 'paper') {
      if (pnlDelta !== 0) {
        this.sessionState.balancePaper = roundEight(this.sessionState.balancePaper + pnlDelta);
        this.appliedPnL.set(t.id, totalPnl);
      }
    } else if (this.binanceClient) {
      // DATA-CONSISTENCY: Track deltas even if we are waiting for a sync to avoid missing rapid-fire closures
      // and prevent double-counting during REST fallback.
      if (pnlDelta !== 0) {
        this.appliedPnL.set(t.id, totalPnl);
      } else if (previouslyApplied === totalPnl) {
        // Delta already applied via UDS or previous call, skip redundant updates
        return;
      }

      // BOLT: Prioritize User Data Stream. If UDS is connected, it will push balance updates,
      // so we can skip the manual REST poll entirely.
      if (this.sessionLifecycle.isUdsConnected) {
         if (this.onBalanceUpdate) this.onBalanceUpdate(this.getBalance(), t.pnl || 0);

         // DATA-CONSISTENCY: Safety sync. If UDS doesn't update after closure, force REST refresh.
         // BOLT: Use debounced safety sync to handle batch closures effectively.
         if (!isEntry) {
           if (this.safetySyncTimeout) clearTimeout(this.safetySyncTimeout);
           this.safetySyncTimeout = setTimeout(async () => {
              this.safetySyncTimeout = null;
              this.logger.log(`Performing scheduled safety balance sync after trade closures.`);
              const b = await this.fetchBinanceBalance();
              if (b > 0) {
                 this.sessionState.balanceLive = b;
                 this.sessionState.balancePaper = b;
                 if (this.onBalanceUpdate) this.onBalanceUpdate(this.getBalance(), 0);
              }
           }, 15000); // 15s after LAST closure in a burst
         }
         return;
      }

      // BOLT: Coalesce balance fetches to avoid weight spikes when multiple trades close at once.
      // We accumulate deltas during the debounce window to ensure fallback math is accurate.
      this.pendingDeltasDuringFetch = roundEight(this.pendingDeltasDuringFetch + pnlDelta);
      if (this.balanceFetchTimeout) return;

      this.balanceFetchTimeout = setTimeout(async () => {
        const b = await this.fetchBinanceBalance();
        const capturedDeltas = this.pendingDeltasDuringFetch;
        this.balanceFetchTimeout = null;
        this.pendingDeltasDuringFetch = 0;

        if (b > 0) {
          // REST is authoritative; it already includes all deltas.
          this.sessionState.balanceLive = b;
          this.sessionState.balancePaper = b;
        } else {
          // Fallback: apply all accumulated deltas from the window.
          this.sessionState.balanceLive = roundEight(this.sessionState.balanceLive + capturedDeltas);
          this.sessionState.balancePaper = roundEight(this.sessionState.balancePaper + capturedDeltas);
        }
        if (this.onBalanceUpdate) this.onBalanceUpdate(this.getBalance(), t.pnl || 0);
      }, 1500); // 1.5s debounce covers most batch closures
      return; // Skip immediate callback as it will fire after debounce
    }
    if (this.onBalanceUpdate) this.onBalanceUpdate(this.getBalance(), t.pnl || 0);
  }
  private getBalance(): number { return this.sessionState.getBalance(this.config?.paper_mode ?? true); }
  private async rollbackTradeClosure(t: Trade, pp: number, pl: number, pa: number) {
    this.logger.warn(`Rolling back trade closure for ${t.symbol}.`);
    this.sessionState.balancePaper = pp;
    this.sessionState.balanceLive = pl;
    this.appliedPnL.set(t.id, pa);
    this.sessionState.rollbackClosedTrade(t);
    t.status = 'OPEN';
    this.positionTracker.addTrade(t);
    if (this.onBalanceUpdate) await this.onBalanceUpdate(this.getBalance(), 0);
  }


  getActiveTradeCount(): number { return this.positionTracker.activeCount(); }
  getActiveTradeSymbols(): string[] { return this.positionTracker.activeList().map(t => t.symbol); }
  getActiveTradesRaw(): Trade[] { return this.positionTracker.activeList(); }

  /**
   * BOLT OPTIMIZATION: Clears transient caches and state to minimize RAM footprint
   * during Deep Sleep or after session termination.
   */
  minimizeMemoryUsage() {
    this.activeWindows.clear();
    this.appliedPnL.clear();
    this.lastScannerResults = [];
    this.lastVariantScannerResults = [];
    this.lastScannerResultsJson = '';
    this.cachedStrategyConfigs = null;
    this.cachedScanSignatures.clear();
    this.monitoringService.clearAppMetrics();
    this.engineBroadcaster.minimize();
    this.logger.verbose('TradingSessionService: Transient memory caches cleared');
  }

  getStatus() {
    const mode = this.config?.trading_mode || (this.config?.paper_mode ? 'paper' : 'live');
    const startingBalance = mode === 'paper'
      ? (this.config?.paper_starting_balance || 10000)
      : (this.config?.live_starting_balance || 0);
    const currentBalance = this.getBalance();
    const totalPnl = roundEight(currentBalance - startingBalance);

    return {
      running: this.running,
      paused: this.sessionState.paused,
      mode: this.config?.paper_mode ? 'PAPER' : 'LIVE',
      tradingMode: mode,
      balance_paper: this.sessionState.balancePaper,
      balance_live: this.sessionState.balanceLive,
      total_pnl: totalPnl,
      stats: this.sessionState.stats,
      activeTrades: this.positionTracker.activeList().map((t) => this.engineBroadcaster.serializeTrade(t, this.config!)),
      total_risk: this.positionTracker.totalRisk(),
      variant_stats: this.variantAnalytics.calculateVariantStats(this.positionTracker.activeList(), currentBalance, this.sessionState.cachedClosedTradesStats, this.getStrategyConfigs()),
      scannerResults: this.lastScannerResults,
      activeWindows: this.getActiveWindows(),
      gateState: this.sessionState.gateState,
      hibernating: this.sessionState.hibernating,
      scannerPaused: this.sessionState.gateState === 'max_trades' || this.sessionState.gateState === 'sl_guard' || this.sessionState.gateState === 'max_trades_period' || this.sessionState.paused,
      history: this.sessionState.closedTrades.slice(0, 50).map((t) => this.engineBroadcaster.serializeTrade(t, this.config!, t.exit_price)),
    };
  }

  setPaused(paused: boolean) { this.sessionState.paused = paused; this.broadcast('tick', { paused }); }
  updateConfig(config: SessionConfig) {
    const prev = this.config; this.config = config; this.cachedStrategyConfigs = null; this.cachedScanSignatures.clear();
    if (prev && (prev.hot_loop_interval_ms !== config.hot_loop_interval_ms || prev.main_loop_interval_ms !== config.main_loop_interval_ms)) { const isEco = this.sessionState.listenerCount === 0; const mainMs = isEco ? Math.max(15000, config.main_loop_interval_ms || 15000) : (config.main_loop_interval_ms || 15000); const hotMs = isEco ? Math.max(5000, config.hot_loop_interval_ms || 5000) : (config.hot_loop_interval_ms || 5000); this.restartLoops(hotMs, mainMs); }

    // DATA-07: Trigger immediate risk re-evaluation when config is updated (e.g., risk_pct_per_trade changed from 2% during gating)
    if (this.running) {
      this.refreshRiskGating().catch(e => this.logger.error(`Failed to refresh gating after config update: ${e.message}`));
    }

    this.auditLog.log({
      action: 'UPDATE_CONFIG',
      resourceId: this.sessionId || undefined,
      details: { strategy: config.strategy_label }
    });

    this.broadcast('tick', { config: this.config });
  }

  async fetchTickerPrice(symbol: string): Promise<number | null> { return this.tickerCache.getPrice(symbol); }
  async fetchPosition(symbol: string): Promise<any | null> { return this.orderManager.fetchPosition(symbol); }
  updateRateLimit(used1m: number) { this.sessionState.updateRateLimit(used1m); }
  isRateLimited(): boolean { return this.sessionState.isRateLimited(); }
  getBinanceRateLimit() { return this.sessionState.getBinanceRateLimit(); }
  getClosedTrades(): Trade[] { return this.sessionState.closedTrades; }

  getTrade(idOrSymbol: string): Trade | undefined {
    const active = this.positionTracker.activeList().find(t => t.id === idOrSymbol || t.symbol === idOrSymbol);
    if (active) return active;
    return this.sessionState.closedTrades.find(t => t.id === idOrSymbol || t.symbol === idOrSymbol);
  }

  @OnEvent('trade.exchange_close')
  async handleExchangeClose(payload: { symbol: string, exitPrice: number, reason: string }) {
    if (!this.running) return;
    const { symbol, exitPrice, reason } = payload;

    const trade = this.positionTracker.activeList().find(t => t.symbol === symbol);
    if (!trade) return;

    this.logger.log(`Handling exchange-triggered close for ${symbol} @ ${exitPrice} (${reason})`);

    // We pass localOnly=true to closeTrade to ensure it only updates local state
    // and doesn't try to send another close order to Binance,
    // since the exchange already closed it.
    const res = await this.positionTracker.closeTrade(symbol, exitPrice, reason, this.config!, this.config?.paper_mode ?? true, true);

    if (res.exitOccurred && res.trade) {
      await this.finalizeTradeClosure(res.trade, exitPrice, reason);
    }
  }

  private async finalizeTradeClosure(trade: Trade, exitPrice: number, reason: string) {
      this.sessionState.updateStatsOnClose((trade.pnl || 0) > 0);
      await this.updateBalance(trade);
      this.sessionState.addClosedTrade(trade);
      if (this.onTradeUpdate) await this.onTradeUpdate(trade, this.getBalance());
      this.sessionState.setActiveTrades(this.positionTracker.activeList());
      this.eventEmitter.emit(ENGINE_EVENTS.WATCHLIST_NEEDS_UPDATE, this.config!);

      const analytics = this.analyticsService.calculateAnalytics(this.sessionState.closedTrades as any, this.config?.paper_mode ? this.config?.paper_starting_balance : this.config?.live_starting_balance);

      this.broadcast('trade_event', {
        event: 'closed',
        symbol: trade.symbol,
        reason: reason,
        trade: this.engineBroadcaster.serializeTrade(trade, this.config!, exitPrice),
        pnl: trade.pnl,
        stats: this.sessionState.stats,
        analytics: {
          maxDrawdown: roundTo(analytics.maxDrawdown, 2),
          maxDrawdownPct: roundTo(analytics.maxDrawdownPct, 2),
          overallWinRate: roundTo(analytics.overallWinRate, 2),
          cumulativePnL: analytics.cumulativePnL.slice(-20).map((p: any) => ({ ...p, pnl: roundTo(p.pnl, 2) })),
        }
      });
  }

  async closeTradeManually(symbol: string): Promise<{ success: boolean; trade?: Trade; error?: string }> {
    if (!this.running) return { success: false, error: 'No session running' };
    const trade = this.positionTracker.activeList().find(t => t.symbol === symbol);
    if (!trade) return { success: false, error: `No open position for ${symbol}` };
    const cp = await this.tickerCache.getPrice(symbol); if (!cp) return { success: false, error: `Could not fetch price for ${symbol}` };
    const res = await this.positionTracker.closeTrade(symbol, cp, 'MANUAL_CLOSE', this.config!, this.config?.paper_mode ?? true);
    if (res.exitOccurred && res.trade) {
      const pp = this.sessionState.balancePaper; const pl = this.sessionState.balanceLive;
      const pa = this.appliedPnL.get(res.trade.id) || 0;
      try {
        await this.finalizeTradeClosure(res.trade, cp, 'MANUAL_CLOSE');
        await this.auditLog.log({
          action: 'MANUAL_TRADE_CLOSE',
          resourceId: res.trade.id,
          details: { symbol, pnl: res.trade.pnl }
        });
        return { success: true, trade: res.trade };
      } catch (err: any) { await this.rollbackTradeClosure(res.trade, pp, pl, pa); return { success: false, error: err.message }; }
    }
    return { success: false, error: 'Failed to close trade' };
  }
}
