import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { SessionConfig } from '../models/SessionConfig';
import { Trade } from '../models/Trade';
import { SessionStateService } from './session_state.service';
import { OrderManagerService } from './orderManager';
import { MarketFeedService } from './market_feed.service';
import { MomentumScannerService } from './momentum_scanner.service';
import { PositionTrackerService } from './positionTracker';
import { MonitoringService } from './monitoring.service';
import { ENGINE_EVENTS } from './events';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AuditLogService } from '../trading/audit-log.service';
import { roundEight } from '../lib/math';
import { ENGINE_CONSTANTS } from '../models/constants';

@Injectable()
export class SessionLifecycleService {
  private readonly logger = new Logger(SessionLifecycleService.name);
  private balancePollInterval: NodeJS.Timeout | null = null;
  private running = false;
  public isUdsConnected = false;
  private userDataWs: any = null;
  private listenKey: string | null = null;
  private listenKeyKeepAlive: NodeJS.Timeout | null = null;

  constructor(
    private readonly sessionState: SessionStateService,
    @Inject(forwardRef(() => OrderManagerService))
    private readonly orderManager: OrderManagerService,
    private readonly marketFeed: MarketFeedService,
    private readonly momentumScanner: MomentumScannerService,
    @Inject(forwardRef(() => PositionTrackerService))
    private readonly positionTracker: PositionTrackerService,
    private readonly monitoringService: MonitoringService,
    private readonly auditLog: AuditLogService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  private async progress(msg: string, level: 'info' | 'warn' = 'info') {
    this.logger.log(`[Lifecycle] ${msg}`);
    this.eventEmitter.emit(ENGINE_EVENTS.LOG_MESSAGE, { msg: `[Lifecycle] ${msg}`, level });
  }

  async start(config: SessionConfig, bc?: any, sid?: string, hist: Trade[] = [], curBal?: number, open: Trade[] = []) {
    this.running = true;
    await this.progress('Starting session initialization...');

    // Seed rate limit from exchangeInfo response headers at startup
    if (bc && config.trading_mode !== 'paper') {
        try {
            const restBase = config.trading_mode === 'testnet' ? 'https://testnet.binancefuture.com' : ENGINE_CONSTANTS.BINANCE_REST_BASE;
            const res = await fetch(`${restBase}/fapi/v1/exchangeInfo`);
            const weight = res.headers.get('X-MBX-USED-WEIGHT-1M');
            if (weight) this.sessionState.updateRateLimit(parseInt(weight, 10));
        } catch (e) {}
    }

    this.sessionState.reset(config, hist, curBal);
    const mode = config.trading_mode || (config.paper_mode ? 'paper' : 'live');
    await this.orderManager.setBinanceClient(bc, mode === 'paper');

    if (mode !== 'paper' && bc) {
      await this.progress(`Configuring Binance ${mode.toUpperCase()} account...`);
      try {
        // Enforce One-Way Mode (Disable Hedge Mode)
        this.monitoringService.incrementApiRequests();
        try {
          const modeRes = await bc.restAPI.tradeApi.changePositionMode({ dualSidePosition: 'false' });
          const modeData = typeof modeRes.data === 'function' ? await modeRes.data() : (modeRes.data || modeRes);
          const modeMsg = `Binance position mode set to One-Way: ${JSON.stringify(modeData)}`;
          this.logger.log(modeMsg);
          this.eventEmitter.emit(ENGINE_EVENTS.LOG_MESSAGE, { msg: modeMsg, level: 'info' });
        } catch (modeErr: any) {
          const errMsg = modeErr.message || '';
          const errCode = modeErr.data?.code || modeErr.code;

          // Error -4059 means it's already in that mode
          if (errMsg.includes('-4059') || errCode === -4059) {
            this.logger.debug('Binance position mode is already One-Way.');
          } else if (errMsg.includes('-4068') || errCode === -4068 || errMsg.includes('open orders')) {
            const criticalMsg = `CRITICAL: Cannot set One-Way Mode because there are OPEN ORDERS on your Binance account. Please close all manual orders on Binance to ensure engine consistency.`;
            this.logger.error(criticalMsg);
            this.eventEmitter.emit(ENGINE_EVENTS.LOG_MESSAGE, { msg: criticalMsg, level: 'error' });
          } else if (errMsg.includes('-4069') || errCode === -4069 || errMsg.includes('exists position')) {
            const criticalMsg = `CRITICAL: Cannot set One-Way Mode because there are OPEN POSITIONS on your Binance account. Please close all manual positions on Binance to ensure engine consistency.`;
            this.logger.error(criticalMsg);
            this.eventEmitter.emit(ENGINE_EVENTS.LOG_MESSAGE, { msg: criticalMsg, level: 'error' });
          } else {
            this.logger.warn(`Failed to set Binance position mode to One-Way: ${errMsg}`);
          }
        }

        await this.progress('Fetching account balance...');
        const b = await this.fetchBinanceBalance(bc);

        if (b === 0 && (curBal || 0) > 0) {
          const fallbackMsg = `Binance ${mode} returned 0 balance. Falling back to local: ${curBal} USDT.`;
          await this.progress(fallbackMsg, 'warn');
          this.sessionState.balanceLive = curBal!;
          this.sessionState.balancePaper = curBal!;
        } else {
          this.sessionState.balanceLive = b;
          this.sessionState.balancePaper = b;
          if (b === 0) {
            await this.progress(`Binance ${mode} balance is 0. Gating until funds are available.`, 'warn');
          }
        }
      } catch (e) {
        this.logger.debug(`Initial balance fetch failed: ${e instanceof Error ? e.message : String(e)}`);
      }

      await this.progress('Establishing real-time account stream...');
      this.startUserDataStream(bc).catch((err) => {
        this.logger.error(`Failed to start user data stream: ${err instanceof Error ? err.message : String(err)}. Falling back to polling.`);
        this.balancePollInterval = setInterval(async () => {
          const b = await this.fetchBinanceBalance(bc);
          if (b > 0) {
            this.sessionState.balanceLive = b;
            this.sessionState.balancePaper = b;
          }
        }, ENGINE_CONSTANTS.USER_DATA_POLL_INTERVAL_MS);
      });
    }

    await this.progress('Initializing market feed and ticker cache...');
    await this.marketFeed.start(config);

    await this.progress('Warming up momentum scanner...');
    await this.momentumScanner.start(config);

    if (open.length > 0) {
      await this.progress(`Resuming ${open.length} active trades...`);
      for (const t of open) {
        this.positionTracker.addTrade(t);
        this.sessionState.updateStatsOnEntry();
      }
    }
    this.sessionState.setActiveTrades(this.positionTracker.activeList());

    await this.progress('Session ready. Trading logic engaged.');

    await this.auditLog.log({
      action: 'SESSION_START',
      resourceId: sid || undefined,
      details: { mode, strategy: config.strategy_label }
    });

    return { status: 'started' };
  }

  async stop(bc?: any, sid?: string, config?: SessionConfig) {
    this.running = false;
    await this.progress('Initiating session shutdown...');
    if (this.balancePollInterval) clearInterval(this.balancePollInterval);
    if (this.listenKeyKeepAlive) clearInterval(this.listenKeyKeepAlive);
    if (this.userDataWs) {
        await this.progress('Closing real-time account stream...');
        try { this.userDataWs.disconnect(); } catch (e) {
            this.logger.debug(`Error disconnecting user data WS: ${e instanceof Error ? e.message : String(e)}`);
        }
        this.userDataWs = null;
    }
    if (this.listenKey && bc) {
        try { await bc.restAPI.userDataStreamsApi.closeUserDataStream(this.listenKey); } catch (e) {
            this.logger.debug(`Error closing user data stream: ${e instanceof Error ? e.message : String(e)}`);
        }
        this.listenKey = null;
    }

    await this.progress('Cleaning up market feeds...');
    await this.marketFeed.stop();
    await this.momentumScanner.stop();
    await this.progress('Shutdown complete.');

    await this.auditLog.log({
      action: 'SESSION_STOP',
      resourceId: sid || undefined,
      details: { strategy: config?.strategy_label }
    });

    return { status: 'stopped' };
  }

  async fetchBinanceBalance(bc: any): Promise<number> {
    if (!bc) return 0;
    try {
      this.monitoringService.incrementApiRequests();
      // Try primary endpoint: futuresAccountBalanceV2
      const res = await bc.restAPI.accountApi.futuresAccountBalanceV2();
      const data = typeof res.data === 'function' ? await res.data() : (res.data || res);
      const usdt = Array.isArray(data) ? data.find((b: any) => b.asset === 'USDT') : null;

      if (usdt) {
        return parseFloat(usdt.balance || 0);
      }

      // Fallback: try accountInformationV2 (full account details)
      this.logger.debug(`futuresAccountBalanceV2 did not return USDT. Trying accountInformationV2 fallback...`);
      const accRes = await bc.restAPI.accountApi.accountInformationV2();
      const accData = accRes.data || accRes;
      if (accData && Array.isArray(accData.assets)) {
        const accUsdt = accData.assets.find((a: any) => a.asset === 'USDT');
        if (accUsdt) {
          return parseFloat(accUsdt.walletBalance || 0);
        }
      }

      this.logger.warn(`Could not find USDT balance in Binance response. Data received: ${JSON.stringify(data).substring(0, 200)}`);
      return 0;
    } catch (e: unknown) {
      this.logger.error(`Balance fetch failed: ${e instanceof Error ? e.message : String(e)}`);
      return 0;
    }
  }

  private async startUserDataStream(bc: any) {
    if (!bc) return;
    try {
      this.monitoringService.incrementApiRequests();
      const res = await bc.restAPI.userDataStreamsApi.startUserDataStream();
      const initialListenKey = typeof res.data === 'function' ? (await res.data()).listenKey : res.data.listenKey;
      this.listenKey = initialListenKey;
      this.userDataWs = await bc.websocketStreams.connect({ stream: this.listenKey });
      this.isUdsConnected = true;

      this.userDataWs.on('error', (err: any) => {
        this.isUdsConnected = false;
        this.logger.error(`User Data Stream error: ${err.message || String(err)}`);
      });
      this.userDataWs.on('close', () => {
        this.isUdsConnected = false;
        if (this.running) {
          this.logger.warn('User Data Stream closed unexpectedly. Reconnecting...');
          setTimeout(() => this.startUserDataStream(bc).catch(() => {}), 5000);
        }
      });

      this.userDataWs.on('message', async (msg: any) => {
        try {
          const data = typeof msg === 'string' ? JSON.parse(msg) : msg;

          if (data.e === 'ACCOUNT_UPDATE' && data.a) {
            // Real-time Balance Tracking (Zero Weight)
            if (data.a.B) {
              const usdt = data.a.B.find((b: any) => b.a === 'USDT');
              if (usdt) {
                const nb = parseFloat(usdt.wb);
                const liveBalMsg = `[Lifecycle] Received real-time balance update: ${nb} USDT`;
                this.logger.log(liveBalMsg);
                this.eventEmitter.emit(ENGINE_EVENTS.LOG_MESSAGE, { msg: liveBalMsg, level: 'info' });
                this.sessionState.balanceLive = nb;
                this.sessionState.balancePaper = nb;
              }
            }
            // Real-time Position Tracking (Zero Weight)
            if (data.a.P) {
              for (const pos of data.a.P) {
                const symbol = pos.s;
                const amount = parseFloat(pos.pa);
                const entryPrice = parseFloat(pos.ep);
                this.sessionState.realTimePositions.set(symbol, { amount, entryPrice });
                this.logger.debug(`[Lifecycle] Real-time position update for ${symbol}: ${amount} @ ${entryPrice}`);
              }
            }
          } else if (data.e === 'ORDER_TRADE_UPDATE') {
            const order = data.o;
            this.logger.log(`[Lifecycle] Order Update: ${order.s} ${order.S} ${order.X} (id=${order.i}, client_id=${order.c})`);
            this.eventEmitter.emit('binance.order_update', data);
          } else if (data.e === 'listenKeyExpired') {
            this.logger.warn('[Lifecycle] ListenKey expired, restarting user data stream...');
            this.startUserDataStream(bc).catch(() => {});
          }
        } catch (err) {
            this.logger.debug(`Error processing user data WS message: ${err instanceof Error ? err.message : String(err)}`);
        }
      });
      const subMsg = `[Lifecycle] Subscribing to User Data Stream with listenKey: ${this.listenKey?.substring(0, 10)}...`;
      this.logger.log(subMsg);
      this.eventEmitter.emit(ENGINE_EVENTS.LOG_MESSAGE, { msg: subMsg, level: 'info' });
      this.userDataWs.userData(this.listenKey);
      this.listenKeyKeepAlive = setInterval(async () => {
        if (this.listenKey) {
          try {
            this.monitoringService.incrementApiRequests();
            await bc.restAPI.userDataStreamsApi.keepaliveUserDataStream(this.listenKey);
          } catch (err) {
              this.logger.debug(`Error keeping alive user data stream: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
      }, ENGINE_CONSTANTS.USER_DATA_KEEPALIVE_MS);
    } catch (e) {
      throw e;
    }
  }
}
