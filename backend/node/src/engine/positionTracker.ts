import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
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
import { CONFIG_LIMITS, EXIT_REASONS } from '../models/constants';

@Injectable()
export class PositionTrackerService {
  private readonly logger = new Logger(PositionTrackerService.name);

  private trades: Map<string, Trade> = new Map(); // symbol -> Trade
  private enteringSymbols: Set<string> = new Set(); // symbols currently in the process of entering
  private inFlightEntries: Map<string, Trade> = new Map(); // symbols with dispatched orders but not yet in trades Map
  private pendingRisk: Map<string, number> = new Map(); // symbol -> reserved risk amount
  private closingSymbols: Set<string> = new Set(); // symbols currently in the process of closing
  private rrSequenceIndex: Map<string, number> = new Map(); // symbol -> current milestone index
  private _totalRisk = 0;
  private _pendingRiskTotal = 0; // BOLT: Track total pending risk in O(1)
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

  isClosing(symbol: string): boolean {
    return this.closingSymbols.has(symbol);
  }

  /**
   * BOLT: Full reset of internal tracking state to prevent leaks between sessions.
   */
  clear(): void {
    this.trades.clear();
    this.enteringSymbols.clear();
    this.inFlightEntries.clear();
    this.pendingRisk.clear();
    this.closingSymbols.clear();
    this.rrSequenceIndex.clear();
    this._totalRisk = 0;
    this._pendingRiskTotal = 0;
    this.sessionState.setActiveTrades([]);
    this._activeListCache = null;
    this.logger.log('[PositionTracker] Internal state cleared.');
  }

  activeList(): Trade[] {
    if (this._activeListCache) return this._activeListCache;
    this._activeListCache = Array.from(this.trades.values());
    return this._activeListCache;
  }

  activeCount(): number {
    return this.trades.size;
  }

  enteringCount(): number {
    return this.enteringSymbols.size;
  }

  getInFlightSymbols(): string[] {
    return Array.from(this.inFlightEntries.keys());
  }

  getInFlightEntry(symbol: string): Trade | undefined {
    return this.inFlightEntries.get(symbol);
  }

  setInFlight(symbol: string, trade: Trade): void {
    this.inFlightEntries.set(symbol, trade);
  }

  clearInFlight(symbol: string): void {
    this.inFlightEntries.delete(symbol);
  }

  /**
   * BOLT OPTIMIZATION: Returns pre-calculated total risk in O(1),
   * including pending risk reserved for trades currently entering.
   */
  totalRisk(): number {
    return roundEight(this._totalRisk + this._pendingRiskTotal);
  }

  setEntering(symbol: string, entering: boolean, reservedRisk = 0): void {
    if (entering) {
      this.enteringSymbols.add(symbol);
      if (reservedRisk > 0) {
        // If updating or re-setting, remove old reserved amount first to maintain O(1) sum
        const oldReserved = this.pendingRisk.get(symbol) || 0;
        const newTotal = this._pendingRiskTotal - oldReserved + reservedRisk;
        this._pendingRiskTotal = roundEight(Number.isFinite(newTotal) ? newTotal : 0);

        this.pendingRisk.set(symbol, reservedRisk);
        this.logger.debug(`[Risk Integrity] Reserved ${reservedRisk} USDT risk for ${symbol} entry. Total Pending: ${this._pendingRiskTotal}`);
      }
    } else {
      this.enteringSymbols.delete(symbol);
      const oldReserved = this.pendingRisk.get(symbol) || 0;
      if (oldReserved > 0) {
        const newTotal = this._pendingRiskTotal - oldReserved;
        this._pendingRiskTotal = roundEight(Number.isFinite(newTotal) ? newTotal : 0);
        this.pendingRisk.delete(symbol);
        this.logger.debug(`[Risk Integrity] Released ${oldReserved} USDT risk for ${symbol}. Total Pending: ${this._pendingRiskTotal}`);
      }
    }

    // SRE: Defensive catch-all to prevent drift from Map state
    if (!entering && this.enteringSymbols.size === 0 && this._pendingRiskTotal !== 0) {
       this.recalculateTotalRisk();
    }
  }

  addTrade(trade: Trade): void {
    // CHRONOS: Skip adding trades that were already closed while in-flight
    if (trade.status !== 'OPEN') {
      this.logger.debug(`[PositionTracker] Skipping addTrade for ${trade.symbol} - already in terminal status ${trade.status}`);
      this.clearInFlight(trade.symbol);
      this.setEntering(trade.symbol, false);
      return;
    }

    // Correctly handle symbol overwrites to prevent double-counting risk
    const existing = this.trades.get(trade.symbol);
    if (existing) {
      this._totalRisk = roundEight(this._totalRisk - (existing.risk_usdt || 0));
    }

    // SRE: Ensure risk is correctly calculated before adding to total
    this.refreshTradeRisk(trade, true);

    this.trades.set(trade.symbol, trade);
    // DATA-07: Initialize milestone tracker from trade state for persistent state recovery
    this.rrSequenceIndex.set(trade.symbol, trade.rr_sequence_index ?? -1);
    this._totalRisk = roundEight(this._totalRisk + (trade.risk_usdt || 0));

    // SRE: If we just added a trade, ensure we released the entering risk for this symbol
    if (this.enteringSymbols.has(trade.symbol)) {
       this.setEntering(trade.symbol, false);
    }

    // SRE: Remove from in-flight registry now that it's in active trades
    this.clearInFlight(trade.symbol);

    // BOLT: Proactively synchronize SessionState to prevent race conditions in UDS handlers
    this.sessionState.setActiveTrades(Array.from(this.trades.values()));

    this._activeListCache = null;
    this.eventEmitter.emit(ENGINE_EVENTS.WATCHLIST_NEEDS_UPDATE);
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

    // BOLT: Update peak RR on every tick to ensure high-fidelity analytics.
    // We only emit TRADE_UPDATED if it changes significantly (0.1 R) to avoid DB pressure.
    const oldMaxRr = trade.max_rr_achieved || 0;
    if (liveRr > oldMaxRr) {
      trade.max_rr_achieved = liveRr;
      if (liveRr - oldMaxRr >= 0.1) {
        this.eventEmitter.emit(ENGINE_EVENTS.TRADE_UPDATED, { trade });
      }
    }

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
    const prevIndex = this.rrSequenceIndex.get(symbol) ?? -1;
    if (currentIndex > prevIndex && currentIndex >= 0) {
      // SRE: Ratchet Race Guard. If an exchange-side mutation is already in flight for this symbol,
      // skip evaluation to prevent redundant overlapping requests.
      if (this.orderManager.isRatcheting(symbol)) {
         return;
      }

      // Get target RR for this milestone
      const exitRr = exitRrSequence[currentIndex] ?? 0;

      // Calculate new SL based on target RR
      let targetSl: number;
      if (trade.direction === 'LONG') {
        // For LONG: breakeven is entry; positive exit RR locks profit above entry.
        targetSl = trade.entry_price + risk * exitRr;
      } else {
        // For SHORT: breakeven is entry; positive exit RR locks profit below entry.
        targetSl = trade.entry_price - risk * exitRr;
      }

      if (isNaN(targetSl) || !isFinite(targetSl) || targetSl <= 0) {
        this.logger.debug(`[RrSequence] Derived target SL ${targetSl} for ${symbol} is invalid or non-positive. Skipping adjustment.`);
        return;
      }

      // DATA-07: Ensure the target SL is filtered/rounded to exchange tick size BEFORE comparison.
      // This prevents infinite cancel-replace loops caused by precision mismatches between
      // internal float math (e.g. 0.1886835) and exchange tick sizes (e.g. 0.1887).
      const filtered = this.orderManager.applyFilters(symbol, targetSl, trade.qty, {
        priceRounding: trade.direction === 'LONG' ? 'floor' : 'ceil',
        skipNotionalCheck: true
      });
      let newSl = filtered.price;

      // Audit Item: Dynamic Trailing Boundary Guard
      // Prevents "Order would immediately trigger" rejections and instant fills by ensuring
      // the new SL is not too close to (or beyond) the current market price.
      const bufferPct = config.trailing_guard_buffer_pct ?? CONFIG_LIMITS.TRAILING_GUARD_DEFAULT;
      const buffer = currentPrice * (bufferPct / 100);
      if (trade.direction === 'LONG') {
        if (newSl >= currentPrice - buffer) {
          const msg = `[Trailing Guard] Long SL ${Number(newSl || 0).toFixed(5)} capped at ${ Number(currentPrice - buffer).toFixed(5)} (Market: ${Number(currentPrice || 0).toFixed(5)})`;
          this.logger.warn(msg);
          this.eventEmitter.emit(ENGINE_EVENTS.LOG_MESSAGE, { msg, level: 'warn' });
          newSl = currentPrice - buffer;
        }
      } else {
        if (newSl <= currentPrice + buffer) {
          const msg = `[Trailing Guard] Short SL ${Number(newSl || 0).toFixed(5)} capped at ${ Number(currentPrice + buffer).toFixed(5)} (Market: ${Number(currentPrice || 0).toFixed(5)})`;
          this.logger.warn(msg);
          this.eventEmitter.emit(ENGINE_EVENTS.LOG_MESSAGE, { msg, level: 'warn' });
          newSl = currentPrice + buffer;
        }
      }

      // Only move SL deeper into profit (stricter protection)
      // PERFORMANCE: Apply a minimum delta guard (0.01% of entry) to reduce order-count rate limit pressure.
      const minDelta = trade.entry_price * 0.0001;

      let shouldUpdate = false;
      if (trade.direction === 'LONG' && newSl) {
        // BOLT: Use epsilon + minDelta comparison to avoid loops on tiny float differences
        shouldUpdate = newSl > trade.current_sl + Math.max(0.00000001, minDelta);
      } else if (trade.direction === 'SHORT' && newSl) {
        shouldUpdate = newSl < trade.current_sl - Math.max(0.00000001, minDelta);
      }

      if (shouldUpdate) {
        const prevSl = trade.current_sl;

        // Acknowledge-then-Update: Update exchange first in live mode
        const updateRes = await this.orderManager.updateStopLoss(trade, newSl, prevSl);

        if (updateRes.success) {
           const finalSl = updateRes.price || newSl;

           // Acknowledge-then-Commit: Only update local state after exchange confirmation
           this.rrSequenceIndex.set(symbol, currentIndex);
           trade.rr_sequence_index = currentIndex;
           trade.updated_at = new Date();
           trade.current_sl = finalSl;

           // SRE: Live Risk Mitigation.
           // Automatically handles risk release and updates _totalRisk via refreshTradeRisk
           this.refreshTradeRisk(trade);

           this.logSlAdjustment(trade, prevSl, finalSl, currentIndex, !!updateRes.price && updateRes.price !== newSl);

           // Notify of trade state change for persistence
           this.eventEmitter.emit(ENGINE_EVENTS.TRADE_UPDATED, { trade });
        } else {
           this.logger.warn(`[SL Ratchet] Local state for ${symbol} SL update rolled back due to exchange failure.`);
        }
      }
    }
  }

  private logSlAdjustment(
    trade: Trade,
    prevSl: number,
    newSl: number,
    milestoneIndex: number,
    adaptive = false,
  ): void {
    const adjustment = {
      timestamp: new Date().toISOString(),
      prev_sl: prevSl,
      new_sl: newSl,
      reason: `RR_sequence_milestone_${milestoneIndex}`,
      milestone_index: milestoneIndex,
      max_rr_achieved: trade.max_rr_achieved,
      adaptive,
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
        exitReason: `${EXIT_REASONS.SL_HIT}_${slType}`,
      };
    }

    // Check TP hit
    if (trade.tp != null && trade.direction === 'LONG' && currentPrice >= trade.tp) {
      trade.exit_signal_type = 'TAKE_PROFIT';
      trade.exit_signal_reason = `Price ${currentPrice} >= TP ${trade.tp}`;
      return {
        exitOccurred: true,
        exitType: 'CLOSED_TP',
        exitReason: EXIT_REASONS.TP_HIT,
      };
    }

    if (trade.tp != null && trade.direction === 'SHORT' && currentPrice <= trade.tp) {
      trade.exit_signal_type = 'TAKE_PROFIT';
      trade.exit_signal_reason = `Price ${currentPrice} <= TP ${trade.tp}`;
      return {
        exitOccurred: true,
        exitType: 'CLOSED_TP',
        exitReason: EXIT_REASONS.TP_HIT,
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
      // DYNAMIC MULTI-LAYER ACTIONS: Check if any of the active fired signals trigger a 'close' vs 'lock_sl'
      const actions = config.exit_signal_actions || {};
      const statusMap = trade.exit_signals_status || {};
      const firedActiveKeys = Object.keys(statusMap).filter(k => statusMap[k].fired && statusMap[k].active);

      const hasCloseAction = firedActiveKeys.some(k => !actions[k] || actions[k] === 'close');

      if (hasCloseAction || config.exit_signal_logic === 'all') {
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
          exitReason: `${EXIT_REASONS.SIGNAL}_${exitSignalType?.toUpperCase()}`,
        };
      } else {
        // ONLY lock_sl ACTIONS FIRED: Ratchet Stop Loss instead of market closing position
        for (const sigKey of firedActiveKeys) {
          if (actions[sigKey] === 'lock_sl') {
            const sigStatus = statusMap[sigKey];
            let proposedSlPrice = sigStatus.value; // Value can be the crossover/EMA price

            if (!sigStatus.threshold_is_price || isNaN(proposedSlPrice) || !isFinite(proposedSlPrice) || proposedSlPrice <= 0) {
              proposedSlPrice = currentPrice; // Fallback to current price if threshold is not price
            }

            // Apply filters & rounding
            const filtered = this.orderManager.applyFilters(symbol, proposedSlPrice, trade.qty, {
              priceRounding: trade.direction === 'LONG' ? 'floor' : 'ceil',
              skipNotionalCheck: true
            });
            let roundedSl = filtered.price;

            // Apply Trailing Stop/Milestone boundary safety buffer
            const bufferPct = config.trailing_guard_buffer_pct ?? CONFIG_LIMITS.TRAILING_GUARD_DEFAULT;
            const buffer = currentPrice * (bufferPct / 100);
            if (trade.direction === 'LONG') {
              roundedSl = Math.min(roundedSl, currentPrice - buffer);
            } else {
              roundedSl = Math.max(roundedSl, currentPrice + buffer);
            }

            // Only update SL if it improves protection
            const minDelta = trade.entry_price * 0.0001;
            let shouldUpdate = false;
            if (trade.direction === 'LONG') {
              shouldUpdate = roundedSl > trade.current_sl + Math.max(0.00000001, minDelta);
            } else {
              shouldUpdate = roundedSl < trade.current_sl - Math.max(0.00000001, minDelta);
            }

            if (shouldUpdate && !this.orderManager.isRatcheting(symbol)) {
              const prevSl = trade.current_sl;
              this.logger.log(`[Multi-Layer Exit] ${symbol} triggering Lock SL for signal ${sigKey}: ${prevSl} -> ${roundedSl}`);

              this.orderManager.updateStopLoss(trade, roundedSl, prevSl).then(updateRes => {
                if (updateRes.success) {
                  const finalSl = updateRes.price || roundedSl;
                  trade.current_sl = finalSl;
                  trade.updated_at = new Date();
                  this.refreshTradeRisk(trade);
                  this.logSlAdjustment(trade, prevSl, finalSl, -3, !!updateRes.price && updateRes.price !== roundedSl);
                  this.eventEmitter.emit(ENGINE_EVENTS.TRADE_UPDATED, { trade });
                }
              }).catch(err => {
                this.logger.error(`[Multi-Layer Exit] Failed to update SL via lock_sl action for ${symbol}: ${err.message}`);
              });
            }
          }
        }
      }
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
    options: { ignoreBlocked?: boolean, orderId?: string, feesAlreadyAccounted?: boolean, alreadyRealized?: boolean, needsMarketClose?: boolean } = {}
  ): Promise<{ trade: Trade | null; exitOccurred: boolean; closeBlocked?: boolean, error?: string }> {
    // CHRONOS: Fallback to in-flight registry if not in active trades (Race Condition Guard)
    let trade = this.trades.get(symbol);
    let isInFlight = false;

    if (!trade) {
       trade = this.inFlightEntries.get(symbol);
       if (trade) {
          isInFlight = true;
          this.logger.log(`[Chronos] Found in-flight trade for ${symbol} closure. Local Map recovery active.`);
       }
    }

    if (!trade || trade.status !== 'OPEN' || this.closingSymbols.has(symbol)) {
      return { trade: null, exitOccurred: false };
    }

    this.closingSymbols.add(symbol);

    try {
    if (exitReason === EXIT_REASONS.MANUAL_CLOSE) {
      trade.exit_signal_type = 'MANUAL';
      trade.exit_signal_reason = 'User manually closed position';
    } else if (exitReason === EXIT_REASONS.SESSION_TERMINATED) {
      trade.exit_signal_type = 'SESSION_TERMINATED';
      trade.exit_signal_reason = 'Trading session was stopped by user';
    }

    const result = await this.orderManager.closeTrade(symbol, trade, exitPrice, exitReason, paperMode, localOnly, options);
    if (!result.exitOccurred || !result.trade) {
      this.closingSymbols.delete(symbol);
      return { trade: null, exitOccurred: false, closeBlocked: result.closeBlocked, error: result.error };
    }

    // Remove from tracking after exchange close/recording
    const existing = this.trades.get(symbol);
    this.trades.delete(symbol);
    this.clearInFlight(symbol);
    this.setEntering(symbol, false);
    this.closingSymbols.delete(symbol);
    this.rrSequenceIndex.delete(symbol);
    this._activeListCache = null;
    this.recalculateTotalRisk();

    // BOLT: Proactively synchronize SessionState to prevent race conditions in UI/UDS handlers
    this.sessionState.setActiveTrades(Array.from(this.trades.values()));

    this.eventEmitter.emit(ENGINE_EVENTS.WATCHLIST_NEEDS_UPDATE);

    const finalizedExitPrice = result.trade.exit_price || exitPrice;
    const finalizedExitReason = result.trade.exit_reason || exitReason;
    const msg = `Trade closed: ${symbol} Exit=${finalizedExitPrice} P&L=${Number(result.trade.pnl || 0).toFixed(2)} (${Number(result.trade.pnl_pct || 0).toFixed(2)}%) Reason=${finalizedExitReason}`;
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
    this.trades.delete(symbol);
    this.rrSequenceIndex.delete(symbol);
    this.sessionState.setActiveTrades(Array.from(this.trades.values()));
    this._activeListCache = null;
    this.recalculateTotalRisk();
    this.eventEmitter.emit(ENGINE_EVENTS.WATCHLIST_NEEDS_UPDATE);
  }

  /**
   * SRE: Risk calculation helper.
   * Enforces the "Breakeven Risk Release" rule: risk is 0 if SL is at or beyond entry.
   * Otherwise, risk is based on the initial stop distance.
   */
  public refreshTradeRisk(trade: Trade, skipTotalRiskUpdate = false): void {
    const prevRisk = trade.risk_usdt || 0;

    // SRE: Increased tolerance for breakeven detection (0.01% or 0.00000001)
    // to handle exchange-side rounding/flooring that might place SL 1 tick below entry.
    const tolerance = Math.max(0.00000001, trade.entry_price * 0.0001);

    const isBreakevenOrBetter = trade.direction === 'LONG'
      ? trade.current_sl >= trade.entry_price - tolerance
      : trade.current_sl <= trade.entry_price + tolerance;

    if (isBreakevenOrBetter) {
      trade.risk_usdt = 0;
    } else {
      const slDistance = Math.abs(trade.entry_price - trade.initial_sl);
      trade.risk_usdt = roundEight(slDistance * trade.qty);
    }

    if (!skipTotalRiskUpdate && this.trades.has(trade.symbol) && prevRisk > 0 && trade.risk_usdt === 0) {
      this._totalRisk = roundEight(Math.max(0, this._totalRisk - prevRisk));
      this.logger.log(`[Risk Mitigation] ${trade.symbol} reached breakeven. Risk released: ${prevRisk} USDT. New Total Risk: ${this._totalRisk}`);
    }
  }

  /**
   * DATA-07: Manual recalculation of total risk to ensure state consistency
   */
  @OnEvent(ENGINE_EVENTS.QUANTITY_SYNC)
  handleQuantitySync(payload: { symbol: string, qty: number }) {
    const trade = this.trades.get(payload.symbol);
    if (trade && trade.status === 'OPEN') {
      const tradeIdShort8 = (trade.id || 'N/A').substring(0, 8);
      this.logger.log(`[${tradeIdShort8}] [Sync] Synchronizing risk for ${payload.symbol} after quantity update to ${payload.qty}`);

      // Update quantity before risk calculation for consistency
      trade.qty = payload.qty;
      this.refreshTradeRisk(trade, true);
      trade.updated_at = new Date();

      this.recalculateTotalRisk();
      this.eventEmitter.emit(ENGINE_EVENTS.TRADE_UPDATED, { trade });

      // Reactive Watchdog Audit to ensure SL order matches new quantity
      this.eventEmitter.emit('watchdog.reactive_audit', { symbol: payload.symbol });
    }
  }

  recalculateTotalRisk(): void {
    let activeRisk = 0;
    for (const t of this.trades.values()) {
      this.refreshTradeRisk(t, true);
      activeRisk += (t.risk_usdt || 0);
    }
    this._totalRisk = roundEight(activeRisk);

    let pendingRiskSum = 0;
    for (const r of this.pendingRisk.values()) {
      pendingRiskSum += r;
    }
    this._pendingRiskTotal = roundEight(pendingRiskSum);
  }

  /**
   * SRE: State reconciliation for SL ratcheting.
   * If we adopt an untracked SL, we derive the most likely milestone index
   * to ensure the local 'rr_sequence_index' state is consistent for future ratchets.
   * Uses a "Ladder Discovery" approach: finds the highest milestone already passed by the exchange SL.
   */
  public reconcileMilestoneFromSl(trade: Trade, slPrice: number, config: SessionConfig): number {
    const risk = Math.abs(trade.entry_price - trade.initial_sl);
    if (risk <= 0) return trade.rr_sequence_index ?? -1;

    const exitRrSequence = config.exit_rr_sequence || [];
    let bestIndex = -1; // Default to pre-milestone

    for (let i = 0; i < exitRrSequence.length; i++) {
      const exitRr = exitRrSequence[i];
      let milestoneSl: number;

      if (trade.direction === 'LONG') {
        milestoneSl = trade.entry_price + risk * exitRr;
        // If exchange SL is at or beyond this milestone (with tiny epsilon for float precision)
        if (slPrice >= milestoneSl - Math.max(0.00000001, milestoneSl * 0.0001)) {
          bestIndex = i;
        }
      } else {
        milestoneSl = trade.entry_price - risk * exitRr;
        // If exchange SL is at or beyond this milestone
        if (slPrice <= milestoneSl + Math.max(0.00000001, milestoneSl * 0.0001)) {
          bestIndex = i;
        }
      }
    }

    if (bestIndex !== trade.rr_sequence_index) {
      this.logger.log(`[Reconciliation] ${trade.symbol} reconciling milestone index from SL price: ${trade.rr_sequence_index} -> ${bestIndex}`);
      trade.rr_sequence_index = bestIndex;

      // DATA-07: Also reconcile max_rr_achieved to match the discovered milestone
      // to ensure the ladder continues from the correct peak.
      if (bestIndex !== -1 && config.live_rr_sequence?.[bestIndex] !== undefined) {
        trade.max_rr_achieved = Math.max(trade.max_rr_achieved || 0, config.live_rr_sequence[bestIndex]);
      }

      // BOLT: Only update the internal map if this trade is already tracked
      if (this.trades.has(trade.symbol)) {
        this.rrSequenceIndex.set(trade.symbol, bestIndex);
      }
    }

    return bestIndex;
  }

  async checkTrailingStop(
    symbol: string,
    currentPrice: number,
    config: SessionConfig,
  ): Promise<void> {
    const trade = this.trades.get(symbol);
    if (!trade || trade.status !== 'OPEN' || !config.trailing_stop_enabled) return;

    const distancePct = config.trailing_stop_distance_pct || 1.0;
    const distance = trade.entry_price * (distancePct / 100);

    let prospectiveSl: number;
    if (trade.direction === 'LONG') {
      prospectiveSl = currentPrice - distance;
    } else {
      prospectiveSl = currentPrice + distance;
    }

    if (isNaN(prospectiveSl) || !isFinite(prospectiveSl) || prospectiveSl <= 0) {
      this.logger.debug(`[TrailingStop] Prospective SL ${prospectiveSl} for ${symbol} is invalid or non-positive. Skipping trailing stop update.`);
      return;
    }

    const filtered = this.orderManager.applyFilters(symbol, prospectiveSl, trade.qty, {
      priceRounding: trade.direction === 'LONG' ? 'floor' : 'ceil',
      skipNotionalCheck: true
    });
    let newSl = filtered.price;

    const bufferPct = config.trailing_guard_buffer_pct ?? CONFIG_LIMITS.TRAILING_GUARD_DEFAULT;
    const buffer = currentPrice * (bufferPct / 100);

    if (trade.direction === 'LONG') {
      newSl = Math.min(newSl, currentPrice - buffer);
    } else {
      newSl = Math.max(newSl, currentPrice + buffer);
    }

    const minDelta = trade.entry_price * 0.0001;
    let shouldUpdate = false;

    if (trade.direction === 'LONG') {
      shouldUpdate = newSl > trade.current_sl + Math.max(0.00000001, minDelta);
    } else {
      shouldUpdate = newSl < trade.current_sl - Math.max(0.00000001, minDelta);
    }

    if (shouldUpdate) {
      if (this.orderManager.isRatcheting(symbol)) return;

      const prevSl = trade.current_sl;
      const updateRes = await this.orderManager.updateStopLoss(trade, newSl, prevSl);

      if (updateRes.success) {
        const finalSl = updateRes.price || newSl;
        trade.current_sl = finalSl;
        trade.updated_at = new Date();
        this.refreshTradeRisk(trade);
        this.logSlAdjustment(trade, prevSl, finalSl, -2, !!updateRes.price && updateRes.price !== newSl);
        this.eventEmitter.emit(ENGINE_EVENTS.TRADE_UPDATED, { trade });
      }
    }
  }
}
