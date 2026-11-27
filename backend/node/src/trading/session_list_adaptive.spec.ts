import { getMetadataArgsStorage } from 'typeorm';
import { TradeEntity } from '../models/entities/Trade.entity';
import { Session } from '../models/entities/Session.entity';

jest.mock('@nestjs/config', () => ({ ConfigService: class {} }));

// Load compiled CommonJS outputs to exercise SessionService/SessionController runtime behavior
// without triggering ts-jest strict diagnostics on pre-existing lines in session.service.ts.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { SessionService } = require('../../dist/trading/session.service');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { SessionController } = require('../../dist/trading/session.controller');

describe('Adaptive Session List & Entity Indexing', () => {
  it('registers composite TradeEntity indexes and Session indexes for fast history scans', () => {
    const indices = getMetadataArgsStorage().indices;
    const tradeCompositeCols = indices
      .filter((i) => i.target === TradeEntity && Array.isArray(i.columns))
      .map((i) => i.columns as string[]);

    expect(tradeCompositeCols).toEqual(
      expect.arrayContaining([
        ['sessionId', 'status'],
        ['status', 'exit_ts'],
        ['sessionId', 'status', 'exit_ts'],
      ]),
    );

    const sessionIndexedCols = indices
      .filter((i) => i.target === Session && Array.isArray(i.columns))
      .flatMap((i) => i.columns as string[]);

    expect(sessionIndexedCols).toEqual(expect.arrayContaining(['running', 'startTime']));
  });

  it('SessionService.listSessions returns normalized legacy array when includeCounts is false and caps limit at 500', async () => {
    const find = jest.fn().mockResolvedValue([
      {
        id: 'sess-1',
        running: false,
        paperMode: true,
        tradingMode: null,
        balance: 1000,
        totalPnl: 25,
        strategyLabel: 'Dual EMA',
        startTime: new Date('2026-07-15T10:00:00Z'),
        endTime: new Date('2026-07-15T12:00:00Z'),
        config: null,
      },
    ]);
    const mockCtx: any = { sessionRepository: { find } };

    const result = await SessionService.prototype.listSessions.call(mockCtx, 9999, false);
    expect(find).toHaveBeenCalledWith(
      expect.objectContaining({
        order: { startTime: 'DESC' },
        take: 500,
      }),
    );
    expect(Array.isArray(result)).toBe(true);
    expect(result[0].config.strategy_label).toBe('Dual EMA');
    expect(result[0].config.trading_mode).toBe('paper');
  });

  it('SessionService.listSessions returns { sessions, totalCount, sessionCounts } when includeCounts is true', async () => {
    const find = jest.fn().mockResolvedValue([
      {
        id: 'sess-live',
        running: false,
        paperMode: false,
        tradingMode: 'live',
        balance: 2500,
        totalPnl: 120,
        strategyLabel: 'Breakout',
        startTime: new Date('2026-07-15T10:00:00Z'),
        endTime: null,
        config: {},
      },
    ]);
    const qb = {
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      getRawOne: jest.fn().mockResolvedValue({ total: '84', paper: '60', testnet: '4', live: '20' }),
    };
    const mockCtx: any = {
      sessionRepository: {
        find,
        createQueryBuilder: jest.fn().mockReturnValue(qb),
      },
    };

    const result: any = await SessionService.prototype.listSessions.call(mockCtx, 100, true);
    expect(find).toHaveBeenCalledWith(expect.objectContaining({ take: 100 }));
    expect(result.totalCount).toBe(84);
    expect(result.sessionCounts).toEqual({ total: 84, paper: 60, testnet: 4, live: 20 });
    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0].config.paper_mode).toBe(false);
  });

  it('SessionController.listSessions forwards limit and withCounts boolean to SessionService', async () => {
    const listSessions = jest.fn().mockResolvedValue({
      sessions: [],
      totalCount: 0,
      sessionCounts: { total: 0, paper: 0, testnet: 0, live: 0 },
    });
    const mockCtrl: any = { sessionService: { listSessions } };

    await SessionController.prototype.listSessions.call(mockCtrl, 75, '1');
    expect(listSessions).toHaveBeenCalledWith(75, true);

    await SessionController.prototype.listSessions.call(mockCtrl, undefined, undefined);
    expect(listSessions).toHaveBeenCalledWith(undefined, false);
  });

  it('SessionService.getStatus returns engineMode-scoped lastSession when stopped and filters out mismatched engines', async () => {
    const findOneSession = jest.fn()
      .mockResolvedValueOnce(null) // activeSession
      .mockResolvedValueOnce({
        id: 'paper-last-1',
        running: false,
        paperMode: true,
        tradingMode: 'paper',
        strategyLabel: 'Mom 2% 5m 2R',
        startTime: new Date('2026-11-26T10:00:00Z'),
        endTime: new Date('2026-11-26T12:00:00Z'),
        config: { strategy_label: 'Mom 2% 5m 2R', paper_mode: true, trading_mode: 'paper' },
      });
    const findOneSettings = jest.fn().mockResolvedValue({
      paper_balance: 10250,
      live_balance: 5000,
      testnet_balance: 1000,
    });
    const mockCtx: any = {
      currentSessionId: null,
      sessionRunning: false,
      engineMode: 'paper',
      sessionRepository: { findOne: findOneSession },
      settingsRepository: { findOne: findOneSettings },
    };

    const res: any = await SessionService.prototype.getStatus.call(mockCtx, false);
    expect(findOneSession).toHaveBeenNthCalledWith(2, {
      where: { tradingMode: 'paper' },
      order: { startTime: 'DESC' },
    });
    expect(res.running).toBe(false);
    expect(res.balance).toBe(10250);
    expect(res.tradingMode).toBe('paper');
    expect(res.lastSession).toEqual(
      expect.objectContaining({
        id: 'paper-last-1',
        strategyLabel: 'Mom 2% 5m 2R',
        paperMode: true,
        tradingMode: 'paper',
        status: 'stopped',
      }),
    );

    // Mismatched engineMode safety guard
    const mismatchSessionFind = jest.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'live-session-leak',
        running: false,
        paperMode: false,
        tradingMode: 'live',
        strategyLabel: 'Live Strat',
        config: { strategy_label: 'Live Strat' },
      });
    const mismatchRes: any = await SessionService.prototype.getStatus.call(
      { ...mockCtx, engineMode: 'paper', sessionRepository: { findOne: mismatchSessionFind } },
      false,
    );
    expect(mismatchRes.lastSession).toBeNull();
    expect(mismatchRes.config).toBeNull();
  });
});
