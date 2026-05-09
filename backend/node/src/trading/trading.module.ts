import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { SignalEngineService } from '../engine/signal_engine.service';
import { RiskEngineService } from '../engine/risk_engine.service';
import { PositionTrackerService } from '../engine/position_tracker.service';
import { OrderManagerService } from '../engine/order_manager.service';
import { TradingSessionService } from '../engine/trading_session.service';
import { TickerCacheService } from '../engine/ticker_cache.service';
import { MarketFeedService } from '../engine/market_feed.service';
import { MomentumScannerService } from '../engine/momentum_scanner.service';
import { KlineStoreService } from '../engine/kline_store.service';

@Module({
  imports: [ConfigModule],
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
