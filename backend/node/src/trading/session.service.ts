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

@Injectable()
export class SessionService implements OnModuleInit {
  private readonly logger = new Logger(SessionService.name);
  
  private sessionRunning = false;
  private currentSessionId: string | null = null;
  private wsBroadcaster: (data: any) => void = () => {};

  constructor(
    @InjectRepository(SessionEntity)
    private sessionRepository: Repository<SessionEntity>,
    @InjectRepository(TradeEntity)
    private tradeRepository: Repository<TradeEntity>,
    @InjectRepository(LogEntity)
    private logRepository: Repository<LogEntity>,
    private tradingSessionService: TradingSessionService,
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
      if (this.currentSessionId) {
        await this.sessionRepository.increment({ id: this.currentSessionId }, 'totalPnl', pnl);
        await this.sessionRepository.update(this.currentSessionId, { balance });
      }
    });
  }

  async startSession(config: SessionConfig, paperMode: boolean, sessionId?: string) {
    if (this.sessionRunning) {
      throw new Error('Session already running');
    }

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
        balance: paperMode ? (config.paper_starting_balance || 10000.0) : (config.live_starting_balance || 10000.0),
        config,
      });
      session = await this.sessionRepository.save(session);
    }

    this.currentSessionId = session.id;
    this.sessionRunning = true;

    // Start the actual trading engine
    await this.tradingSessionService.start(config, null, this.currentSessionId);

    this.logger.log(`Session ${this.currentSessionId} ${sessionId ? 'restarted' : 'started'} in ${paperMode ? 'paper' : 'live'} mode`);
    return { strategyId: this.currentSessionId, status: 'started' };
  }

  async updateSession(id: string, config: SessionConfig) {
    // Ensure we pass a plain object for the config column to avoid TypeORM issues with class instances
    await this.sessionRepository.update(id, { config: Object.assign({}, config) as any });
    return { status: 'updated' };
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

    this.logger.log('Stopping trading session');
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
    const activeTrades = await this.tradeRepository.find({ where: { status: 'OPEN' } });

    const logs = await this.logRepository.find({
      where: { sessionId: session.id },
      order: { ts: 'DESC' },
      take: 100,
    });

    return {
      running: session.running,
      strategyId: session.id,
      paperMode: session.paperMode,
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
    const engineStatus = this.tradingSessionService.getStatus();
    if (engineStatus.history?.length) {
      return { trades: engineStatus.history };
    }

    const closedTrades = await this.tradeRepository.find({
      where: [
        { status: 'CLOSED' as any },
        { status: 'CLOSED_SL' },
        { status: 'CLOSED_TP' },
        { status: 'CLOSED_SIGNAL' },
      ],
      order: { exit_ts: 'DESC' },
      take: 50,
    });

    return { trades: closedTrades };
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

  // Add trade to session
  async addTrade(trade: any) {
    const tradeEntity = this.tradeRepository.create({
      ...trade,
      status: 'OPEN',
    });
    await this.tradeRepository.save(tradeEntity);
    this.logger.log(`Added trade ${trade.symbol} to database`);
  }

  // Remove trade from session
  async removeTrade(symbol: string) {
    await this.tradeRepository.update({ symbol, status: 'OPEN' }, { status: 'CLOSED' });
    this.logger.log(`Closed trade ${symbol} in database`);
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
