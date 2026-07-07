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
  public last_scan_ts = 0;
  public realTimePositions: Map<string, { amount: number; entryPrice: number }> = new Map();
  public realTimeOrders: Map<string, any[]> = new Map();

  // Idempotency tracking
  private appliedGlobalPnL: Map<string, number> = new Map();
  private countedGlobalEntries: Set<string> = new Set();
  private countedGlobalHits: Set<string> = new Set();

  private appliedStrategyPnL: Map<string, number> = new Map();
  private countedStrategyEntries: Set<string> = new Set();
  private countedStrategyHits: Set<string> = new Set();

  public config: SessionConfig | null = null;
  public closedTrades: Trade[] = [];
  public activeTrades: Trade[] = []; // BOLT: Track active trades here for circular dependency removal
  public cachedClosedTradesStats: Record<string, { pnl: number, count: number, hits: number }> = {};
  private appliedStatsPnL: Map<string, number> = new Map(); // trade.id -> pnl portion already in stats.totalPnl

  public listenerCount = 0;
  public dashboardCount = 0;

  // SRE: Entry Pipeline Lock to prevent concurrent entry evaluations and dispatches
  public entryInProgress = false;

  reset(config: SessionConfig, initialHistory: Trade[] = [], currentBalance?: number, sessionId?: string, initialOpen: Trade[] = []) {
    this.config = config;

    // DATA-07: Stats should be session-specific even if we load mode-wide history for risk gating
    const sessionHistory = sessionId ? initialHistory.filter(t => t.sessionId === sessionId) : [];
    const sessionOpen = sessionId ? initialOpen.filter(t => t.sessionId === sessionId) : [];
    this.statsVersion = 0;
    this.closedTrades = initialHistory;
    this.activeTrades = initialOpen;
    this.gateState = null;
    this.gateReason = null;
    this.hibernating = false;
    this.agreementRequired = false;
    this.isAdaptiveTightened = false;
    this.paused = false;
    // SRE: Preserve the existing weight limit during reset to ensure persistent dynamic limits (Issue 5)
    const currentLimit = this.binanceRateLimit.limit || 2400;
    this.binanceRateLimit = { used_1m: 0, limit: currentLimit };
    this.apiStatus = { isBanned: false, isRateLimited: false, banUntil: null, lastErrorMessage: null };
    this.cachedClosedTradesStats = {};
    this.appliedStatsPnL.clear();
    this.realTimePositions.clear();
    this.realTimeOrders.clear();

    this.appliedGlobalPnL.clear();
    this.countedGlobalEntries.clear();
    this.countedGlobalHits.clear();
    this.appliedStrategyPnL.clear();
    this.countedStrategyEntries.clear();
    this.countedStrategyHits.clear();

    for (const trade of [...sessionHistory, ...sessionOpen]) {
      const label = trade.strategy_label || config.strategy_label || 'Momentum Strategy';
      if (!trade.strategy_label) trade.strategy_label = label;

      if (!this.cachedClosedTradesStats[label]) {
        this.cachedClosedTradesStats[label] = { pnl: 0, count: 0, hits: 0 };
      }

      // Populate idempotency maps/sets to prevent double-counting
      if (!trade.is_reconciliation) {
        this.countedGlobalEntries.add(trade.id);
        this.countedStrategyEntries.add(trade.id);

        if (trade.status !== 'OPEN') {
          if ((trade.pnl || 0) > 0) {
            this.countedGlobalHits.add(trade.id);
            this.countedStrategyHits.add(trade.id);
          }
        }
      }

      // Realized portion (fees/funding) is tracked even for OPEN trades
      this.appliedGlobalPnL.set(trade.id, trade.pnl || 0);
      this.appliedStrategyPnL.set(trade.id, trade.pnl || 0);
      this.appliedStatsPnL.set(trade.id, trade.pnl || 0);

      // Populate strategy-specific stats
      const stats = this.cachedClosedTradesStats[label];
      if (trade.status !== 'OPEN') {
        stats.pnl = roundEight(stats.pnl + (trade.pnl || 0));
        if (!trade.is_reconciliation) {
          stats.count++;
          if ((trade.pnl || 0) > 0) stats.hits++;
        }
      }
    }

    // Finalize session stats
    this.stats = {
        entryCount: this.countedGlobalEntries.size,
        hitCount: this.countedGlobalHits.size,
        totalPnl: roundEight(
          [...sessionHistory, ...sessionOpen]
            .reduce((acc, t) => acc + (t.pnl || 0), 0)
        )
    };

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

  @OnEvent('binance.api_limit_cleared')
  handleApiLimitCleared() {
    this.apiStatus = {
      isBanned: false,
      isRateLimited: false,
      banUntil: null,
      lastErrorMessage: null
    };
    this.logger.log(`API Status restored: Recovery event received from Gateway.`);
  }

  updateOrderRateLimits(headers: any | null, limits?: { limit10s?: number, limit1m?: number }) {
    if (limits) {
       if (limits.limit10s) this.binanceOrderLimit.limit_10s = limits.limit10s;
       if (limits.limit1m) this.binanceOrderLimit.limit_1m = limits.limit1m;
       return;
    }
    if (!headers) return;

    const getHeader = (name: string) => {
      return (headers && typeof headers.get === 'function')
        ? headers.get(name)
        : (headers ? (headers[name.toLowerCase()] || headers[name]) : null);
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

  updateStatsOnEntry(tradeId?: string) {
    if (tradeId) {
      if (!this.countedGlobalEntries.has(tradeId)) {
        this.stats.entryCount++;
        this.countedGlobalEntries.add(tradeId);
      }
    } else {
      this.stats.entryCount++;
    }
    this.statsVersion++;
  }

  updateStatsOnClose(isWin: boolean, pnl: number = 0, isReconciliation: boolean = false, tradeId?: string) {
    if (tradeId) {
      if (!isReconciliation && isWin && !this.countedGlobalHits.has(tradeId)) {
        this.stats.hitCount++;
        this.countedGlobalHits.add(tradeId);
      }

      const applied = this.appliedGlobalPnL.get(tradeId) || 0;
      const delta = roundEight(pnl - applied);
      this.stats.totalPnl = roundEight(this.stats.totalPnl + delta);
      this.appliedGlobalPnL.set(tradeId, pnl);
    } else {
      if (!isReconciliation && isWin) this.stats.hitCount++;
      this.stats.totalPnl = roundEight(this.stats.totalPnl + pnl);
    }

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

    const stats = this.cachedClosedTradesStats[label];
    const applied = this.appliedStrategyPnL.get(trade.id) || 0;
    const delta = roundEight((trade.pnl || 0) - applied);

    stats.pnl = roundEight(stats.pnl + delta);
    this.appliedStrategyPnL.set(trade.id, trade.pnl || 0);

    if (!trade.is_reconciliation) {
      if (!this.countedStrategyEntries.has(trade.id)) {
        stats.count++;
        this.countedStrategyEntries.add(trade.id);
      }
      if ((trade.pnl || 0) > 0 && !this.countedStrategyHits.has(trade.id)) {
        stats.hits++;
        this.countedStrategyHits.add(trade.id);
      }
    }

    // Prevent duplicate entries in closedTrades array
    const existingIndex = this.closedTrades.findIndex(t => t.id === trade.id);
    if (existingIndex !== -1) {
      this.closedTrades[existingIndex] = trade;
    } else {
      this.closedTrades.unshift(trade);
      if (this.closedTrades.length > 500) {
        this.closedTrades = this.closedTrades.slice(0, 500);
      }
    }
  }

  rollbackClosedTrade(trade: Trade, prevAppliedPnL: number = 0) {
    const label = trade.strategy_label || 'Momentum Strategy';

    // Rollback Strategy Stats
    const appliedStr = this.appliedStrategyPnL.get(trade.id) || 0;
    if (this.cachedClosedTradesStats[label]) {
      const stats = this.cachedClosedTradesStats[label];
      stats.pnl = roundEight(stats.pnl - appliedStr);

      if (!trade.is_reconciliation) {
        if (this.countedStrategyEntries.has(trade.id)) {
          stats.count--;
          this.countedStrategyEntries.delete(trade.id);
        }
        if (this.countedStrategyHits.has(trade.id)) {
          stats.hits--;
          this.countedStrategyHits.delete(trade.id);
        }
      }
    }
    this.appliedStrategyPnL.delete(trade.id);

    // Rollback Global Stats
    const appliedGl = this.appliedGlobalPnL.get(trade.id) || 0;
    this.stats.totalPnl = roundEight(this.stats.totalPnl - appliedGl);
    this.appliedGlobalPnL.delete(trade.id);

    if (this.countedGlobalEntries.has(trade.id)) {
      this.stats.entryCount--;
      this.countedGlobalEntries.delete(trade.id);
    }

    if (this.countedGlobalHits.has(trade.id)) {
      this.stats.hitCount--;
      this.countedGlobalHits.delete(trade.id);
    }

    this.statsVersion++;

    const idx = this.closedTrades.findIndex(t => t.id === trade.id);
    if (idx !== -1) {
      this.closedTrades.splice(idx, 1);
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
