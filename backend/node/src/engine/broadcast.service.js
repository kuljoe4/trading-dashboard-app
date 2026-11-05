var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var BroadcastService_1;
import { Injectable, Logger } from '@nestjs/common';
let BroadcastService = BroadcastService_1 = class BroadcastService {
    logger = new Logger(BroadcastService_1.name);
    wsBroadcaster = null;
    setWsBroadcaster(cb) {
        this.wsBroadcaster = cb;
    }
    broadcast(eventType, payload) {
        if (this.wsBroadcaster) {
            this.wsBroadcaster({ type: eventType, ...payload });
        }
    }
    broadcastTick(tickData) {
        this.broadcast('tick', tickData);
    }
    broadcastScanner(scannerData) {
        this.broadcast('scanner', scannerData);
    }
    broadcastTradeEvent(event) {
        this.broadcast('trade_event', event);
    }
};
BroadcastService = BroadcastService_1 = __decorate([
    Injectable()
], BroadcastService);
export { BroadcastService };
