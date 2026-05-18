import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Session as SessionEntity } from '../models/entities/Session.entity';
import { TradeEntity } from '../models/entities/Trade.entity';
import { Log as LogEntity } from '../models/entities/Log.entity';
import { SessionConfig } from '../models/SessionConfig';
import { TradingSessionService } from '../engine/trading_session.service';
import { Trade } from '../models/Trade';
import { v4 as uuid } from 'uuid';
import { Settings as SettingsEntity } from '../models/entities/Settings.entity';
import { decrypt } from '../lib/crypto';
import { BinanceClientFactory } from '../lib/binanceClientFactory';
import { AnalyticsService } from '../engine/analytics.service';

@Injectable()
export class SessionService implements OnModuleInit {
  private readonly logger = new Logger(SessionService.name);
  
  private sessionRunning = false;
  private currentSessionId: string | null = null;
  private wsBroadcaster: (data: any) => void = () => {};

  private analyticsCache: { data: any; ts: number } | null = null;
  private readonly CACHE_TTL_MS = 60000; // 1 minute

  constructor(
    @InjectRepository(SessionEntity)
    private sessionRepository: Repository<SessionEntity>,
    @InjectRepository(TradeEntity)
    private tradeRepository: Repository<TradeEntity>,
    @InjectRepository(LogEntity)
    private logRepository: Repository<LogEntity>,
    @InjectRepository(SettingsEntity)
    private settingsRepository: Repository<SettingsEntity>,
    private tradingSessionService: TradingSessionService,
    private analyticsService: AnalyticsService,
  ) {}

  async onModuleInit() {
    // Cleanup any sessions marked as running in the database on startup
    const runningSessions = await this.sessionRepository.find({ where: { running: true } });
    if (runningSessions.length > 0) {
      this.logger.log(`Cleaning up ${runningSessions.length} stale running sessions`);
      for (const session of runningSessions) {
        await this.sessionRepository.update(session.id, { running: false });
      }
    }

    // Wire balance updates to persistence
    this.tradingSessionService.setBalanceUpdateCallback(async (balance, pnl) => {
      const sessionId = this.currentSessionId;
      if (sessionId) {
        await this.sessionRepository.increment({ id: sessionId }, 'totalPnl', pnl);
        await this.sessionRepository.update(sessionId, { balance });
      }
    });

    // Wire trade updates to persistence
    this.tradingSessionService.setTradeUpdateCallback(async (trade) => {
      await this.saveTrade(trade);
    });
  }

  private validateTrade(trade: any): boolean {
    return (
      trade.symbol != null &&
      trade.entry_price != null && !isNaN(Number(trade.entry_price)) &&
      trade.qty != null && !isNaN(Number(trade.qty)) &&
      trade.status != null
    );
  }

  async saveTrade(trade: any) {
    if (!this.validateTrade(trade)) {
      this.logger.warn(`Attempted to save invalid trade ${trade.symbol}, skipping.`);
      return;
    }
    try {
      const tradeEntity = this.tradeRepository.create({
        ...trade,
        sessionId: this.currentSessionId || trade.sessionId,
      });
      await this.tradeRepository.save(tradeEntity);
      this.logger.debug(`Saved trade ${trade.symbol} (${trade.status}) to database`);
    } catch (error) {
      this.logger.error(`Failed to save trade ${trade.symbol}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private validateConfig(config: SessionConfig) {
    if (!config) throw new Error('Configuration is required');

    // 1. Scan Mode Dependencies
    if (config.scan_mode === 'active_window') {
      if (!config.scan_window_duration_sec) throw new Error('Window duration is required for Active Window mode');
      if (!config.scan_check_interval_sec) throw new Error('Check interval is required for Active Window mode');
    }

    // 2. Stop Loss Dependencies
    if (config.sl_type === 'lookback_low/high') {
      if (!config.sl_lookback_period || config.sl_lookback_period < 1) {
        throw new Error('Valid lookback period is required for Lookback SL type');
      }
    }

    // 3. Take Profit Dependencies
    if (config.tp_mode === 'exp_rr_seq') {
      if (!config.live_rr_sequence || config.live_rr_sequence.length === 0) {
        throw new Error('Live RR sequence is required for Exponential RR mode');
      }
      if (!config.exit_rr_sequence || config.exit_rr_sequence.length !== config.live_rr_sequence.length) {
        throw new Error('Exit RR sequence must match Live RR sequence length');
      }
    }

    // 4. Signal Parameter Dependencies
    let signalParams;
    try {
      signalParams = typeof config.signal_params === 'string' 
        ? JSON.parse(config.signal_params || '{}') 
        : config.signal_params || {};
    } catch (e) {
      throw new Error('Invalid signal_params format. Must be a valid JSON string or object.');
    }
    
    const allEnabled = [...(config.enabled_signals || []), ...(config.exit_signals || [])];

    if (allEnabled.includes('ema_dual_cross')) {
      const fast = parseInt(signalParams.entry_ema_fast || signalParams.exit_ema_fast || '0', 10);
      const slow = parseInt(signalParams.entry_ema_slow || signalParams.exit_ema_slow || '0', 10);
      if (fast <= 0 || slow <= 0) throw new Error('EMA Dual Cross requires both fast and slow periods (e.g., 9 and 21)');
      if (fast >= slow) throw new Error('EMA Dual Cross: Fast period must be less than slow period');
    }

    if (allEnabled.includes('ma') && !signalParams.ma_period && !config.strategies?.some(s => s.enabled_signals?.includes('ma'))) {
      throw new Error('MA Cross signal requires ma_period in signal_params');
    }

    if ((allEnabled.includes('ema') || allEnabled.includes('ema_close')) && !signalParams.ema_period && !signalParams.entry_ema_period && !signalParams.exit_ema_period) {
       throw new Error('EMA signals require an EMA period to be defined');
    }

    // 5. Risk Constraints
    const riskPerTrade = config.risk_pct_per_trade ?? 0;
    const maxTotalRisk = config.max_total_risk_pct ?? 100;
    if (riskPerTrade > maxTotalRisk) {
      throw new Error('Risk per trade cannot exceed maximum total risk');
    }
  }

  async startSession(config: SessionConfig, paperMode: boolean, sessionId?: string) {
    if (this.sessionRunning) {
      throw new Error('Session already running');
    }

    // Deep validation of dependent fields
    this.validateConfig(config);

    let session;
    if (sessionId) {
      session = await this.sessionRepository.findOne({ where: { id: sessionId } });
      if (!session) throw new Error('Session not found');
      
      // Update session to running
      session.running = true;
      await this.sessionRepository.save(session);
      
      // Use existing config and balance
      config = session.config;
      paperMode = session.paperMode;
      
      // Update config with current session balance so engine starts with correct funds
      if (paperMode) {
        config.paper_starting_balance = Number(session.balance);
      } else {
        config.live_starting_balance = Number(session.balance);
      }
    } else {
      session = this.sessionRepository.create({
        running: true,
        paperMode,
        tradingMode: config.trading_mode || (paperMode ? 'paper' : 'live'),
        balance: paperMode ? (config.paper_starting_balance || 10000.0) : (config.live_starting_balance || 10000.0),
        config,
      });
      session = await this.sessionRepository.save(session);
    }

    this.currentSessionId = session.id;
    this.sessionRunning = true;

    // Load initial history for TOD risk context
    const initialHistory = await this.tradeRepository.find({
      where: [
        { status: 'CLOSED' as any },
        { status: 'CLOSED_SL' },
        { status: 'CLOSED_TP' },
        { status: 'CLOSED_SIGNAL' },
      ],
      order: { exit_ts: 'DESC' },
      take: 200,
    });

    // Load potentially orphaned open trades for reconciliation
    const openTrades = await this.tradeRepository.find({
      where: { status: 'OPEN' as any }
    });

    // Instantiate Binance client if not in paper mode
    let binanceClient = null;
    const mode = config.trading_mode || (paperMode ? 'paper' : 'live');
    if (mode !== 'paper') {
      const settings = await this.settingsRepository.findOne({ where: { id: 'default' } });
      if (!settings) throw new Error('Settings not found. Please configure API keys first.');

      const isTestnet = mode === 'testnet';
      const key = isTestnet ? settings.binance_testnet_api_key : settings.binance_api_key;
      const secret = isTestnet ? settings.binance_testnet_api_secret : settings.binance_api_secret;

      if (!key || !secret) {
        throw new Error(`Binance ${isTestnet ? 'Testnet' : 'Live'} API keys are not configured.`);
      }

      binanceClient = BinanceClientFactory.createClient(key, decrypt(secret), isTestnet);
    }
      
    // Reconciliation for Paper Mode: Mark open trades as orphaned if their session is not running
    if (mode === 'paper') {
      for (const trade of openTrades) {
        let isOrphaned = false;
        if (trade.sessionId) {
          const session = await this.sessionRepository.findOne({ where: { id: trade.sessionId } });
          if (!session || !session.running) {
            isOrphaned = true;
          }
        } else {
          // If no sessionId, default to time-based fallback for safety
          const STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000;
          if (Date.now() - (trade.entry_ts ? new Date(trade.entry_ts).getTime() : 0) > STALE_THRESHOLD_MS) {
            isOrphaned = true;
          }
        }

        if (isOrphaned) {
          this.logger.log(`Paper trade ${trade.symbol} (Session: ${trade.sessionId}) is orphaned. Marking as closed.`);
          await this.tradeRepository.update(trade.id, { status: 'CLOSED_ORPHANED', exit_ts: new Date() });
        }
      }
    } else if (binanceClient) {
      // Reconciliation: Check if persistent open trades still exist on the exchange
      for (const trade of openTrades) {
        try {
          const orders = await (binanceClient.restAPI as any).tradeApi.getOpenOrders(trade.symbol);
          const hasOrder = Array.isArray(orders) && orders.some(o => o.orderId == trade.binance_order_id || o.orderId == trade.binance_stop_order_id);
          if (!hasOrder) {
            this.logger.log(`Trade ${trade.symbol} not found on exchange. Marking as closed (orphaned).`);
            await this.tradeRepository.update(trade.id, { status: 'CLOSED_ORPHANED', exit_ts: new Date() });
          }
        } catch (e) {
          this.logger.warn(`Failed to reconcile trade ${trade.symbol}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    }

    // Start the actual trading engine
    await this.tradingSessionService.start(config, binanceClient, this.currentSessionId, initialHistory as any);

    this.logger.log(`Session ${this.currentSessionId} ${sessionId ? 'restarted' : 'started'} in ${mode} mode`);
    return { strategyId: this.currentSessionId, status: 'started' };
  }

  async updateSession(id: string, config: SessionConfig) {
   this.validateConfig(config);
   // Ensure we pass a plain object for the config column to avoid TypeORM issues with class instances
   await this.sessionRepository.update(id, { config: Object.assign({}, config) as any });
    // If this is the active session, hot-reload the config in the engine
    if (this.sessionRunning && this.currentSessionId === id) {
      this.tradingSessionService.updateConfig(config);
    }

    return { status: 'updated' };
  }

  async pauseSession(paused: boolean) {
    if (!this.sessionRunning) throw new Error('No session running');
    this.tradingSessionService.setPaused(paused);
    return { status: paused ? 'paused' : 'resumed' };
  }

  async deleteSession(id: string) {
    // Manually delete session, ensuring no cascade to trades (as there is no FK link in the current entity model)
    await this.sessionRepository.delete(id);
    return { status: 'deleted' };
  }

  async listSessions() {
    return this.sessionRepository.find({
      order: { startTime: 'DESC' },
      take: 20,
    });
  }

  async stopSession() {
    if (!this.sessionRunning || !this.currentSessionId) {
      throw new Error('No session running');
    }

    await this.sessionRepository.update(this.currentSessionId, { running: false });

    // Stop the actual trading engine
    await this.tradingSessionService.stop();

    this.logger.log(`Stopping trading session.`);
    this.sessionRunning = false;
    this.currentSessionId = null;
    
    return { status: 'stopped' };
  }

  async getStatus() {
    if (!this.currentSessionId) {
      const lastSession = await this.sessionRepository.findOne({
        where: { running: true },
        order: { startTime: 'DESC' }
      });
      if (lastSession) {
        this.currentSessionId = lastSession.id;
        this.sessionRunning = true;
      } else {
        return { running: false };
      }
    }
    
    const session = await this.sessionRepository.findOne({ where: { id: this.currentSessionId } });
    if (!session) return { running: false };

    const engineStatus: any = this.tradingSessionService.getStatus();
    const activeTrades = (await this.tradeRepository.find({ where: { status: 'OPEN' } })).filter(trade => 
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
      totalPnl: session.totalPnl,
      logLines: logs,
      activeTrades: engineStatus.activeTrades?.length ? engineStatus.activeTrades : activeTrades,
      scannerResults: engineStatus.scannerResults,
      activeWindows: engineStatus.activeWindows,
      gateState: engineStatus.gateState,
      scannerPaused: engineStatus.scannerPaused,
      history: engineStatus.history,
      totalRiskPct: session.paperMode ? (engineStatus.balance_paper > 0 ? (engineStatus.total_risk / engineStatus.balance_paper) * 100 : 0) : (engineStatus.balance_live > 0 ? (engineStatus.total_risk / engineStatus.balance_live) * 100 : 0),
      totalSlUsed: engineStatus.total_risk,
      config: session.config,
      startTime: session.startTime,
    };
  }

  async getHistory() {
    const closedTrades = await this.tradeRepository.find({
      where: [
        { status: 'CLOSED' as any },
        { status: 'CLOSED_SL' },
        { status: 'CLOSED_TP' },
        { status: 'CLOSED_SIGNAL' },
      ],
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
      select: ['pnl', 'exit_ts', 'status', 'strategyId', 'strategyLabel'],
      where: [
        { status: 'CLOSED' as any },
        { status: 'CLOSED_SL' },
        { status: 'CLOSED_TP' },
        { status: 'CLOSED_SIGNAL' },
      ],
    });

    const result = this.analyticsService.calculateAnalytics(trades as any);
    this.analyticsCache = { data: result, ts: now };
    return result;
  }

  async getBinanceRateLimit() {
    return this.tradingSessionService.getBinanceRateLimit();
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
      throw new Error('No session running');
    }

    const result = await this.tradingSessionService.closeTradeManually(symbol);
    
    if (result.success && result.trade) {
      this.logger.log(`Manually closed trade ${symbol}`);
    }

    return result;
  }

  // Add log line
  async logMessage(msg: string, level: 'info' | 'warn' | 'error' = 'info') {
    if (!this.currentSessionId) return;
    
    await this.logRepository.insert({
      sessionId: this.currentSessionId,
      ts: new Date().toISOString(),
      level,
      msg,
    });
  }
}
