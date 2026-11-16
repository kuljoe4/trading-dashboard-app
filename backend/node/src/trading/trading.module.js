var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
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
let TradingModule = class TradingModule {
};
TradingModule = __decorate([
    Module({
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
            TickerCacheService,
            MarketFeedService,
            ExecutionService,
            SessionLifecycleService,
            MomentumScannerService,
            KlineStoreService,
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
], TradingModule);
export { TradingModule };
