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
import { v4 as uuid } from 'uuid';

@Injectable()
export class TradingSessionService {
  private readonly logger = new Logger(TradingSessionService.name);

  private running = false;
  private config: SessionConfig | null = null;
  private binanceClient: any = null;
  private balancePaper = 0;
  private balanceLive = 0;
  private lastRateLimitCheck = 0;
  private binanceRateLimit: Record<string, any> = {};
  private wsBroadcaster: ((data: any) => void) | null = null;
  private lastScannerResults: any[] = [];
  private closedTrades: Trade[] = [];
  private gateState: string | null = null;
  private activeWindows: Map<string, any> = new Map();

  constructor(
    private readonly tickerCache: TickerCacheService,
    private readonly klineStore: KlineStoreService,
    private readonly signalEngine: SignalEngineService,
    private readonly riskEngine: RiskEngineService,
    private readonly positionTracker: PositionTrackerService,
    private readonly orderManager: OrderManagerService,
    private readonly marketFeed: MarketFeedService,
    private readonly momentumScanner: MomentumScannerService,
  ) {}

  setWsBroadcaster(cb: (data: any) => void) {
    this.wsBroadcaster = cb;
  }

  private broadcast(eventType: string, payload: any) {
    if (this.wsBroadcaster) {
      this.wsBroadcaster({ type: eventType, ...payload });
    }
  }

  async start(config: SessionConfig, binanceClient?: any) {
    this.running = true;
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

    // Fetch live balance if in live mode
    if (!config.paper_mode && binanceClient) {
      try {
        const balance = await this.fetchBinanceBalance();
        this.balanceLive = balance;
        this.logger.log(`Live balance: ${this.balanceLive} USDT`);
      } catch (error) {
        this.logger.warn(`Failed to fetch live balance: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    // Start market feed
    await this.marketFeed.start(config);
    await this.momentumScanner.start(config);

    this.logger.log(
      `Session started | mode=${config.paper_mode ? 'PAPER' : 'LIVE'} | ` +
        `balance=${this.getBalance()} | signals=${config.enabled_signals?.join(',')} | ` +
        `sl_type=${config.sl_type}`,
    );

    this.broadcastSnapshot('started');

    return { status: 'started' };
  }

  async stop() {
    this.running = false;
    await this.marketFeed.stop();
    await this.momentumScanner.stop();
    this.logger.log('Session stopped');
    this.broadcastSnapshot('stopped');
    return { status: 'stopped' };
  }

  private async onCandleClose(symbol: string) {
    if (!this.running || !this.config) return;

    try {
      // Check exit conditions for open trades
      const activeTrades = this.positionTracker.activeList();
      for (const trade of activeTrades) {
        const currentPrice = await this.tickerCache.getPrice(trade.symbol);
        if (!currentPrice) continue;

        // Check RR sequence adjustments (SL ratcheting)
        await this.positionTracker.checkRrSequenceAdjustments(
          trade.symbol,
          currentPrice,
          this.config,
        );

        // Check exit conditions
        const exitCondition = await this.positionTracker.checkExitConditions(
          trade.symbol,
          currentPrice,
          this.config,
        );

        if (exitCondition?.exitOccurred) {
          const result = await this.positionTracker.closeTrade(
            trade.symbol,
            currentPrice,
            exitCondition.exitReason,
            this.config,
          );

          if (result.exitOccurred && result.trade) {
            this.updateBalance(result.trade);
            const trade = result.trade;
            this.closedTrades.unshift(trade);
            this.broadcast('trade_event', {
              event: 'closed',
              trade: this.serializeTrade(trade, currentPrice),
              symbol: trade.symbol,
              reason: exitCondition.exitReason,
              pnl: trade.pnl,
              pnl_pct: trade.pnl_pct,
            });
          }
        }
      }

      // Scan for new opportunities
      const opportunities = await this.momentumScanner.scan(this.config);
      this.lastScannerResults = opportunities.slice(0, 10).map((o) => ({
        symbol: o.symbol,
        price: o.price,
        pct: Number(o.momentum.toFixed(2)),
        momentum: Number(o.momentum.toFixed(2)),
        direction: o.direction.toLowerCase(),
        dir: o.direction.toLowerCase(),
        vol: o.volume_24h,
        volume_usdt: o.volume_24h,
        score: Number((o.score / 10).toFixed(1)),
      }));
      this.refreshActiveWindows(this.lastScannerResults);
      this.broadcast('scanner', {
        count: this.lastScannerResults.length,
        opportunities: this.lastScannerResults,
        activeWindows: this.getActiveWindows(),
      });

      // Try to enter new trades
      for (const opp of opportunities) {
        if (!this.running || !this.config) break;

        // Skip if already has position
        if (this.positionTracker.hasSymbol(opp.symbol)) {
          continue;
        }

        // Check ALL signals fired (AND logic)
        const signalResult = await this.signalEngine.checkEntry(
          opp.symbol,
          this.config,
          this.config.scan_interval || '1m',
        );

        if (!signalResult.allFired) {
          this.logger.debug(
            `${opp.symbol}: Signals not all fired - ${signalResult.reason}`,
          );
          continue;
        }

        // Check risk gate
        const activeTrades2 = this.positionTracker.activeList();
        const riskResult = await this.riskEngine.canEnter(
          activeTrades2,
          this.getBalance(),
          opp.symbol,
          this.config,
          this.positionTracker.totalRisk(),
        );

        if (!riskResult.canEnter) {
          this.gateState = this.mapGateState(riskResult.reason);
          this.broadcast('gate', {
            gateState: this.gateState,
            scannerPaused: this.gateState === 'max_trades' || this.gateState === 'sl_guard',
            reason: riskResult.reason,
          });
          this.logger.debug(`${opp.symbol}: Risk gate failed - ${riskResult.reason}`);
          continue;
        }

        // Get current price
        const price = await this.tickerCache.getPrice(opp.symbol);
        if (!price) continue;

        // Compute SL
        const lookback = await this.klineStore.getLookbackExtremes(
          opp.symbol,
          this.config.sl_lookback_timeframe || this.config.scan_interval || '1m',
          this.config.sl_lookback_period || 20,
        );

        const slPrice = await this.riskEngine.computeSl(
          price,
          opp.direction,
          this.config,
          lookback.lows,
          lookback.highs,
        );

        // Compute position size
        const qty = await this.riskEngine.computePositionSize(
          this.getBalance(),
          price,
          slPrice,
          opp.direction,
          this.config,
        );

        if (qty <= 0) {
          this.logger.debug(`${opp.symbol}: Invalid position size ${qty}`);
          continue;
        }

        // Compute TP
        const tpPrice = await this.riskEngine.computeTp(
          price,
          slPrice,
          opp.direction,
          this.config,
        );

        // Enter trade
        const trade = await this.orderManager.enter(
          uuid().substring(0, 8),
          opp.symbol,
          opp.direction,
          price,
          qty,
          slPrice,
          tpPrice,
        );

        if (trade) {
          this.positionTracker.addTrade(trade);
          this.gateState = null;
          this.activeWindows.delete(opp.symbol);
          this.broadcast('trade_event', {
            event: 'opened',
            trade: this.serializeTrade(trade, price),
            symbol: opp.symbol,
            direction: opp.direction,
            entry: price,
            qty: qty.toFixed(4),
            sl: slPrice.toFixed(4),
            tp: tpPrice == null ? null : tpPrice.toFixed(4),
            signals: signalResult.firedSignals,
          });

          this.logger.log(
            `Entered: ${opp.symbol} ${opp.direction} @ ${price} qty=${qty.toFixed(4)} SL=${slPrice.toFixed(4)} TP=${tpPrice == null ? 'none' : tpPrice.toFixed(4)}`,
          );
        }
      }
      await this.broadcastTick();
    } catch (error) {
      this.logger.error(`OnCandleClose error: ${error instanceof Error ? error.message : String(error)}`);
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
    if (reason.includes('Global max open trades') || reason.includes('Max open trades')) return 'max_trades';
    if (reason.includes('Total SL')) return 'sl_guard';
    if (reason.includes('Total risk')) return 'risk_pct';
    return 'risk';
  }

  private serializeTrade(trade: Trade, currentPrice?: number) {
    const current = currentPrice ?? trade.exit_price ?? trade.entry_price;
    const risk = Math.abs(trade.entry_price - trade.initial_sl) || 1;
    const liveRr = trade.direction === 'LONG'
      ? (current - trade.entry_price) / risk
      : (trade.entry_price - current) / risk;
    const pnl = trade.direction === 'LONG'
      ? (current - trade.entry_price) * trade.qty
      : (trade.entry_price - current) * trade.qty;

    return {
      ...trade,
      current_price: current,
      sl_price: trade.current_sl,
      tp_price: trade.tp,
      pnl,
      rr: liveRr,
      max_rr_achieved: trade.max_rr_achieved,
      live_rr_sequence: this.config?.live_rr_sequence || [],
      exit_rr_sequence: this.config?.exit_rr_sequence || [],
      tp_mode: this.config?.tp_mode || 'fixed',
      tp_ratio: this.config?.tp_ratio || 2,
      sl_type: this.config?.sl_type,
      paper_mode: this.config?.paper_mode,
    };
  }

  private async broadcastTick() {
    const activeTrades = this.positionTracker.activeList();
    const trades = await Promise.all(activeTrades.map(async (trade) => {
      const current = await this.tickerCache.getPrice(trade.symbol);
      return this.serializeTrade(trade, current || trade.entry_price);
    }));
    const totalPnl = trades.reduce((sum, trade) => sum + (trade.pnl || 0), 0);
    const totalRiskUsdt = this.positionTracker.totalRisk();
    const balance = this.getBalance();

    this.broadcast('tick', {
      balance,
      total_pnl: totalPnl,
      total_risk_pct: balance > 0 ? (totalRiskUsdt / balance) * 100 : 0,
      total_sl_used: totalRiskUsdt,
      trades,
      gateState: this.gateState,
      scannerPaused: this.gateState === 'max_trades' || this.gateState === 'sl_guard',
      activeWindows: this.getActiveWindows(),
      rateLimit: this.getBinanceRateLimit(),
    });
  }

  private broadcastSnapshot(status: 'started' | 'stopped') {
    this.broadcast('session', {
      status,
      running: this.running,
      mode: this.config?.paper_mode ? 'PAPER' : 'LIVE',
      balance: this.getBalance(),
      config: this.config,
      gateState: this.gateState,
      scannerPaused: this.gateState === 'max_trades' || this.gateState === 'sl_guard',
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
    } catch (error) {
      this.logger.warn(`Balance fetch failed: ${error instanceof Error ? error.message : String(error)}`);
      return 0;
    }
  }

  private updateBalance(trade: Trade) {
    if (this.config?.paper_mode) {
      this.balancePaper += trade.pnl || 0;
    } else {
      this.balanceLive += trade.pnl || 0;
    }
  }

  private getBalance(): number {
    return this.config?.paper_mode ? this.balancePaper : this.balanceLive;
  }

  getStatus() {
    return {
      running: this.running,
      mode: this.config?.paper_mode ? 'PAPER' : 'LIVE',
      balance_paper: this.balancePaper,
      balance_live: this.balanceLive,
      active_trades: this.positionTracker.activeList().length,
      activeTrades: this.positionTracker.activeList().map((trade) => this.serializeTrade(trade)),
      total_risk: this.positionTracker.totalRisk(),
      scannerResults: this.lastScannerResults,
      activeWindows: this.getActiveWindows(),
      gateState: this.gateState,
      scannerPaused: this.gateState === 'max_trades' || this.gateState === 'sl_guard',
      history: this.closedTrades.slice(0, 50).map((trade) => this.serializeTrade(trade, trade.exit_price)),
      binance_rate_limit: this.binanceRateLimit,
    };
  }

  getBinanceRateLimit() {
    return {
      used_weight: this.binanceRateLimit.used || 0,
      used_weight_1m: this.binanceRateLimit.used_1m || 0,
      limit: 1200,
      used_pct: ((this.binanceRateLimit.used_1m || 0) / 1200) * 100,
      last_update: new Date().toISOString(),
    };
  }
}
