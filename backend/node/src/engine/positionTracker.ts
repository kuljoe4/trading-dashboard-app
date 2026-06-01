import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { Trade } from '../models/Trade';
import { SessionConfig } from '../models/SessionConfig';
import { RiskEngineService } from './riskEngine';
import { SignalEngineService } from './signalEngine';
import { OrderManagerService } from './orderManager';
import { TickerCacheService } from './ticker_cache.service';
import { KlineStoreService } from './kline_store.service';

@Injectable()
export class PositionTrackerService {
  private readonly logger = new Logger(PositionTrackerService.name);

  private trades: Map<string, Trade> = new Map(); // symbol -> Trade
  private rrSequenceIndex: Map<string, number> = new Map(); // symbol -> current milestone index
  private onTradeUpdate: ((trade: Trade) => void) | null = null;

  constructor(
    private readonly riskEngine: RiskEngineService,
    private readonly signalEngine: SignalEngineService,
    @Inject(forwardRef(() => OrderManagerService))
    private readonly orderManager: OrderManagerService,
    private readonly tickerCache: TickerCacheService,
    private readonly klineStore: KlineStoreService,
  ) {}

  setCallbacks(onClose: (closed: any) => void, onTick: () => void) {
    // Callbacks would be set from server
  }

  setTradeUpdateCallback(cb: (trade: Trade) => void) {
    this.onTradeUpdate = cb;
  }

  hasSymbol(symbol: string): boolean {
    return this.trades.has(symbol);
  }

  activeList(): Trade[] {
    return Array.from(this.trades.values());
  }

  activeCount(): number {
    return this.trades.size;
  }

  /**
   * BOLT OPTIMIZATION: Use direct loop over Map values instead of creating an array.
   * Eliminates O(N) allocation in the 1s hot loop and 2s main loop.
   */
  totalRisk(): number {
    let sum = 0;
    for (const trade of this.trades.values()) {
      sum += trade.risk_usdt || 0;
    }
    return sum;
  }

  addTrade(trade: Trade): void {
    this.trades.set(trade.symbol, trade);
    this.rrSequenceIndex.set(trade.symbol, -1);
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
          trade.current_sl = newSl;
          trade.risk_usdt = Math.abs(trade.entry_price - trade.current_sl) * trade.qty;
          this.logSlAdjustment(trade, prevSl, newSl, currentIndex);
          // Update exchange-side SL in live mode
          this.orderManager.updateStopLoss(trade, newSl).catch(err => {
            this.logger.error(`Failed to update exchange SL for ${symbol}: ${err.message}`);
          });
          // Notify of trade state change for persistence
          if (this.onTradeUpdate) this.onTradeUpdate(trade);
        }
      } else if (trade.direction === 'SHORT' && newSl) {
        if (newSl < trade.current_sl) {
          const prevSl = trade.current_sl;
          trade.current_sl = newSl;
          trade.risk_usdt = Math.abs(trade.entry_price - trade.current_sl) * trade.qty;
          this.logSlAdjustment(trade, prevSl, newSl, currentIndex);
          // Update exchange-side SL in live mode
          this.orderManager.updateStopLoss(trade, newSl).catch(err => {
            this.logger.error(`Failed to update exchange SL for ${symbol}: ${err.message}`);
          });
          // Notify of trade state change for persistence
          if (this.onTradeUpdate) this.onTradeUpdate(trade);
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

    this.logger.verbose(
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
    if (trade.direction === 'LONG' && currentPrice <= trade.current_sl) {
      trade.exit_signal_type = 'STOP_LOSS';
      trade.exit_signal_reason = `Price ${currentPrice} <= SL ${trade.current_sl}`;
      return {
        exitOccurred: true,
        exitType: 'CLOSED_SL',
        exitReason: 'SL_HIT',
      };
    }

    if (trade.direction === 'SHORT' && currentPrice >= trade.current_sl) {
      trade.exit_signal_type = 'STOP_LOSS';
      trade.exit_signal_reason = `Price ${currentPrice} >= SL ${trade.current_sl}`;
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
  ): Promise<{ trade: Trade | null; exitOccurred: boolean }> {
    const trade = this.trades.get(symbol);
    if (!trade || trade.status !== 'OPEN') {
      return { trade: null, exitOccurred: false };
    }

    if (exitReason === 'MANUAL_CLOSE') {
      trade.exit_signal_type = 'MANUAL';
      trade.exit_signal_reason = 'User manually closed position';
    } else if (exitReason === 'SESSION_TERMINATED') {
      trade.exit_signal_type = 'SESSION_TERMINATED';
      trade.exit_signal_reason = 'Trading session was stopped by user';
    }

    const result = await this.orderManager.closeTrade(symbol, trade, exitPrice, exitReason);
    if (!result.exitOccurred || !result.trade) {
      return { trade: null, exitOccurred: false };
    }

    // Remove from tracking after exchange close/recording
    this.trades.delete(symbol);
    this.rrSequenceIndex.delete(symbol);

    this.logger.log(
      `Trade closed: ${symbol} Exit=${exitPrice} P&L=${result.trade.pnl.toFixed(2)} (${(result.trade.pnl_pct ?? 0).toFixed(2)}%) Reason=${exitReason}`,
    );

    return { trade: result.trade, exitOccurred: true };
  }

  removeTrade(symbol: string): void {
    this.trades.delete(symbol);
    this.rrSequenceIndex.delete(symbol);
  }
}
