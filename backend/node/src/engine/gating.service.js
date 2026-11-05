var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var GatingService_1;
import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ENGINE_EVENTS } from './events';
import { SessionStateService } from './session_state.service';
import { MomentumScannerService } from './momentum_scanner.service';
import { MarketFeedService } from './market_feed.service';
import { KlineStoreService } from './kline_store.service';
import { TickerCacheService } from './ticker_cache.service';
import { BroadcastService } from './broadcast.service';
let GatingService = GatingService_1 = class GatingService {
    sessionState;
    momentumScanner;
    marketFeed;
    klineStore;
    tickerCache;
    broadcastService;
    eventEmitter;
    logger = new Logger(GatingService_1.name);
    // BOLT OPTIMIZATION: Cache for pre-parsed trading windows to avoid redundant string manipulation and parsing in the hot path.
    tradingWindowCache = new WeakMap();
    constructor(sessionState, momentumScanner, marketFeed, klineStore, tickerCache, broadcastService, eventEmitter) {
        this.sessionState = sessionState;
        this.momentumScanner = momentumScanner;
        this.marketFeed = marketFeed;
        this.klineStore = klineStore;
        this.tickerCache = tickerCache;
        this.broadcastService = broadcastService;
        this.eventEmitter = eventEmitter;
    }
    mapGateState(reason) {
        if (reason.includes('max open trades'))
            return 'max_trades';
        if (reason.includes('Max trades per period'))
            return 'max_trades_period';
        if (reason.includes('Rolling 24h limit'))
            return 'max_trades_24h';
        if (reason.includes('Total SL'))
            return 'sl_guard';
        if (reason.includes('Total risk') || reason.includes('Risk ceiling'))
            return 'risk_pct';
        if (reason.includes('Historical performance'))
            return 'tod_risk';
        if (reason.includes('Lookback SL dist'))
            return 'sl_out_of_bounds';
        return 'risk';
    }
    isInsideTradingWindow(config) {
        if (!config?.trading_windows?.length)
            return true;
        // BOLT OPTIMIZATION: Check for cached parsed windows first
        let parsedWindows = this.tradingWindowCache.get(config);
        if (!parsedWindows) {
            parsedWindows = config.trading_windows
                .filter(window => window && typeof window.start === 'string' && typeof window.end === 'string')
                .map(window => ({
                start: parseInt(window.start.replace(':', ''), 10),
                end: parseInt(window.end.replace(':', ''), 10)
            }));
            this.tradingWindowCache.set(config, parsedWindows);
        }
        const now = new Date();
        const currentTime = now.getUTCHours() * 100 + now.getUTCMinutes();
        // BOLT OPTIMIZATION: Use manual for loop to avoid iterator overhead and function call overhead from .some()
        for (let i = 0; i < parsedWindows.length; i++) {
            const window = parsedWindows[i];
            const start = window.start;
            const end = window.end;
            if (start <= end) {
                if (currentTime >= start && currentTime <= end)
                    return true;
            }
            else {
                // Overnight window
                if (currentTime >= start || currentTime <= end)
                    return true;
            }
        }
        return false;
    }
    async enterHibernation(reason, config, activeTrades) {
        const mode = config.hibernation_mode || 'adaptive';
        const isLight = mode === 'light';
        const msg = `Entering ${isLight ? 'LIGHT' : 'DEEP'} SLEEP (Hibernation) - Reason: ${reason}`;
        this.logger.log(msg);
        this.eventEmitter.emit(ENGINE_EVENTS.LOG_MESSAGE, { msg, level: 'info' });
        this.sessionState.hibernating = true;
        const needsKlines = activeTrades.some(t => {
            const c = { ...config, ...(t.strategy_config || {}) };
            return c.exit_signals && c.exit_signals.length > 0;
        });
        if (needsKlines) {
            await this.momentumScanner.stop();
        }
        else {
            // In LIGHT sleep, we keep MarketFeed running to maintain WS connections and kline trickle.
            // We only stop the heavy MomentumScanner.
            if (!isLight) {
                await this.marketFeed.stop();
            }
            await this.momentumScanner.stop();
            // BOLT: Do not clear klineStore here.
            // MarketFeedService.stop() already cleared activeWatchlist.
            // Keeping klineStore allows faster resumption if the same symbols are monitored again.
            // this.klineStore.clear();
            // BOLT: In LIGHT sleep, we MUST preserve tickerCache so the background scanner
            // can continue to evaluate symbols and wake the bot up on a signal.
            if (!isLight) {
                this.tickerCache.clear();
            }
        }
        this.broadcastService.broadcast('gate', {
            gateState: this.sessionState.gateState,
            hibernation_mode: mode,
            reason: reason,
            hibernating: true,
            activeTrades: [] // Explicitly clear in UI broadcast to avoid "stuck trade" visual bug
        });
    }
    async exitHibernation(config) {
        const mode = config.hibernation_mode || 'adaptive';
        const isLight = mode === 'light';
        const msg = `Exiting ${isLight ? 'LIGHT' : 'DEEP'} SLEEP (Hibernation)`;
        this.logger.log(msg);
        this.eventEmitter.emit(ENGINE_EVENTS.LOG_MESSAGE, { msg, level: 'info' });
        this.sessionState.hibernating = false;
        // In LIGHT sleep, MarketFeed was never stopped.
        if (!isLight) {
            await this.marketFeed.start(config);
        }
        await this.momentumScanner.start(config);
        this.broadcastService.broadcast('gate', {
            gateState: this.sessionState.gateState,
            hibernation_mode: mode,
            hibernating: false
        });
    }
};
GatingService = GatingService_1 = __decorate([
    Injectable(),
    __metadata("design:paramtypes", [SessionStateService,
        MomentumScannerService,
        MarketFeedService,
        KlineStoreService,
        TickerCacheService,
        BroadcastService,
        EventEmitter2])
], GatingService);
export { GatingService };
