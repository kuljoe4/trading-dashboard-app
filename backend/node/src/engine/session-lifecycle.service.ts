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

  async start(config: SessionConfig, bc?: any, sid?: string, hist: Trade[] = [], curBal?: number, open: Trade[] = []) {
    this.sessionState.reset(config, hist, curBal);
    const mode = config.trading_mode || (config.paper_mode ? 'paper' : 'live');
    this.orderManager.setBinanceClient(bc, mode === 'paper');

    if (mode !== 'paper' && bc) {
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
          // Error -4059 means it's already in that mode
          if (modeErr.message?.includes('-4059') || modeErr.data?.code === -4059) {
            this.logger.debug('Binance position mode is already One-Way.');
          } else {
            this.logger.warn(`Failed to set Binance position mode to One-Way: ${modeErr.message}`);
          }
        }

        const b = await this.fetchBinanceBalance(bc);
        const balMsg = `[Lifecycle] Initial Binance ${mode} balance fetch: ${b} USDT`;
        this.logger.log(balMsg);
        this.eventEmitter.emit(ENGINE_EVENTS.LOG_MESSAGE, { msg: balMsg, level: 'info' });

        if (b === 0 && (curBal || 0) > 0) {
          const fallbackMsg = `[Lifecycle] Binance ${mode} returned 0 balance. Falling back to local configuration: ${curBal} USDT. Please check if your Testnet account needs funds from the faucet.`;
          this.logger.warn(fallbackMsg);
          this.eventEmitter.emit(ENGINE_EVENTS.LOG_MESSAGE, { msg: fallbackMsg, level: 'warn' });
          this.sessionState.balanceLive = curBal!;
          this.sessionState.balancePaper = curBal!;
        } else {
          this.sessionState.balanceLive = b;
          this.sessionState.balancePaper = b;
          if (b === 0) {
            const zeroBalMsg = `[Lifecycle] Binance ${mode} balance is actually 0. Engine will be gated until funds are available.`;
            this.logger.warn(zeroBalMsg);
            this.eventEmitter.emit(ENGINE_EVENTS.LOG_MESSAGE, { msg: zeroBalMsg, level: 'warn' });
          }
        }
      } catch (e) {
        this.logger.debug(`Initial balance fetch failed: ${e instanceof Error ? e.message : String(e)}`);
      }

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

    await this.marketFeed.start(config);
    await this.momentumScanner.start(config);

    if (open.length > 0) {
      for (const t of open) {
        this.positionTracker.addTrade(t);
        this.sessionState.updateStatsOnEntry();
      }
    }
    this.sessionState.setActiveTrades(this.positionTracker.activeList());

    await this.auditLog.log({
      action: 'SESSION_START',
      resourceId: sid || undefined,
      details: { mode, strategy: config.strategy_label }
    });

    return { status: 'started' };
  }

  async stop(bc?: any, sid?: string, config?: SessionConfig) {
    if (this.balancePollInterval) clearInterval(this.balancePollInterval);
    if (this.listenKeyKeepAlive) clearInterval(this.listenKeyKeepAlive);
    if (this.userDataWs) {
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

    await this.marketFeed.stop();
    await this.momentumScanner.stop();

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
      this.userDataWs.on('message', async (msg: any) => {
        try {
          const data = typeof msg === 'string' ? JSON.parse(msg) : msg;
          if (data.e === 'ACCOUNT_UPDATE' && data.a && data.a.B) {
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
