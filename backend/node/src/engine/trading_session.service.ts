import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
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
import { BroadcastService } from './broadcast.service';
import { SessionStateService } from './session_state.service';
import { ENGINE_EVENTS } from './events';
import { v4 as uuid } from 'uuid';
import { roundEight } from '../lib/math';
import { ENGINE_CONSTANTS } from '../models/constants';

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
  private lastScannerResults: any[] = [];
  private lastVariantScannerResults: any[] = [];
  private lastAnalyticsResult: any = null;
  private lastAnalyticsTradeCount = -1;
  private lastAnalyticsStartingBalance = -1;
  private activeWindows: Map<string, any> = new Map();
  private mainLoopInterval: NodeJS.Timeout | null = null;
  private hotLoopInterval: NodeJS.Timeout | null = null;
  private balancePollInterval: NodeJS.Timeout | null = null;
  private lastScannerFullBroadcast = 0;
  private lastScannerResultsJson = '';
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
    private readonly broadcastService: BroadcastService,
    private readonly sessionState: SessionStateService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  setWsBroadcaster(cb: (data: any) => void) { this.broadcastService.setWsBroadcaster(cb); }
  isEcoMode(): boolean { return this.sessionState.isEcoMode(this.running); }
  isGated(): boolean { return this.sessionState.isGated(); }
  setDashboardCount(count: number) { this.sessionState.dashboardCount = count; }
  setListenerCount(count: number) {
    const prevCount = this.sessionState.listenerCount; this.sessionState.listenerCount = count;
    if (this.running && this.config) {
      if (prevCount > 0 && count === 0) {
        const ecoMainMs = Math.max(15000, this.config.main_loop_interval_ms || 5000);
        const ecoHotMs = Math.max(5000, this.config.hot_loop_interval_ms || 2000);
        this.restartLoops(ecoHotMs, ecoMainMs);
      } else if (prevCount === 0 && count > 0) {
        this.restartLoops(this.config.hot_loop_interval_ms || 2000, this.config.main_loop_interval_ms || 5000);
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
    this.running = true; this.sessionState.reset(config, hist, curBal);
    this.sessionId = sid || null; this.config = config; this.cachedStrategyConfigs = null; this.cachedScanSignatures.clear(); this.binanceClient = bc;
    const mode = config.trading_mode || (config.paper_mode ? 'paper' : 'live');
    this.activeWindows.clear(); this.orderManager.setBinanceClient(bc, mode === 'paper'); this.marketFeed.setCandeCloseCallback(this.onCandleClose.bind(this));
    this.positionTracker.setTradeUpdateCallback(async (t) => { if (this.onTradeUpdate) await this.onTradeUpdate(t, this.getBalance()); });

    if (mode !== 'paper' && bc) {
      try { const b = await this.fetchBinanceBalance(); this.sessionState.balanceLive = b; this.sessionState.balancePaper = b; } catch (e) {}
      this.startUserDataStream().catch(() => {
        this.balancePollInterval = setInterval(async () => {
          const b = await this.fetchBinanceBalance();
          if (b > 0) { this.sessionState.balanceLive = b; this.sessionState.balancePaper = b; if (this.onBalanceUpdate) this.onBalanceUpdate(this.getBalance(), 0); }
        }, 30000);
      });
    }

    await this.marketFeed.start(config); await this.momentumScanner.start(config);
    if (open.length > 0) { for (const t of open) { this.positionTracker.addTrade(t); this.sessionState.updateStatsOnEntry(); } }
    this.sessionState.setActiveTrades(this.positionTracker.activeList());

    const hot = config.hot_loop_interval_ms || 5000; this.hotLoopInterval = setInterval(() => this.hotLoop(), hot);
    const main = config.main_loop_interval_ms || 15000; this.mainLoopInterval = setInterval(() => this.mainLoop(), main);
    this.broadcastSnapshot('started'); return { status: 'started' };
  }

  async stop() {
    this.running = false; this.sessionState.paused = false;
    if (this.mainLoopInterval) clearInterval(this.mainLoopInterval); if (this.hotLoopInterval) clearInterval(this.hotLoopInterval);
    if (this.balancePollInterval) clearInterval(this.balancePollInterval); if (this.listenKeyKeepAlive) clearInterval(this.listenKeyKeepAlive);
    if (this.userDataWs) { try { this.userDataWs.disconnect(); } catch (e) {} this.userDataWs = null; }
    if (this.listenKey && this.binanceClient) { try { await this.binanceClient.restAPI.userDataStreamsApi.closeUserDataStream(this.listenKey); } catch (e) {} this.listenKey = null; }

    const active = this.positionTracker.activeList();
    for (const t of active) {
      const cp = await this.tickerCache.getPrice(t.symbol); const ep = cp ?? t.last_price ?? t.entry_price;
      const res = await this.positionTracker.closeTrade(t.symbol, ep, 'SESSION_TERMINATED', this.config!);
      if (res.exitOccurred && res.trade) {
        this.sessionState.updateStatsOnClose((res.trade.pnl || 0) > 0); this.sessionState.addClosedTrade(res.trade);
        await this.updateBalance(res.trade); if (this.onTradeUpdate) await this.onTradeUpdate(res.trade, this.getBalance());
      } else {
        t.status = 'CLOSED'; t.exit_ts = new Date(); t.exit_reason = 'SESSION_TERMINATED'; t.exit_price = ep;
        const pnlp = t.direction === 'LONG' ? ep - t.entry_price : t.entry_price - ep; t.pnl = roundEight(pnlp * t.qty);
        this.sessionState.addClosedTrade(t); this.sessionState.updateStatsOnClose((t.pnl || 0) > 0);
        await this.updateBalance(t); if (this.onTradeUpdate) await this.onTradeUpdate(t, this.getBalance());
        this.positionTracker.removeTrade(t.symbol);
      }
    }
    this.sessionState.setActiveTrades([]);
    await this.marketFeed.stop(); await this.momentumScanner.stop();
    this.broadcastSnapshot('stopped'); return { status: 'stopped' };
  }

  private async hotLoop() {
    if (!this.running || !this.config) return;
    if (this.sessionState.listenerCount === 0 && this.positionTracker.activeCount() === 0) { this.monitoringService.recordHotLoop(0); return; }
    const start = performance.now();
    try { await this.checkExits(); this.broadcastTick(); this.monitoringService.recordHotLoop(performance.now() - start); } catch (error) {}
  }

  private async mainLoop() {
    if (!this.running || !this.config) return;
    const activeTrades = this.positionTracker.activeList();
    const prevGateState = this.sessionState.gateState;
    const isInsideWindow = this.isInsideTradingWindow();

    const riskResult = this.riskEngine.canEnter(activeTrades, this.sessionState.closedTrades, this.getBalance(), 'DUMMY', this.config!, this.positionTracker.totalRisk());
    const hasUnscheduledMonitors = this.config.single_symbol_configs?.some(sc => sc.enabled && sc.follow_schedule === false);

    if (!isInsideWindow && !hasUnscheduledMonitors) this.sessionState.gateState = 'sleeping';
    else if (!riskResult.canEnter) { if (!riskResult.reason.includes('Max open trades for')) this.sessionState.gateState = this.mapGateState(riskResult.reason); }
    else this.sessionState.gateState = null;

    const shouldHibernate = this.isGated() && activeTrades.length === 0;
    if (shouldHibernate && !this.sessionState.hibernating) await this.enterHibernation(riskResult.reason || 'Session gated and idle');
    else if (!shouldHibernate && this.sessionState.hibernating) await this.exitHibernation();

    if (this.sessionState.gateState !== prevGateState) {
      this.broadcast('gate', { gateState: this.sessionState.gateState, reason: riskResult.reason, scannerPaused: this.sessionState.gateState === 'max_trades' || this.sessionState.gateState === 'sl_guard' || this.sessionState.gateState === 'max_trades_period' || this.sessionState.paused });
      if (!this.sessionState.hibernating) this.eventEmitter.emit(ENGINE_EVENTS.WATCHLIST_NEEDS_UPDATE, this.config);
    }

    if (this.isGated() || this.sessionState.hibernating) {
      if (this.sessionState.listenerCount > 0) {
        const now = Date.now(); const isFull = now - this.lastScannerFullBroadcast > 30000; if (isFull) this.lastScannerFullBroadcast = now;
        this.broadcast('scanner', { count: this.lastScannerResults.length, hibernating: this.sessionState.hibernating, opportunities: this.lastScannerResults.slice(0, 5).map(o => { if (isFull) return o; const { history, ...rest } = o; return rest; }), variant_opportunities: this.lastVariantScannerResults.map(v => ({ ...v, opportunities: v.opportunities.slice(0, 5).map((o: any) => { if (isFull) return o; const { history, ...rest } = o; return rest; }) })), activeWindows: this.getActiveWindows() });
      }
      return;
    }

    const start = performance.now();
    try {
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
        const priceChanged = this.lastScannerResults.some((o, i) => { const prev = (this.lastTickData as any)?.scannerResults?.[i]; return prev && Math.abs(o.price - prev.price) / prev.price > 0.001; });

        if (isFull || resultsChanged || priceChanged) {
          if (isFull) this.lastScannerFullBroadcast = now; this.lastScannerResultsJson = nextResultsJson;
          this.broadcast('scanner', { count: this.lastScannerResults.length, opportunities: this.lastScannerResults.slice(0, 5).map(o => { if (isFull) return o; const { history, ...rest } = o; return rest; }), variant_opportunities: this.lastVariantScannerResults.map(v => ({ ...v, opportunities: v.opportunities.slice(0, 5).map((o: any) => { if (isFull) return o; const { history, ...rest } = o; return rest; }) })), activeWindows: this.getActiveWindows() });
        }
      } else this.refreshActiveWindows(primaryOpportunities);

      for (const sc of strategyConfigs) { const opps = opportunitiesBySignature.get(this.scanSignature(sc)) || []; await this.processEntries(opps, sc); }
      this.monitoringService.recordMainLoop(performance.now() - start);
    } catch (error) {}
  }

  private async checkExits() {
    if (this.positionTracker.activeCount() === 0) return;
    const activeTrades = this.positionTracker.activeList();
    for (const trade of activeTrades) {
      const currentPrice = this.tickerCache.getPrice(trade.symbol); if (!currentPrice) continue;
      const tradeConfig = { ...this.config!, ...((trade as any).strategy_config || {}) } as SessionConfig;
      await this.positionTracker.checkRrSequenceAdjustments(trade.symbol, currentPrice, tradeConfig);
      const exitInterval = tradeConfig.scan_interval || '1m'; const exitCondition = this.positionTracker.checkExitConditions(trade.symbol, currentPrice, tradeConfig, exitInterval);

      if (exitCondition?.exitOccurred) {
        const result = await this.positionTracker.closeTrade(trade.symbol, currentPrice, exitCondition.exitReason, tradeConfig);
        if (result.exitOccurred && result.trade) {
          this.sessionState.updateStatsOnClose((result.trade.pnl || 0) > 0);
          const prevPaper = this.sessionState.balancePaper; const prevLive = this.sessionState.balanceLive;
          try {
            await this.updateBalance(result.trade); this.sessionState.addClosedTrade(result.trade);
            if (this.onTradeUpdate) await this.onTradeUpdate(result.trade, this.getBalance());
            this.sessionState.setActiveTrades(this.positionTracker.activeList());
            this.eventEmitter.emit(ENGINE_EVENTS.WATCHLIST_NEEDS_UPDATE, tradeConfig);
            const analytics = this.analyticsService.calculateAnalytics(this.sessionState.closedTrades as any, this.config?.paper_mode ? this.config?.paper_starting_balance : this.config?.live_starting_balance);
            this.lastAnalyticsResult = analytics;
            this.broadcast('trade_event', { event: 'closed', symbol: result.trade.symbol, reason: exitCondition.exitReason, trade: this.serializeTrade(result.trade, currentPrice), pnl: result.trade.pnl, stats: this.sessionState.stats, analytics: { maxDrawdown: Number(analytics.maxDrawdown.toFixed(2)), maxDrawdownPct: Number(analytics.maxDrawdownPct.toFixed(2)), overallWinRate: Number(analytics.overallWinRate.toFixed(2)), cumulativePnL: analytics.cumulativePnL.slice(-20).map((p: any) => ({ ...p, pnl: Number(p.pnl.toFixed(2)) })), } });
          } catch (err: any) { await this.rollbackTradeClosure(result.trade, prevPaper, prevLive); throw err; }
        }
      }
    }
  }

  private async onCandleClose(symbol: string) { if (!this.running || !this.config) return; if (this.config.debug_mode) this.logger.verbose(`Candle closed for ${symbol}`); }

  private updateScannerResults(opportunities: any[]) {
    this.lastScannerResults = opportunities.map((o) => ({ symbol: o.symbol, price: o.price, pct: Number(o.momentum.toFixed(2)), momentum: Number(o.momentum.toFixed(2)), direction: o.direction.toLowerCase(), dir: o.direction.toLowerCase(), vol: o.volume_24h, volume_usdt: o.volume_24h, score: Number((o.score / 10).toFixed(1)), history: o.history, signalResult: o.signalResult, }));
    this.refreshActiveWindows(this.lastScannerResults);
  }

  private async processEntries(opportunities: any[], strategyConfig: SessionConfig = this.config!) {
    const strategyLabel = this.getStrategyLabel(strategyConfig); const symbolConfigs = strategyConfig.single_symbol_configs;
    const symbolConfigMap = (symbolConfigs && symbolConfigs.length > 0) ? new Map(symbolConfigs.map(sc => [sc.symbol, sc])) : null;

    for (const opp of opportunities) {
      if (this.positionTracker.hasSymbol(opp.symbol)) continue;
      const sc = symbolConfigMap?.get(opp.symbol); const symbolConfig = (sc?.use_custom_config && sc.custom_config) ? { ...strategyConfig, ...sc.custom_config } as SessionConfig : strategyConfig;
      const signalResult = this.signalEngine.checkEntry(opp.symbol, strategyConfig, strategyConfig.scan_interval || '1m', opp.direction.toUpperCase() as any, 'entry');
      if (!signalResult.allFired) continue;

      const activeTrades = this.positionTracker.activeList();
      const riskResult = this.riskEngine.canEnter(activeTrades, this.sessionState.closedTrades, this.getBalance(), opp.symbol, symbolConfig, this.positionTracker.totalRisk());

      if (!riskResult.canEnter) {
        if (!riskResult.reason.includes('Max open trades for')) {
          this.sessionState.gateState = this.mapGateState(riskResult.reason);
          this.broadcast('gate', { gateState: this.sessionState.gateState, reason: riskResult.reason, scannerPaused: this.sessionState.gateState === 'max_trades' || this.sessionState.gateState === 'sl_guard' || this.sessionState.gateState === 'max_trades_period' || this.sessionState.paused });
        }
        continue;
      }

      const price = this.tickerCache.getPrice(opp.symbol); if (!price) continue;
      const lookback = this.klineStore.getLookbackExtremes(opp.symbol, symbolConfig.sl_lookback_timeframe || '1m', symbolConfig.sl_lookback_period || 20);
      const slPrice = this.riskEngine.computeSl(price, opp.direction.toUpperCase() as any, symbolConfig, lookback.minLow, lookback.maxHigh);
      const qty = this.riskEngine.computePositionSize(this.getBalance(), price, slPrice, opp.direction.toUpperCase() as any, symbolConfig);
      if (qty <= 0) continue;
      const tpPrice = this.riskEngine.computeTp(price, slPrice, opp.direction.toUpperCase() as any, symbolConfig);
      
      const trade = await this.orderManager.enter(this.sessionId || uuid().substring(0, 8), opp.symbol, opp.direction.toUpperCase() as any, price, qty, slPrice, tpPrice, { strategy_label: strategyLabel, strategy_config: strategyConfig });

      if (trade) {
        this.positionTracker.addTrade(trade); this.sessionState.updateStatsOnEntry(); if (this.onTradeUpdate) await this.onTradeUpdate(trade, this.getBalance());
        this.sessionState.setActiveTrades(this.positionTracker.activeList());
        this.eventEmitter.emit(ENGINE_EVENTS.WATCHLIST_NEEDS_UPDATE, strategyConfig);
        this.broadcast('trade_event', { event: 'opened', symbol: opp.symbol, trade: this.serializeTrade(trade, price), stats: this.sessionState.stats });
      }
    }
  }

  private refreshActiveWindows(opportunities: any[]) {
    if (this.config?.scan_mode !== 'active_window') { this.activeWindows.clear(); return; }
    const now = Date.now(); const durationMs = (this.config.scan_window_duration_sec || 90) * 1000;
    opportunities.forEach((opp) => { const existing = this.activeWindows.get(opp.symbol); this.activeWindows.set(opp.symbol, { symbol: opp.symbol, direction: opp.dir, pct_change: opp.pct, opened_at: existing?.opened_at || now, expires_at: existing?.expires_at || now + durationMs, checks: (existing?.checks || 0) + 1, entries: existing?.entries || 0 }); });
    for (const [symbol, window] of this.activeWindows.entries()) { if (window.expires_at <= now || this.positionTracker.hasSymbol(symbol)) this.activeWindows.delete(symbol); }
  }

  private getActiveWindows() { const now = Date.now(); return Array.from(this.activeWindows.values()).map((window) => ({ ...window, remaining_ms: Math.max(0, window.expires_at - now) })); }

  private isInsideTradingWindow(): boolean { if (!this.config?.trading_windows?.length) return true; const now = new Date(); const currentTime = now.getUTCHours() * 100 + now.getUTCMinutes(); return this.config.trading_windows.some(window => { const start = parseInt(window.start.replace(':', ''), 10); const end = parseInt(window.end.replace(':', ''), 10); return start <= end ? (currentTime >= start && currentTime <= end) : (currentTime >= start || currentTime <= end); }); }

  private async enterHibernation(reason: string) {
    this.logger.log(`Entering DEEP SLEEP (Hibernation) - Reason: ${reason}`);
    this.sessionState.hibernating = true;
    const needsKlines = this.positionTracker.activeList().some(t => { const c = { ...this.config!, ...(t as any).strategy_config || {} }; return c.exit_signals && c.exit_signals.length > 0; });
    if (needsKlines) await this.momentumScanner.stop(); else { await this.marketFeed.stop(); await this.momentumScanner.stop(); this.klineStore.clear(); this.tickerCache.clear(); }
    this.broadcast('gate', { gateState: this.sessionState.gateState, reason: reason, hibernating: true });
  }

  private async exitHibernation() {
    this.logger.log('Exiting DEEP SLEEP (Hibernation)');
    this.sessionState.hibernating = false; if (this.config) { await this.marketFeed.start(this.config); await this.momentumScanner.start(this.config); }
    this.broadcast('gate', { gateState: this.sessionState.gateState, hibernating: false });
  }

  private mapGateState(reason: string): string {
    if (reason.includes('max open trades')) return 'max_trades'; if (reason.includes('Max trades per period')) return 'max_trades_period';
    if (reason.includes('Total SL')) return 'sl_guard'; if (reason.includes('Total risk')) return 'risk_pct';
    if (reason.includes('Historical performance')) return 'tod_risk'; return 'risk';
  }

  private serializeTrade(trade: Trade, currentPrice?: number, minimal = false) {
    const round = (val: any, p = 8) => (val !== undefined && Number.isFinite(val)) ? Number(val.toFixed(p)) : val;
    const anyTrade = trade as any; const direction = (anyTrade.direction || anyTrade.side || 'LONG').toString().toUpperCase(); const entry = anyTrade.entry_price ?? anyTrade.entry ?? 0;
    const cpv = currentPrice !== undefined && Number.isFinite(currentPrice) && currentPrice > 0; const current = cpv ? currentPrice : anyTrade.exit_price ?? anyTrade.last_price ?? entry; if (cpv) anyTrade.last_price = currentPrice;
    let pnl = undefined; let rrValue = undefined;
    if (current !== undefined && Number.isFinite(current) && Number.isFinite(entry)) { pnl = roundEight(direction === 'LONG' ? (current - entry) * (anyTrade.qty ?? 0) : (entry - current) * (anyTrade.qty ?? 0)); anyTrade.pnl = pnl; const risk = Math.abs(entry - (anyTrade.initial_sl ?? anyTrade.current_sl ?? anyTrade.sl_price ?? anyTrade.sl ?? entry)) || 1; rrValue = (direction === 'LONG' ? (current - entry) : (entry - current)) / risk; }

    if (minimal) { return { id: trade.id, symbol: trade.symbol, strategy_label: anyTrade.strategy_label || this.getStrategyLabel(anyTrade.strategy_config || this.config), current_price: round(current ?? entry), sl_price: round(anyTrade.current_sl ?? anyTrade.sl_price), tp_price: round(anyTrade.tp ?? anyTrade.tp_price), pnl: round(pnl, 2), rr: round(rrValue, 4), max_rr: round(anyTrade.max_rr_achieved ?? anyTrade.max_rr ?? 0, 4), direction, entry_price: round(entry), qty: round(anyTrade.qty ?? 0), paper_mode: this.config?.paper_mode, exit_signals_status: anyTrade.exit_signals_status || {}, sl_adjustments: anyTrade.sl_adjustments || [], live_rr_sequence: anyTrade.strategy_config?.live_rr_sequence || this.config?.live_rr_sequence || [], exit_rr_sequence: anyTrade.strategy_config?.exit_rr_sequence || this.config?.exit_rr_sequence || [], tp_mode: anyTrade.strategy_config?.tp_mode || this.config?.tp_mode || 'fixed', tp_ratio: anyTrade.strategy_config?.tp_ratio || this.config?.tp_ratio || 2, _delta: true, }; }

    return { ...trade, direction, current_price: round(current ?? entry), sl_price: round(anyTrade.current_sl ?? anyTrade.sl_price), tp_price: round(anyTrade.tp ?? anyTrade.tp_price), pnl: round(pnl, 2), rr: round(rrValue, 4), paper_mode: this.config?.paper_mode, trading_mode: this.config?.trading_mode || (this.config?.paper_mode ? 'paper' : 'live'), max_rr: round(anyTrade.max_rr_achieved ?? anyTrade.max_rr ?? 0, 4), strategy_label: anyTrade.strategy_label || this.getStrategyLabel(anyTrade.strategy_config || this.config), strategy_config: anyTrade.strategy_config, live_rr_sequence: anyTrade.strategy_config?.live_rr_sequence || this.config?.live_rr_sequence || [], exit_rr_sequence: anyTrade.strategy_config?.exit_rr_sequence || this.config?.exit_rr_sequence || [], exit_signal_logic: anyTrade.strategy_config?.exit_signal_logic || this.config?.exit_signal_logic || 'any', tp_mode: anyTrade.strategy_config?.tp_mode || this.config?.tp_mode || 'fixed', tp_ratio: anyTrade.strategy_config?.tp_ratio || this.config?.tp_ratio || 2, };
  }

  private lastTickData: any = null; private lastTickTime = 0;

  private broadcastTick() {
    if (this.sessionState.listenerCount === 0) return;
    const activeTrades = this.positionTracker.activeList(); const now = Date.now(); const isHeartbeat = !this.lastTickData || (now - this.lastTickTime > 10000);
    const prevTickMap = new Map<string, any>(); if (this.lastTickData?.trades) { for (const t of this.lastTickData.trades) prevTickMap.set(t.symbol, t); }
    const trades: any[] = []; const len = activeTrades.length; let anyPriceChangedSignificant = false;
    for (let i = 0; i < len; i++) {
      const trade = activeTrades[i]; let current = this.tickerCache.getPrice(trade.symbol); const prevTrade = prevTickMap.get(trade.symbol);
      if (current === null && prevTrade) current = prevTrade.current_price;
      const serialized = this.serializeTrade(trade, current ?? undefined, true); let tradeChanged = false;
      if (prevTrade && !isHeartbeat) {
        if (serialized.sl_price !== prevTrade.sl_price) tradeChanged = true; if (serialized.max_rr !== prevTrade.max_rr) tradeChanged = true;
        if (JSON.stringify(serialized.sl_adjustments) !== JSON.stringify(prevTrade.sl_adjustments)) tradeChanged = true;
        if (JSON.stringify(serialized.exit_signals_status) !== JSON.stringify(prevTrade.exit_signals_status)) tradeChanged = true;
        if (serialized.direction !== prevTrade.direction) tradeChanged = true;
        if (serialized.rr !== undefined && prevTrade.rr !== undefined && Math.abs(serialized.rr - prevTrade.rr) >= 0.01) { anyPriceChangedSignificant = true; tradeChanged = true; }
        if (serialized.pnl !== undefined && prevTrade.pnl !== undefined && Math.abs(serialized.pnl - prevTrade.pnl) > 0.05) { anyPriceChangedSignificant = true; tradeChanged = true; }
        if (serialized.current_price !== undefined && prevTrade.current_price !== undefined && Math.abs(serialized.current_price - prevTrade.current_price) / prevTrade.current_price >= 0.0001) tradeChanged = true;
      } else { anyPriceChangedSignificant = true; tradeChanged = true; }
      if (tradeChanged || isHeartbeat) { const { strategy_config, live_rr_sequence, exit_rr_sequence, exit_signals_status, sl_adjustments, tp_mode, tp_ratio, ...thin } = serialized as any; trades.push(thin); }
    }

    let activePnl = 0; for (const t of activeTrades) activePnl += (t.pnl || 0);
    const balance = this.getBalance(); const mode = this.config?.trading_mode || (this.config?.paper_mode ? 'paper' : 'live'); const startingBalance = (mode === 'paper') ? this.config?.paper_starting_balance : this.config?.live_starting_balance;
    const realizedPnl = roundEight(balance - (startingBalance ?? balance)); const totalPnl = roundEight(realizedPnl + activePnl); const totalRiskUsdt = this.positionTracker.totalRisk();
    if (!this.lastAnalyticsResult || this.sessionState.closedTrades.length !== this.lastAnalyticsTradeCount || startingBalance !== this.lastAnalyticsStartingBalance) { this.lastAnalyticsResult = this.analyticsService.calculateAnalytics(this.sessionState.closedTrades as any, startingBalance); this.lastAnalyticsTradeCount = this.sessionState.closedTrades.length; this.lastAnalyticsStartingBalance = startingBalance || 0; }
    const monitoringInterval = 15000; const lastMonitoringTime = this.lastTickData?._monitoring_ts || 0; const shouldUpdateMonitoring = (now - lastMonitoringTime > monitoringInterval) || !this.lastTickData; const monitoring = shouldUpdateMonitoring ? this.monitoringService.getMetrics() : null;
    const variantStats = this.calculateVariantStats(activeTrades);
    const tickData: any = { balance: Number(balance.toFixed(2)), total_pnl: Number(totalPnl.toFixed(2)), total_risk_pct: Number((balance > 0 ? (totalRiskUsdt / balance) * 100 : 0).toFixed(2)), total_sl_used: Number(totalRiskUsdt.toFixed(2)), trades, gateState: this.sessionState.gateState, hibernating: this.sessionState.hibernating, paused: this.sessionState.paused, scannerPaused: this.sessionState.gateState === 'max_trades' || this.sessionState.gateState === 'sl_guard' || this.sessionState.gateState === 'max_trades_period' || this.sessionState.paused, activeWindows: this.getActiveWindows(), rateLimit: this.getBinanceRateLimit(), stats: this.sessionState.stats, monitoring, isEcoMode: this.isEcoMode(), };
    if (this.config?.strategy_variants?.length) tickData.variant_stats = variantStats;
    const heartbeatInterval = trades.length > 0 ? 10000 : 30000; let shouldBroadcast = !this.lastTickData || (now - this.lastTickTime > heartbeatInterval); if (shouldBroadcast) (tickData as any)._heartbeat = true;
    if (!shouldBroadcast) { const prevTrades = this.lastTickData?.trades || []; const tradesChanged = trades.length !== prevTrades.length || anyPriceChangedSignificant; const pnlChanged = Math.abs(totalPnl - (this.lastTickData?.total_pnl || 0)) > 0.1; if (!shouldUpdateMonitoring) delete tickData.monitoring; else tickData._monitoring_ts = now; const gateChanged = tickData.gateState !== this.lastTickData?.gateState; const lastStatsVersion = this.lastTickData?._statsVersion || 0; const statsChanged = this.sessionState.statsVersion !== lastStatsVersion; if (tradesChanged || pnlChanged || (shouldUpdateMonitoring && monitoringChangedInternal(monitoring, this.lastTickData?.monitoring)) || gateChanged || statsChanged) shouldBroadcast = true; }
    tickData._statsVersion = this.sessionState.statsVersion;
    if (shouldBroadcast) { this.broadcast('tick', tickData); this.lastTickData = tickData; this.lastTickTime = now; }
  }

  private broadcastSnapshot(status: 'started' | 'stopped') {
    const mode = this.config?.trading_mode || (this.config?.paper_mode ? 'paper' : 'live');
    if (status === 'stopped') { this.broadcast('session_terminated', { reason: 'SESSION_TERMINATED', endedAt: new Date().toISOString() }); return; }
    this.broadcast('session', { status, running: this.running, paused: this.sessionState.paused, mode: this.config?.paper_mode ? 'PAPER' : 'LIVE', tradingMode: mode, balance: this.getBalance(), config: this.config, gateState: this.sessionState.gateState, scannerPaused: this.sessionState.gateState === 'max_trades' || this.sessionState.gateState === 'sl_guard' || this.sessionState.gateState === 'max_trades_period', activeTrades: this.positionTracker.activeList().map((t) => this.serializeTrade(t)), scannerResults: this.lastScannerResults, activeWindows: this.getActiveWindows(), });
  }

  async fetchBinanceBalance(): Promise<number> { if (!this.binanceClient) return 0; try { this.monitoringService.incrementApiRequests(); const res = await this.binanceClient.restAPI.accountApi.futuresAccountBalanceV2(); const data = res.data || res; const usdt = Array.isArray(data) ? data.find((b: any) => b.asset === 'USDT') : null; return usdt ? parseFloat(usdt.balance || 0) : 0; } catch (e: any) { this.logger.error(`Balance fetch failed: ${e.message}`); return 0; } }
  private async updateBalance(t: Trade) { const mode = this.config?.trading_mode || (this.config?.paper_mode ? 'paper' : 'live'); if (mode === 'paper') this.sessionState.balancePaper = roundEight(this.sessionState.balancePaper + (t.pnl || 0)); else if (this.binanceClient) { const b = await this.fetchBinanceBalance(); if (b > 0) { this.sessionState.balanceLive = b; this.sessionState.balancePaper = b; } else { this.sessionState.balanceLive = roundEight(this.sessionState.balanceLive + (t.pnl || 0)); this.sessionState.balancePaper = roundEight(this.sessionState.balancePaper + (t.pnl || 0)); } } if (this.onBalanceUpdate) this.onBalanceUpdate(this.getBalance(), t.pnl || 0); }
  private getBalance(): number { return this.sessionState.getBalance(this.config?.paper_mode ?? true); }
  private async rollbackTradeClosure(t: Trade, pp: number, pl: number) { this.logger.warn(`Rolling back trade closure for ${t.symbol}.`); this.sessionState.balancePaper = pp; this.sessionState.balanceLive = pl; this.sessionState.rollbackClosedTrade(t); t.status = 'OPEN'; this.positionTracker.addTrade(t); if (this.onBalanceUpdate) await this.onBalanceUpdate(this.getBalance(), 0); }

  private async startUserDataStream() {
    if (!this.binanceClient) return;
    try {
      this.monitoringService.incrementApiRequests(); const res = await this.binanceClient.restAPI.userDataStreamsApi.startUserDataStream(); this.listenKey = res.data.listenKey;
      this.userDataWs = await this.binanceClient.websocketStreams.connect();
      this.userDataWs.on('message', async (msg: any) => { try { const data = typeof msg === 'string' ? JSON.parse(msg) : msg; if (data.e === 'ACCOUNT_UPDATE' && data.a && data.a.B) { const usdt = data.a.B.find((b: any) => b.a === 'USDT'); if (usdt) { const nb = parseFloat(usdt.wb); this.sessionState.balanceLive = nb; this.sessionState.balancePaper = nb; if (this.onBalanceUpdate) await this.onBalanceUpdate(this.getBalance(), 0); } } } catch (err) {} });
      this.userDataWs.userData(this.listenKey); this.listenKeyKeepAlive = setInterval(async () => { if (this.listenKey) { try { this.monitoringService.incrementApiRequests(); await this.binanceClient.restAPI.userDataStreamsApi.keepaliveUserDataStream(this.listenKey); } catch (err) {} } }, 1800000);
    } catch (e) { throw e; }
  }

  private calculateVariantStats(activeTrades?: Trade[]): Record<string, any> {
    const variantStats: Record<string, any> = {}; if (!this.config?.strategy_variants?.length) return variantStats;
    const activeList = activeTrades || this.positionTracker.activeList(); const balance = this.getBalance(); const closedStats = this.sessionState.cachedClosedTradesStats;
    const groups: Record<string, { pnl: number, risk: number, count: number, hits: number }> = {};
    for (let i = 0; i < activeList.length; i++) { const t = activeList[i]; const l = t.strategy_label || 'Momentum Strategy'; if (!groups[l]) groups[l] = { pnl: 0, risk: 0, count: 0, hits: 0 }; groups[l].pnl = roundEight(groups[l].pnl + (t.pnl || 0)); groups[l].risk = roundEight(groups[l].risk + (t.risk_usdt || 0)); groups[l].count++; if ((t.pnl || 0) > 0) groups[l].hits++; }
    this.getStrategyConfigs().forEach(cfg => { const l = cfg.strategy_label!; const a = groups[l] || { pnl: 0, risk: 0, count: 0, hits: 0 }; const c = closedStats[l] || { pnl: 0, count: 0, hits: 0 }; variantStats[l] = { totalPnl: roundEight(c.pnl + a.pnl), entryCount: c.count + a.count, hitCount: c.hits + a.hits, totalRiskPct: Number((balance > 0 ? (a.risk / balance) * 100 : 0).toFixed(2)), activeTradeCount: a.count }; });
    return variantStats;
  }

  getActiveTradeCount(): number { return this.positionTracker.activeCount(); }
  getActiveTradeSymbols(): string[] { return this.positionTracker.activeList().map(t => t.symbol); }
  getActiveTradesRaw(): Trade[] { return this.positionTracker.activeList(); }

  getStatus() {
    return { running: this.running, paused: this.sessionState.paused, mode: this.config?.paper_mode ? 'PAPER' : 'LIVE', tradingMode: this.config?.trading_mode || (this.config?.paper_mode ? 'paper' : 'live'), balance_paper: this.sessionState.balancePaper, balance_live: this.sessionState.balanceLive, stats: this.sessionState.stats, activeTrades: this.positionTracker.activeList().map((t) => this.serializeTrade(t)), total_risk: this.positionTracker.totalRisk(), variant_stats: this.calculateVariantStats(), scannerResults: this.lastScannerResults, activeWindows: this.getActiveWindows(), gateState: this.sessionState.gateState, hibernating: this.sessionState.hibernating, scannerPaused: this.sessionState.gateState === 'max_trades' || this.sessionState.gateState === 'sl_guard' || this.sessionState.gateState === 'max_trades_period' || this.sessionState.paused, history: this.sessionState.closedTrades.slice(0, 50).map((t) => this.serializeTrade(t, t.exit_price)), };
  }

  setPaused(paused: boolean) { this.sessionState.paused = paused; this.broadcast('tick', { paused }); }
  updateConfig(config: SessionConfig) {
    const prev = this.config; this.config = config; this.cachedStrategyConfigs = null; this.cachedScanSignatures.clear();
    if (prev && (prev.hot_loop_interval_ms !== config.hot_loop_interval_ms || prev.main_loop_interval_ms !== config.main_loop_interval_ms)) { const isEco = this.sessionState.listenerCount === 0; const mainMs = isEco ? Math.max(15000, config.main_loop_interval_ms || 15000) : (config.main_loop_interval_ms || 15000); const hotMs = isEco ? Math.max(5000, config.hot_loop_interval_ms || 5000) : (config.hot_loop_interval_ms || 5000); this.restartLoops(hotMs, mainMs); }
    this.broadcast('tick', { config: this.config });
  }

  async fetchTickerPrice(symbol: string): Promise<number | null> { return this.tickerCache.getPrice(symbol); }
  updateRateLimit(used1m: number) { this.sessionState.updateRateLimit(used1m); }
  isRateLimited(): boolean { return this.sessionState.isRateLimited(); }
  getBinanceRateLimit() { return this.sessionState.getBinanceRateLimit(); }
  getClosedTrades(): Trade[] { return this.sessionState.closedTrades; }

  getTrade(idOrSymbol: string): Trade | undefined {
    const active = this.positionTracker.activeList().find(t => t.id === idOrSymbol || t.symbol === idOrSymbol);
    if (active) return active;
    return this.sessionState.closedTrades.find(t => t.id === idOrSymbol || t.symbol === idOrSymbol);
  }

  async closeTradeManually(symbol: string): Promise<{ success: boolean; trade?: Trade; error?: string }> {
    if (!this.running) return { success: false, error: 'No session running' };
    const trade = this.positionTracker.activeList().find(t => t.symbol === symbol);
    if (!trade) return { success: false, error: `No open position for ${symbol}` };
    const cp = await this.tickerCache.getPrice(symbol); if (!cp) return { success: false, error: `Could not fetch price for ${symbol}` };
    const res = await this.positionTracker.closeTrade(symbol, cp, 'MANUAL_CLOSE', this.config!);
    if (res.exitOccurred && res.trade) {
      this.sessionState.updateStatsOnClose((res.trade.pnl || 0) > 0);
      const pp = this.sessionState.balancePaper; const pl = this.sessionState.balanceLive;
      try {
        await this.updateBalance(res.trade); this.sessionState.addClosedTrade(res.trade);
        if (this.onTradeUpdate) await this.onTradeUpdate(res.trade, this.getBalance());
        this.sessionState.setActiveTrades(this.positionTracker.activeList());
        this.eventEmitter.emit(ENGINE_EVENTS.WATCHLIST_NEEDS_UPDATE, this.config!);
        this.lastAnalyticsResult = this.analyticsService.calculateAnalytics(this.sessionState.closedTrades as any, this.config?.paper_mode ? this.config?.paper_starting_balance : this.config?.live_starting_balance);
        this.broadcast('trade_event', { event: 'closed', symbol: res.trade.symbol, reason: 'MANUAL_CLOSE', trade: this.serializeTrade(res.trade, cp), pnl: res.trade.pnl, stats: this.sessionState.stats, analytics: { maxDrawdown: Number(this.lastAnalyticsResult.maxDrawdown.toFixed(2)), maxDrawdownPct: Number(this.lastAnalyticsResult.maxDrawdownPct.toFixed(2)), overallWinRate: Number(this.lastAnalyticsResult.overallWinRate.toFixed(2)), cumulativePnL: this.lastAnalyticsResult.cumulativePnL.slice(-20).map((p: any) => ({ ...p, pnl: Number(p.pnl.toFixed(2)) })), } });
        return { success: true, trade: res.trade };
      } catch (err: any) { await this.rollbackTradeClosure(res.trade, pp, pl); return { success: false, error: err.message }; }
    }
    return { success: false, error: 'Failed to close trade' };
  }
}
