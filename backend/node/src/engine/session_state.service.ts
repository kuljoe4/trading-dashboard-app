import { Injectable, Logger } from '@nestjs/common';
import { Trade } from '../models/Trade';
import { SessionConfig } from '../models/SessionConfig';
import { roundEight } from '../lib/math';
import { ENGINE_CONSTANTS } from '../models/constants';

@Injectable()
export class SessionStateService {
  private readonly logger = new Logger(SessionStateService.name);

  public balancePaper = 0;
  public balanceLive = 0;
  public paused = false;
  public binanceRateLimit: { used_1m?: number } = {};
  public stats = {
    entryCount: 0,
    hitCount: 0,
  };
  public statsVersion = 0;
  public gateState: string | null = null;
  public hibernating = false;
  public config: SessionConfig | null = null;
  public closedTrades: Trade[] = [];
  public activeTrades: Trade[] = []; // BOLT: Track active trades here for circular dependency removal
  public cachedClosedTradesStats: Record<string, { pnl: number, count: number, hits: number }> = {};

  public listenerCount = 0;
  public dashboardCount = 0;

  reset(config: SessionConfig, initialHistory: Trade[] = [], currentBalance?: number) {
    this.config = config;
    this.stats = {
      entryCount: initialHistory.length,
      hitCount: initialHistory.filter(t => (t.pnl || 0) > 0).length,
    };
    this.statsVersion = 0;
    this.closedTrades = initialHistory;
    this.activeTrades = [];
    this.gateState = null;
    this.hibernating = false;
    this.paused = false;
    this.binanceRateLimit = {};
    this.cachedClosedTradesStats = {};

    for (const trade of initialHistory) {
      const label = trade.strategy_label || 'Momentum Strategy';
      if (!this.cachedClosedTradesStats[label]) {
        this.cachedClosedTradesStats[label] = { pnl: 0, count: 0, hits: 0 };
      }
      this.cachedClosedTradesStats[label].pnl = roundEight(this.cachedClosedTradesStats[label].pnl + (trade.pnl || 0));
      this.cachedClosedTradesStats[label].count++;
      if ((trade.pnl || 0) > 0) this.cachedClosedTradesStats[label].hits++;
    }

    const mode = config.trading_mode || (config.paper_mode ? 'paper' : 'live');
    if (currentBalance !== undefined) {
      if (mode === 'paper') {
        this.balancePaper = currentBalance;
        this.balanceLive = config.live_starting_balance || 0;
      } else if (mode === 'testnet') {
        this.balanceLive = currentBalance;
        this.balancePaper = config.paper_starting_balance || 10000;
      } else {
        this.balanceLive = currentBalance;
        this.balancePaper = config.paper_starting_balance || 10000;
      }
    } else {
      this.balancePaper = config.paper_starting_balance || 10000;
      if (mode === 'testnet') {
        this.balanceLive = (config as any).testnet_starting_balance || 0;
      } else {
        this.balanceLive = config.live_starting_balance || 0;
      }
    }
  }

  getBalance(paperMode: boolean): number {
    return paperMode ? this.balancePaper : this.balanceLive;
  }

  isGated(): boolean {
    return this.paused ||
      ['max_trades', 'sl_guard', 'max_trades_period', 'sleeping', 'risk_pct', 'tod_risk', 'risk'].includes(this.gateState || '');
  }

  updateRateLimit(used1m: number) {
    this.binanceRateLimit.used_1m = used1m;
  }

  isRateLimited(): boolean {
    const used = this.binanceRateLimit.used_1m || 0;
    const limit = ENGINE_CONSTANTS.BINANCE_RATE_LIMIT_DEFAULT;
    return (used / limit) > 0.8;
  }

  getBinanceRateLimit() {
    return {
      used_weight_1m: this.binanceRateLimit.used_1m || 0,
      limit: ENGINE_CONSTANTS.BINANCE_RATE_LIMIT_DEFAULT,
      last_update: new Date().toISOString(),
    };
  }

  updateStatsOnEntry() {
    this.stats.entryCount++;
    this.statsVersion++;
  }

  updateStatsOnClose(isWin: boolean) {
    if (isWin) this.stats.hitCount++;
    this.statsVersion++;
  }

  addClosedTrade(trade: Trade) {
    const label = trade.strategy_label || 'Momentum Strategy';
    if (!this.cachedClosedTradesStats[label]) {
      this.cachedClosedTradesStats[label] = { pnl: 0, count: 0, hits: 0 };
    }
    this.cachedClosedTradesStats[label].pnl = roundEight(this.cachedClosedTradesStats[label].pnl + (trade.pnl || 0));
    this.cachedClosedTradesStats[label].count++;
    if ((trade.pnl || 0) > 0) this.cachedClosedTradesStats[label].hits++;

    this.closedTrades.unshift(trade);
    if (this.closedTrades.length > 500) {
      this.closedTrades = this.closedTrades.slice(0, 500);
    }
  }

  rollbackClosedTrade(trade: Trade) {
    const label = trade.strategy_label || 'Momentum Strategy';
    if (this.cachedClosedTradesStats[label]) {
      this.cachedClosedTradesStats[label].pnl = roundEight(this.cachedClosedTradesStats[label].pnl - (trade.pnl || 0));
      this.cachedClosedTradesStats[label].count--;
      if ((trade.pnl || 0) > 0) this.cachedClosedTradesStats[label].hits--;
    }
    if (this.closedTrades[0] && this.closedTrades[0].id === trade.id) {
      this.closedTrades.shift();
    }
  }

  isEcoMode(running: boolean): boolean {
    return running && this.listenerCount === 0;
  }

  setActiveTrades(trades: Trade[]) {
    this.activeTrades = trades;
  }

  /**
   * BOLT OPTIMIZATION: Clears non-essential state when session stops.
   * Keeps starting balances but clears transient history and stats caches.
   */
  minimize() {
    this.closedTrades = [];
    this.activeTrades = [];
    this.cachedClosedTradesStats = {};
    this.binanceRateLimit = {};
    this.stats = { entryCount: 0, hitCount: 0 };
    this.statsVersion++;
    this.logger.verbose('SessionStateService: Memory minimized');
  }
}
