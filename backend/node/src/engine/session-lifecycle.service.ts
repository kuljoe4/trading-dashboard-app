import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { SessionConfig } from '../models/SessionConfig';
import { Trade } from '../models/Trade';
import { SessionStateService } from './session_state.service';
import { OrderManagerService } from './orderManager';
import { MarketFeedService } from './market_feed.service';
import { MomentumScannerService } from './momentum_scanner.service';
import { PositionTrackerService } from './positionTracker';
import { MonitoringService } from './monitoring.service';
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
  ) {}

  async start(config: SessionConfig, bc?: any, sid?: string, hist: Trade[] = [], curBal?: number, open: Trade[] = []) {
    this.sessionState.reset(config, hist, curBal);
    const mode = config.trading_mode || (config.paper_mode ? 'paper' : 'live');
    this.orderManager.setBinanceClient(bc, mode === 'paper');

    if (mode !== 'paper' && bc) {
      try {
        const b = await this.fetchBinanceBalance(bc);
        this.logger.log(`[Lifecycle] Initial Binance ${mode} balance fetch: ${b} USDT`);
        this.sessionState.balanceLive = b;
        this.sessionState.balancePaper = b;
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
      const res = await bc.restAPI.accountApi.futuresAccountBalanceV2();
      const data = res.data || res;
      const usdt = Array.isArray(data) ? data.find((b: any) => b.asset === 'USDT') : null;
      return usdt ? parseFloat(usdt.balance || 0) : 0;
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
      this.listenKey = res.data.listenKey;
      this.userDataWs = await bc.websocketStreams.connect();
      this.userDataWs.on('message', async (msg: any) => {
        try {
          const data = typeof msg === 'string' ? JSON.parse(msg) : msg;
          if (data.e === 'ACCOUNT_UPDATE' && data.a && data.a.B) {
            const usdt = data.a.B.find((b: any) => b.a === 'USDT');
            if (usdt) {
              const nb = parseFloat(usdt.wb);
              this.sessionState.balanceLive = nb;
              this.sessionState.balancePaper = nb;
            }
          }
        } catch (err) {
            this.logger.debug(`Error processing user data WS message: ${err instanceof Error ? err.message : String(err)}`);
        }
      });
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
