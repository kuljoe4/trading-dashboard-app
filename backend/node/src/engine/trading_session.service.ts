import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
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
import { v4 as uuid } from 'uuid';
import { roundEight } from '../lib/math';

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
  private onBalanceUpdate: ((balance: number, pnl: number) => Promise<void> | void) | null = null;
  private onTradeUpdate: ((trade: Trade, balance: number) => Promise<void>) | null = null;
  private lastScannerResults: any[] = [];
  private lastVariantScannerResults: any[] = [];
  private closedTrades: Trade[] = [];
  private lastAnalyticsResult: any = null;
  private lastAnalyticsTradeCount = -1;
  private lastAnalyticsStartingBalance = -1;
  private lastClosedTradesStatsCount = -1;
  private cachedClosedTradesStats: Record<string, { pnl: number, count: number, hits: number }> = {};
  private gateState: string | null = null;
  private hibernating = false;
  private activeWindows: Map<string, any> = new Map();
  private mainLoopInterval: NodeJS.Timeout | null = null;
  private hotLoopInterval: NodeJS.Timeout | null = null;
  private balancePollInterval: NodeJS.Timeout | null = null;
  private lastScannerFullBroadcast = 0;
  private lastScannerResultsJson = '';
  private userDataWs: any = null;
  private listenKey: string | null = null;
  private listenKeyKeepAlive: NodeJS.Timeout | null = null;
  private listenerCount = 0;
  private dashboardCount = 0;

  private stats = {
    entryCount: 0,
    hitCount: 0,
  };
  // BOLT OPTIMIZATION: Cache for strategy configurations and signatures to avoid redundant allocations/stringifications
  private cachedStrategyConfigs: SessionConfig[] | null = null;
  private cachedScanSignatures: Map<SessionConfig, string> = new Map();

  private getStrategyLabel(config: Partial<SessionConfig> | null | undefined, index = 0): string {
    return (config?.strategy_label || (index === 0 ? 'Momentum Strategy' : `Strategy ${index + 1}`)).toString();
  }

  private getStrategyConfigs(): SessionConfig[] {
    if (this.cachedStrategyConfigs) return this.cachedStrategyConfigs;
    if (!this.config) return [];

    const base = { ...this.config, strategy_label: this.getStrategyLabel(this.config, 0), strategy_variants: [] } as SessionConfig;
    const variants = (this.config.strategy_variants || [])
      .filter((variant: any) => variant && variant.enabled !== false)
      .map((variant, index) => ({
        ...this.config,
        ...variant,
        strategy_label: this.getStrategyLabel(variant, index + 1),
        strategy_variants: [],
      } as SessionConfig));

    this.cachedStrategyConfigs = [base, ...variants];
    return this.cachedStrategyConfigs;
  }

  private scanSignature(config: SessionConfig): string {
    let signature = this.cachedScanSignatures.get(config);
    if (signature) return signature;

    signature = JSON.stringify({
      global_scanner_enabled: config.global_scanner_enabled,
      scan_interval: config.scan_interval,
      scan_lookback: config.scan_lookback,
      scan_pct_threshold: config.scan_pct_threshold,
      scan_min_volume_usdt: config.scan_min_volume_usdt,
      scan_mode: config.scan_mode,
      watchlist_size: config.watchlist_size,
      entry_side: config.entry_side,
      excluded_symbols: config.excluded_symbols,
      symbols: config.symbols,
      single_symbol_configs: config.single_symbol_configs,
    });

    this.cachedScanSignatures.set(config, signature);
    return signature;
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
  ) {}

  setWsBroadcaster(cb: (data: any) => void) {
    this.wsBroadcaster = cb;
  }

  isEcoMode(): boolean {
    return this.running && this.listenerCount === 0;
  }

  isGated(): boolean {
    return this.paused ||
      this.gateState === 'max_trades' ||
      this.gateState === 'sl_guard' ||
      this.gateState === 'max_trades_period' ||
      this.gateState === 'sleeping' ||
      this.gateState === 'risk_pct' ||
      this.gateState === 'tod_risk' ||
      this.gateState === 'risk';
  }

  setDashboardCount(count: number) {
    this.dashboardCount = count;
  }

  setListenerCount(count: number) {
    const prevCount = this.listenerCount;
    this.listenerCount = count;

    // BOLT ECO-MODE: Dynamically throttle loops if no one is watching
    if (this.running && this.config) {
      if (prevCount > 0 && count === 0) {
        const ecoMainMs = Math.max(15000, this.config.main_loop_interval_ms || 5000);
        const ecoHotMs = Math.max(5000, this.config.hot_loop_interval_ms || 2000);
        this.logger.log(`Switching to ECO-MODE: No active listeners. Throttling loops (Main: ${ecoMainMs}ms, Hot: ${ecoHotMs}ms).`);
        this.restartLoops(ecoHotMs, ecoMainMs);
      } else if (prevCount === 0 && count > 0) {
        this.logger.log('Exiting ECO-MODE: Listener detected. Restoring performance loops.');
        this.restartLoops(this.config.hot_loop_interval_ms || 2000, this.config.main_loop_interval_ms || 5000);
      }
    }
  }

  private restartLoops(hotMs: number, mainMs: number) {
    if (this.hotLoopInterval) clearInterval(this.hotLoopInterval);
    if (this.mainLoopInterval) clearInterval(this.mainLoopInterval);

    this.hotLoopInterval = setInterval(() => this.hotLoop(), hotMs);
    this.mainLoopInterval = setInterval(() => this.mainLoop(), mainMs);
  }

  setBalanceUpdateCallback(cb: (balance: number, pnl: number) => Promise<void> | void) {
    this.onBalanceUpdate = cb;
  }

  setTradeUpdateCallback(cb: (trade: Trade, balance: number) => Promise<void>) {
    this.onTradeUpdate = cb;
  }

  private broadcast(eventType: string, payload: any) {
    if (this.wsBroadcaster) {
      this.wsBroadcaster({ type: eventType, ...payload });
    }
  }

  async start(config: SessionConfig, binanceClient?: any, sessionId?: string, initialHistory: Trade[] = [], currentBalance?: number, openTrades: Trade[] = []) {
    this.running = true;
    this.stats = {
      entryCount: initialHistory.length,
      hitCount: initialHistory.filter(t => (t.pnl || 0) > 0).length,
    };
    this.paused = false;
    this.sessionId = sessionId || null;
    this.config = config;
    this.cachedStrategyConfigs = null;
    this.cachedScanSignatures.clear();
    this.binanceClient = binanceClient;

    const mode = config.trading_mode || (config.paper_mode ? 'paper' : 'live');

    if (currentBalance !== undefined) {
      if (mode === 'paper') {
        this.balancePaper = currentBalance;
        // Also initialize live balance for consistency in UI toggles, but separate from paper
        this.balanceLive = config.live_starting_balance || 0;
      } else {
        this.balanceLive = currentBalance;
        this.balancePaper = config.paper_starting_balance || 10000;
      }
    } else {
      this.balancePaper = config.paper_starting_balance || 10000;
      this.balanceLive = config.live_starting_balance || 0;
    }

    this.closedTrades = initialHistory;

    // Load resumed open trades into the position tracker
    if (openTrades.length > 0) {
      this.logger.verbose(`Resuming ${openTrades.length} open trades into the position tracker.`);
      for (const trade of openTrades) {
        this.positionTracker.addTrade(trade);
        this.stats.entryCount++;
      }
    }

    this.gateState = null;
    this.activeWindows.clear();

    // Wire services
    this.orderManager.setBinanceClient(binanceClient, mode === 'paper');
    this.marketFeed.setCandeCloseCallback(this.onCandleClose.bind(this));
    // Persistence for SL adjustments and other internal trade state changes
    this.positionTracker.setTradeUpdateCallback(async (trade) => {
      if (this.onTradeUpdate) await this.onTradeUpdate(trade, this.getBalance());
    });

    // Fetch live balance
    if (mode !== 'paper' && binanceClient) {
      try {
        const balance = await this.fetchBinanceBalance();
        this.balanceLive = balance;
        this.balancePaper = balance; // Sync paper balance too for display consistency
      } catch (error) {
        this.logger.warn(`Failed to fetch live balance: ${error instanceof Error ? error.message : String(error)}`);
      }

      // Start User Data Stream (WebSocket) for zero-weight real-time updates
      this.startUserDataStream().catch(err => {
        this.logger.error(`User Data Stream failed to start: ${err.message}. Falling back to 30s polling.`);
        // Fallback to balance poll (30s)
        this.balancePollInterval = setInterval(async () => {
          const balance = await this.fetchBinanceBalance();
          if (balance > 0) {
            this.balanceLive = balance;
            this.balancePaper = balance;
            if (this.onBalanceUpdate) this.onBalanceUpdate(this.getBalance(), 0);
          }
        }, 30000);
      });
    }

    // Start market feed
    await this.marketFeed.start(config);
    await this.momentumScanner.start(config);

    // Pro Loop Architecture
    // 1. Hot Loop: Exit monitoring & PnL updates
    const hotInterval = config.hot_loop_interval_ms || 5000;
    this.hotLoopInterval = setInterval(() => this.hotLoop(), hotInterval);

    // 2. Main Loop: Scanning & Entry
    const mainInterval = config.main_loop_interval_ms || 15000;
    this.mainLoopInterval = setInterval(() => this.mainLoop(), mainInterval);

    this.logger.log(`Session started | mode=${config.paper_mode ? 'PAPER' : 'LIVE'} | balance=${this.getBalance()} | hot=${hotInterval}ms | main=${mainInterval}ms`);
    this.broadcastSnapshot('started');

    return { status: 'started' };
  }

  async stop() {
    this.running = false;
    this.paused = false;
    if (this.mainLoopInterval) clearInterval(this.mainLoopInterval);
    if (this.hotLoopInterval) clearInterval(this.hotLoopInterval);
    if (this.balancePollInterval) clearInterval(this.balancePollInterval);
    if (this.listenKeyKeepAlive) clearInterval(this.listenKeyKeepAlive);

    if (this.userDataWs) {
      try {
        this.userDataWs.disconnect();
      } catch (e) {}
      this.userDataWs = null;
    }

    if (this.listenKey && this.binanceClient) {
      try {
        await this.binanceClient.restAPI.userDataStreamsApi.closeUserDataStream(this.listenKey);
      } catch (e) {}
      this.listenKey = null;
    }

    // Properly close active positions on session stop
    const active = this.positionTracker.activeList();
    for (const trade of active) {
      const currentPrice = await this.tickerCache.getPrice(trade.symbol);
      const exitPrice = currentPrice ?? trade.last_price ?? trade.entry_price;
      const result = await this.positionTracker.closeTrade(trade.symbol, exitPrice, 'SESSION_TERMINATED', this.config!);
      if (result.exitOccurred && result.trade) {
          if ((result.trade.pnl || 0) > 0) this.stats.hitCount++;
        this.closedTrades.push(result.trade);
        await this.updateBalance(result.trade);
        if (this.onTradeUpdate) await this.onTradeUpdate(result.trade, this.getBalance());
      } else {
        // Fallback if the engine could not close trade normally
        trade.status = 'CLOSED';
        trade.exit_ts = new Date();
        trade.exit_reason = 'SESSION_TERMINATED';
        trade.exit_price = exitPrice;
        // BOLT: Manually calculate PnL for fallback closure to ensure balance integrity
        const pnlPoints = trade.direction === 'LONG' ? exitPrice - trade.entry_price : trade.entry_price - exitPrice;
        trade.pnl = roundEight(pnlPoints * trade.qty);

        this.closedTrades.push(trade);
        await this.updateBalance(trade);
        if (this.onTradeUpdate) await this.onTradeUpdate(trade, this.getBalance());
        this.positionTracker.removeTrade(trade.symbol);
      }
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

    // BOLT ECO-MODE: Skip hot loop entirely if no one is listening AND no positions are open
    if (this.listenerCount === 0 && this.positionTracker.activeCount() === 0) {
      this.monitoringService.recordHotLoop(0);
      return;
    }

    const start = performance.now();
    try {
      await this.checkExits();
      this.broadcastTick();
      this.monitoringService.recordHotLoop(performance.now() - start);
    } catch (error) {
      if (this.config.debug_mode) {
        this.logger.debug(`Hot loop error: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  /**
   * Pro Main Loop: 2000ms
   * Handles lower-frequency tasks: Market scanning and trade entry
   */
  private async mainLoop() {
    if (!this.running || !this.config) return;

    const activeTrades = this.positionTracker.activeList();
    const prevGateState = this.gateState;
    const isInsideWindow = this.isInsideTradingWindow();

    // 1. Evaluate Risk Gates
    const riskResult = this.riskEngine.canEnter(
      activeTrades,
      this.closedTrades,
      this.getBalance(),
      'DUMMY', // Global check
      this.config!,
      this.positionTracker.totalRisk(),
    );

    // 2. Determine Gate State
    const hasUnscheduledMonitors = this.config.single_symbol_configs?.some(sc => sc.enabled && sc.follow_schedule === false);

    if (!isInsideWindow && !hasUnscheduledMonitors) {
      this.gateState = 'sleeping';
    } else if (!riskResult.canEnter) {
      // Filter out per-symbol reasons for global gate state
      if (!riskResult.reason.includes('Max open trades for')) {
        this.gateState = this.mapGateState(riskResult.reason);
      }
    } else {
      this.gateState = null;
    }

    // 3. Deep Sleep (Hibernation) Management
    // If gated and no active trades, we can shut down all connections completely.
    const shouldHibernate = this.isGated() && activeTrades.length === 0;

    if (shouldHibernate && !this.hibernating) {
      await this.enterHibernation(riskResult.reason || 'Session gated and idle');
    } else if (!shouldHibernate && this.hibernating) {
      await this.exitHibernation();
    }

    // 4. Broadcast and handle gate changes
    if (this.gateState !== prevGateState) {
      this.broadcast('gate', {
        gateState: this.gateState,
        reason: riskResult.reason,
        scannerPaused: this.gateState === 'max_trades' || this.gateState === 'sl_guard' || this.gateState === 'max_trades_period'
      });

      // BOLT: When gating status changes, update the market feed watchlist
      if (!this.hibernating) {
        this.marketFeed.updateWatchlist(this.config).catch(() => {});
      }
    }

    // 5. Resource Throttling & Early Returns
    const isGated = this.isGated();
    
    if (isGated || this.hibernating) {
      // RESOURCE REDUCTION: When gated or paused, we completely skip the momentum scan and entry processing.
      // If gated due to 'sleeping' (outside windows), the market feed and scanner are fully stopped.
      // This saves CPU cycles, memory allocations from new candle data, and Binance API weight.

      // Still broadcast cached results to keep UI from flickering/clearing if listeners are active.
      if (this.listenerCount > 0) {
        const now = Date.now();
        const isFullBroadcast = now - this.lastScannerFullBroadcast > 30000;
        if (isFullBroadcast) this.lastScannerFullBroadcast = now;

        this.broadcast('scanner', {
          count: this.lastScannerResults.length,
          hibernating: this.hibernating,
          opportunities: this.lastScannerResults.slice(0, 5).map(o => {
            if (isFullBroadcast) return o;
            const { history, ...rest } = o;
            return rest;
          }),
          variant_opportunities: this.lastVariantScannerResults.map(v => ({
            ...v,
            opportunities: v.opportunities.slice(0, 5).map((o: any) => {
               if (isFullBroadcast) return o;
               const { history, ...rest } = o;
               return rest;
            })
          })),
          activeWindows: this.getActiveWindows(),
        });
      }
      return;
    }

    const start = performance.now();
    try {
      const strategyConfigs = this.getStrategyConfigs();
      const opportunitiesBySignature = new Map<string, any[]>();
      let primaryOpportunities: any[] = [];

      for (const strategyConfig of strategyConfigs) {
        const signature = this.scanSignature(strategyConfig);
        if (!opportunitiesBySignature.has(signature)) {
          opportunitiesBySignature.set(signature, this.momentumScanner.scan(strategyConfig));
        }
        if (primaryOpportunities.length === 0) {
          primaryOpportunities = opportunitiesBySignature.get(signature) || [];
        }
      }

      const scannerData = strategyConfigs.map(config => ({
        strategy_label: config.strategy_label,
        opportunities: opportunitiesBySignature.get(this.scanSignature(config)) || [],
      }));

      // BOLT OPTIMIZATION: Only update and broadcast scanner results for UI if there are active dashboard listeners
      if (this.dashboardCount > 0) {
        const baseConfig = strategyConfigs[0];
        const opportunitiesWithSignals = primaryOpportunities.slice(0, 10).map((opp) => {
          const signalResult = this.signalEngine.checkEntry(
            opp.symbol,
            baseConfig,
            baseConfig.scan_interval || '1m',
            opp.direction.toUpperCase() as any,
            'entry'
          );
          return { ...opp, signalResult };
        });

        this.updateScannerResults(opportunitiesWithSignals);
        this.lastVariantScannerResults = scannerData;

        const now = Date.now();
        const isFullBroadcast = now - this.lastScannerFullBroadcast > 30000;

        // BOLT: Efficiently check if scanner results actually changed to save egress
        const nextResultsJson = JSON.stringify(this.lastScannerResults.map(o => o.symbol + o.direction + o.score));
        const resultsChanged = nextResultsJson !== this.lastScannerResultsJson;
        this.lastScannerResultsJson = nextResultsJson;

        // BOLT: Only broadcast scanner results if they changed or during heartbeat
        // We also check for significant price changes to keep opportunities "realtime"
        const priceChanged = this.lastScannerResults.some((o, i) => {
          const prev = (this.lastTickData as any)?.scannerResults?.[i];
          return prev && Math.abs(o.price - prev.price) / prev.price > 0.001; // 0.1% change
        });

        if (isFullBroadcast || resultsChanged || priceChanged) {
          if (isFullBroadcast) this.lastScannerFullBroadcast = now;
          this.lastScannerResultsJson = nextResultsJson;

          this.broadcast('scanner', {
            count: this.lastScannerResults.length,
            opportunities: this.lastScannerResults.slice(0, 5).map(o => {
              if (isFullBroadcast) return o;
              const { history, ...rest } = o; // Skip history (sparkline data) in delta updates
              return rest;
            }),
            variant_opportunities: this.lastVariantScannerResults.map(v => ({
              ...v,
              opportunities: v.opportunities.slice(0, 5).map((o: any) => {
                 if (isFullBroadcast) return o;
                 const { history, ...rest } = o;
                 return rest;
              })
            })),
            activeWindows: this.getActiveWindows(),
          });
        }
      } else {
        // Still update internal state for history tracking if needed,
        // but we can skip the expensive formatting and broadcasting
        this.refreshActiveWindows(primaryOpportunities);
      }

      for (const strategyConfig of strategyConfigs) {
        const opportunities = opportunitiesBySignature.get(this.scanSignature(strategyConfig)) || [];
        await this.processEntries(opportunities, strategyConfig);
      }
      this.monitoringService.recordMainLoop(performance.now() - start);
    } catch (error) {
      if (this.config.debug_mode) {
        this.logger.debug(`Main loop error: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  private async checkExits() {
    if (this.positionTracker.activeCount() === 0) return;

    const activeTrades = this.positionTracker.activeList();
    for (const trade of activeTrades) {
      const currentPrice = this.tickerCache.getPrice(trade.symbol);
      if (!currentPrice) continue;

      // 1. Ratchet SL if applicable
      const tradeConfig = { ...this.config!, ...((trade as any).strategy_config || {}) } as SessionConfig;
      this.positionTracker.checkRrSequenceAdjustments(trade.symbol, currentPrice, tradeConfig);

      // 2. Check Exit Conditions (SL/TP/Signals)
      const exitInterval = tradeConfig.scan_interval || '1m';
      const exitCondition = this.positionTracker.checkExitConditions(trade.symbol, currentPrice, tradeConfig, exitInterval);

      if (exitCondition?.exitOccurred) {
        const result = await this.positionTracker.closeTrade(trade.symbol, currentPrice, exitCondition.exitReason, tradeConfig);
        if (result.exitOccurred && result.trade) {
          if ((result.trade.pnl || 0) > 0) this.stats.hitCount++;
          const prevBalancePaper = this.balancePaper;
          const prevBalanceLive = this.balanceLive;
          try {
            await this.updateBalance(result.trade);
            this.closedTrades.unshift(result.trade);
            if (this.onTradeUpdate) await this.onTradeUpdate(result.trade, this.getBalance());

            // Trigger watchlist update to potentially remove closed trade symbol
            this.marketFeed.updateWatchlist(tradeConfig).catch(() => {});

            const analytics = this.analyticsService.calculateAnalytics(this.closedTrades as any, this.config?.paper_mode ? this.config?.paper_starting_balance : this.config?.live_starting_balance);
            this.lastAnalyticsResult = analytics;

            this.broadcast('trade_event', {
              event: 'closed',
              symbol: result.trade.symbol, // Fix: Added symbol for frontend log
              reason: exitCondition.exitReason,
              trade: this.serializeTrade(result.trade, currentPrice),
              pnl: result.trade.pnl,
              stats: this.stats,
              analytics: {
                maxDrawdown: Number(analytics.maxDrawdown.toFixed(2)),
                maxDrawdownPct: Number(analytics.maxDrawdownPct.toFixed(2)),
                overallWinRate: Number(analytics.overallWinRate.toFixed(2)),
                cumulativePnL: analytics.cumulativePnL.slice(-20).map((p: any) => ({ ...p, pnl: Number(p.pnl.toFixed(2)) })),
              }
            });
          } catch (err) {
            this.logger.error(`Failed to persist closed trade ${trade.symbol}: ${err instanceof Error ? err.message : String(err)}`);
            await this.rollbackTradeClosure(result.trade, prevBalancePaper, prevBalanceLive);
            throw err;
          }
        }
      }
    }
  }

  private async onCandleClose(symbol: string) {
    if (!this.running || !this.config) return;
    if (this.config.debug_mode) {
      this.logger.verbose(`Candle closed for ${symbol}`);
    }
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
      signalResult: o.signalResult,
    }));
    this.refreshActiveWindows(this.lastScannerResults);
  }

  private async processEntries(opportunities: any[], strategyConfig: SessionConfig = this.config!) {
    const strategyLabel = this.getStrategyLabel(strategyConfig);
    if (this.config?.debug_mode) {
      this.logger.verbose(`Processing entries. Label: ${strategyLabel}, Config Label: ${strategyConfig.strategy_label}`);
    }

    // BOLT OPTIMIZATION: Pre-map symbol configs for O(1) lookup in the entry loop
    const symbolConfigs = strategyConfig.single_symbol_configs;
    const symbolConfigMap = (symbolConfigs && symbolConfigs.length > 0)
      ? new Map(symbolConfigs.map(sc => [sc.symbol, sc]))
      : null;

    for (const opp of opportunities) {
      if (this.positionTracker.hasSymbol(opp.symbol)) continue;

      const sc = symbolConfigMap?.get(opp.symbol);
      const symbolConfig = (sc?.use_custom_config && sc.custom_config)
        ? { ...strategyConfig, ...sc.custom_config } as SessionConfig
        : strategyConfig;

      const signalResult = this.signalEngine.checkEntry(
        opp.symbol,
        strategyConfig,
        strategyConfig.scan_interval || '1m',
        opp.direction.toUpperCase() as any,
        'entry'
      );

      if (!signalResult.allFired) continue;

      if (this.config?.debug_mode) {
        this.logger.log(`${strategyLabel} | ${opp.symbol}: ALL SIGNALS FIRED! Proceeding to risk checks...`);
      }

      const activeTrades = this.positionTracker.activeList();
      const riskResult = this.riskEngine.canEnter(
        activeTrades,
        this.closedTrades,
        this.getBalance(),
        opp.symbol,
        symbolConfig,
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

      const price = this.tickerCache.getPrice(opp.symbol);
      if (!price) continue;

      const lookback = this.klineStore.getLookbackExtremes(opp.symbol, symbolConfig.sl_lookback_timeframe || '1m', symbolConfig.sl_lookback_period || 20);
      const slPrice = this.riskEngine.computeSl(price, opp.direction.toUpperCase() as any, symbolConfig, lookback.minLow, lookback.maxHigh);
      const qty = this.riskEngine.computePositionSize(this.getBalance(), price, slPrice, opp.direction.toUpperCase() as any, symbolConfig);
      
      if (qty <= 0) continue;

      const tpPrice = this.riskEngine.computeTp(price, slPrice, opp.direction.toUpperCase() as any, symbolConfig);

      this.logger.log(`${opp.symbol}: Sending ${opp.direction} order (Qty: ${qty.toFixed(4)})`);
      
      const trade = await this.orderManager.enter(
        this.sessionId || uuid().substring(0, 8),
        opp.symbol,
        opp.direction.toUpperCase() as any,
        price,
        qty,
        slPrice,
        tpPrice,
        {
          strategy_label: strategyLabel,
          strategy_config: strategyConfig,
        },
      );

      if (trade) {
        this.positionTracker.addTrade(trade);
        this.stats.entryCount++;
        if (this.onTradeUpdate) await this.onTradeUpdate(trade, this.getBalance());

        // Trigger watchlist update to ensure kline stream for new trade
        this.marketFeed.updateWatchlist(strategyConfig).catch(() => {});

        this.broadcast('trade_event', { 
          event: 'opened', 
          symbol: opp.symbol,
          trade: this.serializeTrade(trade, price),
          stats: this.stats
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

  private isInsideTradingWindow(): boolean {
    if (!this.config?.trading_windows?.length) return true;

    const now = new Date();
    const currentTime = now.getUTCHours() * 100 + now.getUTCMinutes();

    return this.config.trading_windows.some(window => {
      const start = parseInt(window.start.replace(':', ''), 10);
      const end = parseInt(window.end.replace(':', ''), 10);

      if (start <= end) {
        return currentTime >= start && currentTime <= end;
      } else {
        // Over-midnight window (e.g., 22:00 to 02:00)
        return currentTime >= start || currentTime <= end;
      }
    });
  }

  private async enterHibernation(reason: string) {
    // MAXIMUM RESOURCE REDUCTION (Deep Sleep): Stop all high-frequency data streams and scanning
    this.logger.log(`Entering DEEP SLEEP (Hibernation) - Stopping all connections and clearing memory. Reason: ${reason}`);
    this.hibernating = true;
    await this.marketFeed.stop();
    await this.momentumScanner.stop();

    // BOLT: Clear memory-heavy stores during Deep Sleep to reduce RAM usage
    this.klineStore.clear();
    this.tickerCache.clear();

    this.broadcast('gate', {
      gateState: this.gateState,
      reason: reason,
      hibernating: true
    });
  }

  private async exitHibernation() {
    this.logger.log('Exiting DEEP SLEEP (Hibernation) - Restarting connections and warming up...');
    this.hibernating = false;
    if (this.config) {
      // Market feed will automatically seed tickers and rebuild kline streams
      await this.marketFeed.start(this.config);
      await this.momentumScanner.start(this.config);
    }
    this.broadcast('gate', {
      gateState: this.gateState,
      hibernating: false
    });
  }

  private mapGateState(reason: string): string {
    if (reason.includes('max open trades')) return 'max_trades';
    if (reason.includes('Max trades per period')) return 'max_trades_period';
    if (reason.includes('Total SL')) return 'sl_guard';
    if (reason.includes('Total risk')) return 'risk_pct';
    if (reason.includes('Historical performance')) return 'tod_risk';
    return 'risk';
  }

  private serializeTrade(trade: Trade, currentPrice?: number, minimal = false) {
    const round = (val: any, p = 8) => (val !== undefined && Number.isFinite(val)) ? Number(val.toFixed(p)) : val;
    const anyTrade = trade as any;
    const direction = (anyTrade.direction || anyTrade.side || 'LONG').toString().toUpperCase();
    const entry = anyTrade.entry_price ?? anyTrade.entry ?? 0;

    const currentPriceValid = currentPrice !== undefined && Number.isFinite(currentPrice) && currentPrice > 0;
    const current = currentPriceValid ? currentPrice : anyTrade.exit_price ?? anyTrade.last_price ?? entry;
    if (currentPriceValid) {
      anyTrade.last_price = currentPrice;
    }

    let pnl = undefined;
    let rrValue = undefined;

    if (current !== undefined && Number.isFinite(current) && Number.isFinite(entry)) {
      pnl = roundEight(direction === 'LONG' ? (current - entry) * (anyTrade.qty ?? 0) : (entry - current) * (anyTrade.qty ?? 0));
      anyTrade.pnl = pnl; // BOLT: Persist current PnL on the trade object for O(1) access in stats
      const risk = Math.abs(entry - (anyTrade.initial_sl ?? anyTrade.current_sl ?? anyTrade.sl_price ?? anyTrade.sl ?? entry)) || 1;
      rrValue = (direction === 'LONG' ? (current - entry) : (entry - current)) / risk;
    }

    if (minimal) {        return {
        id: trade.id,
        symbol: trade.symbol,
        strategy_label: anyTrade.strategy_label || this.getStrategyLabel(anyTrade.strategy_config || this.config),
        current_price: round(current ?? entry),
        sl_price: round(anyTrade.current_sl ?? anyTrade.sl_price),
        tp_price: round(anyTrade.tp ?? anyTrade.tp_price),
        pnl: round(pnl, 2),
        rr: round(rrValue, 4),
        max_rr: round(anyTrade.max_rr_achieved ?? anyTrade.max_rr ?? 0, 4),
        direction: (anyTrade.direction || anyTrade.side || 'LONG').toString().toUpperCase(),
        entry_price: round(entry),
        qty: round(anyTrade.qty ?? 0),
        paper_mode: this.config?.paper_mode,
        exit_signals_status: anyTrade.exit_signals_status || {},
        sl_adjustments: anyTrade.sl_adjustments || [],
        live_rr_sequence: anyTrade.strategy_config?.live_rr_sequence || this.config?.live_rr_sequence || [],
        exit_rr_sequence: anyTrade.strategy_config?.exit_rr_sequence || this.config?.exit_rr_sequence || [],
        tp_mode: anyTrade.strategy_config?.tp_mode || this.config?.tp_mode || 'fixed',
        tp_ratio: anyTrade.strategy_config?.tp_ratio || this.config?.tp_ratio || 2,
        _delta: true,
        };    }

    return {
      ...trade,
      direction,
      current_price: round(current ?? entry),
      sl_price: round(anyTrade.current_sl ?? anyTrade.sl_price),
      tp_price: round(anyTrade.tp ?? anyTrade.tp_price),
      pnl: round(pnl, 2),
      rr: round(rrValue, 4),
      paper_mode: this.config?.paper_mode,
      trading_mode: this.config?.trading_mode || (this.config?.paper_mode ? 'paper' : 'live'),
      max_rr: round(anyTrade.max_rr_achieved ?? anyTrade.max_rr ?? 0, 4),
      strategy_label: anyTrade.strategy_label || this.getStrategyLabel(anyTrade.strategy_config || this.config),
      strategy_config: anyTrade.strategy_config,
      live_rr_sequence: anyTrade.strategy_config?.live_rr_sequence || this.config?.live_rr_sequence || [],
      exit_rr_sequence: anyTrade.strategy_config?.exit_rr_sequence || this.config?.exit_rr_sequence || [],
      exit_signal_logic: anyTrade.strategy_config?.exit_signal_logic || this.config?.exit_signal_logic || 'any',
      tp_mode: anyTrade.strategy_config?.tp_mode || this.config?.tp_mode || 'fixed',
      tp_ratio: anyTrade.strategy_config?.tp_ratio || this.config?.tp_ratio || 2,
    };
  }

  private lastTickData: any = null;
  private lastTickTime = 0;

  private broadcastTick() {
    // RESOURCE REDUCTION: Skip heavy tick data construction and broadcast if no one is listening.
    // This is the primary driver of egress savings when the tab is in the background.
    if (this.listenerCount === 0) return;

    const activeTrades = this.positionTracker.activeList();
    const now = Date.now();
    const isHeartbeat = !this.lastTickData || (now - this.lastTickTime > 10000);

    // BOLT OPTIMIZATION: Index last tick data for O(1) lookup during price fallbacks
    const prevTickMap = new Map<string, any>();
    if (this.lastTickData?.trades) {
      for (const t of this.lastTickData.trades) {
        prevTickMap.set(t.symbol, t);
      }
    }

    // BOLT: Single-pass synchronous processing of trades
    const trades: any[] = [];
    const len = activeTrades.length;
    let anyPriceChangedSignificant = false;
    for (let i = 0; i < len; i++) {
      const trade = activeTrades[i];
      let current = this.tickerCache.getPrice(trade.symbol);
      const prevTrade = prevTickMap.get(trade.symbol);
      
      // Fallback to previous price if cache miss to prevent PnL flickering
      if (current === null && prevTrade) {
        current = prevTrade.current_price;
      }
      
      // BOLT: Use minimal serialization for ticks (delta updates) to save network egress
      const serialized = this.serializeTrade(trade, current ?? undefined, true);

      let tradeChanged = false;

      // DELTA OPTIMIZATION: Only send fields if they actually changed since last tick
      // BOLT: Replace slow JSON.stringify checks with length and reference checks where possible
      if (prevTrade && !isHeartbeat) {
        if (serialized.sl_price === prevTrade.sl_price) delete (serialized as any).sl_price; else tradeChanged = true;
        if (serialized.max_rr === prevTrade.max_rr) delete (serialized as any).max_rr; else tradeChanged = true;

        // Strip large static/semi-static fields in delta updates if they match previous
        // BOLT: Use JSON.stringify for complex state to ensure data integrity during delta ticks
        if (JSON.stringify(serialized.sl_adjustments) === JSON.stringify(prevTrade.sl_adjustments)) delete (serialized as any).sl_adjustments; else tradeChanged = true;
        if (JSON.stringify(serialized.exit_signals_status) === JSON.stringify(prevTrade.exit_signals_status)) delete (serialized as any).exit_signals_status; else tradeChanged = true;
        if (JSON.stringify(serialized.live_rr_sequence) === JSON.stringify(prevTrade.live_rr_sequence)) delete (serialized as any).live_rr_sequence; else tradeChanged = true;
        if (JSON.stringify(serialized.exit_rr_sequence) === JSON.stringify(prevTrade.exit_rr_sequence)) delete (serialized as any).exit_rr_sequence; else tradeChanged = true;

        if (serialized.tp_mode === prevTrade.tp_mode) delete (serialized as any).tp_mode; else tradeChanged = true;
        if (serialized.tp_ratio === prevTrade.tp_ratio) delete (serialized as any).tp_ratio; else tradeChanged = true;

        // BOLT: Prune static identifiers that only need to be sent once or on heartbeat
        if (serialized.direction === prevTrade.direction) delete (serialized as any).direction; else tradeChanged = true;
        if (serialized.entry_price === prevTrade.entry_price) delete (serialized as any).entry_price; else tradeChanged = true;
        if (serialized.qty === prevTrade.qty) delete (serialized as any).qty; else tradeChanged = true;
        if (serialized.paper_mode === prevTrade.paper_mode) delete (serialized as any).paper_mode; else tradeChanged = true;
        if (serialized.strategy_label === prevTrade.strategy_label) delete (serialized as any).strategy_label; else tradeChanged = true;

        // Even RR can be omitted if it hasn't moved significantly
        if (serialized.rr !== undefined && prevTrade.rr !== undefined && Math.abs(serialized.rr - prevTrade.rr) < 0.01) {
           delete (serialized as any).rr;
        } else {
           anyPriceChangedSignificant = true;
           tradeChanged = true;
        }

        // Also check PnL movement for "Quiet Ticks"
        if (serialized.pnl !== undefined && prevTrade.pnl !== undefined && Math.abs(serialized.pnl - prevTrade.pnl) > 0.05) {
           anyPriceChangedSignificant = true;
           tradeChanged = true;
        }

        // If price hasn't moved much, we can omit it too
        if (serialized.current_price !== undefined && prevTrade.current_price !== undefined && Math.abs(serialized.current_price - prevTrade.current_price) / prevTrade.current_price < 0.0001) {
           delete (serialized as any).current_price;
        } else {
           tradeChanged = true;
        }
      } else {
        anyPriceChangedSignificant = true;
        tradeChanged = true;
      }

      // BOLT DEEP DELTA: Only include the trade object in the tick if it actually changed!
      if (tradeChanged || isHeartbeat) {
        trades.push(serialized);
      }
    }

    // BOLT BUGFIX: Calculate total PnL from all active trades, not just those in the delta update!
    let activePnl = 0;
    for (const t of activeTrades) {
      activePnl += (t.pnl || 0);
    }

    const balance = this.getBalance();
    const mode = this.config?.trading_mode || (this.config?.paper_mode ? 'paper' : 'live');
    const startingBalance = (mode === 'paper')
      ? this.config?.paper_starting_balance
      : this.config?.live_starting_balance;
    const realizedPnl = roundEight(balance - (startingBalance ?? balance));
    const totalPnl = roundEight(realizedPnl + activePnl);
    const totalRiskUsdt = this.positionTracker.totalRisk();

    // BOLT OPTIMIZATION: Cache analytics results to avoid O(N log N) sorting in the 1s hot loop.
    if (!this.lastAnalyticsResult ||
        this.closedTrades.length !== this.lastAnalyticsTradeCount ||
        startingBalance !== this.lastAnalyticsStartingBalance) {

      this.lastAnalyticsResult = this.analyticsService.calculateAnalytics(this.closedTrades as any, startingBalance);
      this.lastAnalyticsTradeCount = this.closedTrades.length;
      this.lastAnalyticsStartingBalance = startingBalance || 0;
    }

    const monitoring = this.monitoringService.getMetrics();

    // BOLT: Optimized single-pass variant stats calculation
    const variantStats = this.calculateVariantStats(activeTrades);

    const tickData: any = {
      balance: Number(balance.toFixed(2)),
      total_pnl: Number(totalPnl.toFixed(2)),
      total_risk_pct: Number((balance > 0 ? (totalRiskUsdt / balance) * 100 : 0).toFixed(2)),
      total_sl_used: Number(totalRiskUsdt.toFixed(2)),
      trades,
      variant_stats: variantStats,
      gateState: this.gateState,
      hibernating: this.hibernating,
      paused: this.paused,
      scannerPaused: this.gateState === 'max_trades' || this.gateState === 'sl_guard' || this.gateState === 'max_trades_period' || this.paused,
      activeWindows: this.getActiveWindows(),
      rateLimit: this.getBinanceRateLimit(),
      stats: this.stats,
      monitoring,
      isEcoMode: this.isEcoMode(),
    };

    const hasActiveTrades = trades.length > 0;

    // BOLT DELTA: Only include analytics in periodic heartbeats to save massive JSON payload
    // Analytics only changes on trade closure, which is already handled via separate event.
    const isAnalyticsHeartbeat = !this.lastTickData || (now - this.lastTickTime > 60000);
    if (isAnalyticsHeartbeat) {
       tickData.analytics = {
         maxDrawdown: Number(this.lastAnalyticsResult.maxDrawdown.toFixed(2)),
         maxDrawdownPct: Number(this.lastAnalyticsResult.maxDrawdownPct.toFixed(2)),
         overallWinRate: Number(this.lastAnalyticsResult.overallWinRate.toFixed(2)),
         cumulativePnL: this.lastAnalyticsResult.cumulativePnL.slice(-20).map((p: any) => ({
            ...p,
            pnl: Number(p.pnl.toFixed(2))
         })),
       };
    }

    // BOLT "QUIET TICKS": Only broadcast if significant data changed or as a heartbeat (30s)
    // Heartbeat is increased to 30s for Quiet Ticks when no active trades exist
    const heartbeatInterval = hasActiveTrades ? 10000 : 30000;
    let shouldBroadcast = !this.lastTickData || (now - this.lastTickTime > heartbeatInterval);
    if (shouldBroadcast) (tickData as any)._heartbeat = true;

    if (!shouldBroadcast) {
      const prevTrades = this.lastTickData?.trades || [];
      const tradesChanged = trades.length !== prevTrades.length || anyPriceChangedSignificant;
      
      const pnlChanged = Math.abs(totalPnl - (this.lastTickData?.total_pnl || 0)) > 0.1;
      const monitoringChanged = Math.abs((monitoring?.system?.cpu_usage || 0) - (this.lastTickData?.monitoring?.system?.cpu_usage || 0)) > 8;
      const gateChanged = tickData.gateState !== this.lastTickData?.gateState;
      const statsChanged = JSON.stringify(tickData.stats) !== JSON.stringify(this.lastTickData?.stats);

      if (tradesChanged || pnlChanged || monitoringChanged || gateChanged || statsChanged) {
        shouldBroadcast = true;
      }
    }

    if (shouldBroadcast) {
      const finalPayload = { ...tickData };

      // BOLT DELTA: Further prune final payload by removing unchanged nested objects
      if (this.lastTickData && !isHeartbeat) {
         if (JSON.stringify(finalPayload.stats) === JSON.stringify(this.lastTickData.stats)) delete finalPayload.stats;
         if (JSON.stringify(finalPayload.activeWindows) === JSON.stringify(this.lastTickData.activeWindows)) delete finalPayload.activeWindows;
         if (finalPayload.gateState === this.lastTickData.gateState) delete finalPayload.gateState;
         if (finalPayload.paused === this.lastTickData.paused) delete finalPayload.paused;
         if (JSON.stringify(finalPayload.monitoring) === JSON.stringify(this.lastTickData.monitoring)) delete finalPayload.monitoring;
      }

      this.broadcast('tick', finalPayload);
      this.lastTickData = tickData;
      this.lastTickTime = now;
    }
  }

  private broadcastSnapshot(status: 'started' | 'stopped') {
    const tradingMode = this.config?.trading_mode || (this.config?.paper_mode ? 'paper' : 'live');
    this.broadcast('session', {
      status,
      running: this.running,
      paused: this.paused,
      mode: this.config?.paper_mode ? 'PAPER' : 'LIVE',
      tradingMode,
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
      this.monitoringService.incrementApiRequests();
      const response = await this.binanceClient.restAPI.accountApi.futuresAccountBalanceV2();
      // Handle the official SDK response format (often it's an array of objects)
      const data = response.data || response;
      const usdtBalance = Array.isArray(data) ? data.find((b: any) => b.asset === 'USDT') : null;
      return usdtBalance ? parseFloat(usdtBalance.balance || 0) : 0;
    } catch (error) {
      this.logger.error(`Balance fetch failed: ${error instanceof Error ? error.message : String(error)}`);
      return 0;
    }
  }

  private async updateBalance(trade: Trade) {
    const mode = this.config?.trading_mode || (this.config?.paper_mode ? 'paper' : 'live');
    if (mode === 'paper') {
      this.balancePaper = roundEight(this.balancePaper + (trade.pnl || 0));
    } else if (this.binanceClient) {
      // For real modes, fetch actual balance to account for fees and slippage
      const balance = await this.fetchBinanceBalance();
      if (balance > 0) {
        this.balanceLive = balance;
        this.balancePaper = balance;
      } else {
        // Fallback to manual calculation if API fails
        this.balanceLive = roundEight(this.balanceLive + (trade.pnl || 0));
        this.balancePaper = roundEight(this.balancePaper + (trade.pnl || 0));
      }
    }

    if (this.onBalanceUpdate) this.onBalanceUpdate(this.getBalance(), trade.pnl || 0);
  }

  private getBalance(): number {
    return this.config?.paper_mode ? this.balancePaper : this.balanceLive;
  }

  private async rollbackTradeClosure(trade: Trade, prevBalancePaper: number, prevBalanceLive: number) {
    this.logger.warn(`Rolling back trade closure for ${trade.symbol} due to persistence failure.`);

    // 1. Restore balance
    this.balancePaper = prevBalancePaper;
    this.balanceLive = prevBalanceLive;

    // 2. Remove from closed trades if it was unshifted
    if (this.closedTrades[0] && this.closedTrades[0].id === trade.id) {
      this.closedTrades.shift();
    }

    // 3. Re-add to position tracker
    trade.status = 'OPEN';
    this.positionTracker.addTrade(trade);
        this.stats.entryCount++;

    // 4. Notify UI of balance revert
    if (this.onBalanceUpdate) {
      await this.onBalanceUpdate(this.getBalance(), 0);
    }
  }

  private async startUserDataStream() {
    if (!this.binanceClient) return;

    try {
      this.monitoringService.incrementApiRequests();
      const response = await this.binanceClient.restAPI.userDataStreamsApi.startUserDataStream();
      this.listenKey = response.data.listenKey;

      this.userDataWs = await this.binanceClient.websocketStreams.connect();

      this.userDataWs.on('message', async (msg: any) => {
        try {
          const data = typeof msg === 'string' ? JSON.parse(msg) : msg;

          // ACCOUNT_UPDATE event contains balance updates
          if (data.e === 'ACCOUNT_UPDATE' && data.a && data.a.B) {
            const usdtBalance = data.a.B.find((b: any) => b.a === 'USDT');
            if (usdtBalance) {
              const newBalance = parseFloat(usdtBalance.wb); // Wallet Balance
              this.logger.log(`[WS] Account Balance Update: ${newBalance}`);
              this.balanceLive = newBalance;
              this.balancePaper = newBalance;
              if (this.onBalanceUpdate) await this.onBalanceUpdate(this.getBalance(), 0);
            }
          }
        } catch (err) {
          this.logger.warn(`User Data WS parse error: ${err instanceof Error ? err.message : String(err)}`);
        }
      });

      this.userDataWs.userData(this.listenKey);

      // Keepalive listenKey every 30 mins
      this.listenKeyKeepAlive = setInterval(async () => {
        if (this.listenKey) {
          try {
            this.monitoringService.incrementApiRequests();
            await this.binanceClient.restAPI.userDataStreamsApi.keepaliveUserDataStream(this.listenKey);
          } catch (err) {
            this.logger.warn(`ListenKey keepalive failed: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
      }, 30 * 60 * 1000);

      this.logger.log(`User Data Stream started for real-time balance updates (ListenKey: ${this.listenKey?.substring(0, 8)}...)`);
    } catch (error) {
      throw error;
    }
  }

  private getClosedTradesStats(): Record<string, { pnl: number, count: number, hits: number }> {
    if (this.closedTrades.length === this.lastClosedTradesStatsCount) {
      return this.cachedClosedTradesStats;
    }

    const stats: Record<string, { pnl: number, count: number, hits: number }> = {};
    for (const trade of this.closedTrades) {
      const label = trade.strategy_label || 'Momentum Strategy';
      if (!stats[label]) {
        stats[label] = { pnl: 0, count: 0, hits: 0 };
      }
      stats[label].pnl = roundEight(stats[label].pnl + (trade.pnl || 0));
      stats[label].count++;
      if ((trade.pnl || 0) > 0) stats[label].hits++;
    }

    this.cachedClosedTradesStats = stats;
    this.lastClosedTradesStatsCount = this.closedTrades.length;
    return stats;
  }

  /**
   * BOLT OPTIMIZATION: Single-pass variant stats calculation.
   * Reduces complexity from O(M * (N + K)) to O(M + N + K_cache_update).
   */
  private calculateVariantStats(activeTrades?: Trade[]): Record<string, any> {
    const variantStats: Record<string, any> = {};
    const activeList = activeTrades || this.positionTracker.activeList();
    const balance = this.getBalance();
    const closedStats = this.getClosedTradesStats();
    
    // Group active trades in O(N)
    const activeGroups: Record<string, { pnl: number, risk: number, count: number, hits: number }> = {};
    for (let i = 0; i < activeList.length; i++) {
       const t = activeList[i];
       const label = t.strategy_label || 'Momentum Strategy';
       if (!activeGroups[label]) {
         activeGroups[label] = { pnl: 0, risk: 0, count: 0, hits: 0 };
       }
       activeGroups[label].pnl = roundEight(activeGroups[label].pnl + (t.pnl || 0));
       activeGroups[label].risk = roundEight(activeGroups[label].risk + (t.risk_usdt || 0));
       activeGroups[label].count++;
       if ((t.pnl || 0) > 0) activeGroups[label].hits++;
    }

    this.getStrategyConfigs().forEach(cfg => {
      const label = cfg.strategy_label!;
      const a = activeGroups[label] || { pnl: 0, risk: 0, count: 0, hits: 0 };
      const c = closedStats[label] || { pnl: 0, count: 0, hits: 0 };

      variantStats[label] = {
         totalPnl: roundEight(c.pnl + a.pnl),
         entryCount: c.count + a.count,
         hitCount: c.hits + a.hits,
         totalRiskPct: Number((balance > 0 ? (a.risk / balance) * 100 : 0).toFixed(2)),
         activeTradeCount: a.count
      };
    });
    return variantStats;
  }

  getTrade(idOrSymbol: string): any | null {
    const active = this.positionTracker.activeList();
    const trade = active.find(t => t.id === idOrSymbol || t.symbol === idOrSymbol);
    if (trade) {
      return this.serializeTrade(trade, this.tickerCache.getPrice(trade.symbol) || undefined);
    }
    const closed = this.closedTrades.find(t => t.id === idOrSymbol || t.symbol === idOrSymbol);
    if (closed) {
      return this.serializeTrade(closed, closed.exit_price);
    }
    return null;
  }

  getStatus() {
    return {
      running: this.running,
      paused: this.paused,
      mode: this.config?.paper_mode ? 'PAPER' : 'LIVE',
      tradingMode: this.config?.trading_mode || (this.config?.paper_mode ? 'paper' : 'live'),
      balance_paper: this.balancePaper,
      balance_live: this.balanceLive,
      stats: this.stats,
      activeTrades: this.positionTracker.activeList().map((trade) => this.serializeTrade(trade)),
      total_risk: this.positionTracker.totalRisk(),
      variant_stats: this.calculateVariantStats(),
      scannerResults: this.lastScannerResults,
      activeWindows: this.getActiveWindows(),
      gateState: this.gateState,
      hibernating: this.hibernating,
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
    const prevConfig = this.config;
    this.config = config;
    this.cachedStrategyConfigs = null;
    this.cachedScanSignatures.clear();
    this.logger.log('Session config updated (hot-reload)');

    // If loop intervals changed, restart them (obeying eco-mode if active)
    if (prevConfig && (
      prevConfig.hot_loop_interval_ms !== config.hot_loop_interval_ms ||
      prevConfig.main_loop_interval_ms !== config.main_loop_interval_ms
    )) {
      const isEco = this.listenerCount === 0;
      const mainMs = isEco
        ? Math.max(15000, config.main_loop_interval_ms || 15000)
        : (config.main_loop_interval_ms || 15000);
      const hotMs = isEco
        ? Math.max(5000, config.hot_loop_interval_ms || 5000)
        : (config.hot_loop_interval_ms || 5000);

      this.logger.log(`Restarting loops with new intervals: hot=${hotMs}ms, main=${mainMs}ms ${isEco ? '(ECO)' : ''}`);
      this.restartLoops(hotMs, mainMs);
    }

    this.broadcast('tick', { config: this.config });
  }

  async fetchTickerPrice(symbol: string): Promise<number | null> {
    return this.tickerCache.getPrice(symbol);
  }

  updateRateLimit(used1m: number) {
    this.binanceRateLimit.used_1m = used1m;
  }

  /**
   * Proactive Rate Limit Check
   * Returns true if 1m weight usage is > 80%
   */
  isRateLimited(): boolean {
    const used = this.binanceRateLimit.used_1m || 0;
    const limit = 1200; // Binance Futures default
    return (used / limit) > 0.8;
  }

  getBinanceRateLimit() {
    return {
      used_weight_1m: this.binanceRateLimit.used_1m || 0,
      limit: 1200,
      last_update: new Date().toISOString(),
    };
  }

  /**
   * Get all closed trades for persistence
   */
  getClosedTrades(): Trade[] {
    return this.closedTrades;
  }

  /**
   * Manually close a trade at current market price
   */
  async closeTradeManually(symbol: string): Promise<{ success: boolean; trade?: Trade; error?: string }> {
    if (!this.running) {
      return { success: false, error: 'No session running' };
    }

    const activeTrades = this.positionTracker.activeList();
    const trade = activeTrades.find(t => t.symbol === symbol);

    if (!trade) {
      return { success: false, error: `No open position for ${symbol}` };
    }

    const currentPrice = await this.tickerCache.getPrice(symbol);
    if (!currentPrice) {
      return { success: false, error: `Could not fetch price for ${symbol}` };
    }

    // Close the trade
    const result = await this.positionTracker.closeTrade(symbol, currentPrice, 'MANUAL_CLOSE', this.config!);
    
    if (result.exitOccurred && result.trade) {
          if ((result.trade.pnl || 0) > 0) this.stats.hitCount++;
      const prevBalancePaper = this.balancePaper;
      const prevBalanceLive = this.balanceLive;
      try {
        await this.updateBalance(result.trade);
        this.closedTrades.unshift(result.trade);
        if (this.onTradeUpdate) await this.onTradeUpdate(result.trade, this.getBalance());

        // Trigger watchlist update
        this.marketFeed.updateWatchlist(this.config!).catch(() => {});

        const analytics = this.analyticsService.calculateAnalytics(this.closedTrades as any, this.config?.paper_mode ? this.config?.paper_starting_balance : this.config?.live_starting_balance);
        this.lastAnalyticsResult = analytics;

        this.broadcast('trade_event', {
          event: 'closed',
          symbol: result.trade.symbol,
          reason: 'MANUAL_CLOSE',
          trade: this.serializeTrade(result.trade, currentPrice),
          pnl: result.trade.pnl,
          stats: this.stats,
          analytics: {
            maxDrawdown: Number(analytics.maxDrawdown.toFixed(2)),
            maxDrawdownPct: Number(analytics.maxDrawdownPct.toFixed(2)),
            overallWinRate: Number(analytics.overallWinRate.toFixed(2)),
            cumulativePnL: analytics.cumulativePnL.slice(-20).map((p: any) => ({ ...p, pnl: Number(p.pnl.toFixed(2)) })),
          }
        });

        return { success: true, trade: result.trade };
      } catch (err) {
        this.logger.error(`Failed to persist manual trade closure for ${symbol}: ${err instanceof Error ? err.message : String(err)}`);
        await this.rollbackTradeClosure(result.trade, prevBalancePaper, prevBalanceLive);
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    }

    return { success: false, error: 'Failed to close trade' };
  }
}
