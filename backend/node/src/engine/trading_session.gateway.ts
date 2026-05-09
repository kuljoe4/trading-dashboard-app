import { Injectable } from '@nestjs/common';
import { WebSocketGateway } from '@nestjs/websockets';
import { Server } from 'socket.io';
import { TradingSessionService } from './trading_session.service';
import { TickerCacheService } from '../ticker_cache/ticker_cache.service';
import { SignalEngineService } from '../signal_engine/signal_engine.service';
import { RiskEngineService } from '../risk_engine/risk_engine.service';
import { PositionTrackerService } from '../position_tracker/position_tracker.service';
import { OrderManagerService } from '../order_manager/order_manager.service';

@Injectable()
export class TradingSessionGateway extends WebSocketGateway {
  constructor(
    private tradingSessionService: TradingSessionService,
    private tickerCacheService: TickerCacheService,
    private signalEngineService: SignalEngineService,
    private riskEngineService: RiskEngineService,
    private positionTrackerService: PositionTrackerService,
    private orderManagerService: OrderManagerService,
  ) {
    super();
  }

  @SubscribeMessage('trade')
  async handleTrade(client: any, data: any) {
    // Handle incoming trade messages from clients
    const { symbol, side, quantity, price } = data;
    const result = await this.tradingSessionService.executeTrade({
      symbol,
      side,
      quantity,
      price,
    });
    this.emit('trade_result', result);
  }

  @SubscribeMessage('market_data')
  async handleMarketData(client: any) {
    // Send market data to client
    const data = await this.tickerCacheService.getLatestTickers();
    this.emit('market_data_update', data);
  }

  @SubscribeMessage('signal')
  async handleSignal(client: any, data: any) {
    // Handle signal generation
    const result = await this.signalEngineService.generateSignal(data);
    this.emit('signal_result', result);
  }

  @SubscribeMessage('risk_check')
  async handleRiskCheck(client: any, data: any) {
    // Handle risk check
    const result = await this.riskEngineService.checkRisk(data);
    this.emit('risk_result', result);
  }

  @SubscribeMessage('position_update')
  async handlePositionUpdate(client: any) {
    // Handle position updates
    const data = await this.positionTrackerService.getPositions();
    this.emit('position_update', data);
  }

  @SubscribeMessage('order_update')
  async handleOrderUpdate(client: any, data: any) {
    // Handle order updates
    const result = await this.orderManagerService.processOrderUpdate(data);
    this.emit('order_update_result', result);
  }
}