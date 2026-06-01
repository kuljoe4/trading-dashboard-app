import { Injectable, Logger } from '@nestjs/common';
import { Trade } from '../models/Trade';
import { SessionConfig } from '../models/SessionConfig';

@Injectable()
export class BroadcastService {
  private readonly logger = new Logger(BroadcastService.name);
  private wsBroadcaster: ((data: any) => void) | null = null;

  setWsBroadcaster(cb: (data: any) => void) {
    this.wsBroadcaster = cb;
  }

  broadcast(eventType: string, payload: any) {
    if (this.wsBroadcaster) {
      this.wsBroadcaster({ type: eventType, ...payload });
    }
  }

  broadcastTick(tickData: any) {
    this.broadcast('tick', tickData);
  }

  broadcastScanner(scannerData: any) {
    this.broadcast('scanner', scannerData);
  }

  broadcastTradeEvent(event: any) {
    this.broadcast('trade_event', event);
  }
}
