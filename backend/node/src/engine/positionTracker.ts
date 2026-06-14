import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Trade } from '../models/Trade';
import { SessionConfig } from '../models/SessionConfig';
import { RiskEngineService } from './riskEngine';
import { SignalEngineService } from './signalEngine';
import { OrderManagerService } from './orderManager';
import { TickerCacheService } from './ticker_cache.service';
import { KlineStoreService } from './kline_store.service';
import { SessionStateService } from './session_state.service';
import { roundEight } from '../lib/math';
import { ENGINE_EVENTS } from './events';

@Injectable()
export class PositionTrackerService {
  private readonly logger = new Logger(PositionTrackerService.name);

  private trades: Map<string, Trade> = new Map(); // symbol -> Trade
  private enteringSymbols: Set<string> = new Set(); // symbols currently in the process of entering
  private pendingRisk: Map<string, number> = new Map(); // symbol -> reserved risk amount
  private closingSymbols: Set<string> = new Set(); // symbols currently in the process of closing
  private rrSequenceIndex: Map<string, number> = new Map(); // symbol -> current milestone index
  private _totalRisk = 0;
  private _activeListCache: Trade[] | null = null;

  constructor(
    private readonly riskEngine: RiskEngineService,
    private readonly signalEngine: SignalEngineService,
    private readonly orderManager: OrderManagerService,
    private readonly tickerCache: TickerCacheService,
    private readonly klineStore: KlineStoreService,
    private readonly sessionState: SessionStateService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  hasSymbol(symbol: string): boolean {
    return this.trades.has(symbol) || this.enteringSymbols.has(symbol);
  }

  isEntering(symbol: string): boolean {
    return this.enteringSymbols.has(symbol);
  }

  activeList(): Trade[] {
    if (this._activeListCache) return this._activeListCache;
    this._activeListCache = Array.from(this.trades.values());
    return this._activeListCache;
  }

  activeCount(): number {
    return this.trades.size;
  }

  /**
   * BOLT OPTIMIZATION: Returns pre-calculated total risk in O(1),
   * including pending risk reserved for trades currently entering.
   */
  totalRisk(): number {
    let reserved = 0;
    for (const r of this.pendingRisk.values()) reserved += r;
    return roundEight(this._totalRisk + reserved);
  }

  setEntering(symbol: string, entering: boolean, reservedRisk = 0): void {
    if (entering) {
      this.enteringSymbols.add(symbol);
      if (reservedRisk > 0) {
        this.pendingRisk.set(symbol, reservedRisk);
        this.logger.debug(`[Risk Integrity] Reserved ${reservedRisk} USDT risk for ${symbol} entry.`);
      }
    } else {
      this.enteringSymbols.delete(symbol);
      this.pendingRisk.delete(symbol);
    }
  }

  addTrade(trade: Trade): void {
    // Correctly handle symbol overwrites to prevent double-counting risk
    const existing = this.trades.get(trade.symbol);
    if (existing) {
      this._totalRisk = roundEight(this._totalRisk - (existing.risk_usdt || 0));
    }

    this.trades.set(trade.symbol, trade);
    this.rrSequenceIndex.set(trade.symbol, -1);
    this._totalRisk = roundEight(this._totalRisk + (trade.risk_usdt || 0));
    this._activeListCache = null;
  }

  async checkRrSequenceAdjustments(
    symbol: string,
    currentPrice: number,
    config: SessionConfig,
  ): Promise<void> {
    const trade = this.trades.get(symbol);
    if (!trade || trade.status !== 'OPEN') return;

    // Calculate current R:R metrics
    const risk = Math.abs(trade.entry_price - trade.initial_sl);
    if (risk <= 0) return;

    const reward = trade.direction === 'LONG'
      ? currentPrice - trade.entry_price
      : trade.entry_price - currentPrice;
    const liveRr = reward / risk;

    // Update peak R:R (one-way ladder, never goes down)
    const prevMaxRr = trade.max_rr_achieved;
    trade.max_rr_achieved = Math.max(prevMaxRr, liveRr);

    // Find highest milestone crossed by max_rr
    let currentIndex = -1;
    const liveRrSequence = config.live_rr_sequence || [];
    const exitRrSequence = config.exit_rr_sequence || [];

    for (let i = 0; i < liveRrSequence.length; i++) {
      if (trade.max_rr_achieved >= liveRrSequence[i]) {
        currentIndex = i;
      }
    }

    // If we crossed a new milestone, update SL
    const prevIndex = this.rrSequenceIndex.get(symbol) || -1;
    if (currentIndex > prevIndex && currentIndex >= 0) {
      this.rrSequenceIndex.set(symbol, currentIndex);

      // Get target RR for this milestone
      const exitRr = exitRrSequence[currentIndex] ?? 0;

      // Calculate new SL based on target RR
      let newSl: number;
      if (trade.direction === 'LONG') {
        // For LONG: breakeven is entry; positive exit RR locks profit above entry.
        newSl = trade.entry_price + risk * exitRr;
      } else {
        // For SHORT: breakeven is entry; positive exit RR locks profit below entry.
        newSl = trade.entry_price - risk * exitRr;
      }

      // Only move SL deeper into profit (stricter protection)
      if (trade.direction === 'LONG' && newSl) {
        if (newSl > trade.current_sl) {
          const prevSl = trade.current_sl;
          const prevRisk = trade.risk_usdt || 0;
          trade.current_sl = newSl;
          trade.risk_usdt = Math.max(0, trade.entry_price - trade.current_sl) * trade.qty;
          // Update running total risk with the delta
          this._totalRisk = roundEight(this._totalRisk + (trade.risk_usdt - prevRisk));
          this.logSlAdjustment(trade, prevSl, newSl, currentIndex);
          // Update exchange-side SL in live mode
          this.orderManager.updateStopLoss(trade, newSl).catch(err => {
            this.logger.error(`Failed to update exchange SL for ${symbol}: ${err.message}`);
          });
          // Notify of trade state change for persistence
          this.eventEmitter.emit(ENGINE_EVENTS.TRADE_UPDATED, { trade });
        }
      } else if (trade.direction === 'SHORT' && newSl) {
        if (newSl < trade.current_sl) {
          const prevSl = trade.current_sl;
          const prevRisk = trade.risk_usdt || 0;
          trade.current_sl = newSl;
          trade.risk_usdt = Math.max(0, trade.current_sl - trade.entry_price) * trade.qty;
          // Update running total risk with the delta
          this._totalRisk = roundEight(this._totalRisk + (trade.risk_usdt - prevRisk));
          this.logSlAdjustment(trade, prevSl, newSl, currentIndex);
          // Update exchange-side SL in live mode
          this.orderManager.updateStopLoss(trade, newSl).catch(err => {
            this.logger.error(`Failed to update exchange SL for ${symbol}: ${err.message}`);
          });
          // Notify of trade state change for persistence
          this.eventEmitter.emit(ENGINE_EVENTS.TRADE_UPDATED, { trade });
        }
      }
    }
  }

  private logSlAdjustment(
    trade: Trade,
    prevSl: number,
    newSl: number,
    milestoneIndex: number,
  ): void {
    const adjustment = {
      timestamp: new Date().toISOString(),
      prev_sl: prevSl,
      new_sl: newSl,
      reason: `RR_sequence_milestone_${milestoneIndex}`,
      milestone_index: milestoneIndex,
      max_rr_achieved: trade.max_rr_achieved,
    };

    if (!trade.sl_adjustments) {
      trade.sl_adjustments = [];
    }
    trade.sl_adjustments.push(adjustment);

    this.logger.debug(
      `SL Adjusted for ${trade.symbol}: ${prevSl} → ${newSl} (Milestone ${milestoneIndex})`,
    );
  }

  checkExitConditions(
    symbol: string,
    currentPrice: number,
    config: SessionConfig,
    interval: string = '1m',
  ): { exitOccurred: boolean; exitType: string; exitReason: string } | null {
    const trade = this.trades.get(symbol);
    if (!trade || trade.status !== 'OPEN') return null;

    // Check SL hit
    if ((trade.direction === 'LONG' && currentPrice <= trade.current_sl) ||
        (trade.direction === 'SHORT' && currentPrice >= trade.current_sl)) {

      const slType = trade.current_sl === trade.initial_sl ? 'INITIAL_SL' : (trade.sl_adjustments?.length ? trade.sl_adjustments[trade.sl_adjustments.length - 1].reason : 'ADJUSTED_SL');
      trade.exit_signal_type = 'STOP_LOSS';
      trade.exit_signal_reason = `${slType}: Price ${currentPrice} reached SL ${trade.current_sl}`;

      return {
        exitOccurred: true,
        exitType: 'CLOSED_SL',
        exitReason: 'SL_HIT',
      };
    }

    // Check TP hit
    if (trade.tp != null && trade.direction === 'LONG' && currentPrice >= trade.tp) {
      trade.exit_signal_type = 'TAKE_PROFIT';
      trade.exit_signal_reason = `Price ${currentPrice} >= TP ${trade.tp}`;
      return {
        exitOccurred: true,
        exitType: 'CLOSED_TP',
        exitReason: 'TP_HIT',
      };
    }

    if (trade.tp != null && trade.direction === 'SHORT' && currentPrice <= trade.tp) {
      trade.exit_signal_type = 'TAKE_PROFIT';
      trade.exit_signal_reason = `Price ${currentPrice} <= TP ${trade.tp}`;
      return {
        exitOccurred: true,
        exitType: 'CLOSED_TP',
        exitReason: 'TP_HIT',
      };
    }

    // Check exit signals
    const { exitTriggered, exitSignalType } = this.orderManager.checkExitSignals(
      symbol,
      trade,
      config,
      interval,
    );

    if (exitTriggered) {
      trade.exit_signal_type = exitSignalType;
      if (exitSignalType === 'combined') {
        trade.exit_signal_reason = `All signals fired: ${config.exit_signals?.join(', ')}`;
      } else {
        const status = trade.exit_signals_status?.[exitSignalType || ''];
        trade.exit_signal_reason = status?.description || `Signal ${exitSignalType} fired`;
      }

      return {
        exitOccurred: true,
        exitType: 'CLOSED_SIGNAL',
        exitReason: `SIGNAL_${exitSignalType}`,
      };
    }

    return null;
  }

  async closeTrade(
    symbol: string,
    exitPrice: number,
    exitReason: string,
    config?: SessionConfig,
    paperMode?: boolean,
    localOnly?: boolean,
  ): Promise<{ trade: Trade | null; exitOccurred: boolean }> {
    const trade = this.trades.get(symbol);
    if (!trade || trade.status !== 'OPEN' || this.closingSymbols.has(symbol)) {
      return { trade: null, exitOccurred: false };
    }

    this.closingSymbols.add(symbol);

    try {
    if (exitReason === 'MANUAL_CLOSE') {
      trade.exit_signal_type = 'MANUAL';
      trade.exit_signal_reason = 'User manually closed position';
    } else if (exitReason === 'SESSION_TERMINATED') {
      trade.exit_signal_type = 'SESSION_TERMINATED';
      trade.exit_signal_reason = 'Trading session was stopped by user';
    }

    const result = await this.orderManager.closeTrade(symbol, trade, exitPrice, exitReason, paperMode, localOnly);
    if (!result.exitOccurred || !result.trade) {
      this.closingSymbols.delete(symbol);
      return { trade: null, exitOccurred: false };
    }

    // Remove from tracking after exchange close/recording
    const existing = this.trades.get(symbol);
    if (existing) {
      this._totalRisk = roundEight(this._totalRisk - (existing.risk_usdt || 0));
    }
    this.trades.delete(symbol);
    this.closingSymbols.delete(symbol);
    this.rrSequenceIndex.delete(symbol);
    this._activeListCache = null;

    const msg = `Trade closed: ${symbol} Exit=${exitPrice} P&L=${result.trade.pnl.toFixed(2)} (${(result.trade.pnl_pct ?? 0).toFixed(2)}%) Reason=${exitReason}`;
    this.logger.log(msg);
    this.eventEmitter.emit(ENGINE_EVENTS.LOG_MESSAGE, { msg, level: 'info' });

    return { trade: result.trade, exitOccurred: true };
    } catch (err) {
      this.logger.error(`Error during closeTrade for ${symbol}: ${err instanceof Error ? err.message : String(err)}`);
      this.closingSymbols.delete(symbol);
      return { trade: null, exitOccurred: false };
    }
  }

  removeTrade(symbol: string): void {
    const existing = this.trades.get(symbol);
    if (existing) {
      this._totalRisk = roundEight(this._totalRisk - (existing.risk_usdt || 0));
    }
    this.trades.delete(symbol);
    this.rrSequenceIndex.delete(symbol);
    this._activeListCache = null;
  }

  /**
   * DATA-07: Manual recalculation of total risk to ensure state consistency
   */
  recalculateTotalRisk(): void {
    let risk = 0;
    for (const t of this.trades.values()) {
      risk += (t.risk_usdt || 0);
    }
    this._totalRisk = roundEight(risk);
  }
}
