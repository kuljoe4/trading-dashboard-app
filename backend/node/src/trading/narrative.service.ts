import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { AuditLog as AuditLogEntity } from '../models/entities/AuditLog.entity';
import { TradeEntity } from '../models/entities/Trade.entity';
import { Session as SessionEntity } from '../models/entities/Session.entity';

@Injectable()
export class NarrativeService {
  private readonly logger = new Logger(NarrativeService.name);

  constructor(
    @InjectRepository(AuditLogEntity)
    private readonly auditLogRepository: Repository<AuditLogEntity>,
    @InjectRepository(TradeEntity)
    private readonly tradeRepository: Repository<TradeEntity>,
    @InjectRepository(SessionEntity)
    private readonly sessionRepository: Repository<SessionEntity>,
  ) {}

  async generateNarrative(sessionId: string) {
    const session = await this.sessionRepository.findOne({ where: { id: sessionId } });
    if (!session) return { narrative: 'Session not found.' };

    const logs = await this.auditLogRepository.find({
      where: { resourceId: sessionId },
      order: { timestamp: 'ASC' },
    });

    const trades = await this.tradeRepository.find({
      where: { sessionId },
      order: { entry_ts: 'ASC' },
    });

    const events = this.collateEvents(logs, trades);
    const narrativeLines = this.buildNarrative(events);

    return {
      sessionId,
      strategyLabel: session.strategyLabel,
      startTime: session.startTime,
      endTime: session.endTime,
      eventCount: events.length,
      narrative: narrativeLines,
    };
  }

  private collateEvents(logs: AuditLogEntity[], trades: TradeEntity[]) {
    const events: any[] = [];

    logs.forEach(log => {
      events.push({
        ts: log.timestamp,
        type: 'LOG',
        action: log.action,
        details: log.details,
      });
    });

    trades.forEach(trade => {
      events.push({
        ts: trade.entry_ts || trade.updated_at,
        type: 'TRADE_ENTRY',
        symbol: trade.symbol,
        price: trade.entry_price,
        side: trade.direction,
      });

      if (trade.status !== 'OPEN') {
        events.push({
          ts: trade.exit_ts || trade.updated_at,
          type: 'TRADE_EXIT',
          symbol: trade.symbol,
          price: trade.exit_price,
          pnl: trade.pnl,
          reason: trade.exit_reason,
        });
      }
    });

    return events.sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());
  }

  private buildNarrative(events: any[]) {
    const lines: string[] = [];
    let configChanges = 0;

    events.forEach(event => {
      const time = new Date(event.ts).toLocaleTimeString();

      switch (event.type) {
        case 'LOG':
          if (event.action === 'START_SESSION' || event.action === 'RESTART_SESSION') {
            lines.push(`[${time}] User launched the engine using ${event.details?.mode || 'paper'} mode.`);
          } else if (event.action === 'TELEMETRY_SCANNER_OPEN') {
            lines.push(`[${time}] User opened the Market Scanner to hunt for opportunities.`);
          } else if (event.action === 'UPDATE_SESSION_CONFIG') {
            configChanges++;
            lines.push(`[${time}] Strategy parameters were adjusted (Change #${configChanges}).`);
          } else if (event.action === 'STOP_SESSION') {
            lines.push(`[${time}] User terminated the session manually.`);
          }
          break;
        case 'TRADE_ENTRY':
          lines.push(`[${time}] ⚡ Entry Authorized: ${event.side} position opened for ${event.symbol} at ${event.price}.`);
          break;
        case 'TRADE_EXIT':
          const outcome = event.pnl >= 0 ? '✅ PROFIT' : '❌ LOSS';
          lines.push(`[${time}] 🏁 Trade Closed: ${event.symbol} exited at ${event.price}. Outcome: ${outcome} (${event.pnl > 0 ? '+' : ''}${event.pnl} USDT) via ${event.reason}.`);
          break;
      }
    });

    if (lines.length === 0) {
      lines.push('No significant events recorded for this session yet.');
    }

    return lines;
  }
}
