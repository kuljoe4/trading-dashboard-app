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
import { ConfigValidationException } from '../lib/exceptions';
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
  private udsLivenessCheck: NodeJS.Timeout | null = null;

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

    this.sessionState.reset(config, hist, curBal, sid);
    const mode = config.trading_mode || (config.paper_mode ? 'paper' : 'live');
    await this.orderManager.setBinanceClient(bc, mode === 'paper');

    if (mode !== 'paper' && bc) {
      // PROACTIVE RATE LIMIT: Reset weights at session start to ensure clean slate
      this.sessionState.updateRateLimit(0);

      await this.progress(`Configuring Binance ${mode.toUpperCase()} account...`);

      // Best Practice: Synchronize server time
      try {
        const timeRes = await bc.restAPI.queryUserRateLimit(); // Using an authenticated endpoint that returns headers, or just serverTime if available
        // Note: The SDK usually handles time sync internally, but we log it for auditability.
        const serverTimeHeader = timeRes.headers?.get ? timeRes.headers.get('Date') : timeRes.headers?.date;
        if (serverTimeHeader) {
          const serverTime = new Date(serverTimeHeader).getTime();
          const offset = serverTime - Date.now();
          this.logger.log(`[Lifecycle] Binance Time Sync Audit: Local offset is ${offset}ms`);
        }
      } catch (e) {
        this.logger.debug(`Time sync audit skipped: ${e instanceof Error ? e.message : String(e)}`);
      }

      try {
        // Enforce One-Way Mode (Disable Hedge Mode)
        try {
          this.monitoringService.incrementApiRequests();
          const currentModeRes = await bc.restAPI.getCurrentPositionMode();
          const currentModeData = await currentModeRes.data();

          if (currentModeData && currentModeData.dualSidePosition === false) {
            this.logger.debug('Binance position mode is already One-Way.');
          } else {
            this.monitoringService.incrementApiRequests();
            const modeRes = await bc.restAPI.changePositionMode({ dualSidePosition: false } as any);
            const modeData = await modeRes.data();
            const modeMsg = `Binance position mode set to One-Way: ${JSON.stringify(modeData)}`;
            this.logger.log(modeMsg);
            this.eventEmitter.emit(ENGINE_EVENTS.LOG_MESSAGE, { msg: modeMsg, level: 'info' });
          }
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
            throw new ConfigValidationException(criticalMsg);
          } else if (errMsg.includes('-4069') || errCode === -4069 || errMsg.includes('exists position')) {
            const criticalMsg = `CRITICAL: Cannot set One-Way Mode because there are OPEN POSITIONS on your Binance account. Please close all manual positions on Binance to ensure engine consistency.`;
            this.logger.error(criticalMsg);
            this.eventEmitter.emit(ENGINE_EVENTS.LOG_MESSAGE, { msg: criticalMsg, level: 'error' });
            throw new ConfigValidationException(criticalMsg);
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
          this.sessionState.lastExchangeBalance = curBal!;
        } else {
          this.sessionState.balanceLive = b;
          this.sessionState.balancePaper = b;
          this.sessionState.lastExchangeBalance = b;
          if (b === 0) {
            const zeroBalMsg = `CRITICAL: Binance ${mode.toUpperCase()} balance is 0. Initialization halted. Please fund your account.`;
            this.logger.error(zeroBalMsg);
            this.eventEmitter.emit(ENGINE_EVENTS.LOG_MESSAGE, { msg: zeroBalMsg, level: 'error' });
            throw new ConfigValidationException(zeroBalMsg);
          }
        }
      } catch (e) {
        if (e instanceof ConfigValidationException) throw e;
        this.logger.debug(`Initial account configuration failed: ${e instanceof Error ? e.message : String(e)}`);
      }

      await this.progress('Establishing real-time account stream...');
      try {
        await this.startUserDataStream(bc);
      } catch (err) {
        const errMsg = `CRITICAL: Failed to establish real-time account stream: ${err instanceof Error ? err.message : String(err)}. Polling fallback is disabled for safety.`;
        this.logger.error(errMsg);
        this.eventEmitter.emit(ENGINE_EVENTS.LOG_MESSAGE, { msg: errMsg, level: 'error' });
        throw new ConfigValidationException(errMsg);
      }
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
    if (this.udsLivenessCheck) clearInterval(this.udsLivenessCheck);
    if (this.userDataWs) {
        await this.progress('Closing real-time account stream...');
        try { this.userDataWs.disconnect(); } catch (e) {
            this.logger.debug(`Error disconnecting user data WS: ${e instanceof Error ? e.message : String(e)}`);
        }
        this.userDataWs = null;
    }
    if (this.listenKey && bc) {
        try { await bc.restAPI.closeUserDataStream(); } catch (e) {
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
      const res = await bc.restAPI.futuresAccountBalanceV2();
      if (!res) return 0;

      const data = await res.data() as any;
      const usdt = Array.isArray(data) ? data.find((b: any) => b.asset === 'USDT') : null;

      if (usdt) {
        return parseFloat(usdt.balance || 0);
      }

      // Fallback: try accountInformationV2 (full account details)
      this.logger.debug(`futuresAccountBalanceV2 did not return USDT. Trying accountInformationV2 fallback...`);
      const accRes = await bc.restAPI.accountInformationV2();
      const accData = await accRes.data() as any;
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

  private async startUserDataStream(bc: any, isReconnect = false) {
    if (!bc) return;
    // SRE: Critical guard - if IP is banned, do not even attempt UDS start to prevent chain reaction
    const currentWeight = this.sessionState.binanceRateLimit.used_1m;
    if (currentWeight >= this.sessionState.binanceRateLimit.limit) {
      this.logger.error(`[UDS] Cannot start stream: IP Rate limit exceeded (${currentWeight}/${this.sessionState.binanceRateLimit.limit}).`);
      if (!isReconnect) throw new Error('IP Rate limit exceeded');
      return;
    }

    try {
      this.monitoringService.incrementApiRequests();
      const res = await bc.restAPI.startUserDataStream();
      if (!res || !res.data) throw new Error('Failed to start user data stream: No response from Binance');

      const resData = await res.data() as any;
      const newListenKey = resData.listenKey;

      // If we got the same listenKey back, the old stream is still valid
      if (isReconnect && newListenKey === this.listenKey && this.isUdsConnected) {
        this.logger.debug('[UDS] Same listenKey returned — stream still valid, skipping reconnect');
        this.monitoringService.setUdsStatus('CONNECTED'); // resets stale clock
        return;
      }

      const oldWs = this.userDataWs;
      const oldListenKey = this.listenKey;

      this.listenKey = newListenKey;
      this.userDataWs = await bc.websocketStreams.connect({ stream: this.listenKey });
      this.isUdsConnected = true;

      this.monitoringService.setUdsStatus('CONNECTED');

      this.userDataWs.on('error', (err: any) => {
        this.isUdsConnected = false;
        this.monitoringService.setUdsStatus('DISCONNECTED');
        this.logger.error(`User Data Stream error: ${err.message || String(err)}`);
      });

      this.userDataWs.on('close', () => {
        if (this.userDataWs === oldWs) return; // Ignore close from old stream during transition
        this.isUdsConnected = false;
        this.monitoringService.setUdsStatus('DISCONNECTED');
        if (this.running) {
          this.logger.warn('User Data Stream closed unexpectedly. Reconnecting...');
          setTimeout(() => this.startUserDataStream(bc, true).catch(() => {}), 5000);
        }
      });

      this.userDataWs.on('message', async (payload: any) => {
        this.monitoringService.recordUdsPing();
        try {
          // SDK WebsocketStreams.connect returns a connection that emits 'message' with the already parsed object or string
          const data = typeof payload === 'string' ? JSON.parse(payload) : payload;

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
                this.sessionState.lastExchangeBalance = nb;
              }
            }
            // Real-time Position Tracking (Zero Weight)
            if (data.a.P) {
              for (const pos of data.a.P) {
                const symbol = pos.s;
                const amount = parseFloat(pos.pa);
                const entryPrice = parseFloat(pos.ep);

                const prevPos = this.sessionState.realTimePositions.get(symbol);
                this.sessionState.realTimePositions.set(symbol, { amount, entryPrice });

                this.logger.debug(`[Lifecycle] Real-time position update for ${symbol}: ${amount} @ ${entryPrice}`);

                // ZERO-WEIGHT RECONCILIATION: If position reaches 0 and we have an active trade,
                // it means it was closed on exchange (SL, TP, or manual).
                if (amount === 0 && (!prevPos || prevPos.amount !== 0)) {
                  const trade = this.sessionState.activeTrades.find(t => t.symbol === symbol);
                  if (trade) {
                    const tradeIdShort8 = (trade.id || 'N/A').substring(0, 8);
                    this.logger.log(`[${tradeIdShort8}] [Lifecycle] Zero-weight reconciliation: Position for ${symbol} reached zero on exchange. Triggering local closure.`);
                    this.eventEmitter.emit('trade.exchange_close', {
                      symbol,
                      exitPrice: 0, // Will use ticker fallback
                      reason: 'EXCHANGE_SYNC',
                      isReconciliation: true
                    });
                  }
                }
              }
            }
          } else if (data.e === 'ORDER_TRADE_UPDATE') {
            const order = data.o;
            this.logger.log(`[Lifecycle] Order Update: ${order.s} ${order.S} ${order.X} (id=${order.i}, client_id=${order.c})`);
            this.eventEmitter.emit('binance.order_update', data);
          } else if (data.e === 'listenKeyExpired') {
            this.logger.warn('[Lifecycle] ListenKey expired, restarting user data stream...');
            this.startUserDataStream(bc, true).catch(() => {});
          }
        } catch (err) {
            this.logger.debug(`Error processing user data WS message: ${err instanceof Error ? err.message : String(err)}`);
        }
      });
      const subMsg = `[Lifecycle] Subscribing to User Data Stream with listenKey: ${this.listenKey?.substring(0, 10)}...`;
      this.logger.log(subMsg);
      this.eventEmitter.emit(ENGINE_EVENTS.LOG_MESSAGE, { msg: subMsg, level: 'info' });
      // Not needed for new SDK as connect({ stream: listenKey }) already handles the subscription
      // this.userDataWs.userData(this.listenKey);

      // Transition handling for proactive 24h reconnect
      if (isReconnect && oldWs) {
        this.logger.log('[Lifecycle] Transitioning to new User Data Stream. Closing old stream in 30s...');
        setTimeout(() => {
          try {
            oldWs.disconnect();
            if (oldListenKey) bc.restAPI.closeUserDataStream().catch(() => {});
          } catch (e) {}
        }, 30000);
      }

      if (this.listenKeyKeepAlive) clearInterval(this.listenKeyKeepAlive);

      // SRE: Independent UDS liveness check (Stall Detection)
      if (this.udsLivenessCheck) clearInterval(this.udsLivenessCheck);
      this.udsLivenessCheck = setInterval(() => {
        if (!this.running || !this.isUdsConnected) return;
        const metrics = this.monitoringService.getMetrics();
        if (metrics.application.exchange_uds_status === 'LAGGING') {
           this.logger.warn(`[SRE] User Data Stream stall detected (>60s). Force-reconnecting...`);
           this.startUserDataStream(bc, true).catch(() => {});
        }
      }, 30000);

      const startTime = Date.now();
      this.listenKeyKeepAlive = setInterval(async () => {
        if (!this.listenKey || !this.running) return;

        const ageMs = Date.now() - startTime;
        // Finding 9: Proactive 24h reconnect at 23h 50m
        if (ageMs > 23 * 60 * 60 * 1000 + 50 * 60 * 1000) {
           this.logger.log('[Lifecycle] Proactive 24h User Data Stream refresh initiated...');
           this.startUserDataStream(bc, true).catch(err => {
              this.logger.error(`Proactive UDS refresh failed: ${err.message}`);
           });
           return;
        }

        try {
          this.monitoringService.incrementApiRequests();
          await bc.restAPI.keepaliveUserDataStream();
        } catch (err) {
            this.logger.debug(`Error keeping alive user data stream: ${err instanceof Error ? err.message : String(err)}`);
        }
      }, ENGINE_CONSTANTS.USER_DATA_KEEPALIVE_MS);
    } catch (e) {
      if (!isReconnect) throw e;
      this.logger.error(`Failed to refresh user data stream: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}
