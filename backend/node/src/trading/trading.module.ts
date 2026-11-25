import { ENGINE_EVENTS } from '../engine/events';
import { Module, forwardRef } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Repository } from 'typeorm';
import { SHARED_MARKET_DATA, SharedMarketData } from '../engine/shared-market-data';
import { TypeOrmModule, getRepositoryToken } from '@nestjs/typeorm';
import { Session as SessionEntity } from '../models/entities/Session.entity';
import { TradeEntity } from '../models/entities/Trade.entity';
import { Log as LogEntity } from '../models/entities/Log.entity';
import { Settings as SettingsEntity } from '../models/entities/Settings.entity';
import { AuditLog as AuditLogEntity } from '../models/entities/AuditLog.entity';
import { BalanceHistory as BalanceHistoryEntity } from '../models/entities/BalanceHistory.entity';
import { StrategyPreset as StrategyPresetEntity } from '../models/entities/StrategyPreset.entity';
import { Kline as KlineEntity } from '../models/entities/Kline.entity';
import { SignalEngineService } from '../engine/signalEngine';
import { RiskEngineService } from '../engine/riskEngine';
import { PositionTrackerService } from '../engine/positionTracker';
import { OrderManagerService } from '../engine/orderManager';
import { OrderFilterService } from '../engine/order-filter.service';
import { TradingSessionService } from '../engine/trading_session.service';
import { TickerCacheService } from '../engine/ticker_cache.service';
import { MarketFeedService } from '../engine/market_feed.service';
import { ExecutionService } from '../engine/execution.service';
import { SessionLifecycleService } from '../engine/session-lifecycle.service';
import { MomentumScannerService } from '../engine/momentum_scanner.service';
import { KlineStoreService } from '../engine/kline_store.service';
import { BroadcastService } from '../engine/broadcast.service';
import { SessionStateService } from '../engine/session_state.service';
import { SessionService } from './session.service';
import { AuditLogService } from './audit-log.service';
import { SessionController } from './session.controller';
import { SettingsController } from './settings.controller';
import { MonitoringController } from './monitoring.controller';
import { PresetsController } from './presets.controller';
import { ApiKeyGuard } from '../lib/api-key.guard';
import { BinanceClientFactory } from '../lib/binanceClientFactory';
import { MonitoringService } from '../engine/monitoring.service';
import { AnalyticsService } from '../engine/analytics.service';
import { VariantAnalyticsService } from '../engine/variant-analytics.service';
import { RrOptimizationService } from '../engine/rr-optimization.service';
import { EngineBroadcasterService } from '../engine/engine-broadcaster.service';
import { GatingService } from '../engine/gating.service';
import { MaintenanceService } from '../engine/maintenance.service';
import { BacktestService } from '../engine/backtest.service';
import { SmartOptimizerService } from '../engine/smart-optimizer.service';

@Module({
  imports: [
    ConfigModule,
    TypeOrmModule.forFeature([SessionEntity, TradeEntity, LogEntity, SettingsEntity, AuditLogEntity, BalanceHistoryEntity, StrategyPresetEntity, KlineEntity]),
  ],
  controllers: [SessionController, SettingsController, MonitoringController, PresetsController],
  providers: [
    SignalEngineService,
    RiskEngineService,
    PositionTrackerService,
    OrderManagerService,
    OrderFilterService,
    TradingSessionService,
    {
      provide: TickerCacheService,
      inject: [EventEmitter2, SHARED_MARKET_DATA],
      useFactory: (events: EventEmitter2, shared: SharedMarketData | null) => {
        if (!shared) return new TickerCacheService(events);
        shared.events.on(ENGINE_EVENTS.TICKER_PRICE_UPDATED, price => {
          events.emit(ENGINE_EVENTS.TICKER_PRICE_UPDATED, price);
        });
        return shared.tickerCache;
      },
    },
    MarketFeedService,
    ExecutionService,
    SessionLifecycleService,
    MomentumScannerService,
    {
      provide: KlineStoreService,
      inject: [getRepositoryToken(KlineEntity), SHARED_MARKET_DATA],
      useFactory: (repository: Repository<KlineEntity>, shared: SharedMarketData | null) => {
        if (!shared) return new KlineStoreService(repository);
        return shared.klineStore ??= new KlineStoreService(repository);
      },
    },
    BroadcastService,
    SessionStateService,
    SessionService,
    AuditLogService,
    MonitoringService,
    AnalyticsService,
    VariantAnalyticsService,
    RrOptimizationService,
    EngineBroadcasterService,
    GatingService,
    MaintenanceService,
    BacktestService,
    SmartOptimizerService,
    ApiKeyGuard,
    BinanceClientFactory,
  ],
  exports: [
    BacktestService,
    SignalEngineService,
    RiskEngineService,
    PositionTrackerService,
    OrderManagerService,
    OrderFilterService,
    TradingSessionService,
    TickerCacheService,
    MarketFeedService,
    ExecutionService,
    MomentumScannerService,
    KlineStoreService,
    BroadcastService,
    SessionStateService,
    AuditLogService,
    MonitoringService,
    AnalyticsService,
    VariantAnalyticsService,
    RrOptimizationService,
    EngineBroadcasterService,
    GatingService,
    MaintenanceService,
    SmartOptimizerService,
  ],
})
export class TradingModule {}
