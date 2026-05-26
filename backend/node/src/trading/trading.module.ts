import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Session as SessionEntity } from '../models/entities/Session.entity';
import { TradeEntity } from '../models/entities/Trade.entity';
import { Log as LogEntity } from '../models/entities/Log.entity';
import { Settings as SettingsEntity } from '../models/entities/Settings.entity';
import { BalanceHistory as BalanceHistoryEntity } from '../models/entities/BalanceHistory.entity';
import { SignalEngineService } from '../engine/signalEngine';
import { RiskEngineService } from '../engine/riskEngine';
import { PositionTrackerService } from '../engine/positionTracker';
import { OrderManagerService } from '../engine/orderManager';
import { TradingSessionService } from '../engine/trading_session.service';
import { TickerCacheService } from '../engine/ticker_cache.service';
import { MarketFeedService } from '../engine/market_feed.service';
import { MomentumScannerService } from '../engine/momentum_scanner.service';
import { KlineStoreService } from '../engine/kline_store.service';
import { SessionService } from './session.service';
import { SessionController } from './session.controller';
import { SettingsController } from './settings.controller';
import { MonitoringController } from './monitoring.controller';
import { BinanceClientFactory } from '../lib/binanceClientFactory';
import { MonitoringService } from '../engine/monitoring.service';
import { AnalyticsService } from '../engine/analytics.service';

@Module({
  imports: [
    ConfigModule,
    TypeOrmModule.forFeature([SessionEntity, TradeEntity, LogEntity, SettingsEntity, BalanceHistoryEntity]),
  ],
  controllers: [SessionController, SettingsController, MonitoringController],
  providers: [
    SignalEngineService,
    RiskEngineService,
    PositionTrackerService,
    OrderManagerService,
    TradingSessionService,
    TickerCacheService,
    MarketFeedService,
    MomentumScannerService,
    KlineStoreService,
    SessionService,
    MonitoringService,
    AnalyticsService,
  ],
  exports: [
    SignalEngineService,
    RiskEngineService,
    PositionTrackerService,
    OrderManagerService,
    TradingSessionService,
    TickerCacheService,
    MarketFeedService,
    MomentumScannerService,
    KlineStoreService,
    MonitoringService,
    AnalyticsService,
  ],
})
export class TradingModule {}
