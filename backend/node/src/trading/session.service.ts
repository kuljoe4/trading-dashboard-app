import { Injectable, Logger } from '@nestjs/common';
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
  private tradingSession: {
    strategyId: string;
    sessionData: any;
    wsBroadcaster: (data: any) => void;
  } | null = null;
  
  // In-memory storage for demo (in production, use database)
  private sessions: Map<string, any> = new Map();

  async startSession(config: SessionConfig, paperMode: boolean) {
    if (this.sessionRunning) {
      throw new Error('Session already running');
    }

    const strategyId = uuid().substring(0, 8);
    this.logger.log(`Starting trading session ${strategyId}`);

    // Initialize session data
    const sessionData = {
      strategyId,
      config,
      paperMode,
      running: true,
      startTime: new Date(),
      trades: [],
      balance: paperMode ? config.paper_starting_balance : config.live_starting_balance,
      totalPnl: 0,
      logLines: [],
      rateLimit: {
        usedWeight: 0,
        usedWeight1m: 0,
        limit: 1200,
        usedPct: 0,
        status: 'ok',
      },
    };

    // Store session
    this.sessions.set(strategyId, { ...sessionData });
    this.tradingSession = { strategyId, sessionData, wsBroadcaster: () => {} };

    this.sessionRunning = true;
    this.logger.log(`Session ${strategyId} started in ${paperMode ? 'paper' : 'live'} mode`);

    // TODO: Start market feed, signal processing, etc.
    // For now, just simulate
    this.logger.log(`Session ${strategyId} would start market feed and monitoring...`);

    return { strategyId, status: 'started' };
  }

  async stopSession() {
    if (!this.sessionRunning || !this.tradingSession) {
      throw new Error('No session running');
    }

    this.logger.log('Stopping trading session');
    this.sessionRunning = false;
    
    // TODO: Stop market feed, stop monitoring
    this.sessions.delete(this.tradingSession.strategyId);
    this.tradingSession = null;
    
    return { status: 'stopped' };
  }

  async getStatus() {
    if (!this.tradingSession) {
      return { running: false };
    }
    
    const { sessionData } = this.tradingSession;
    return {
      running: this.sessionRunning,
      strategyId: sessionData.strategyId,
      paperMode: sessionData.paperMode,
      balance: sessionData.balance,
      totalPnl: sessionData.totalPnl,
      logLines: sessionData.logLines,
      activeTrades: sessionData.trades,
      config: sessionData.config,
      startTime: sessionData.startTime,
    };
  }

  async getBinanceRateLimit() {
    return {
      usedWeight: this.tradingSession?.sessionData?.rateLimit?.usedWeight || 0,
      usedWeight1m: this.tradingSession?.sessionData?.rateLimit?.usedWeight1m || 0,
      limit: this.tradingSession?.sessionData?.rateLimit?.limit || 1200,
      usedPct: this.tradingSession?.sessionData?.rateLimit?.usedPct || 0,
      status: this.tradingSession?.sessionData?.rateLimit?.status || 'ok',
    };
  }

  // WebSocket broadcaster
  setBroadcaster(callback: (data: any) => void) {
    if (this.tradingSession) {
      this.tradingSession.wsBroadcaster = callback;
    }
  }

  // Broadcast event to WebSocket clients
  broadcastEvent(eventType: string, payload: any) {
    if (this.tradingSession?.wsBroadcaster) {
      try {
        this.tradingSession.wsBroadcaster({ type: eventType, ...payload });
      } catch (err) {
        this.logger.error(`Broadcast error: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  // Add trade to session
  addTrade(trade: Trade) {
    if (this.tradingSession) {
      const sessionData = this.tradingSession.sessionData;
      sessionData.trades.push(trade);
      this.logger.log(`Added trade ${trade.symbol} to session`);
    }
  }

  // Remove trade from session
  removeTrade(symbol: string) {
    if (this.tradingSession) {
      const sessionData = this.tradingSession.sessionData;
      sessionData.trades = sessionData.trades.filter((t: any) => t.symbol !== symbol);
      this.logger.log(`Removed trade ${symbol} from session`);
    }
  }

  // Add log line
  logMessage(msg: string, level: 'info' | 'warn' | 'error' = 'info') {
    if (!this.tradingSession) return;
    
    const sessionData = this.tradingSession.sessionData;
    sessionData.logLines.push({
      ts: new Date().toISOString(),
      level,
      msg,
    });
    
    // Keep log lines limited
    if (sessionData.logLines.length > 200) {
      sessionData.logLines = sessionData.logLines.slice(-200);
    }
  }
}