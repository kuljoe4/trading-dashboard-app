import { Injectable, Logger } from '@nestjs/common';
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
import { v4 as uuid } from 'uuid';

@Injectable()
export class TradingSessionService {
  private readonly logger = new Logger(TradingSessionService.name);

  private running = false;
  private paused = false;
  private sessionId: string | null = null;
  private config: SessionConfig | null = null;
  private binanceClient: any = null;
  private balancePaper = 0;
  private balanceLive = 0;
  private lastRateLimitCheck = 0;
  private binanceRateLimit: Record<string, any> = {};
  private wsBroadcaster: ((data: any) => void) | null = null;
  private onBalanceUpdate: ((balance: number, pnl: number) => void) | null = null;
  private lastScannerResults: any[] = [];
  private closedTrades: Trade[] = [];
  private gateState: string | null = null;
  private activeWindows: Map<string, any> = new Map();
  private mainLoopInterval: NodeJS.Timeout | null = null;
  private hotLoopInterval: NodeJS.Timeout | null = null;

  constructor(
    private readonly tickerCache: TickerCacheService,
    private readonly klineStore: KlineStoreService,
    private readonly signalEngine: SignalEngineService,
    private readonly riskEngine: RiskEngineService,
    private readonly positionTracker: PositionTrackerService,
    private readonly orderManager: OrderManagerService,
    private readonly marketFeed: MarketFeedService,
    private readonly momentumScanner: MomentumScannerService,
    private readonly monitoringService: MonitoringService,
  ) {}

  setWsBroadcaster(cb: (data: any) => void) {
    this.wsBroadcaster = cb;
  }

  setBalanceUpdateCallback(cb: (balance: number, pnl: number) => void) {
    this.onBalanceUpdate = cb;
  }

  private broadcast(eventType: string, payload: any) {
    if (this.wsBroadcaster) {
      this.wsBroadcaster({ type: eventType, ...payload });
    }
  }

  async start(config: SessionConfig, binanceClient?: any, sessionId?: string) {
    this.running = true;
    this.paused = false;
    this.sessionId = sessionId || null;
    this.config = config;
    this.binanceClient = binanceClient;
    this.balancePaper = config.paper_starting_balance || 1000;
    this.balanceLive = config.live_starting_balance || 0;
    this.closedTrades = [];
    this.gateState = null;
    this.activeWindows.clear();

    // Wire services
    this.orderManager.setBinanceClient(binanceClient, config.paper_mode);
    this.marketFeed.setCandeCloseCallback(this.onCandleClose.bind(this));

    // Fetch live balance
    if (!config.paper_mode && binanceClient) {
      try {
        const balance = await this.fetchBinanceBalance();
        this.balanceLive = balance;
      } catch (error) {
        this.logger.warn(`Failed to fetch live balance: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    // Start market feed
    await this.marketFeed.start(config);
    await this.momentumScanner.start(config);

    // Pro Loop Architecture
    // 1. Hot Loop (1000ms): Exit monitoring & PnL updates
    this.hotLoopInterval = setInterval(() => this.hotLoop(), 1000);

    // 2. Main Loop (2000ms): Scanning & Entry
    this.mainLoopInterval = setInterval(() => this.mainLoop(), 2000);

    this.logger.log(`Session started | mode=${config.paper_mode ? 'PAPER' : 'LIVE'} | balance=${this.getBalance()}`);
    this.broadcastSnapshot('started');

    return { status: 'started' };
  }

  async stop() {
    this.running = false;
    this.paused = false;
    if (this.mainLoopInterval) clearInterval(this.mainLoopInterval);
    if (this.hotLoopInterval) clearInterval(this.hotLoopInterval);

    // Properly close active positions on session stop
    const active = this.positionTracker.activeList();
    for (const trade of active) {
      trade.status = 'CLOSED';
      trade.exit_ts = new Date();
      trade.exit_reason = 'SESSION_TERMINATED';
      this.closedTrades.push(trade);
      this.positionTracker.removeTrade(trade.symbol);
    }
    
    await this.marketFeed.stop();
    await this.momentumScanner.stop();
    this.logger.log('Session stopped');
    this.broadcastSnapshot('stopped');
    this.broadcast('session_terminated', {
      reason: 'SESSION_TERMINATED',
      endedAt: new Date().toISOString(),
    });
    return { status: 'stopped' };
  }

  /**
   * Pro Hot Loop: 500ms
   * Handles high-frequency tasks: SL/TP monitoring and UI ticks
   */
  private async hotLoop() {
    if (!this.running || !this.config) return;
    const start = performance.now();
    try {
      await this.checkExits();
      await this.broadcastTick();
      this.monitoringService.recordHotLoop(performance.now() - start);
    } catch (error) {
      this.logger.debug(`Hot loop error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Pro Main Loop: 2000ms
   * Handles lower-frequency tasks: Market scanning and trade entry
   */
  private async mainLoop() {
    if (!this.running || !this.config || this.paused) return;

    // Evaluate risk gates before scanning
    const activeTrades = this.positionTracker.activeList();
    const riskResult = await this.riskEngine.canEnter(
      activeTrades,
      this.closedTrades,
      this.getBalance(),
      'DUMMY', // Global check
      this.config!,
      this.positionTracker.totalRisk(),
    );

    const prevGateState = this.gateState;
    if (!riskResult.canEnter) {
      // Filter out per-symbol reasons for global gate state
      if (!riskResult.reason.includes('Max open trades for')) {
        this.gateState = this.mapGateState(riskResult.reason);
      }
    } else {
      this.gateState = null;
    }

    if (this.gateState !== prevGateState) {
      this.broadcast('gate', {
        gateState: this.gateState,
        reason: riskResult.reason,
        scannerPaused: this.gateState === 'max_trades' || this.gateState === 'sl_guard' || this.gateState === 'max_trades_period'
      });
    }
    
    // Check if scanner should be paused based on gate state
    if (this.gateState === 'max_trades' || this.gateState === 'sl_guard' || this.gateState === 'max_trades_period') {
      this.broadcast('scanner', {
        count: 0,
        opportunities: [],
        activeWindows: this.getActiveWindows(),
      });
      return;
    }

    const start = performance.now();
    try {
      const opportunities = await this.momentumScanner.scan(this.config);
      this.updateScannerResults(opportunities);
      
      this.broadcast('scanner', {
        count: this.lastScannerResults.length,
        opportunities: this.lastScannerResults,
        activeWindows: this.getActiveWindows(),
      });

      await this.processEntries(opportunities);
      this.monitoringService.recordMainLoop(performance.now() - start);
    } catch (error) {
      this.logger.debug(`Main loop error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async checkExits() {
    const activeTrades = this.positionTracker.activeList();
    for (const trade of activeTrades) {
      const currentPrice = await this.tickerCache.getPrice(trade.symbol);
      if (!currentPrice) continue;

      // 1. Ratchet SL if applicable
      await this.positionTracker.checkRrSequenceAdjustments(trade.symbol, currentPrice, this.config!);

      // 2. Check Exit Conditions (SL/TP/Signals)
      const exitCondition = await this.positionTracker.checkExitConditions(trade.symbol, currentPrice, this.config!);

      if (exitCondition?.exitOccurred) {
        const result = await this.positionTracker.closeTrade(trade.symbol, currentPrice, exitCondition.exitReason, this.config!);
        if (result.exitOccurred && result.trade) {
          this.updateBalance(result.trade);
          this.closedTrades.unshift(result.trade);
          this.broadcast('trade_event', {
            event: 'closed',
            symbol: result.trade.symbol, // Fix: Added symbol for frontend log
            reason: exitCondition.exitReason,
            trade: this.serializeTrade(result.trade, currentPrice),
            pnl: result.trade.pnl,
          });
        }
      }
    }
  }

  private async onCandleClose(symbol: string) {
    if (!this.running || !this.config) return;
    this.logger.debug(`Candle closed for ${symbol}`);
  }

  private updateScannerResults(opportunities: any[]) {
    this.lastScannerResults = opportunities.map((o) => ({
      symbol: o.symbol,
      price: o.price,
      pct: Number(o.momentum.toFixed(2)),
      momentum: Number(o.momentum.toFixed(2)),
      direction: o.direction.toLowerCase(),
      dir: o.direction.toLowerCase(),
      vol: o.volume_24h,
      volume_usdt: o.volume_24h,
      score: Number((o.score / 10).toFixed(1)),
      history: o.history,
    }));
    this.refreshActiveWindows(this.lastScannerResults);
  }

  private async processEntries(opportunities: any[]) {
    for (const opp of opportunities) {
      if (this.positionTracker.hasSymbol(opp.symbol)) continue;

      const signalResult = await this.signalEngine.checkEntry(opp.symbol, this.config!, this.config!.scan_interval || '1m');
      if (!signalResult.allFired) continue;

      this.logger.log(`${opp.symbol}: ALL SIGNALS FIRED! Proceeding to risk checks...`);

      const activeTrades = this.positionTracker.activeList();
      const riskResult = await this.riskEngine.canEnter(
        activeTrades,
        this.closedTrades,
        this.getBalance(),
        opp.symbol,
        this.config!,
        this.positionTracker.totalRisk(),
      );

      if (!riskResult.canEnter) {
        // Only update gateState if it's a global limit, not per-symbol
        if (!riskResult.reason.includes('Max open trades for')) {
          this.gateState = this.mapGateState(riskResult.reason);
          this.broadcast('gate', {
            gateState: this.gateState,
            reason: riskResult.reason,
            scannerPaused: this.gateState === 'max_trades' || this.gateState === 'sl_guard' || this.gateState === 'max_trades_period'
          });
        }
        this.logger.warn(`${opp.symbol}: Risk gate blocked - ${riskResult.reason}`);
        continue;
      }

      const price = await this.tickerCache.getPrice(opp.symbol);
      if (!price) continue;

      const lookback = await this.klineStore.getLookbackExtremes(opp.symbol, this.config!.sl_lookback_timeframe || '1m', this.config!.sl_lookback_period || 20);
      const slPrice = await this.riskEngine.computeSl(price, opp.direction.toUpperCase() as any, this.config!, lookback.lows, lookback.highs);
      const qty = await this.riskEngine.computePositionSize(this.getBalance(), price, slPrice, opp.direction.toUpperCase() as any, this.config!);
      
      if (qty <= 0) continue;

      const tpPrice = await this.riskEngine.computeTp(price, slPrice, opp.direction.toUpperCase() as any, this.config!);

      this.logger.log(`${opp.symbol}: Sending ${opp.direction} order (Qty: ${qty.toFixed(4)})`);
      
      const trade = await this.orderManager.enter(this.sessionId || uuid().substring(0, 8), opp.symbol, opp.direction.toUpperCase() as any, price, qty, slPrice, tpPrice);

      if (trade) {
        this.positionTracker.addTrade(trade);
        this.broadcast('trade_event', { 
          event: 'opened', 
          symbol: opp.symbol, // Fix: Added symbol for frontend log
          trade: this.serializeTrade(trade, price) 
        });
      }
    }
  }

  private refreshActiveWindows(opportunities: any[]) {
    if (this.config?.scan_mode !== 'active_window') {
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
      if (window.expires_at <= now || this.positionTracker.hasSymbol(symbol)) {
        this.activeWindows.delete(symbol);
      }
    }
  }

  private getActiveWindows() {
    const now = Date.now();
    return Array.from(this.activeWindows.values()).map((window) => ({
      ...window,
      remaining_ms: Math.max(0, window.expires_at - now),
    }));
  }

  private mapGateState(reason: string): string {
    if (reason.includes('max open trades')) return 'max_trades';
    if (reason.includes('Max trades per period')) return 'max_trades_period';
    if (reason.includes('Total SL')) return 'sl_guard';
    if (reason.includes('Total risk')) return 'risk_pct';
    return 'risk';
  }

  private serializeTrade(trade: Trade, currentPrice?: number) {
    const anyTrade = trade as any;
    const direction = (anyTrade.direction || anyTrade.side || 'LONG').toString().toUpperCase();
    const current = currentPrice ?? anyTrade.exit_price ?? anyTrade.entry_price ?? 0;
    const entry = anyTrade.entry_price ?? anyTrade.entry ?? 0;
    const risk = Math.abs(entry - (anyTrade.initial_sl ?? anyTrade.current_sl ?? anyTrade.sl_price ?? anyTrade.sl ?? entry)) || 1;
    const pnl = Number.isFinite(current) && Number.isFinite(entry)
      ? (direction === 'LONG' ? (current - entry) * (anyTrade.qty ?? 0) : (entry - current) * (anyTrade.qty ?? 0))
      : 0;
    const rrValue = Number.isFinite(current) && Number.isFinite(entry)
      ? ((direction === 'LONG' ? (current - entry) : (entry - current)) / risk)
      : 0;

    return {
      ...trade,
      direction,
      current_price: current,
      sl_price: anyTrade.current_sl ?? anyTrade.sl_price,
      tp_price: anyTrade.tp ?? anyTrade.tp_price,
      pnl: Number.isFinite(pnl) ? pnl : 0,
      rr: Number.isFinite(rrValue) ? rrValue : 0,
      paper_mode: this.config?.paper_mode,
      max_rr: anyTrade.max_rr_achieved ?? anyTrade.max_rr ?? 0,
      live_rr_sequence: this.config?.live_rr_sequence || [],
      exit_rr_sequence: this.config?.exit_rr_sequence || [],
      tp_mode: this.config?.tp_mode || 'fixed',
      tp_ratio: this.config?.tp_ratio || 2,
    };
  }

  private async broadcastTick() {
    const activeTrades = this.positionTracker.activeList();
    const trades = await Promise.all(activeTrades.map(async (trade) => {
      const current = await this.tickerCache.getPrice(trade.symbol);
      return this.serializeTrade(trade, current || trade.entry_price);
    }));
    const activePnl = trades.reduce((sum, trade) => sum + (trade.pnl || 0), 0);
    const balance = this.getBalance();
    const mode = this.config?.paper_mode;
    const startingBalance = mode
      ? this.config?.paper_starting_balance
      : this.config?.live_starting_balance;
    const realizedPnl = balance - (startingBalance ?? balance);
    const totalPnl = realizedPnl + activePnl;
    const totalRiskUsdt = this.positionTracker.totalRisk();

    this.broadcast('tick', {
      balance,
      total_pnl: totalPnl,
      total_risk_pct: balance > 0 ? (totalRiskUsdt / balance) * 100 : 0,
      total_sl_used: totalRiskUsdt,
      trades,
      gateState: this.gateState,
      paused: this.paused,
      scannerPaused: this.gateState === 'max_trades' || this.gateState === 'sl_guard' || this.gateState === 'max_trades_period' || this.paused,
      activeWindows: this.getActiveWindows(),
      rateLimit: this.getBinanceRateLimit(),
      monitoring: this.monitoringService.getMetrics(),
    });
  }

  private broadcastSnapshot(status: 'started' | 'stopped') {
    this.broadcast('session', {
      status,
      running: this.running,
      paused: this.paused,
      mode: this.config?.paper_mode ? 'PAPER' : 'LIVE',
      balance: this.getBalance(),
      config: this.config,
      gateState: this.gateState,
      scannerPaused: this.gateState === 'max_trades' || this.gateState === 'sl_guard' || this.gateState === 'max_trades_period',
      activeTrades: this.positionTracker.activeList().map((trade) => this.serializeTrade(trade)),
      scannerResults: this.lastScannerResults,
      activeWindows: this.getActiveWindows(),
      history: this.closedTrades.slice(0, 50).map((trade) => this.serializeTrade(trade, trade.exit_price)),
    });
  }

  async fetchBinanceBalance(): Promise<number> {
    if (!this.binanceClient) return 0;
    try {
      const response = await this.binanceClient.futures_account_balance();
      const usdtBalance = response.find((b: any) => b.asset === 'USDT');
      return parseFloat(usdtBalance?.balance || 0);
    } catch (error) { return 0; }
  }

  private updateBalance(trade: Trade) {
    if (this.config?.paper_mode) this.balancePaper += trade.pnl || 0;
    else this.balanceLive += trade.pnl || 0;
    if (this.onBalanceUpdate) this.onBalanceUpdate(this.getBalance(), trade.pnl || 0);
  }

  private getBalance(): number {
    return this.config?.paper_mode ? this.balancePaper : this.balanceLive;
  }

  getStatus() {
    return {
      running: this.running,
      paused: this.paused,
      mode: this.config?.paper_mode ? 'PAPER' : 'LIVE',
      balance_paper: this.balancePaper,
      balance_live: this.balanceLive,
      activeTrades: this.positionTracker.activeList().map((trade) => this.serializeTrade(trade)),
      total_risk: this.positionTracker.totalRisk(),
      scannerResults: this.lastScannerResults,
      activeWindows: this.getActiveWindows(),
      gateState: this.gateState,
      scannerPaused: this.gateState === 'max_trades' || this.gateState === 'sl_guard' || this.gateState === 'max_trades_period',
      history: this.closedTrades.slice(0, 50).map((trade) => this.serializeTrade(trade, trade.exit_price)),
    };
  }

  setPaused(paused: boolean) {
    this.paused = paused;
    this.logger.log(`Session ${paused ? 'PAUSED' : 'RESUMED'}`);
    this.broadcast('tick', { paused: this.paused });
  }

  updateConfig(config: SessionConfig) {
    this.config = config;
    this.logger.log('Session config updated (hot-reload)');
    this.broadcast('tick', { config: this.config });
  }

  updateRateLimit(used1m: number) {
    this.binanceRateLimit.used_1m = used1m;
  }

  getBinanceRateLimit() {
    return {
      used_weight_1m: this.binanceRateLimit.used_1m || 0,
      limit: 1200,
      last_update: new Date().toISOString(),
    };
  }
}
