import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Trade } from '../models/Trade';
import { SessionConfig } from '../models/SessionConfig';
import { roundEight } from '../lib/math';
import { ENGINE_CONSTANTS } from '../models/constants';

@Injectable()
export class SessionStateService {
  private readonly logger = new Logger(SessionStateService.name);

  public balancePaper = 0;
  public balanceLive = 0;
  public lastExchangeBalance = 0;
  public lastUdsBalanceUpdate = 0;
  public paused = false;
  public binanceRateLimit: { used_1m: number; limit: number } = { used_1m: 0, limit: 2400 };
  public binanceOrderLimit: {
    used_10s: number;
    limit_10s: number;
    used_1m: number;
    limit_1m: number;
  } = {
    used_10s: 0,
    limit_10s: 300,
    used_1m: 0,
    limit_1m: 1200
  };
  public apiStatus: {
    isBanned: boolean;
    isRateLimited: boolean;
    banUntil: number | null;
    lastErrorMessage: string | null;
  } = {
    isBanned: false,
    isRateLimited: false,
    banUntil: null,
    lastErrorMessage: null
  };
  public stats = {
    entryCount: 0,
    hitCount: 0,
    totalPnl: 0,
  };
  public statsVersion = 0;
  public gateState: string | null = null;
  public gateReason: string | null = null;
  public hibernating = false;
  public agreementRequired = false;
  public isAdaptiveTightened = false;
  public realTimePositions: Map<string, { amount: number; entryPrice: number }> = new Map();
  public realTimeOrders: Map<string, any[]> = new Map();
  public config: SessionConfig | null = null;
  public closedTrades: Trade[] = [];
  public activeTrades: Trade[] = []; // BOLT: Track active trades here for circular dependency removal
  public cachedClosedTradesStats: Record<string, { pnl: number, count: number, hits: number }> = {};

  public listenerCount = 0;
  public dashboardCount = 0;

  // SRE: Entry Pipeline Lock to prevent concurrent entry evaluations and dispatches
  public entryInProgress = false;

  reset(config: SessionConfig, initialHistory: Trade[] = [], currentBalance?: number, sessionId?: string) {
    this.config = config;

    // DATA-07: Stats should be session-specific even if we load mode-wide history for risk gating
    const sessionHistory = sessionId ? initialHistory.filter(t => t.sessionId === sessionId) : [];
    this.stats = {
      entryCount: sessionHistory.length,
      hitCount: sessionHistory.filter(t => (t.pnl || 0) > 0).length,
      totalPnl: sessionHistory.reduce((acc, t) => acc + (t.pnl || 0), 0),
    };
    this.statsVersion = 0;
    this.closedTrades = initialHistory;
    this.activeTrades = [];
    this.gateState = null;
    this.gateReason = null;
    this.hibernating = false;
    this.agreementRequired = false;
    this.isAdaptiveTightened = false;
    this.paused = false;
    this.binanceRateLimit = { used_1m: 0, limit: 2400 };
    this.apiStatus = { isBanned: false, isRateLimited: false, banUntil: null, lastErrorMessage: null };
    this.cachedClosedTradesStats = {};
    this.realTimePositions.clear();
    this.realTimeOrders.clear();

    for (const trade of initialHistory) {
      const label = trade.strategy_label || config.strategy_label || 'Momentum Strategy';
      if (!trade.strategy_label) trade.strategy_label = label;

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

  @OnEvent('binance.weight_update')
  updateRateLimit(used1m: number, limit?: number) {
    this.binanceRateLimit.used_1m = used1m;
    if (limit) {
      this.binanceRateLimit.limit = limit;

      // SRE: Proactively sync with static gateway queue
      // Since BinanceClientFactory might not be available yet due to circular dep,
      // we use a dynamic check if needed, but BinanceRequestQueue is static.
      try {
        const { BinanceRequestQueue } = require('../lib/binanceClientFactory');
        if (BinanceRequestQueue && typeof BinanceRequestQueue.setWeightLimit === 'function') {
          BinanceRequestQueue.setWeightLimit(limit);
        }
      } catch (e) {
        // Fallback or ignore if module not loaded
      }
    }
  }

  @OnEvent('binance.order_limit_update')
  handleOrderLimitUpdate(payload: { headers: any }) {
    this.updateOrderRateLimits(payload.headers);
  }

  updateOrderRateLimits(headers: any | null, limits?: { limit10s?: number, limit1m?: number }) {
    if (limits) {
       if (limits.limit10s) this.binanceOrderLimit.limit_10s = limits.limit10s;
       if (limits.limit1m) this.binanceOrderLimit.limit_1m = limits.limit1m;
    }
    if (!headers) return;

    const getHeader = (name: string) => {
      return typeof headers.get === 'function'
        ? headers.get(name)
        : (headers[name.toLowerCase()] || headers[name]);
    };

    const used10s = getHeader('X-MBX-ORDER-COUNT-10S');
    const used1m = getHeader('X-MBX-ORDER-COUNT-1M');

    if (used10s) {
      const parts = used10s.split(',');
      if (parts.length > 0) {
        this.binanceOrderLimit.used_10s = parseInt(parts[0], 10);
      }
    }
    if (used1m) {
      const parts = used1m.split(',');
      if (parts.length > 0) {
        this.binanceOrderLimit.used_1m = parseInt(parts[0], 10);
      }
    }
  }

  isRateLimited(threshold = 0.8): boolean {
    if (this.isBanned()) return true;
    const used = this.binanceRateLimit.used_1m;
    const limit = this.binanceRateLimit.limit;
    return (used / limit) > threshold;
  }

  isBanned(): boolean {
    // SRE: Proactive ban expiration. If the ban time has passed, treat it as cleared
    // regardless of the isBanned status bit.
    if (this.apiStatus.isBanned) {
      if (this.apiStatus.banUntil && Date.now() < this.apiStatus.banUntil) {
        return true;
      }
    }
    return false;
  }

  /**
   * Check if order rate limits are approaching thresholds based on priority.
   * Priority:
   * 0 - Emergency (Closes, first SL) - Never throttles
   * 1 - Normal (Significant ratchets, entries)
   * 2 - Low (Small ratchets)
   */
  isOrderRateLimited(priority: number): boolean {
    if (priority <= 0) return false;

    const usage10s = this.binanceOrderLimit.used_10s / this.binanceOrderLimit.limit_10s;
    const usage1m = this.binanceOrderLimit.used_1m / this.binanceOrderLimit.limit_1m;
    const maxUsage = Math.max(usage10s, usage1m);

    if (priority === 1) {
      return maxUsage > 0.9; // Block entries/significant ratchets at 90%
    }
    if (priority >= 2) {
      return maxUsage > 0.8; // Throttle low priority at 80%
    }
    return false;
  }

  getBinanceRateLimit() {
    return {
      used_weight_1m: this.binanceRateLimit.used_1m,
      limit: this.binanceRateLimit.limit,
      weight_limit: this.binanceRateLimit.limit,
      used_order_10s: this.binanceOrderLimit.used_10s,
      order_limit_10s: this.binanceOrderLimit.limit_10s,
      used_order_1m: this.binanceOrderLimit.used_1m,
      order_limit_1m: this.binanceOrderLimit.limit_1m,
      last_update: new Date().toISOString(),
    };
  }

  updateStatsOnEntry() {
    this.stats.entryCount++;
    this.statsVersion++;
  }

  updateStatsOnClose(isWin: boolean, pnl: number = 0, isReconciliation: boolean = false) {
    if (!isReconciliation && isWin) this.stats.hitCount++;
    this.stats.totalPnl = roundEight(this.stats.totalPnl + pnl);
    this.statsVersion++;
  }

  addClosedTrade(trade: Trade) {
    const label = trade.strategy_label || this.config?.strategy_label || 'Momentum Strategy';
    if (!trade.strategy_label) trade.strategy_label = label;

    // Reconciliation trades should contribute to PnL (for accurate balance) but NOT to counts/hits
    // to avoid penalizing or artificially boosting strategy performance metrics.
    if (!this.cachedClosedTradesStats[label]) {
      this.cachedClosedTradesStats[label] = { pnl: 0, count: 0, hits: 0 };
    }
    this.cachedClosedTradesStats[label].pnl = roundEight(this.cachedClosedTradesStats[label].pnl + (trade.pnl || 0));

    if (!trade.is_reconciliation) {
      this.cachedClosedTradesStats[label].count++;
      if ((trade.pnl || 0) > 0) this.cachedClosedTradesStats[label].hits++;
    }

    this.closedTrades.unshift(trade);
    if (this.closedTrades.length > 500) {
      this.closedTrades = this.closedTrades.slice(0, 500);
    }
  }

  rollbackClosedTrade(trade: Trade) {
    const label = trade.strategy_label || 'Momentum Strategy';
    if (this.cachedClosedTradesStats[label]) {
      this.cachedClosedTradesStats[label].pnl = roundEight(this.cachedClosedTradesStats[label].pnl - (trade.pnl || 0));
      if (!trade.is_reconciliation) {
        this.cachedClosedTradesStats[label].count--;
        if ((trade.pnl || 0) > 0) this.cachedClosedTradesStats[label].hits--;
      }
    }

    // DATA-07: Rollback global stats for consistency
    this.stats.totalPnl = roundEight(this.stats.totalPnl - (trade.pnl || 0));
    if (!trade.is_reconciliation && (trade.pnl || 0) > 0) {
      this.stats.hitCount--;
    }
    this.statsVersion++;

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
   * Keeps starting balances and history (required for risk gating) but clears transient caches.
   */
  minimize() {
    this.activeTrades = [];
    this.binanceRateLimit = { used_1m: 0, limit: 2400 };
    this.realTimePositions.clear();
    this.realTimeOrders.clear();
    // DATA-07: Preserve stats during hibernation so dashboard remains accurate
    this.statsVersion++;

    // Suggest explicit GC if --expose-gc is enabled
    if (typeof global !== 'undefined' && (global as any).gc) {
      try {
        (global as any).gc();
        this.logger.log('Manual Garbage Collection triggered');
      } catch (e) {}
    }

    this.logger.verbose('SessionStateService: Memory minimized');
  }
}
