import { Injectable, Logger } from '@nestjs/common';
import { WebSocketGateway, SubscribeMessage, WebSocketServer } from '@nestjs/websockets';
import { TradingSessionService } from './trading_session.service';

@Injectable()
@WebSocketGateway({
  namespace: '/session',
  cors: {
    origin: '*',
  },
})
export class TradingSessionGateway {
  private readonly logger = new Logger(TradingSessionGateway.name);

  // Note: WebSocketServer is unused as we are using the 'ws' library in server.ts
  @WebSocketServer() server: any = null;

  constructor(private tradingSessionService: TradingSessionService) {
    // Wire the broadcaster
    this.tradingSessionService.setWsBroadcaster((data: any) => {
      if (this.server) {
        this.server.emit('event', data);
      }
    });
  }

  @SubscribeMessage('trade')
  async handleTradeMessage(client: any, data: any) {
    this.logger.debug(`Trade message received: ${JSON.stringify(data)}`);
    return { success: true };
  }

  @SubscribeMessage('status')
  async handleStatusMessage(client: any, data: any) {
    const status = this.tradingSessionService.getStatus();
    client.emit('status', status);
    return status;
  }

  @SubscribeMessage('ping')
  async handlePing(client: any) {
    return { pong: true };
  }
}