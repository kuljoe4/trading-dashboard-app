import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Settings as SettingsEntity } from '../models/entities/Settings.entity';
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
import { sanitize } from '../lib/logger';
import {
  BinancePositionMode,
  BinanceBalanceV3,
  BinanceListenKeyResponse,
  BinanceAccountUpdateEvent
} from '../models/binance.types';
import { ENGINE_CONSTANTS, EXIT_REASONS } from '../models/constants';

@Injectable()
export class SessionLifecycleService {
  private readonly logger = new Logger(SessionLifecycleService.name);
  private balancePollInterval: NodeJS.Timeout | null = null;
  private running = false;
  public isUdsConnected = false;
  private udsReconnectAttempts = 0;
  private userDataWs: any = null;
  private listenKey: string | null = null;
  private listenKeyKeepAlive: NodeJS.Timeout | null = null;
  private udsLivenessCheck: NodeJS.Timeout | null = null;
  private lastModeSync = 0;
  private isUdsStarting = false;

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
    @InjectRepository(SettingsEntity)
    private readonly settingsRepository: Repository<SettingsEntity>,
  ) {}

  private async progress(msg: string, level: 'info' | 'warn' = 'info') {
    this.logger.log(`[Lifecycle] ${msg}`);
    this.eventEmitter.emit(ENGINE_EVENTS.LOG_MESSAGE, { msg: `[Lifecycle] ${msg}`, level });
  }

  async start(config: SessionConfig, bc?: any, sid?: string, hist: Trade[] = [], curBal?: number, open: Trade[] = []) {
    this.running = true;
    await this.progress('Starting session initialization...');

    // Load lastModeSync from DB on startup
    try {
      const settings = await this.settingsRepository.findOne({ where: { id: 'default' } });
      if (settings && settings.last_mode_sync) {
        this.lastModeSync = Number(settings.last_mode_sync);
      }
    } catch (e) {}

    this.sessionState.reset(config, hist, curBal, sid, open);
    const mode = config.trading_mode || (config.paper_mode ? 'paper' : 'live');
    await this.orderManager.setBinanceClient(bc, mode === 'paper');

    if (mode !== 'paper' && bc) {
      // PROACTIVE RATE LIMIT: Reset weights at session start to ensure clean slate
      this.sessionState.updateRateLimit(0);

      await this.progress(`Configuring Binance ${mode.toUpperCase()} account...`);

      // Best Practice: Synchronize server time
      // PERF: Optimized startup - removed redundant queryUserRateLimit (Weight 20).
      // SDK handles time sync; we log the offset from actual data calls.

      try {
        // Enforce One-Way Mode (Disable Hedge Mode) - Cache for 7 days
        const CACHE_TTL = 7 * 24 * 60 * 60 * 1000;
        let shouldSyncMode = Date.now() - this.lastModeSync > CACHE_TTL;

        // RESEARCH-02: Load cached position mode from DB
        if (shouldSyncMode) {
          try {
             const settings = await this.settingsRepository.findOne({ where: { id: 'default' } });
             if (settings && settings.last_mode_sync && (Date.now() - Number(settings.last_mode_sync)) < CACHE_TTL) {
                this.lastModeSync = Number(settings.last_mode_sync);
                if (settings.is_one_way_mode) {
                   this.logger.debug('Loaded cached position mode from DB: One-Way.');
                   shouldSyncMode = false;
                }
             }
          } catch (e) {}
        }

        if (shouldSyncMode) {
        try {
          this.monitoringService.incrementApiRequests();
          const currentModeRes = await bc.restAPI.getCurrentPositionMode();
          const currentModeData = (await currentModeRes.data()) as BinancePositionMode;

          if (currentModeData && currentModeData.dualSidePosition === false) {
            this.logger.debug('Binance position mode is already One-Way.');

            await this.settingsRepository.update('default', {
              is_one_way_mode: true,
              last_mode_sync: Date.now()
            });
          } else {
            this.monitoringService.incrementApiRequests();
            const modeRes = await bc.restAPI.changePositionMode({ dualSidePosition: false } as any);
            const modeData = await modeRes.data();
            const modeMsg = `Binance position mode set to One-Way: ${JSON.stringify(modeData)}`;
            this.logger.log(modeMsg);
            this.eventEmitter.emit(ENGINE_EVENTS.LOG_MESSAGE, { msg: modeMsg, level: 'info' });

            await this.settingsRepository.update('default', {
              is_one_way_mode: true,
              last_mode_sync: Date.now()
            });
          }
          this.lastModeSync = Date.now();
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
        } else {
          this.logger.debug('Skipping Binance position mode sync (already cached).');
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

      if (!this.isUdsConnected) {
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
    }

    await this.progress('Initializing market feed and ticker cache...');
    await this.marketFeed.start(config, bc);

    await this.progress('Warming up momentum scanner...');
    await this.momentumScanner.start(config);

    if (open.length > 0) {
      await this.progress(`Resuming ${open.length} active trades...`);
      for (const t of open) {
        this.positionTracker.addTrade(t);
        this.sessionState.updateStatsOnEntry(t.id);
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
    // SRE: Proactive Rate Limit Guard for balance polling (non-critical)
    if (this.sessionState.isRateLimited(0.95)) {
       this.logger.warn(`[Lifecycle] Skipping REST balance fetch due to high API weight. Using last known: ${this.sessionState.balanceLive}`);
       return this.sessionState.balanceLive;
    }

    try {
      this.monitoringService.incrementApiRequests();
      // OPTIMIZATION: Migrate to V3 endpoint for targeted, low-payload balance fetch.
      // futuresAccountBalanceV3 returns only active symbols, reducing network overhead.
      // SRE: Explicitly filter to USDT to minimize exchange-side processing and weight.
      const res = await bc.restAPI.futuresAccountBalanceV3({ asset: 'USDT' });
      if (!res) return 0;

      // Traceability: Log successful balance fetch
      this.logger.debug(`[Lifecycle] Successfully fetched balance via REST V3.`);

      const data = (await res.data()) as BinanceBalanceV3[];
      const usdt = Array.isArray(data) ? data.find((b) => b.asset === 'USDT') : null;

      if (usdt) {
        return parseFloat(String(usdt.balance || '0'));
      }

      // SENTINEL: Sanitize the raw data before logging to prevent potential credential leakage
      this.logger.warn(`Could not find USDT balance in Binance response. Data received: ${JSON.stringify(sanitize(data)).substring(0, 200)}`);
      return 0;
    } catch (e: unknown) {
      this.logger.error(`Balance fetch failed: ${e instanceof Error ? e.message : String(e)}`);
      return 0;
    }
  }

  /**
   * CHRONOS: Attributes net funding fee impact to active trades.
   * Logic: If symbols are present in P[], attribute bc proportionately to notional.
   * If P[] is empty (Cross Margin), attribute to all active USDT-margined trades.
   */
  private attributeFundingFee(totalDelta: number, positions: any[]) {
     const activeTrades = this.positionTracker.activeList();
     if (activeTrades.length === 0) return;

     let targetTrades = activeTrades;

     // If symbols provided in P[], only attribute to those symbols
     if (positions && positions.length > 0) {
        const symbols = new Set(positions.map(p => p.s));
        targetTrades = activeTrades.filter(t => symbols.has(t.symbol));
     }

     if (targetTrades.length === 0) return;

     // Proportionate Attribution by Notional Value (Absolute)
     const notionals = targetTrades.map(t => Math.abs(t.qty * t.entry_price));
     const totalNotional = notionals.reduce((a, b) => a + b, 0);

     if (totalNotional === 0) return;

     for (let i = 0; i < targetTrades.length; i++) {
        const trade = targetTrades[i];
        const share = notionals[i] / totalNotional;
        const delta = roundEight(totalDelta * share);

        if (delta !== 0) {
           // Binance funding 'bc' is positive for credit, negative for debit.
           // trade.funding_fee is cost (positive = paid, negative = received).
           const cost = -delta;
           trade.funding_fee = roundEight((Number(trade.funding_fee) || 0) + cost);
           trade.pnl = roundEight((Number(trade.pnl) || 0) + delta);

           this.logger.log(`[Chronos] Attributed funding fee to ${trade.symbol}: ${cost} USDT (Total: ${trade.funding_fee})`);

           // Emit update to trigger session stats reconciliation (appliedPnL delta)
           this.eventEmitter.emit(ENGINE_EVENTS.TRADE_UPDATED, {
              trade,
              pnlDelta: delta
           });
        }
     }
  }

  public handleAccountUpdate(data: BinanceAccountUpdateEvent) {
    const reason = data.a.m;

    // Real-time Balance Tracking (Zero Weight)
    if (data.a.B) {
      const usdt = data.a.B.find((b) => b.a === 'USDT');
      if (usdt) {
        const nb = parseFloat(usdt.wb);
        const bc = parseFloat(usdt.bc || '0');
        const liveBalMsg = `[Lifecycle] Received real-time balance update: ${nb} USDT (Reason: ${reason}, Delta: ${bc})`;
        this.logger.log(liveBalMsg);
        this.eventEmitter.emit(ENGINE_EVENTS.LOG_MESSAGE, { msg: liveBalMsg, level: 'info' });
        this.sessionState.balanceLive = nb;
        this.sessionState.balancePaper = nb;
        this.sessionState.lastExchangeBalance = nb;
        this.sessionState.lastUdsBalanceUpdate = Date.now();

        // CHRONOS: Handle Authoritative Funding Fee Attribution
        // When reason is FUNDING_FEE, the 'bc' field contains the net funding impact.
        // We attribute this to active trades to ensure PnL and session stats remain accurate.
        if (reason === 'FUNDING_FEE' && bc !== 0) {
           this.attributeFundingFee(bc, data.a.P || []);
        }
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

        let trade = this.sessionState.activeTrades.find(t => t.symbol === symbol);

        // SRE: Race condition guard - check in-flight entries if not in active list
        if (!trade && amount !== 0) {
           trade = this.positionTracker.getInFlightEntry(symbol);
           if (trade) {
              this.logger.debug(`[Lifecycle] [Sync] Matched in-flight entry for ${symbol} in ACCOUNT_UPDATE.`);
           }
        }

        // Real-time Quantity & Price Sync: Update active trade from UDS ACCOUNT_UPDATE
        if (trade && amount !== 0) {
          const absoluteAmount = Math.abs(amount);
          const tradeIdShort8 = (trade.id || 'N/A').substring(0, 8);

          // Authoritative Entry Price Sync
          if (entryPrice > 0 && Math.abs(trade.entry_price - entryPrice) > 0.00000001) {
            this.logger.log(`[${tradeIdShort8}] [Sync] Updating entry price from ACCOUNT_UPDATE for ${symbol}: ${trade.entry_price} -> ${entryPrice}`);
            trade.entry_price = entryPrice;
          }

          // Authoritative Quantity Sync
          if (Math.abs(trade.qty - absoluteAmount) > 0.00000001) {
            // CHRONOS: Authoritative sync is mandatory.
            // We no longer ignore quantity decreases outside of 'closing' state,
            // as this creates ghost positions when users manually reduce positions on exchange.
            this.logger.log(`[${tradeIdShort8}] [Sync] Updating quantity from ACCOUNT_UPDATE for ${symbol}: ${trade.qty} -> ${absoluteAmount}`);
            trade.qty = absoluteAmount;
            this.eventEmitter.emit(ENGINE_EVENTS.QUANTITY_SYNC, { symbol, qty: absoluteAmount });
          }
        }

        // ZERO-WEIGHT RECONCILIATION: If position reaches 0 and we have an active trade,
        // it means it was closed on exchange (SL, TP, or manual).
        if (amount === 0 && (!prevPos || prevPos.amount !== 0)) {
          // SRE: Race condition guard - ignore UDS zero-fills if we are already in the process of entering, ratcheting, or closing
          if (this.orderManager.isRatcheting(symbol) || this.positionTracker.isEntering(symbol) || this.positionTracker.isClosing(symbol)) {
            this.logger.debug(`[UDS] Ignoring zero-amount update for ${symbol} during lifecycle transition.`);
            return;
          }

          const trade = this.sessionState.activeTrades.find(t => t.symbol === symbol);
          if (trade) {
            const tradeIdShort8 = (trade.id || 'N/A').substring(0, 8);
            this.logger.log(`[${tradeIdShort8}] [Lifecycle] Zero-weight reconciliation: Position for ${symbol} reached zero on exchange. Triggering local closure.`);
            this.eventEmitter.emit('trade.exchange_close', {
              symbol,
              exitPrice: 0, // Will use ticker fallback
              reason: EXIT_REASONS.EXCHANGE_SYNC,
              isReconciliation: true
            });
          }
        }
      }
    }
  }

  public async startUserDataStream(bc: any, isReconnect = false, isTransition = false) {
    if (!bc || !this.running) return;

    if (this.isUdsStarting) {
      this.logger.debug('[UDS] Connection attempt already in progress. Skipping.');
      return;
    }
    this.isUdsStarting = true;

    // SRE: Critical guard - if IP is banned, do not even attempt UDS start to prevent chain reaction
    // SRE Overwatch: startUserDataStream is whitelisted as IMMUNE in the gateway, but we still log warning if over limit.
    const currentWeight = this.sessionState.binanceRateLimit.used_1m;
    const limit = this.sessionState.binanceRateLimit.limit || ENGINE_CONSTANTS.BINANCE_RATE_LIMIT_DEFAULT;
    if (currentWeight >= limit) {
      this.logger.warn(`[UDS] IP Rate limit exceeded (${currentWeight}/${limit}). Proceeding with IMMUNE infrastructure call.`);
    }

    try {
      this.monitoringService.incrementApiRequests();
      const res = await bc.restAPI.startUserDataStream();
      if (!res || !res.data) throw new Error('Failed to start user data stream: No response from Binance');

      const resData = (await res.data()) as BinanceListenKeyResponse;
      const newListenKey = resData.listenKey;

      const oldWs = this.userDataWs;
      const oldListenKey = this.listenKey;

      // SRE FIX: Always rebuild the socket on reconnection attempt to handle silent network-level stalls,
      // even if the listenKey string remains unchanged.
      // BOLT: Only disconnect immediately if NOT a transition. Transitions keep old one alive for 30s.
      if (isReconnect && oldWs && !isTransition) {
        this.logger.log('[UDS] Force-rebuilding User Data Stream socket to resolve potential stall.');
        try { oldWs.disconnect(); } catch (e) {}
      }

      this.listenKey = newListenKey;
      this.userDataWs = await bc.websocketStreams.connect({ stream: this.listenKey });
      this.isUdsConnected = true;
      this.udsReconnectAttempts = 0;

      this.monitoringService.setUdsStatus('CONNECTED');

      const currentWs = this.userDataWs;

      currentWs.on('error', (err: any) => {
        if (this.userDataWs !== currentWs) return;
        this.isUdsConnected = false;
        this.monitoringService.setUdsStatus('DISCONNECTED');
        this.logger.error(`User Data Stream error: ${err.message || String(err)}`);
      });

      currentWs.on('close', () => {
        if (this.userDataWs !== currentWs) {
          this.logger.log('[UDS] Old stream closed gracefully.');
          return;
        }
        this.isUdsConnected = false;
        this.monitoringService.setUdsStatus('DISCONNECTED');
        if (this.running) {
          this.udsReconnectAttempts++;

          if (this.udsReconnectAttempts > 5) {
             const alertMsg = `CRITICAL: User Data Stream failed to reconnect after ${this.udsReconnectAttempts} attempts. Account monitoring is degraded.`;
             this.logger.error(alertMsg);
             this.eventEmitter.emit(ENGINE_EVENTS.LOG_MESSAGE, { msg: alertMsg, level: 'error' });
             this.eventEmitter.emit(ENGINE_EVENTS.ALERT, {
                level: 'error',
                title: 'UDS Reconnect Failure',
                message: 'Account stream is offline after multiple retries. Positions might be unprotected.',
             });
          }

          this.logger.warn(`User Data Stream closed unexpectedly. Reconnecting (Attempt ${this.udsReconnectAttempts})...`);

          // BOLT: Use exponential backoff for reconnect attempts to avoid hammering during outages
          const delay = Math.min(30000, 5000 * Math.pow(2, Math.max(0, this.udsReconnectAttempts - 1)));
          setTimeout(() => {
            if (this.running && !this.isUdsConnected) {
              this.startUserDataStream(bc, true).catch(() => {});
            }
          }, delay);
        }
      });

      currentWs.on('pong', () => {
        if (this.userDataWs !== currentWs) return;
        // REDUCE LOG NOISE: Silence heartbeat PONGs
        // this.logger.debug('[UDS] WebSocket PONG received. Heartbeat confirmed.');
        this.monitoringService.recordUdsPing();
      });

      currentWs.on('message', async (payload: any) => {
        if (this.userDataWs !== currentWs) return;
        this.monitoringService.recordUdsPing();
        try {
          // SDK WebsocketStreams.connect returns a connection that emits 'message' with the already parsed object or string
          let data = typeof payload === 'string' ? JSON.parse(payload) : payload;

          // UDS HARDENING: Handle both direct and combined stream formats (unwrap .data if present)
          if (data && data.data && data.stream) {
            data = data.data;
          }

          if (data.e === 'ACCOUNT_UPDATE' && data.a) {
            this.handleAccountUpdate(data);
          } else if (data.e === 'ORDER_TRADE_UPDATE') {
            // REDUCE LOG NOISE: OrderManagerService already logs this with more detail
            // const order = data.o;
            // this.logger.log(`[Lifecycle] Order Update: ${order.s} ${order.S} ${order.X} (id=${order.i}, client_id=${order.c})`);
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

      // Transition handling for proactive 24h reconnect or planned swaps
      if (isTransition && oldWs) {
        this.logger.log('[Lifecycle] Transitioning to new User Data Stream. Closing old stream in 30s...');
        setTimeout(() => {
          try {
            // Close the old socket if it hasn't been closed yet
            oldWs.disconnect();
            // BOLT: Only close key if different. In case of expiry, Binance already closed it.
            if (oldListenKey && oldListenKey !== this.listenKey) {
              this.logger.debug(`[UDS] Closing old listenKey: ${oldListenKey.substring(0, 10)}...`);
              bc.restAPI.closeUserDataStream({ listenKey: oldListenKey }).catch(() => {});
            }
          } catch (e) {}
        }, 30000);
      }

      if (this.listenKeyKeepAlive) clearInterval(this.listenKeyKeepAlive);

      // SRE: Independent UDS liveness check (Stall Detection)
      if (this.udsLivenessCheck) clearInterval(this.udsLivenessCheck);
      this.udsLivenessCheck = setInterval(() => {
        if (!this.running || !this.isUdsConnected) return;

        // SRE: Proactive WebSocket ping to confirm liveness on idle accounts
        try {
           if (this.userDataWs && typeof this.userDataWs.pingServer === 'function') {
              this.logger.debug('[UDS] Dispatching proactive WebSocket ping...');
              this.userDataWs.pingServer();
           }
        } catch (e) {
           this.logger.debug(`[SRE] Failed to dispatch WebSocket ping: ${e instanceof Error ? e.message : String(e)}`);
        }

        const metrics = this.monitoringService.getMetrics();
        const lastPing = metrics.application.last_uds_ping_sec || 0;
        const hasActiveTrades = this.positionTracker.activeList().length > 0;

        // SRE Optimization: Threshold increased to 300s (5m).
        // On idle accounts, message silence is expected. We only force-reconnect if there are active trades
        // that require real-time monitoring, OR if the stall is excessive (>10m).
        const STALL_THRESHOLD = 300;
        const MAX_IDLE_SILENCE = 600;

        const isStalled = (hasActiveTrades && lastPing > STALL_THRESHOLD) || lastPing > MAX_IDLE_SILENCE;

        if (metrics.application.exchange_uds_status === 'LAGGING' && isStalled) {
           this.logger.warn(`[SRE] User Data Stream stall detected (LastPing=${lastPing}s, ActiveTrades=${hasActiveTrades}). Force-reconnecting...`);
           this.startUserDataStream(bc, true).catch(() => {});
        }
        // HEARTBEAT: Explicit debug log for UDS health observability
        // REDUCE LOG NOISE: Downgrade heartbeat to verbose or silence entirely if connected
        if (!this.isUdsConnected || lastPing > 30) {
           this.logger.debug(`[SRE] UDS Heartbeat: Status=${this.isUdsConnected ? 'CONNECTED' : 'DISCONNECTED'}, LastPing=${lastPing}s, ActiveTrades=${hasActiveTrades}`);
        }
      }, 60000);

      const startTime = Date.now();
      this.listenKeyKeepAlive = setInterval(async () => {
        if (!this.listenKey || !this.running) return;

        const ageMs = Date.now() - startTime;
        // Finding 9: Proactive 24h reconnect at 23h 50m
        if (ageMs > 23 * 60 * 60 * 1000 + 50 * 60 * 1000) {
           this.logger.log('[Lifecycle] Proactive 24h User Data Stream refresh initiated...');
           this.startUserDataStream(bc, true, true).catch(err => {
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
      if (!isReconnect && !isTransition) throw e;
      this.logger.error(`Failed to refresh user data stream: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      this.isUdsStarting = false;
    }
  }
}
