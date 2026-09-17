import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { SessionService } from '../trading/session.service';
import { Session as SessionEntity } from '../models/entities/Session.entity';
import { TradeEntity } from '../models/entities/Trade.entity';
import { Log as LogEntity } from '../models/entities/Log.entity';
import { Settings as SettingsEntity } from '../models/entities/Settings.entity';
import { BalanceHistory as BalanceHistoryEntity } from '../models/entities/BalanceHistory.entity';
import { TradingSessionService } from '../engine/trading_session.service';
import { OrderManagerService } from '../engine/orderManager';
import { MarketFeedService } from '../engine/market_feed.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AnalyticsService } from '../engine/analytics.service';
import { RrOptimizationService } from '../engine/rr-optimization.service';
import { BinanceClientFactory } from '../lib/binanceClientFactory';
import { AuditLogService } from '../trading/audit-log.service';
import { ConfigService } from '@nestjs/config';

describe('SaveTradeOptimization', () => {
  let service: SessionService;
  let mockTradeRepo: any;
  let mockSessionRepo: any;
  let mockSettingsRepo: any;
  let mockBalanceHistoryRepo: any;
  let mockQueryRunner: any;

  beforeEach(async () => {
    mockQueryRunner = {
      connect: jest.fn(),
      startTransaction: jest.fn(),
      commitTransaction: jest.fn(),
      rollbackTransaction: jest.fn(),
      release: jest.fn(),
      manager: {
        findOne: jest.fn().mockResolvedValue({
          id: 'sess-1',
          tradingMode: 'paper',
          paperMode: true,
          config: {},
        }),
        save: jest.fn().mockImplementation((entityClass, obj) => Promise.resolve(obj)),
        update: jest.fn().mockResolvedValue({ affected: 1 }),
        createQueryBuilder: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          getRawOne: jest.fn().mockResolvedValue({ sum: '25.5' }),
        }),
      },
    };

    mockSessionRepo = {
      findOne: jest.fn().mockResolvedValue({
        id: 'sess-1',
        tradingMode: 'paper',
        paperMode: true,
        config: {},
      }),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      manager: {
        connection: {
          createQueryRunner: jest.fn().mockReturnValue(mockQueryRunner),
        },
      },
    };

    mockTradeRepo = {
      create: jest.fn().mockImplementation((dto) => dto),
      save: jest.fn().mockImplementation((dto) => Promise.resolve(dto)),
      find: jest.fn().mockResolvedValue([]),
    };

    mockSettingsRepo = {
      findOne: jest.fn().mockResolvedValue({
        id: 'default',
        paper_balance: 10000,
      }),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };

    mockBalanceHistoryRepo = {
      create: jest.fn().mockImplementation((dto) => dto),
      save: jest.fn().mockImplementation((dto) => Promise.resolve(dto)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SessionService,
        { provide: getRepositoryToken(SessionEntity), useValue: mockSessionRepo },
        { provide: getRepositoryToken(TradeEntity), useValue: mockTradeRepo },
        { provide: getRepositoryToken(LogEntity), useValue: { insert: jest.fn() } },
        { provide: getRepositoryToken(SettingsEntity), useValue: mockSettingsRepo },
        { provide: getRepositoryToken(BalanceHistoryEntity), useValue: mockBalanceHistoryRepo },
        {
          provide: TradingSessionService,
          useValue: {
            setBalanceUpdateCallback: jest.fn(),
            setTradeUpdateCallback: jest.fn(),
            getStatus: jest.fn().mockReturnValue({ balance_paper: 10000, total_pnl: 0 }),
          },
        },
        { provide: OrderManagerService, useValue: {} },
        { provide: MarketFeedService, useValue: {} },
        { provide: EventEmitter2, useValue: { emit: jest.fn() } },
        { provide: AnalyticsService, useValue: {} },
        { provide: RrOptimizationService, useValue: {} },
        { provide: BinanceClientFactory, useValue: {} },
        { provide: AuditLogService, useValue: { log: jest.fn(), cleanup: jest.fn() } },
        { provide: ConfigService, useValue: { get: jest.fn() } },
      ],
    }).compile();

    service = module.get<SessionService>(SessionService);
    (service as any).currentSessionId = 'sess-1';
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should execute streamlined save for newly created open trades without pessimistic session locking', async () => {
    const openTrade = {
      id: 'trade-100',
      symbol: 'BTCUSDT',
      direction: 'LONG',
      entry_price: 50000,
      qty: 0.1,
      current_sl: 49000,
      initial_sl: 49000,
      rr_sequence_index: -1,
      status: 'OPEN',
      pnl: 0,
      mark_price: 50100,
      sessionId: 'sess-1',
    };

    await service.saveTradeAtomic(openTrade, 10000);

    // Should call tradeRepository.save directly
    expect(mockTradeRepo.save).toHaveBeenCalledTimes(1);
    // Should NOT create or start a transaction queryRunner for OPEN trade
    expect(mockSessionRepo.manager.connection.createQueryRunner).not.toHaveBeenCalled();
    expect(mockQueryRunner.startTransaction).not.toHaveBeenCalled();
  });

  it('should skip DB save for routine mark_price updates on open trades within 15 seconds', async () => {
    const openTradeInitial = {
      id: 'trade-101',
      symbol: 'ETHUSDT',
      direction: 'LONG',
      entry_price: 3000,
      qty: 1.0,
      current_sl: 2900,
      initial_sl: 2900,
      rr_sequence_index: -1,
      status: 'OPEN',
      pnl: 0,
      mark_price: 3010,
      sessionId: 'sess-1',
    };

    // First save: records initial open state
    await service.saveTradeAtomic(openTradeInitial, 10000);
    expect(mockTradeRepo.save).toHaveBeenCalledTimes(1);

    mockTradeRepo.save.mockClear();

    // Second save 500ms later: routine tick update with mark_price change only
    const openTradeTick = {
      ...openTradeInitial,
      mark_price: 3015,
      last_price: 3015,
      max_rr_achieved: 0.15,
    };

    await service.saveTradeAtomic(openTradeTick, 10000);

    // Routine tick update should be debounced and skipped!
    expect(mockTradeRepo.save).not.toHaveBeenCalled();
  });

  it('should immediately persist critical open trade state changes (SL ratchet / milestone)', async () => {
    const openTradeInitial = {
      id: 'trade-102',
      symbol: 'SOLUSDT',
      direction: 'LONG',
      entry_price: 150,
      qty: 10,
      current_sl: 145,
      initial_sl: 145,
      rr_sequence_index: -1,
      status: 'OPEN',
      pnl: 0,
      mark_price: 155,
      sessionId: 'sess-1',
    };

    // First save
    await service.saveTradeAtomic(openTradeInitial, 10000);
    expect(mockTradeRepo.save).toHaveBeenCalledTimes(1);

    mockTradeRepo.save.mockClear();

    // SL Ratchet trigger: current_sl changes to 150 (breakeven), rr_sequence_index becomes 0
    const openTradeRatchet = {
      ...openTradeInitial,
      current_sl: 150,
      rr_sequence_index: 0,
      mark_price: 158,
    };

    await service.saveTradeAtomic(openTradeRatchet, 10000);

    // Critical change must save immediately!
    expect(mockTradeRepo.save).toHaveBeenCalledTimes(1);
    expect(mockTradeRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'trade-102',
        current_sl: 150,
        rr_sequence_index: 0,
      }),
    );
    // Still bypasses transaction queryRunner for open trades
    expect(mockSessionRepo.manager.connection.createQueryRunner).not.toHaveBeenCalled();
  });

  it('should execute full atomic queryRunner transaction with pessimistic session locking for terminal trade closures', async () => {
    const closedTrade = {
      id: 'trade-103',
      symbol: 'ADAUSDT',
      direction: 'LONG',
      entry_price: 0.5,
      qty: 1000,
      current_sl: 0.45,
      initial_sl: 0.45,
      status: 'CLOSED_SL',
      pnl: -50,
      exit_price: 0.45,
      exit_ts: new Date(),
      sessionId: 'sess-1',
    };

    await service.saveTradeAtomic(closedTrade, 9950);

    // Must start transaction and pessimistic lock session for closed trades
    expect(mockSessionRepo.manager.connection.createQueryRunner).toHaveBeenCalledTimes(1);
    expect(mockQueryRunner.startTransaction).toHaveBeenCalledTimes(1);
    expect(mockQueryRunner.manager.findOne).toHaveBeenCalledWith(
      SessionEntity,
      expect.objectContaining({
        where: { id: 'sess-1' },
        lock: { mode: 'pessimistic_write' },
      }),
    );
    // Must update session balance and settings balance
    expect(mockQueryRunner.manager.update).toHaveBeenCalledWith(SessionEntity, 'sess-1', {
      balance: 9950,
      totalPnl: 25.5,
    });
    expect(mockQueryRunner.manager.update).toHaveBeenCalledWith(SettingsEntity, 'default', {
      paper_balance: 9950,
    });
    // Must save BalanceHistory snapshot via transactional manager
    expect(mockQueryRunner.manager.save).toHaveBeenCalledWith(
      BalanceHistoryEntity,
      expect.objectContaining({
        balance: 9950,
        pnl: -50,
        type: 'TRADE_CLOSE',
        sessionId: 'sess-1',
        tradeId: 'trade-103',
      }),
    );
    expect(mockQueryRunner.commitTransaction).toHaveBeenCalledTimes(1);
    expect(mockQueryRunner.release).toHaveBeenCalledTimes(1);
  });
});
