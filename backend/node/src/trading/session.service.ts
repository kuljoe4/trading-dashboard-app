import { Injectable, Logger, OnModuleInit, BadRequestException, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { Session as SessionEntity } from '../models/entities/Session.entity';
import { TradeEntity, TERMINAL_STATUSES } from '../models/entities/Trade.entity';
import { Log as LogEntity } from '../models/entities/Log.entity';
import { BalanceHistory as BalanceHistoryEntity } from '../models/entities/BalanceHistory.entity';
import { SessionConfig } from '../models/SessionConfig';
import { TradingSessionService } from '../engine/trading_session.service';
import { ENGINE_EVENTS } from '../engine/events';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { AuditLogService } from './audit-log.service';
import { Trade } from '../models/Trade';
import { v4 as uuid } from 'uuid';
import { Settings as SettingsEntity } from '../models/entities/Settings.entity';
import { decrypt } from '../lib/crypto';
import { ConfigValidationException } from '../lib/exceptions';
import { BinanceClientFactory } from '../lib/binanceClientFactory';
import { AnalyticsService } from '../engine/analytics.service';
import { updateLogLevels } from '../lib/logger';
import { roundEight } from '../lib/math';

@Injectable()
export class SessionService implements OnModuleInit {
  private readonly logger = new Logger(SessionService.name);
  
  private sessionRunning = false;
  private currentSessionId: string | null = null;
  private wsBroadcaster: (data: any) => void = () => {};

  private analyticsCache: { data: any; ts: number } | null = null;
  private readonly CACHE_TTL_MS = 60000; // 1 minute
  // SENTINEL: In-memory tracking to prevent database-heavy count() and log spamming
  private logRateLimits = new Map<string, { count: number; resetAt: number }>();
  private sessionLogCounts = new Map<string, number>();

  constructor(
    @InjectRepository(SessionEntity)
    private sessionRepository: Repository<SessionEntity>,
    @InjectRepository(TradeEntity)
    private tradeRepository: Repository<TradeEntity>,
    @InjectRepository(LogEntity)
    private logRepository: Repository<LogEntity>,
    @InjectRepository(SettingsEntity)
    private settingsRepository: Repository<SettingsEntity>,
    @InjectRepository(BalanceHistoryEntity)
    private balanceHistoryRepository: Repository<BalanceHistoryEntity>,
    private tradingSessionService: TradingSessionService,
    private eventEmitter: EventEmitter2,
    private analyticsService: AnalyticsService,
    private binanceClientFactory: BinanceClientFactory,
    private readonly auditLog: AuditLogService,
  ) {}

  async onModuleInit() {
    this.logger.log('SessionService initializing...');
    // SEC-02: Cleanup old data on startup and periodically
    await this.cleanupOldData();
    setInterval(() => this.cleanupOldData().catch(e => this.logger.error(`Periodic cleanup failed: ${e.message}`)), 12 * 60 * 60 * 1000);

    this.logger.log('Checking security configurations...');
    // DEPLOY-02: Check ENCRYPTION_KEY and ADMIN_API_KEY in production
    // Note: We only log errors here to avoid boot loops. Enforcement happens at the operation level.
    if (process.env.NODE_ENV === "production") {
      if (!process.env.ENCRYPTION_KEY) {
        this.logger.error(
          "CRITICAL: ENCRYPTION_KEY is not set in production! App will fail on sensitive operations.",
        );
      }
      if (!process.env.ADMIN_API_KEY) {
        this.logger.error(
          "CRITICAL: ADMIN_API_KEY is not set in production! App is UNPROTECTED.",
        );
      }
    }

    // Ensure default settings exist
    this.logger.log('Ensuring default settings exist...');
    const settings = await this.settingsRepository.findOne({ where: { id: 'default' } });
    if (!settings) {
      this.logger.log('Initializing default settings...');
      await this.settingsRepository.save(this.settingsRepository.create({
        id: 'default',
        paper_balance: 10000.0,
        testnet_balance: 0,
        live_balance: 0
      }));
    }

    // Cleanup any sessions marked as running in the database on startup
    // BOLT: Optimize startup cleanup with a single bulk update instead of a loop
    this.logger.log('Cleaning up stale running sessions...');
    const updateResult = await this.sessionRepository.update({ running: true }, { running: false });
    if (updateResult.affected && updateResult.affected > 0) {
      this.logger.verbose(`Cleaned up ${updateResult.affected} stale running sessions`);
    }

    // DATA-03: One-time population of strategy_label for legacy trades to fix 'Uncategorized' issue
    this.logger.log('Populating strategy_label for legacy trades...');
    try {
      const tradeUpdateResult = await this.tradeRepository.createQueryBuilder()
        .update(TradeEntity)
        .set({ strategy_label: 'Momentum Strategy' })
        .where("strategy_label IS NULL")
        .execute();
      if (tradeUpdateResult.affected && tradeUpdateResult.affected > 0) {
        this.logger.log(`Initialized strategy_label for ${tradeUpdateResult.affected} legacy trades`);
      }
    } catch (e: any) {
      this.logger.error(`Failed to initialize legacy trade labels: ${e.message}`);
    }

    this.logger.log('Wiring balance and trade updates...');
    // Wire balance updates to persistence (legacy/standalone updates)
    this.tradingSessionService.setBalanceUpdateCallback(async (balance, pnl) => {
      const sessionId = this.currentSessionId;
      if (sessionId && pnl === 0) {
        const queryRunner = this.sessionRepository.manager.connection.createQueryRunner();
        await queryRunner.connect();
        await queryRunner.startTransaction();
        try {
          // Lock Session row to ensure consistency and fetch mode
          const session = await queryRunner.manager.findOne(SessionEntity, {
            where: { id: sessionId },
            lock: { mode: 'pessimistic_write' },
            select: ['id', 'tradingMode', 'paperMode', 'config']
          });

          if (session) {
            const mode = session.tradingMode || (session.paperMode ? 'paper' : 'live');
            const startingBalance = mode === 'paper'
              ? (session.config?.paper_starting_balance || 10000)
              : (session.config?.live_starting_balance || 0);

            await queryRunner.manager.update(SessionEntity, sessionId, {
              balance,
              totalPnl: roundEight(balance - startingBalance)
            });

            const updateData: any = {};
            if (mode === 'paper') updateData.paper_balance = balance;
            else if (mode === 'testnet') updateData.testnet_balance = balance;
            else if (mode === 'live') updateData.live_balance = balance;
            await queryRunner.manager.update(SettingsEntity, 'default', updateData);
          }
          await queryRunner.commitTransaction();
        } catch (error) {
          await queryRunner.rollbackTransaction();
          this.logger.error(`Failed to sync standalone balance for session ${sessionId}: ${error instanceof Error ? error.message : String(error)}`);
        } finally {
          await queryRunner.release();
        }
      }
    });

    // Wire trade updates to persistence
    this.tradingSessionService.setTradeUpdateCallback(async (trade, balance) => {
      await this.saveTradeAtomic(trade, balance);
    });

    this.logger.log('SessionService initialization complete.');
  }

  @OnEvent(ENGINE_EVENTS.LOG_MESSAGE)
  async handleEngineLog(payload: { msg: string, level: 'info' | 'warn' | 'error' }) {
    await this.logMessage(payload.msg, payload.level);
  }

  private validateTrade(trade: any): boolean {
    return (
      trade.symbol != null &&
      trade.entry_price != null && !isNaN(Number(trade.entry_price)) &&
      trade.qty != null && !isNaN(Number(trade.qty)) &&
      trade.status != null
    );
  }

  private saveTradePromiseChain: Promise<any> = Promise.resolve();

  async saveTradeAtomic(trade: any, balance: number) {
    // Audit Item 13: Mutex/Promise chain to prevent race conditions during atomic saves
    return this.saveTradePromiseChain = this.saveTradePromiseChain.then(() => this.executeSaveTradeAtomic(trade, balance)).catch(e => {
       this.logger.error(`Atomic save failed in chain: ${e.message}`);
       throw e;
    });
  }

  private async executeSaveTradeAtomic(trade: any, balance: number) {
    if (!this.validateTrade(trade)) {
      this.logger.warn(`Attempted to save invalid trade ${trade.symbol}, skipping.`);
      return;
    }

    const sessionId = this.currentSessionId || trade.sessionId;
    if (!sessionId) {
      this.logger.warn(`Cannot save trade ${trade.symbol}: No sessionId found.`);
      return;
    }

    const queryRunner = this.sessionRepository.manager.connection.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // 0. Lock Session row to serialize all updates for this session and fetch metadata
      const session = await queryRunner.manager.findOne(SessionEntity, {
        where: { id: sessionId },
        lock: { mode: 'pessimistic_write' },
        select: ['id', 'tradingMode', 'paperMode', 'config']
      });

      if (!session) {
        throw new Error(`Session ${sessionId} not found during atomic save.`);
      }

      // 1. Save Trade record
      // BOLT: Preserve negative PnL (realized fees) for OPEN trades so session totalPnl is accurate
      const persistenceTrade = { ...trade };
      if (trade.status === 'OPEN') {
        // Only allow negative PnL (fees) for OPEN trades. Positive unrealized PnL is NOT saved.
        persistenceTrade.pnl = Math.min(0, Number(trade.pnl || 0));
        persistenceTrade.pnl_pct = 0;
      }

      const tradeEntity = this.tradeRepository.create({
        ...persistenceTrade,
        exit_signal_type: trade.exit_signal_type,
        exit_signal_reason: trade.exit_signal_reason,
        sessionId,
      });
      await queryRunner.manager.save(TradeEntity, tradeEntity);

      // 2. Update Session PnL and Balance
      // BOLT: Use balance-based PnL to account for fees/slippage, ensuring consistency with Engine UI
      const mode = session.tradingMode || (session.paperMode ? 'paper' : 'live');
      const startingBalance = mode === 'paper'
        ? (session.config?.paper_starting_balance || 10000)
        : (session.config?.live_starting_balance || 0);

      const realizedPnl = roundEight(balance - startingBalance);

      await queryRunner.manager.update(SessionEntity, sessionId, {
        balance,
        totalPnl: realizedPnl
      });

      // 3. Update Global Settings and record History for all modes
      if (session) {
        const mode = session.tradingMode || (session.paperMode ? 'paper' : 'live');
        const updateData: any = {};
        if (mode === 'paper') updateData.paper_balance = balance;
        else if (mode === 'testnet') updateData.testnet_balance = balance;
        else if (mode === 'live') updateData.live_balance = balance;

        await queryRunner.manager.update(SettingsEntity, 'default', updateData);

        // Record Balance Snapshot
        const snapshot = this.balanceHistoryRepository.create({
          timestamp: new Date(),
          balance: balance,
          pnl: roundEight(trade.pnl || 0),
          type: trade.status === 'OPEN' ? 'TRADE_OPEN' : 'TRADE_CLOSE',
          sessionId: sessionId,
          tradeId: trade.id,
          tradingMode: mode as any
        });
        await queryRunner.manager.save(BalanceHistoryEntity, snapshot);
      }

      await queryRunner.commitTransaction();
      this.logger.verbose(`Transaction committed: Saved trade ${trade.symbol} (${trade.status}) and updated session ${sessionId}`);
    } catch (error) {
      await queryRunner.rollbackTransaction();
      this.logger.error(`Transaction rolled back: Failed to save trade ${trade.symbol}: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  async saveTrade(trade: any) {
    // Legacy method, keeping for compatibility if needed, but routing to atomic
    const status = await this.getStatus();
    await this.saveTradeAtomic(trade, status.balance);
  }

  private validateConfig(config: SessionConfig) {
    if (!config) throw new BadRequestException('Configuration is required');

    // 1. Scan Mode Dependencies
    if (config.scan_mode === 'active_window') {
      if (!config.scan_window_duration_sec) throw new BadRequestException('Window duration is required for Active Window mode');
      if (!config.scan_check_interval_sec) throw new BadRequestException('Check interval is required for Active Window mode');
    }

    // 2. Stop Loss Dependencies
    if (config.sl_type === 'lookback_low/high') {
      if (!config.sl_lookback_period || config.sl_lookback_period < 1) {
        throw new BadRequestException('Valid lookback period is required for Lookback SL type');
      }
    }

    // 3. Take Profit Dependencies
    if (config.tp_mode === 'exp_rr_seq') {
      if (!config.live_rr_sequence || config.live_rr_sequence.length === 0) {
        throw new BadRequestException('Live RR sequence is required for Exponential RR mode');
      }
      if (!config.exit_rr_sequence || config.exit_rr_sequence.length !== config.live_rr_sequence.length) {
        throw new BadRequestException('Exit RR sequence must match Live RR sequence length');
      }
    }

    // 4. Signal Parameter Dependencies
    let signalParams;
    try {
      signalParams = typeof config.signal_params === 'string' 
        ? JSON.parse(config.signal_params || '{}') 
        : config.signal_params || {};
    } catch (e) {
      throw new BadRequestException('Invalid signal_params format. Must be a valid JSON string or object.');
    }
    
    const allEnabled = [...(config.enabled_signals || []), ...(config.exit_signals || [])];

    if (allEnabled.includes('ema_dual_cross')) {
      const fast = parseInt(signalParams.entry_ema_fast || signalParams.exit_ema_fast || '0', 10);
      const slow = parseInt(signalParams.entry_ema_slow || signalParams.exit_ema_slow || '0', 10);
      if (fast <= 0 || slow <= 0) throw new BadRequestException('EMA Dual Cross requires both fast and slow periods (e.g., 9 and 21)');
      if (fast >= slow) throw new BadRequestException('EMA Dual Cross: Fast period must be less than slow period');
    }

    if (allEnabled.includes('ma') && !signalParams.ma_period) {
      throw new BadRequestException('MA Cross signal requires ma_period in signal_params');
    }

    if ((allEnabled.includes('ema') || allEnabled.includes('ema_close')) && !signalParams.ema_period && !signalParams.entry_ema_period && !signalParams.exit_ema_period) {
       throw new BadRequestException('EMA signals require an EMA period to be defined');
    }

    // DATA-02: Indicator Convergence validation
    const maxCandles = parseInt(process.env.KLINE_MAX_CANDLES || '200', 10);
    const indicatorPeriods = [
      signalParams.ema_period,
      signalParams.entry_ema_period,
      signalParams.exit_ema_period,
      signalParams.entry_ema_slow,
      signalParams.exit_ema_slow,
      signalParams.ma_period
    ].map(p => parseInt(p, 10)).filter(p => !isNaN(p));

    for (const p of indicatorPeriods) {
      if (p >= maxCandles * 0.5) {
        throw new BadRequestException(`Indicator period ${p} is too large for current KLINE_MAX_CANDLES (${maxCandles}). Values may not converge for reliable signals. Use a period < ${Math.floor(maxCandles * 0.5)} or increase KLINE_MAX_CANDLES.`);
      }
    }

    // 5. Risk Constraints
    const riskPerTrade = config.risk_pct_per_trade ?? 0;
    const maxTotalRisk = config.max_total_risk_pct ?? 100;
    if (riskPerTrade > maxTotalRisk) {
      throw new BadRequestException('Risk per trade cannot exceed maximum total risk');
    }
  }

  async startSession(config: SessionConfig, paperMode: boolean, sessionId?: string) {
    const mode = config.trading_mode || (paperMode ? 'paper' : 'live');
    if (mode !== 'paper' && !process.env.ENCRYPTION_KEY) {
      throw new ConfigValidationException(
        "ENCRYPTION_KEY must be set to start a session in live or testnet mode.",
      );
    }

    if (this.sessionRunning) {
      throw new ConflictException('Session already running');
    }

    // Deep validation of dependent fields
    this.validateConfig(config);

    let session;
    if (sessionId) {
      session = await this.sessionRepository.findOne({ where: { id: sessionId } });
      if (!session) throw new NotFoundException('Session not found');
      
      // CODE-03: Validate config on restart
      this.validateConfig(session.config);

      // Update session to running
      session.running = true;
      await this.sessionRepository.save(session);
      
      // Use existing config and balance
      config = session.config;
      paperMode = session.paperMode;
      
      // Preserving starting balance if it exists in the config to maintain correct PnL calculation across restarts
      if (paperMode) {
        config.paper_starting_balance = config.paper_starting_balance || roundEight(Number(session.balance) - Number(session.totalPnl));
      } else {
        config.live_starting_balance = config.live_starting_balance || roundEight(Number(session.balance) - Number(session.totalPnl));
      }
    } else {
      // Ensure starting balance is explicitly in the config for new sessions
      if (mode === 'paper') {
        // Inherit from settings if not explicitly provided
        if (config.paper_starting_balance === undefined || config.paper_starting_balance === null) {
          const settings = await this.settingsRepository.findOne({ where: { id: 'default' } });
          config.paper_starting_balance = settings ? Number(settings.paper_balance) : 10000.0;
        }
      } else if (mode === 'testnet') {
        if (config.testnet_starting_balance === undefined || config.testnet_starting_balance === null) {
          const settings = await this.settingsRepository.findOne({ where: { id: 'default' } });
          // Note: If Binance fetch is used later, this acts as a fallback for the risk engine
          config.testnet_starting_balance = settings ? Number(settings.testnet_balance) : 0;
        }
      } else {
        if (config.live_starting_balance === undefined || config.live_starting_balance === null) {
          const settings = await this.settingsRepository.findOne({ where: { id: 'default' } });
          config.live_starting_balance = settings ? Number(settings.live_balance) : 0;
        }
      }

      session = this.sessionRepository.create({
        running: true,
        paperMode,
        tradingMode: config.trading_mode || (paperMode ? 'paper' : 'live'),
        balance: mode === 'paper' ? config.paper_starting_balance : (mode === 'testnet' ? (config as any).testnet_starting_balance : config.live_starting_balance),
        strategyLabel: config.strategy_label || 'Momentum Strategy',
        config,
      });
      session = await this.sessionRepository.save(session);
    }

    this.currentSessionId = session.id;
    this.sessionRunning = true;

    // Load initial history for TOD risk context
    const initialHistory = await this.tradeRepository.find({
      where: { status: In(TERMINAL_STATUSES as any), sessionId: this.currentSessionId },
      order: { exit_ts: 'DESC' },
      take: 200,
    });

    // Load potentially orphaned open trades for reconciliation
    // For the active session, we'll resume these trades in the engine
    const openTrades = await this.tradeRepository.find({
      where: { status: 'OPEN' as any }
    });

    // Instantiate Binance client if not in paper mode
    let binanceClient = null;
    if (mode !== 'paper') {
      const settings = await this.settingsRepository.findOne({
        where: { id: 'default' },
        select: ['id', 'binance_api_key', 'binance_api_secret', 'binance_testnet_api_key', 'binance_testnet_api_secret']
      });
      if (!settings) throw new NotFoundException('Settings not found. Please configure API keys first.');

      const isTestnet = mode === 'testnet';
      const key = isTestnet ? settings.binance_testnet_api_key : settings.binance_api_key;
      const secret = isTestnet ? settings.binance_testnet_api_secret : settings.binance_api_secret;

      if (!key || !secret) {
        throw new BadRequestException(`Binance ${isTestnet ? 'Testnet' : 'Live'} API keys are not configured.`);
      }

      binanceClient = this.binanceClientFactory.createClient(decrypt(key), decrypt(secret), isTestnet);
    }
      
    // 1. Reconciliation: Identify trades that should be closed or resumed
    for (const trade of openTrades) {
      let isOrphaned = false;
      if (trade.sessionId) {
        const tSession = await this.sessionRepository.findOne({ where: { id: trade.sessionId } });
        if (!tSession || (!tSession.running && tSession.id !== this.currentSessionId)) {
          isOrphaned = true;
        }
      } else {
        const STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000;
        if (Date.now() - (trade.entry_ts ? new Date(trade.entry_ts).getTime() : 0) > STALE_THRESHOLD_MS) {
          isOrphaned = true;
        }
      }

      if (isOrphaned) {
        this.logger.log(`Trade ${trade.symbol} (Session: ${trade.sessionId}) is orphaned. Marking as closed.`);
        await this.tradeRepository.update(trade.id, { status: 'CLOSED_ORPHANED', exit_ts: new Date() });
        await this.logMessage(`Trade ${trade.symbol} was orphaned during downtime and marked closed.`, 'warn');
        (trade as any).reconciled_out = true;
        continue;
      }

      // Check if trade exists on exchange for live/testnet
      if (mode !== 'paper' && binanceClient) {
        try {
          const res = await (binanceClient.restAPI as any).tradeApi.currentAllOpenOrders({ symbol: trade.symbol });
          const orders = typeof res.data === 'function' ? await res.data() : (res.data || res);
          const hasOrder = Array.isArray(orders) && orders.some(o => (o as any).orderId == trade.binance_order_id || (o as any).orderId == trade.binance_stop_order_id);
          if (!hasOrder) {
            this.logger.log(`Trade ${trade.symbol} not found on exchange. Marking as closed (orphaned).`);
            await this.logMessage(`Live position for ${trade.symbol} was not found on exchange during reconciliation. Marking as orphaned.`, 'warn');
            await this.tradeRepository.update(trade.id, { status: 'CLOSED_ORPHANED', exit_ts: new Date() });
            (trade as any).reconciled_out = true;
            continue;
          }
        } catch (e) {
          this.logger.warn(`Failed to reconcile live trade ${trade.symbol}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }

      // Offline Breach Detection for paper trades in the current session
      if (mode === 'paper' && trade.sessionId === this.currentSessionId) {
        const currentPrice = await this.tradingSessionService.fetchTickerPrice(trade.symbol);
        if (currentPrice) {
          const side = trade.direction.toUpperCase();
          const sl = Number(trade.current_sl || 0);
          const tp = Number(trade.tp || 0);

          let breached = false;
          let reason = 'AUTO_RECONCILED_EXIT';

          if (side === 'LONG') {
            if (sl > 0 && currentPrice <= sl) { breached = true; reason = 'AUTO_RECONCILED_SL'; }
            else if (tp > 0 && currentPrice >= tp) { breached = true; reason = 'AUTO_RECONCILED_TP'; }
          } else {
            if (sl > 0 && currentPrice >= sl) { breached = true; reason = 'AUTO_RECONCILED_SL'; }
            else if (tp > 0 && currentPrice <= tp) { breached = true; reason = 'AUTO_RECONCILED_TP'; }
          }

          if (breached) {
            this.logger.warn(`Resumed trade ${trade.symbol} breached SL/TP during downtime. Auto-closing at ${currentPrice}.`);
            await this.logMessage(`Resumed trade ${trade.symbol} breached SL/TP during downtime. Auto-closed at ${currentPrice} (${reason}).`, 'warn');
            const pnl = roundEight(side === 'LONG' ? (currentPrice - Number(trade.entry_price)) * Number(trade.qty) : (Number(trade.entry_price) - currentPrice) * Number(trade.qty));

            // Map reason to specific terminal status
            let terminalStatus: any = 'CLOSED';
            if (reason === 'AUTO_RECONCILED_SL') terminalStatus = 'CLOSED_SL';
            else if (reason === 'AUTO_RECONCILED_TP') terminalStatus = 'CLOSED_TP';

            const updatedTrade = { ...trade, status: terminalStatus, exit_ts: new Date(), exit_price: currentPrice, pnl, exit_reason: reason };
            await this.saveTradeAtomic(updatedTrade, roundEight(Number(session.balance) + pnl));
            (trade as any).reconciled_out = true;
          }
        }
      }
    }

    const sessionOpenTrades = openTrades.filter(t => t.sessionId === this.currentSessionId && !(t as any).reconciled_out);

    // Fetch current global balance to ensure risk engine uses real-time account state
    const currentSettings = await this.settingsRepository.findOne({ where: { id: 'default' } });
    const currentGlobalBalance = currentSettings
      ? (mode === 'paper' ? Number(currentSettings.paper_balance) : (mode === 'testnet' ? Number(currentSettings.testnet_balance) : Number(currentSettings.live_balance)))
      : (mode === 'paper' ? (config.paper_starting_balance || 10000) : (mode === 'testnet' ? (config as any).testnet_starting_balance : config.live_starting_balance));

    this.logger.log(`[Lifecycle] Starting session ${this.currentSessionId} in ${mode} mode. Detected starting balance: ${currentGlobalBalance}`);

    // Update global log levels based on session config
    updateLogLevels(!!config.debug_mode);

    // BOLT: Set binance client before reconciliation so fetchPosition works
    this.tradingSessionService.setBinanceClient(binanceClient, mode === 'paper');

    // Reconcile open trades with actual exchange positions
    if (mode !== 'paper' && binanceClient) {
      for (const trade of sessionOpenTrades) {
        try {
          const position = await this.tradingSessionService.fetchPosition(trade.symbol);
          const posAmt = position ? parseFloat(position.positionAmt) : 0;
          const hasPosition = Math.abs(posAmt) > 0;

          if (!hasPosition) {
            this.logger.log(`Live position for ${trade.symbol} not found on exchange. Marking as closed (orphaned).`);
            await this.logMessage(`Live position for ${trade.symbol} was not found on exchange during reconciliation. Marking as orphaned.`, 'warn');
            await this.tradeRepository.update(trade.id, { status: 'CLOSED_ORPHANED', exit_ts: new Date() });
            (trade as any).reconciled_out = true;
          } else {
            // BOLT: Sync local trade state with actual exchange position to ensure entry price and qty accuracy
            const exEntryPrice = parseFloat(position.entryPrice);
            const exUnrealizedPnl = parseFloat(position.unRealizedProfit);

            if (exEntryPrice > 0 && Math.abs(exEntryPrice - Number(trade.entry_price)) > (exEntryPrice * 0.0001)) {
               this.logger.log(`Syncing entry price for ${trade.symbol}: ${trade.entry_price} -> ${exEntryPrice}`);
               trade.entry_price = exEntryPrice;
            }

            if (Math.abs(posAmt) !== Math.abs(Number(trade.qty))) {
               this.logger.log(`Syncing quantity for ${trade.symbol}: ${trade.qty} -> ${Math.abs(posAmt)}`);
               trade.qty = Math.abs(posAmt);
            }
            // Update direction if mismatch (rare but safe)
            const exDir = posAmt > 0 ? 'LONG' : 'SHORT';
            if (trade.direction !== exDir) {
               this.logger.warn(`Syncing direction for ${trade.symbol}: ${trade.direction} -> ${exDir}`);
               trade.direction = exDir;
            }

            // Recalculate risk based on synced values
            const riskPoints = Math.abs(Number(trade.entry_price) - Number(trade.current_sl));
            trade.risk_usdt = roundEight(riskPoints * Number(trade.qty));

            await this.tradeRepository.save(trade);
          }
        } catch (e) {
          this.logger.warn(`Failed to reconcile live position for ${trade.symbol}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    }

    const filteredOpenTrades = sessionOpenTrades.filter(t => !(t as any).reconciled_out);

    // Start the actual trading engine
    await this.tradingSessionService.start(config, binanceClient, this.currentSessionId, initialHistory as any, currentGlobalBalance, filteredOpenTrades as any);

    this.logger.log(`Session ${this.currentSessionId} ${sessionId ? 'restarted' : 'started'} in ${mode} mode`);
    await this.logMessage(`Session started in ${mode} mode with ${currentGlobalBalance} starting balance.`, 'info');

    return { strategyId: this.currentSessionId, status: 'started' };
  }

  async updateSession(id: string, config: SessionConfig) {
    this.validateConfig(config);
    // Ensure we pass a plain object for the config column to avoid TypeORM issues with class instances
    await this.sessionRepository.update(id, { config: Object.assign({}, config) as any });
    // If this is the active session, hot-reload the config in the engine
    if (this.sessionRunning && this.currentSessionId === id) {
      // Update global log levels based on session config
      updateLogLevels(!!config.debug_mode);
      this.tradingSessionService.updateConfig(config);
    }

    return { status: 'updated' };
  }

  async pauseSession(paused: boolean) {
    if (!this.sessionRunning) throw new ConflictException('No session running');
    this.tradingSessionService.setPaused(paused);
    return { status: paused ? 'paused' : 'resumed' };
  }

  async deleteSession(id: string, actor?: string) {
    // Security: Prevent deleting the active session
    if (this.sessionRunning && this.currentSessionId === id) {
      throw new ConflictException('Cannot delete an active trading session. Stop it first.');
    }

    await this.auditLog.log({
      action: 'DELETE_SESSION',
      resourceId: id,
      actor,
    });

    // Manually delete session, ensuring no cascade to trades (as there is no FK link in the current entity model)
    await this.sessionRepository.delete(id);

    // SENTINEL: Clear in-memory log tracking and analytics cache when session is deleted
    this.logRateLimits.delete(id);
    this.sessionLogCounts.delete(id);
    this.analyticsCache = null;

    return { status: 'deleted' };
  }

  async deleteOrphanedTrades(actor?: string) {
    const sessions = await this.sessionRepository.find({ select: ['id'] });
    const sessionIds = sessions.map(s => s.id);

    const queryBuilder = this.tradeRepository.createQueryBuilder()
      .delete()
      .where("sessionId IS NULL");

    if (sessionIds.length > 0) {
        queryBuilder.orWhere("sessionId NOT IN (:...ids)", { ids: sessionIds });
    }

    const result = await queryBuilder.execute();

    await this.auditLog.log({
      action: 'DELETE_ORPHANED_TRADES',
      actor,
      details: { affected: result.affected }
    });

    return { status: 'deleted', affected: result.affected };
  }

  async listSessions() {
    return this.sessionRepository.find({
      order: { startTime: 'DESC' },
      take: 20,
    });
  }

  async stopSession() {
    if (!this.sessionRunning || !this.currentSessionId) {
      throw new ConflictException('No session running');
    }

    await this.sessionRepository.update(this.currentSessionId, { running: false });

    // Stop the actual trading engine
    await this.tradingSessionService.stop();

    // Reset log levels to default when session stops
    updateLogLevels(false);

    this.logger.log(`Stopping trading session.`);

    // SENTINEL: Clear in-memory log tracking and analytics cache to prevent memory leaks and ensure data integrity
    this.logRateLimits.delete(this.currentSessionId);
    this.sessionLogCounts.delete(this.currentSessionId);
    this.analyticsCache = null;

    this.sessionRunning = false;
    this.currentSessionId = null;
    
    return { status: 'stopped' };
  }

  async getStatus() {
    if (!this.currentSessionId) {
      const activeSession = await this.sessionRepository.findOne({
        where: { running: true },
        order: { startTime: 'DESC' }
      });
      if (activeSession) {
        this.currentSessionId = activeSession.id;
        this.sessionRunning = true;
      } else {
        // No active session, but we want to return the last known state and global balance
        const lastSession = await this.sessionRepository.findOne({
          where: {},
          order: { startTime: 'DESC' }
        });
        const settings = await this.settingsRepository.findOne({ where: { id: 'default' } });

        // Determine which balance to show based on last session mode, defaulting to paper
        const mode = lastSession?.tradingMode || (lastSession?.paperMode === false ? 'live' : 'paper');
        let balance = 10000;
        if (settings) {
          if (mode === 'paper') balance = Number(settings.paper_balance);
          else if (mode === 'testnet') balance = Number(settings.testnet_balance);
          else if (mode === 'live') balance = Number(settings.live_balance);
        }

        return {
          running: false,
          balance,
          tradingMode: mode,
          paperMode: mode === 'paper',
          config: lastSession?.config || null,
        };
      }
    }
    
    const session = await this.sessionRepository.findOne({ where: { id: this.currentSessionId } });
    if (!session) return { running: false };

    const engineStatus: any = this.tradingSessionService.getStatus();
    const activeTrades = (await this.tradeRepository.find({ where: { status: 'OPEN', sessionId: session.id } })).filter(trade =>
      trade.entry_price != null && !isNaN(Number(trade.entry_price)) && 
      trade.qty != null && !isNaN(Number(trade.qty))
    );

    const logs = await this.logRepository.find({
      where: { sessionId: session.id },
      order: { ts: 'DESC' },
      take: 100,
    });

    return {
      running: session.running,
      paused: engineStatus.paused,
      strategyId: session.id,
      paperMode: session.paperMode,
      tradingMode: session.tradingMode,
      balance: engineStatus.running ? (session.paperMode ? engineStatus.balance_paper : engineStatus.balance_live) : session.balance,
      totalPnl: engineStatus.running ? engineStatus.total_pnl : session.totalPnl,
      logLines: logs,
      activeTrades: engineStatus.activeTrades?.length ? engineStatus.activeTrades : activeTrades,
      scannerResults: engineStatus.scannerResults,
      activeWindows: engineStatus.activeWindows,
      gateState: engineStatus.gateState,
      scannerPaused: engineStatus.scannerPaused,
      history: (await this.getHistory(session.id)).trades || [],
      totalRiskPct: session.paperMode ? (engineStatus.balance_paper > 0 ? (engineStatus.total_risk / engineStatus.balance_paper) * 100 : 0) : (engineStatus.balance_live > 0 ? (engineStatus.total_risk / engineStatus.balance_live) * 100 : 0),
      totalSlUsed: engineStatus.total_risk,
      config: session.config,
      startTime: session.startTime,
    };
  }

  async getHistory(sessionId?: string) {
    // If no sessionId is provided, we default to the current session ID if one is running.
    // If we want GLOBAL history (all sessions), we must explicitly pass 'all' or similar.
    const filterId = sessionId === 'all' ? undefined : (sessionId || this.currentSessionId);

    const closedTrades = await this.tradeRepository.find({
      where: {
        status: In(TERMINAL_STATUSES as any),
        ...(filterId ? { sessionId: filterId } : {})
      },
      order: { exit_ts: 'DESC' },
      take: 200,
    });

    return { trades: closedTrades };
  }

  async getAnalytics() {
    const now = Date.now();
    if (this.analyticsCache && (now - this.analyticsCache.ts < this.CACHE_TTL_MS)) {
      return this.analyticsCache.data;
    }

    // Only fetch minimal columns for analytics to save memory
    const trades = await this.tradeRepository.find({
      select: ['pnl', 'exit_ts', 'status'],
      where: {
        status: In(TERMINAL_STATUSES as any),
        ...(this.currentSessionId ? { sessionId: this.currentSessionId } : {})
      }
    });

    const result = this.analyticsService.calculateAnalytics(trades as any, this.currentSessionId ? await this.getStartingBalanceForSession(this.currentSessionId) : undefined);
    this.analyticsCache = { data: result, ts: now };
    return result;
  }

  private async getStartingBalanceForSession(sessionId: string): Promise<number | undefined> {
    const session = await this.sessionRepository.findOne({ where: { id: sessionId } });
    if (!session || !session.config) return undefined;
    const mode = session.tradingMode || (session.paperMode ? 'paper' : 'live');
    if (mode === 'paper') return session.config.paper_starting_balance;
    if (mode === 'testnet') return (session.config as any).testnet_starting_balance;
    return session.config.live_starting_balance;
  }

  async getBinanceRateLimit() {
    return this.tradingSessionService.getBinanceRateLimit();
  }

  async getTrade(idOrSymbol: string) {
    return this.tradingSessionService.getTrade(idOrSymbol);
  }

  // WebSocket broadcaster
  setBroadcaster(callback: (data: any) => void) {
    this.wsBroadcaster = callback;
    this.tradingSessionService.setWsBroadcaster(callback);
  }

  // Broadcast event to WebSocket clients
  broadcastEvent(eventType: string, payload: any) {
    if (this.wsBroadcaster) {
      try {
        this.wsBroadcaster({ type: eventType, ...payload });
      } catch (err) {
        this.logger.error(`Broadcast error: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  // Manually close a trade
  async closeTradeManually(symbol: string) {
    if (!this.sessionRunning) {
      throw new ConflictException('No session running');
    }

    const result = await this.tradingSessionService.closeTradeManually(symbol);
    
    if (result.success && result.trade) {
      this.logger.log(`Manually closed trade ${symbol}`);
    }

    return result;
  }

  /**
   * Cleanup task for old database records (Logs and closed Trades)
   */
  private async cleanupOldData() {
    try {
      const settings = await this.settingsRepository.findOne({ where: { id: 'default' } });
      const logRetentionDays = (settings as any)?.log_retention_days || 7;
      const tradeRetentionDays = (settings as any)?.trade_retention_days || 30;

      const logCutoff = new Date(Date.now() - logRetentionDays * 24 * 60 * 60 * 1000);
      const tradeCutoff = new Date(Date.now() - tradeRetentionDays * 24 * 60 * 60 * 1000);

      const deletedLogs = await this.logRepository.createQueryBuilder()
        .delete()
        .where("ts < :cutoff", { cutoff: logCutoff.toISOString() })
        .execute();

      const deletedTrades = await this.tradeRepository.createQueryBuilder()
        .delete()
        .where("exit_ts < :cutoff", { cutoff: tradeCutoff })
        .andWhere("status IN (:...statuses)", { statuses: TERMINAL_STATUSES })
        .execute();

      this.logger.log(`Cleanup completed: ${deletedLogs.affected || 0} logs and ${deletedTrades.affected || 0} old trades removed.`);
    } catch (e: any) {
      this.logger.error(`Data cleanup failed: ${e.message}`);
    }
  }

  // Add log line
  async logMessage(msg: string, level: 'info' | 'warn' | 'error' = 'info') {
    if (!this.currentSessionId) return;

    const sid = this.currentSessionId;
    const now = Date.now();

    // SENTINEL: Per-session log rate limiting (max 60 logs per minute) to prevent resource exhaustion
    const rateLimit = this.logRateLimits.get(sid) || { count: 0, resetAt: now + 60000 };
    if (now > rateLimit.resetAt) {
      rateLimit.count = 0;
      rateLimit.resetAt = now + 60000;
    }
    rateLimit.count++;
    this.logRateLimits.set(sid, rateLimit);

    if (rateLimit.count > 60) {
      if (rateLimit.count === 61) {
        this.logger.warn(`Log rate limit (60/min) exceeded for session ${sid}. Further logs suppressed.`);
      }
      return;
    }

    // SENTINEL: Use in-memory counter to enforce cap (2000 logs) and avoid DB overhead
    let logCount = this.sessionLogCounts.get(sid);
    if (logCount === undefined) {
      logCount = await this.logRepository.count({ where: { sessionId: sid } });
      this.sessionLogCounts.set(sid, logCount);
    }

    if (logCount >= 2000) {
      // If we already have many logs for this session, we only keep errors
      if (level !== 'error') return;
      // For errors, we delete the oldest log before inserting a new one
      const oldest = await this.logRepository.findOne({
        where: { sessionId: sid },
        order: { ts: 'ASC' },
      });
      if (oldest) {
        await this.logRepository.delete(oldest.id);
        logCount--;
      }
    }

    this.sessionLogCounts.set(sid, logCount + 1);

    await this.logRepository.insert({
      sessionId: this.currentSessionId,
      ts: new Date().toISOString(),
      level,
      msg,
    });
  }

  /**
   * Directly sets the binance client on the underlying trading service.
   * Useful for reconciliation before the full engine start.
   */
  setBinanceClient(client: any, paperMode: boolean) {
    this.tradingSessionService.setBinanceClient(client, paperMode);
  }

  async resetPaperBalance(actor?: string) {
    const defaultBalance = 10000.0;

    await this.auditLog.log({
      action: 'RESET_PAPER_BALANCE',
      actor,
      details: { balance: defaultBalance }
    });

    await this.settingsRepository.update('default', {
      paper_balance: defaultBalance
    });

    // Record reset in history
    await this.balanceHistoryRepository.save({
      timestamp: new Date(),
      balance: defaultBalance,
      pnl: 0,
      type: 'RESET'
    });

    // If a session is running and it's paper mode, we might want to update it,
    // but usually, a reset is done when no session is active or as a hard override.
    if (this.sessionRunning) {
      const session = await this.sessionRepository.findOne({ where: { id: this.currentSessionId! } });
      if (session && session.paperMode) {
        // Hot update the engine if running
        // Note: This is a bit aggressive, usually user stops session, resets, then starts.
      }
    }

    return { status: 'reset', balance: defaultBalance };
  }

  async getLifetimeAnalytics(mode: 'paper' | 'testnet' | 'live' = 'paper') {
    // 1. Fetch all closed trades across all sessions for the specific mode
    const trades = await this.tradeRepository.find({
      select: ['pnl', 'exit_ts', 'status', 'strategy_config', 'strategy_label'],
      where: {
        status: In(TERMINAL_STATUSES as any),
      },
      order: { exit_ts: 'ASC' }
    });

    // Filter trades by mode
    const filteredTrades = trades.filter(t => {
        const tConfig = t.strategy_config || {};
        const tMode = tConfig.trading_mode || (tConfig.paper_mode === false ? 'live' : 'paper');
        return tMode === mode;
    });

    // 2. Fetch balance history snapshots for high-fidelity curve
    const history = await this.balanceHistoryRepository.find({
      where: { tradingMode: mode as any },
      order: { timestamp: 'ASC' }
    });

    // 3. Calculate analytics using the full trade set
    // We assume the very first starting balance was 10000 for paper, and 0 (initial tracking) for real
    const startingBalance = mode === 'paper' ? 10000 : (history.length > 0 ? Number(history[0].balance) - Number(history[0].pnl) : 0);
    const analytics = this.analyticsService.calculateAnalytics(filteredTrades as any, startingBalance);

    // 4. Override cumulative PnL with balance history for better accuracy if available
    if (history.length > 0) {
      analytics.cumulativePnL = history.map(h => ({
        ts: h.timestamp.toISOString(),
        pnl: Number(h.balance) - startingBalance
      }));
    }

    return analytics;
  }
}
