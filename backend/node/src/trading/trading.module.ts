import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Session as SessionEntity } from '../models/entities/Session.entity';
import { TradeEntity } from '../models/entities/Trade.entity';
import { Settings as SettingsEntity } from '../models/entities/Settings.entity';
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
import { DataInjectorService } from '../engine/data_injector.service';

@Module({
  imports: [
    ConfigModule,
    TypeOrmModule.forFeature([SessionEntity, TradeEntity, SettingsEntity]),
  ],
  controllers: [SessionController, SettingsController],
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
    DataInjectorService,
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
  ],
})
export class TradingModule {}
