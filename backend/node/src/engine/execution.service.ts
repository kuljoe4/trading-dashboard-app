import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { Trade } from '../models/Trade';
import { SessionConfig } from '../models/SessionConfig';
import { TickerCacheService } from './ticker_cache.service';
import { KlineStoreService } from './kline_store.service';
import { SignalEngineService } from './signalEngine';
import { RiskEngineService } from './riskEngine';
import { PositionTrackerService } from './positionTracker';
import { OrderManagerService } from './orderManager';
import { SessionStateService } from './session_state.service';
import { GatingService } from './gating.service';
import { BroadcastService } from './broadcast.service';
import { EngineBroadcasterService } from './engine-broadcaster.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ENGINE_EVENTS } from './events';
import { AnalyticsService } from './analytics.service';
import { v4 as uuid } from 'uuid';
import { roundTo } from '../lib/math';
import { ExecutionStatus } from '../models/ExecutionResult';

@Injectable()
export class ExecutionService {
  private readonly logger = new Logger(ExecutionService.name);

  constructor(
    private readonly tickerCache: TickerCacheService,
    private readonly klineStore: KlineStoreService,
    private readonly signalEngine: SignalEngineService,
    private readonly riskEngine: RiskEngineService,
    @Inject(forwardRef(() => PositionTrackerService))
    private readonly positionTracker: PositionTrackerService,
    @Inject(forwardRef(() => OrderManagerService))
    private readonly orderManager: OrderManagerService,
    private readonly sessionState: SessionStateService,
    private readonly gatingService: GatingService,
    private readonly broadcastService: BroadcastService,
    private readonly engineBroadcaster: EngineBroadcasterService,
    private readonly eventEmitter: EventEmitter2,
    private readonly analyticsService: AnalyticsService,
  ) {}

  async checkExits(config: SessionConfig, onTradeUpdate?: (t: Trade, b: number) => Promise<void>) {
    if (this.positionTracker.activeCount() === 0) return;
    const activeTrades = this.positionTracker.activeList();
    const balance = this.sessionState.getBalance(config.paper_mode ?? true);

    for (const trade of activeTrades) {
      // Risk monitoring uses Mark Price to align with Exchange SL behavior
      const markPrice = this.tickerCache.getMarkPrice(trade.symbol);
      if (!markPrice) continue;

      const tradeConfig = { ...config, ...(trade.strategy_config || {}) } as SessionConfig;
      await this.positionTracker.checkRrSequenceAdjustments(trade.symbol, markPrice, tradeConfig);

      const exitInterval = tradeConfig.scan_interval || '1m';
      const exitCondition = this.positionTracker.checkExitConditions(trade.symbol, markPrice, tradeConfig, exitInterval);

      if (exitCondition?.exitOccurred) {
        const result = await this.positionTracker.closeTrade(trade.symbol, markPrice, exitCondition.exitReason, tradeConfig);
        if (result.exitOccurred && result.trade) {
          const closedTrade = result.trade;
          this.sessionState.updateStatsOnClose((closedTrade.pnl || 0) > 0);

          this.sessionState.addClosedTrade(closedTrade);
          this.sessionState.setActiveTrades(this.positionTracker.activeList());
          this.eventEmitter.emit(ENGINE_EVENTS.WATCHLIST_NEEDS_UPDATE, tradeConfig);

          const analytics = this.analyticsService.calculateAnalytics(
            this.sessionState.closedTrades as any,
            config.paper_mode ? config.paper_starting_balance : config.live_starting_balance
          );

          this.eventEmitter.emit(ENGINE_EVENTS.RISK_GATES_UPDATED);
          this.broadcastService.broadcast('trade_event', {
            event: 'closed',
            symbol: closedTrade.symbol,
            reason: exitCondition.exitReason,
            trade: this.engineBroadcaster.serializeTrade(closedTrade, config, markPrice),
            pnl: closedTrade.pnl,
            stats: this.sessionState.stats,
            analytics: {
              maxDrawdown: roundTo(analytics.maxDrawdown, 2),
              maxDrawdownPct: roundTo(analytics.maxDrawdownPct, 2),
              overallWinRate: roundTo(analytics.overallWinRate, 2),
              cumulativePnL: analytics.cumulativePnL.slice(-20).map((p: any) => ({ ...p, pnl: roundTo(p.pnl, 2) })),
            }
          });

          if (onTradeUpdate) await onTradeUpdate(closedTrade, balance);
        }
      }
    }
  }

  async processEntries(opportunities: any[], config: SessionConfig, strategyLabel: string, onTradeUpdate?: (t: Trade, b: number) => Promise<void>) {
    const symbolConfigs = config.single_symbol_configs;
    const symbolConfigMap = (symbolConfigs && symbolConfigs.length > 0) ? new Map(symbolConfigs.map(sc => [sc.symbol, sc])) : null;
    const balance = this.sessionState.getBalance(config.paper_mode ?? true);

    for (const opp of opportunities) {
      if (this.positionTracker.hasSymbol(opp.symbol)) continue;

      const sc = symbolConfigMap?.get(opp.symbol);
      const symbolConfig = (sc?.use_custom_config && sc.custom_config) ? { ...config, ...sc.custom_config } as SessionConfig : config;

      const signalResult = this.signalEngine.checkEntry(opp.symbol, config, config.scan_interval || '1m', opp.direction.toUpperCase() as any, 'entry', false);
      if (!signalResult.allFired) {
        if (signalResult.reason.includes('warm-up')) {
          this.logger.debug(`${opp.symbol}: Entry blocked - ${signalResult.reason}`);
        }
        continue;
      }

      const activeTrades = this.positionTracker.activeList();
      const riskResult = this.riskEngine.canEnter(activeTrades, this.sessionState.closedTrades, balance, opp.symbol, symbolConfig, this.positionTracker.totalRisk());

      if (!riskResult.canEnter) {
        if (!riskResult.reason.includes('Max open trades for')) {
          this.sessionState.gateState = this.gatingService.mapGateState(riskResult.reason);
          this.broadcastService.broadcast('gate', {
            gateState: this.sessionState.gateState,
            reason: riskResult.reason,
            scannerPaused: this.sessionState.gateState === 'max_trades' || this.sessionState.gateState === 'sl_guard' || this.sessionState.gateState === 'max_trades_period' || this.sessionState.paused
          });
        }
        continue;
      }

      // Entry estimation and position sizing are anchored to Mark Price
      // to align with the exchange's SL trigger behavior.
      const price = this.tickerCache.getMarkPrice(opp.symbol);
      if (!price) continue;

      const lookback = this.klineStore.getLookbackExtremes(opp.symbol, symbolConfig.sl_lookback_timeframe || '1m', symbolConfig.sl_lookback_period || 20);
      let slPrice = this.riskEngine.computeSl(price, opp.direction.toUpperCase() as any, symbolConfig, lookback.minLow, lookback.maxHigh);

      // BOLT: Apply exchange filters to SL price BEFORE position sizing.
      // We use risk-averse rounding: floor for LONG SL (farther), ceil for SHORT SL (farther)
      // to ensure we don't underestimate the risk distance.
      const slFiltered = this.orderManager.applyFilters(opp.symbol, slPrice, 1, {
         priceRounding: opp.direction.toUpperCase() === 'LONG' ? 'floor' : 'ceil',
         skipNotionalCheck: true
      });
      slPrice = slFiltered.price;

      const qty = this.riskEngine.computePositionSize(balance, price, slPrice, opp.direction.toUpperCase() as any, symbolConfig);

      if (qty <= 0) {
        this.logger.debug(`${opp.symbol}: Position size is 0 after SL filtering. SL: ${slPrice}, Entry: ${price}`);
        continue;
      }
      const tpPrice = this.riskEngine.computeTp(price, slPrice, opp.direction.toUpperCase() as any, symbolConfig);

      const result = await this.orderManager.enter(
        (this.sessionState.config as any)?.sessionId || uuid().substring(0, 8),
        opp.symbol,
        opp.direction.toUpperCase() as any,
        price,
        qty,
        slPrice,
        tpPrice,
        { strategy_label: strategyLabel, strategy_config: config }
      );

      if (result.status === ExecutionStatus.SUCCESS && result.data) {
        const trade = result.data;
        this.positionTracker.addTrade(trade);
        this.sessionState.updateStatsOnEntry();

        // Immediately apply entry fee to balance
        if (onTradeUpdate) {
            await onTradeUpdate(trade, balance);
        }

        this.sessionState.setActiveTrades(this.positionTracker.activeList());
        this.eventEmitter.emit(ENGINE_EVENTS.WATCHLIST_NEEDS_UPDATE, config);

        this.eventEmitter.emit(ENGINE_EVENTS.RISK_GATES_UPDATED);
        const lastPrice = this.tickerCache.getPrice(opp.symbol) || price;
        this.broadcastService.broadcast('trade_event', {
          event: 'opened',
          symbol: opp.symbol,
          trade: this.engineBroadcaster.serializeTrade(trade, config, lastPrice),
          stats: this.sessionState.stats
        });
      }
    }
  }
}
