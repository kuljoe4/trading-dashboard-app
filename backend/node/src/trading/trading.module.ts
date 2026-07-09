import { Module, forwardRef } from '@nestjs/common';
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
import { User as UserEntity, UserProfile as UserProfileEntity } from '../models/entities/User.entity';
import { Follow as FollowEntity } from '../models/entities/Follow.entity';
import { SignalEngineService } from '../engine/signalEngine';
import { RiskEngineService } from '../engine/riskEngine';
import { PositionTrackerService } from '../engine/positionTracker';
import { OrderManagerService } from '../engine/orderManager';
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
import { GamificationService } from './gamification.service';
import { SessionController } from './session.controller';
import { SettingsController } from './settings.controller';
import { MonitoringController } from './monitoring.controller';
import { PresetsController } from './presets.controller';
import { SocialController } from './social.controller';
import { SocialFollowingService } from './social-following.service';
import { PushNotificationService } from './push-notification.service';
import { ApiKeyGuard } from '../lib/api-key.guard';
import { BinanceClientFactory } from '../lib/binanceClientFactory';
import { MonitoringService } from '../engine/monitoring.service';
import { AnalyticsService } from '../engine/analytics.service';
import { VariantAnalyticsService } from '../engine/variant-analytics.service';
import { EngineBroadcasterService } from '../engine/engine-broadcaster.service';
import { GatingService } from '../engine/gating.service';
import { MaintenanceService } from '../engine/maintenance.service';

@Module({
  imports: [
    ConfigModule,
    TypeOrmModule.forFeature([
      SessionEntity,
      TradeEntity,
      LogEntity,
      SettingsEntity,
      AuditLogEntity,
      BalanceHistoryEntity,
      StrategyPresetEntity,
      KlineEntity,
      UserEntity,
      UserProfileEntity,
      FollowEntity
    ]),
  ],
  controllers: [SessionController, SettingsController, MonitoringController, PresetsController, SocialController],
  providers: [
    SignalEngineService,
    RiskEngineService,
    PositionTrackerService,
    OrderManagerService,
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
    GamificationService,
    SocialFollowingService,
    PushNotificationService,
    MonitoringService,
    AnalyticsService,
    VariantAnalyticsService,
    EngineBroadcasterService,
    GatingService,
    MaintenanceService,
    ApiKeyGuard,
    BinanceClientFactory,
  ],
  exports: [
    SignalEngineService,
    RiskEngineService,
    PositionTrackerService,
    OrderManagerService,
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
    EngineBroadcasterService,
    GatingService,
    MaintenanceService,
  ],
})
export class TradingModule {}
