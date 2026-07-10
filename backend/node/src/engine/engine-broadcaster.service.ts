import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { Trade } from '../models/Trade';
import { SessionConfig } from '../models/SessionConfig';
import { TickerCacheService } from './ticker_cache.service';
import { SessionStateService } from './session_state.service';
import { MonitoringService } from './monitoring.service';
import { AnalyticsService } from './analytics.service';
import { BroadcastService } from './broadcast.service';
import { VariantAnalyticsService } from './variant-analytics.service';
import { RiskEngineService } from './riskEngine';
import { PositionTrackerService } from './positionTracker';
import { TradeSerializationDto, TickTradeDto } from '../trading/dto/trade-serialization.dto';
import { roundEight, roundTo } from '../lib/math';

@Injectable()
export class EngineBroadcasterService {
  private readonly logger = new Logger(EngineBroadcasterService.name);
  private lastTickData: any = null;
  private lastTickTime = 0;
  private lastAnalyticsResult: any = null;
  private lastRiskResult: any = null;
  private lastAnalyticsTradeCount = -1;
  private lastAnalyticsStartingBalance = -1;
  /**
   * BOLT OPTIMIZATION: Track the last state successfully broadcast to clients.
   * This ensures true delta updates even if tick data is cleared or partial.
   */
  private lastSentTrades = new Map<string, TickTradeDto>();

  constructor(
    private readonly tickerCache: TickerCacheService,
    private readonly sessionState: SessionStateService,
    private readonly monitoringService: MonitoringService,
    private readonly analyticsService: AnalyticsService,
    private readonly broadcastService: BroadcastService,
    private readonly variantAnalytics: VariantAnalyticsService,
    private readonly riskEngine: RiskEngineService,
    @Inject(forwardRef(() => PositionTrackerService)) private readonly positionTracker: PositionTrackerService,
  ) {}

  /**
   * BOLT OPTIMIZATION: Move strategy label helper to class level to avoid re-allocation in hot path.
   */
  private getStrategyLabel(c: Partial<SessionConfig> | null | undefined): string {
    return (c?.strategy_label || 'Momentum Strategy').toString();
  }

  /**
   * BOLT OPTIMIZATION: Clears broadcast caches to minimize RAM.
   */
  minimize() {
    this.lastTickData = null;
    this.lastSentTrades.clear();
    this.lastAnalyticsResult = null;
    this.lastAnalyticsTradeCount = -1;
    this.logger.verbose('EngineBroadcasterService: Broadcast caches cleared');
  }

  public getLastTickData(): any { return this.lastTickData; }
  public getLastRiskResult(): any { return this.lastRiskResult; }
  public getLastAnalyticsResult(): any { return this.lastAnalyticsResult; }

  /**
   * DATA-07: Get the current trades list from the last broadcast tick.
   */
  public getLastTickTrades(): TickTradeDto[] {
    return this.lastTickData?.trades || [];
  }

  /**
   * DATA-07: Get the current scanner results from the last broadcast tick.
   */
  public getLastScannerResults(): any[] {
    return this.lastTickData?.scannerResults || [];
  }

  public serializeTrade(trade: Trade, config: SessionConfig, currentPrice?: number, minimal = false): TradeSerializationDto {
    const direction = (trade.direction || 'LONG').toString().toUpperCase() as 'LONG' | 'SHORT';
    const entry = trade.entry_price ?? 0;
    const cpv = currentPrice !== undefined && Number.isFinite(currentPrice) && currentPrice > 0;
    const current = cpv ? currentPrice : trade.exit_price ?? trade.last_price ?? entry;

    if (cpv) {
      trade.last_price = currentPrice;
      trade.mark_price = currentPrice;
    }

    let pnl = 0;
    let rrValue = 0;
    let pnlPct = 0;

    const isTerminal = trade.status !== 'OPEN';

    if (isTerminal) {
      // DATA-CONSISTENCY: For terminal trades, use stored Net values to ensure fees are reflected in history
      pnl = trade.pnl ?? 0;
      pnlPct = trade.pnl_pct ?? 0;

      const exitPrice = trade.exit_price ?? entry;
      const risk = Math.abs(entry - (trade.initial_sl ?? entry)) || 1;
      rrValue = (direction === 'LONG' ? (exitPrice - entry) : (entry - exitPrice)) / risk;
    } else if (current !== undefined && Number.isFinite(current) && Number.isFinite(entry)) {
      const grossPnl = direction === 'LONG' ? (current - entry) * (trade.qty ?? 0) : (entry - current) * (trade.qty ?? 0);

      // BOLT: For active trades, we display Unrealized PnL (Gross) to match exchange UI.
      // Total wallet balance already accounts for entry fees, so we only subtract realized_fee
      // during the final trade closure recording in the database.
      pnl = roundEight(grossPnl);
      pnlPct = entry ? ((current - entry) / entry) * 100 * (direction === 'LONG' ? 1 : -1) : 0;

      const risk = Math.abs(entry - (trade.initial_sl ?? trade.current_sl ?? entry)) || 1;
      rrValue = (direction === 'LONG' ? (current - entry) : (entry - current)) / risk;
    }

    if (minimal) {
      return {
        id: trade.id,
        symbol: trade.symbol,
        strategy_label: trade.strategy_label || this.getStrategyLabel(trade.strategy_config || config),
        current_price: roundTo(current ?? entry, 8),
        sl_price: roundTo(trade.current_sl, 8),
        tp_price: roundTo(trade.tp, 8),
        pnl: roundTo(pnl, 2),
        pnl_pct: roundTo(pnlPct, 4),
        realized_fee: roundTo(trade.realized_fee, 2),
        funding_fee: roundTo(trade.funding_fee || 0, 2),
        rr: roundTo(rrValue, 4),
        max_rr: roundTo(trade.max_rr_achieved ?? 0, 4),
        direction,
        entry_price: roundTo(entry, 8),
        qty: roundTo(trade.qty ?? 0, 8),
        exit_signals_status: trade.exit_signals_status || {},
        sl_adjustments: trade.sl_adjustments || [],
        entry_daily_change_pct: trade.entry_daily_change_pct,
        initial_risk_usdt: trade.initial_risk_usdt ?? undefined,
        close_attempts: trade.close_attempts,
        close_blocked: trade.close_blocked,
        _delta: true,
      };
    }

    return {
      ...trade,
      direction,
      entry_daily_change_pct: trade.entry_daily_change_pct,
      initial_risk_usdt: trade.initial_risk_usdt ?? undefined,
      close_attempts: trade.close_attempts,
      close_blocked: trade.close_blocked,
      current_price: roundTo(current ?? entry, 8),
      sl_price: roundTo(trade.current_sl, 8),
      tp_price: roundTo(trade.tp, 8),
      pnl: roundTo(pnl, 2),
      pnl_pct: roundTo(pnlPct, 4),
      realized_fee: roundTo(trade.realized_fee, 2),
      funding_fee: roundTo(trade.funding_fee || 0, 2),
      rr: roundTo(rrValue, 4),
      paper_mode: config?.paper_mode,
      trading_mode: config?.trading_mode || (config?.paper_mode ? 'paper' : 'live'),
      max_rr: roundTo(trade.max_rr_achieved ?? 0, 4),
      strategy_label: trade.strategy_label || this.getStrategyLabel(trade.strategy_config || config),
      strategy_config: trade.strategy_config,
      live_rr_sequence: trade.strategy_config?.live_rr_sequence || config?.live_rr_sequence || [],
      exit_rr_sequence: trade.strategy_config?.exit_rr_sequence || config?.exit_rr_sequence || [],
      exit_signal_logic: trade.strategy_config?.exit_signal_logic || config?.exit_signal_logic || 'any',
      tp_mode: trade.strategy_config?.tp_mode || config?.tp_mode || 'fixed',
      tp_ratio: trade.strategy_config?.tp_ratio || config?.tp_ratio || 2,
    };
  }

  /**
   * BOLT OPTIMIZATION: High-performance serialization for the broadcast tick.
   * Avoids double-allocations and redundant mapping by returning TickTradeDto directly.
   */
  public serializeTickTrade(trade: Trade, config: SessionConfig, current: number, pnlValue: number, rrValue: number): TickTradeDto {
    const direction = (trade.direction || 'LONG').toString().toUpperCase() as 'LONG' | 'SHORT';
    const entry = trade.entry_price ?? 0;

    return {
      id: trade.id,
      symbol: trade.symbol,
      strategy_label: trade.strategy_label || this.getStrategyLabel(trade.strategy_config || config),
      current_price: roundTo(current, 8),
      sl_price: roundTo(trade.current_sl, 8),
      tp_price: roundTo(trade.tp, 8),
      pnl: roundTo(pnlValue, 2),
      pnl_pct: entry ? roundTo(((current - entry) / entry) * 100 * (direction === 'LONG' ? 1 : -1), 4) : 0,
      realized_fee: roundTo(trade.realized_fee, 2),
      funding_fee: roundTo(trade.funding_fee || 0, 2),
      rr: roundTo(rrValue, 4),
      max_rr: roundTo(trade.max_rr_achieved ?? 0, 4),
      direction,
      entry_price: roundTo(entry, 8),
      qty: roundTo(trade.qty ?? 0, 8),
      entry_daily_change_pct: trade.entry_daily_change_pct,
      close_attempts: trade.close_attempts,
      close_blocked: trade.close_blocked,
      initial_risk_usdt: trade.initial_risk_usdt ?? undefined,
      _thin: true,
      _sl_len: trade.sl_adjustments?.length || 0,
      _sig_json: trade._sig_json || JSON.stringify(trade.exit_signals_status || {}),
      live_rr_sequence: trade.strategy_config?.live_rr_sequence || config?.live_rr_sequence || [],
      exit_rr_sequence: trade.strategy_config?.exit_rr_sequence || config?.exit_rr_sequence || [],
    };
  }

  /**
   * Refactor: Move tiered fidelity logic from server.ts to a dedicated method
   * to decouple business/display logic from the transport layer.
   */
  public getFidelityTick(payload: any, client: any): any {
    if (payload.type !== 'tick') return payload;

    const tick = { ...payload };

    if (tick.trades && Array.isArray(tick.trades)) {
      tick.trades = tick.trades.map((trade: any) => {
        // BOLT: If trade is already thin (from a tick delta), we can skip most stripping
        // unless focused fidelity is requested.
        const isThin = trade._thin === true;

        // 1. Full Fidelity: ONLY for a specific focused trade ID
        const isFullFidelity = client.focusMode && client.focusTradeId === trade.id;

        // 2. Mid Fidelity: For a strategy list or the global trades view
        const isMidFidelity = client.focusMode &&
          (client.focusTradeId === 'all' || client.focusStrategyLabel === trade.strategy_label);

        if (isFullFidelity) {
          return trade;
        }

        if (isThin && !isMidFidelity) return trade;

        // Strip heavy diagnostics for everyone else
        const {
          strategy_config,
          live_rr_sequence,
          exit_rr_sequence,
          exit_signals_status,
          sl_adjustments,
          tp_mode,
          tp_ratio,
          exit_signal_logic,
          ...thinTrade
        } = trade;

        if (isMidFidelity) {
          return {
            ...thinTrade,
            live_rr_sequence: trade.live_rr_sequence,
            exit_rr_sequence: trade.exit_rr_sequence,
            _thin: true,
          };
        }

        // Low Fidelity: For Dashboard overview (No sequences, no logs)
        return { ...thinTrade, _thin: true };
      });
    }

    if (!client.focusMode) {
      tick.activeWindows = [];
    }

    if (client.monitoringEnabled === false) {
      delete tick.monitoring;
    }

    return tick;
  }

  public broadcastTick(
    activeTrades: Trade[],
    config: SessionConfig,
    strategyConfigs: SessionConfig[],
    isEcoMode: boolean,
    getActiveWindows: () => any[],
    getBinanceRateLimit: () => any
  ) {
    if (this.sessionState.listenerCount === 0) return;

    const now = Date.now();
    const isHeartbeat = !this.lastTickData || (now - this.lastTickTime > 10000);

    const trades: TickTradeDto[] = [];
    const len = activeTrades.length;
    let anyPriceChangedSignificant = false;
    let activePnl = 0;
    let totalRiskUsdt = 0;
    const hasVariants = !!(config?.strategy_variants?.length);
    const variantGroups: Record<string, { pnl: number, risk: number, count: number, hits: number }> = {};
    const priceCache = new Map<string, number | null>();

    const riskResult = this.riskEngine.canEnter(this.positionTracker.activeList(), this.sessionState.closedTrades, this.sessionState.getBalance(config?.paper_mode ?? true), 'DUMMY', config, this.positionTracker.totalRisk());
    this.lastRiskResult = riskResult;

    const currentTickSentTrades = new Map<string, TickTradeDto>();

    for (let i = 0; i < len; i++) {
      const trade = activeTrades[i];
      const prevTrade = this.lastSentTrades.get(trade.id);

      let currentPrice = priceCache.get(trade.symbol);
      if (currentPrice === undefined) {
        currentPrice = this.tickerCache.getPrice(trade.symbol);
        priceCache.set(trade.symbol, currentPrice);
      }

      if (currentPrice === null && prevTrade) currentPrice = prevTrade.current_price;

      const current = currentPrice ?? trade.exit_price ?? trade.last_price ?? trade.entry_price;
      if (currentPrice !== null) {
        trade.last_price = currentPrice;
        trade.mark_price = currentPrice;
      }

      const direction = trade.direction || 'LONG';
      const entry = trade.entry_price || 0;
      const qty = trade.qty || 0;
      const grossPnl = direction === 'LONG' ? (current - entry) * qty : (entry - current) * qty;

      // BOLT: Match exchange Unrealized PnL (Gross)
      const pnlValue = roundEight(grossPnl);
      activePnl += pnlValue;
      totalRiskUsdt += (trade.risk_usdt || 0);

      const riskDist = Math.abs(entry - (trade.initial_sl ?? trade.current_sl ?? entry)) || 1;
      const rrValue = (direction === 'LONG' ? (current - entry) : (entry - current)) / riskDist;

      if (hasVariants) {
        const label = trade.strategy_label || 'Momentum Strategy';
        if (!variantGroups[label]) variantGroups[label] = { pnl: 0, risk: 0, count: 0, hits: 0 };
        const g = variantGroups[label];
        g.pnl = roundEight(g.pnl + pnlValue);
        g.risk = roundEight(g.risk + (trade.risk_usdt || 0));
        g.count++;
        if (pnlValue > 0) g.hits++;
      }

      let tradeChanged = !prevTrade || isHeartbeat;
      if (!tradeChanged && prevTrade) {
        if (trade.current_sl !== prevTrade.sl_price || trade.max_rr_achieved !== prevTrade.max_rr || trade.direction !== prevTrade.direction) {
          tradeChanged = true;
        } else if ((trade.sl_adjustments?.length || 0) !== (prevTrade._sl_len || 0)) {
          tradeChanged = true;
        } else if (trade._sig_json !== prevTrade._sig_json) {
          tradeChanged = true;
        } else {
          const pnlDelta = Math.abs(pnlValue - (prevTrade.pnl || 0));
          // BOLT: Standard operational thresholds for broadcast balance.
          if (pnlDelta >= 0.05) {
            tradeChanged = true;
            anyPriceChangedSignificant = true;
          } else {
            const priceMoveRatio = Math.abs(current - (prevTrade.current_price || 0)) / (prevTrade.current_price || 1);
            if (priceMoveRatio >= 0.0001) {
                tradeChanged = true;
            } else {
              if (Math.abs(rrValue - (prevTrade.rr || 0)) >= 0.01) {
                tradeChanged = true;
                anyPriceChangedSignificant = true;
              }
            }
          }
        }
      }

      if (tradeChanged) {
        const thin = this.serializeTickTrade(trade, config, current, pnlValue, rrValue);
        trades.push(thin);
        currentTickSentTrades.set(trade.id, thin);
      } else if (prevTrade) {
        currentTickSentTrades.set(trade.id, prevTrade);
      }
    }

    const balance = this.sessionState.getBalance(config?.paper_mode ?? true);
    const mode = config?.trading_mode || (config?.paper_mode ? 'paper' : 'live');
    const startingBalance = (mode === 'paper') ? config?.paper_starting_balance : config?.live_starting_balance;
    const realizedPnl = roundEight(balance - (startingBalance ?? balance));
    const totalPnl = roundEight(realizedPnl + activePnl);

    const analyticsCondition = !this.lastAnalyticsResult ||
      this.sessionState.closedTrades.length !== this.lastAnalyticsTradeCount ||
      (startingBalance !== undefined && startingBalance !== null && startingBalance !== this.lastAnalyticsStartingBalance);

    if (analyticsCondition) {
      this.lastAnalyticsResult = this.analyticsService.calculateAnalytics(this.sessionState.closedTrades as any, startingBalance);
      this.lastAnalyticsTradeCount = this.sessionState.closedTrades.length;
      this.lastAnalyticsStartingBalance = startingBalance ?? 0;
    }

    const monitoringInterval = 15000;
    const lastMonitoringTime = this.lastTickData?._monitoring_ts || 0;
    const shouldUpdateMonitoring = (now - lastMonitoringTime > monitoringInterval) || !this.lastTickData;
    const monitoring = shouldUpdateMonitoring ? this.monitoringService.getMetrics() : null;

    let variantStats: Record<string, any> | undefined;
    if (hasVariants) {
      variantStats = {};
      const closedStats = this.sessionState.cachedClosedTradesStats;
      for (let i = 0; i < strategyConfigs.length; i++) {
        const l = strategyConfigs[i].strategy_label!;
        const a = variantGroups[l] || { pnl: 0, risk: 0, count: 0, hits: 0 };
        const c = closedStats[l] || { pnl: 0, count: 0, hits: 0 };
        variantStats[l] = {
            totalPnl: roundEight(c.pnl + a.pnl),
            entryCount: c.count + a.count,
            hitCount: c.hits + a.hits,
            totalRiskPct: roundTo(balance > 0 ? (a.risk / balance) * 100 : 0, 2),
            activeTradeCount: a.count
        };
      }
    }

    const tickData: any = {
      balance: roundTo(balance, 2),
      total_pnl: roundTo(totalPnl, 2),
      total_risk_pct: roundTo(balance > 0 ? (totalRiskUsdt / balance) * 100 : 0, 2),
      total_sl_used: roundTo(totalRiskUsdt, 2),
      trades,
      gateState: this.sessionState.gateState,
      gateReason: this.lastRiskResult?.reason || 'OK',
      tradesInPeriod: this.lastRiskResult?.tradesInPeriod,
      maxTradesPeriod: this.lastRiskResult?.maxTradesPeriod,
      tradesIn24h: this.lastRiskResult?.tradesIn24h,
      maxTrades24h: this.lastRiskResult?.maxTrades24h,
      effectivePeriodMs: this.lastRiskResult?.effectivePeriodMs,
      jitterFactor: this.lastRiskResult?.jitterFactor,
      hibernating: this.sessionState.hibernating,
      hibernation_mode: config.hibernation_mode || 'adaptive',
      isAdaptiveTightened: this.sessionState.isAdaptiveTightened,
      paused: this.sessionState.paused,
      scannerPaused: this.sessionState.gateState === 'max_trades' || this.sessionState.gateState === 'sl_guard' || this.sessionState.gateState === 'max_trades_period' || this.sessionState.paused,
      activeWindows: getActiveWindows(),
      rateLimit: getBinanceRateLimit(),
      stats: this.sessionState.stats,
      monitoring,
      isEcoMode: isEcoMode,
      apiStatus: this.sessionState.apiStatus,
      _statsVersion: this.sessionState.statsVersion,
    };

    if (variantStats) tickData.variant_stats = variantStats;

    // BOLT: Heartbeat frequency should be 10s if any trades are active, regardless of "significance".
    // This prevents the UI from appearing stuck when prices are moving slowly.
    const heartbeatInterval = activeTrades.length > 0 ? 10000 : (this.sessionState.listenerCount > 0 ? 30000 : 60000);
    let shouldBroadcast = !this.lastTickData || (now - this.lastTickTime > heartbeatInterval);
    if (shouldBroadcast) tickData._heartbeat = true;

    if (!shouldBroadcast) {
      const tradesChanged = trades.length > 0 || anyPriceChangedSignificant;
      // BOLT: Standard threshold for total session PnL change (0.10 USDT)
      const pnlChanged = Math.abs(totalPnl - (this.lastTickData?.total_pnl || 0)) >= 0.10;
      const gateChanged = tickData.gateState !== this.lastTickData?.gateState;
      const statsChanged = tickData._statsVersion !== this.lastTickData?._statsVersion;

      if (!shouldUpdateMonitoring) delete tickData.monitoring;
      else tickData._monitoring_ts = now;

      if (tradesChanged || pnlChanged || gateChanged || statsChanged) {
          shouldBroadcast = true;
      }
    }

    if (shouldBroadcast) {
      this.broadcastService.broadcast('tick', tickData);
      this.lastTickData = tickData;
      this.lastTickTime = now;
      this.lastSentTrades = currentTickSentTrades;
    }
  }
}
