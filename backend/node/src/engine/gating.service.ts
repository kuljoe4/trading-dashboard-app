import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ENGINE_EVENTS } from './events';
import { SessionConfig } from '../models/SessionConfig';
import { SessionStateService } from './session_state.service';
import { MomentumScannerService } from './momentum_scanner.service';
import { MarketFeedService } from './market_feed.service';
import { KlineStoreService } from './kline_store.service';
import { TickerCacheService } from './ticker_cache.service';
import { BroadcastService } from './broadcast.service';
import { PositionTrackerService } from './positionTracker';

@Injectable()
export class GatingService {
  private readonly logger = new Logger(GatingService.name);

  constructor(
    private readonly sessionState: SessionStateService,
    private readonly momentumScanner: MomentumScannerService,
    private readonly marketFeed: MarketFeedService,
    private readonly klineStore: KlineStoreService,
    private readonly tickerCache: TickerCacheService,
    private readonly broadcastService: BroadcastService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  public mapGateState(reason: string): string {
    if (reason.includes('max open trades')) return 'max_trades';
    if (reason.includes('Max trades per period')) return 'max_trades_period';
    if (reason.includes('Rolling 24h limit')) return 'max_trades_24h';
    if (reason.includes('Total SL')) return 'sl_guard';
    if (reason.includes('Total risk')) return 'risk_pct';
    if (reason.includes('Historical performance')) return 'tod_risk';
    return 'risk';
  }

  public isInsideTradingWindow(config: SessionConfig): boolean {
    if (!config?.trading_windows?.length) return true;
    const now = new Date();
    const currentTime = now.getUTCHours() * 100 + now.getUTCMinutes();
    return config.trading_windows.some(window => {
      const start = parseInt(window.start.replace(':', ''), 10);
      const end = parseInt(window.end.replace(':', ''), 10);
      return start <= end
        ? (currentTime >= start && currentTime <= end)
        : (currentTime >= start || currentTime <= end);
    });
  }

  public async enterHibernation(reason: string, config: SessionConfig, activeTrades: any[]) {
    const msg = `Entering DEEP SLEEP (Hibernation) - Reason: ${reason}`;
    this.logger.log(msg);
    this.eventEmitter.emit(ENGINE_EVENTS.LOG_MESSAGE, { msg, level: 'info' });
    this.sessionState.hibernating = true;
    const needsKlines = activeTrades.some(t => {
      const c = { ...config, ...(t.strategy_config || {}) };
      return c.exit_signals && c.exit_signals.length > 0;
    });

    if (needsKlines) {
        await this.momentumScanner.stop();
    } else {
      await this.marketFeed.stop();
      await this.momentumScanner.stop();
      // BOLT: Do not clear klineStore here.
      // MarketFeedService.stop() already cleared activeWatchlist.
      // Keeping klineStore allows faster resumption if the same symbols are monitored again.
      // this.klineStore.clear();
      this.tickerCache.clear();
    }

    this.broadcastService.broadcast('gate', {
      gateState: this.sessionState.gateState,
      reason: reason,
      hibernating: true
    });
  }

  public async exitHibernation(config: SessionConfig) {
    const msg = 'Exiting DEEP SLEEP (Hibernation)';
    this.logger.log(msg);
    this.eventEmitter.emit(ENGINE_EVENTS.LOG_MESSAGE, { msg, level: 'info' });
    this.sessionState.hibernating = false;
    await this.marketFeed.start(config);
    await this.momentumScanner.start(config);

    this.broadcastService.broadcast('gate', {
      gateState: this.sessionState.gateState,
      hibernating: false
    });
  }
}
