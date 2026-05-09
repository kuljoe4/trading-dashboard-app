import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Session as SessionEntity } from '../models/entities/Session.entity';
import { TradeEntity } from '../models/entities/Trade.entity';
import { SessionConfig } from '../models/SessionConfig';
import { SignalEngineService } from '../engine/signalEngine';
import { RiskEngineService } from '../engine/riskEngine';
import { PositionTrackerService } from '../engine/positionTracker';
import { OrderManagerService } from '../engine/orderManager';
import { Trade } from '../models/Trade';
import { v4 as uuid } from 'uuid';

@Injectable()
export class SessionService {
  private readonly logger = new Logger(SessionService.name);
  
  private sessionRunning = false;
  private currentSessionId: string | null = null;
  private wsBroadcaster: (data: any) => void = () => {};

  constructor(
    @InjectRepository(SessionEntity)
    private sessionRepository: Repository<SessionEntity>,
    @InjectRepository(TradeEntity)
    private tradeRepository: Repository<TradeEntity>,
  ) {}

  async startSession(config: SessionConfig, paperMode: boolean) {
    if (this.sessionRunning) {
      throw new Error('Session already running');
    }

    const session = this.sessionRepository.create({
      running: true,
      paperMode,
      balance: paperMode ? config.paper_starting_balance : config.live_starting_balance,
      config,
      logLines: [],
    });

    const savedSession = await this.sessionRepository.save(session);
    this.currentSessionId = savedSession.id;
    this.sessionRunning = true;

    this.logger.log(`Session ${this.currentSessionId} started in ${paperMode ? 'paper' : 'live'} mode`);
    return { strategyId: this.currentSessionId, status: 'started' };
  }

  async stopSession() {
    if (!this.sessionRunning || !this.currentSessionId) {
      throw new Error('No session running');
    }

    await this.sessionRepository.update(this.currentSessionId, { running: false });

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

    const activeTrades = await this.tradeRepository.find({ where: { status: 'OPEN' } });

    return {
      running: session.running,
      strategyId: session.id,
      paperMode: session.paperMode,
      balance: session.balance,
      totalPnl: session.totalPnl,
      logLines: session.logLines,
      activeTrades: activeTrades,
      config: session.config,
      startTime: session.startTime,
    };
  }

  async getBinanceRateLimit() {
    return {
      usedWeight: 0,
      usedWeight1m: 0,
      limit: 1200,
      usedPct: 0,
      status: 'ok',
    };
  }

  // WebSocket broadcaster
  setBroadcaster(callback: (data: any) => void) {
    this.wsBroadcaster = callback;
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
    
    const session = await this.sessionRepository.findOne({ where: { id: this.currentSessionId } });
    if (!session) return;

    const newLine = {
      ts: new Date().toISOString(),
      level,
      msg,
    };

    session.logLines.push(newLine);
    
    // Keep log lines limited
    if (session.logLines.length > 200) {
      session.logLines = session.logLines.slice(-200);
    }

    await this.sessionRepository.save(session);
  }
}