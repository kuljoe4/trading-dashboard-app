import { OrderFilterService } from './order-filter.service';
import { Test, TestingModule } from '@nestjs/testing';
import { PositionTrackerService } from './positionTracker';
import { RiskEngineService } from './riskEngine';
import { SignalEngineService } from './signalEngine';
import { OrderManagerService } from './orderManager';
import { TickerCacheService } from './ticker_cache.service';
import { KlineStoreService } from './kline_store.service';
import { SessionStateService } from './session_state.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Trade } from '../models/Trade';
import { SessionConfig } from '../models/SessionConfig';

describe('Chronos: Price Breach Race Protection', () => {
  let positionTracker: PositionTrackerService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PositionTrackerService,
        { provide: RiskEngineService, useValue: {} },
        { provide: SignalEngineService, useValue: {} },
        { provide: OrderManagerService, useValue: { isRatcheting: jest.fn().mockReturnValue(false), applyFilters: jest.fn((sym, price) => ({ price })) } },
        { provide: TickerCacheService, useValue: {} },
        { provide: KlineStoreService, useValue: {} },
        { provide: SessionStateService, useValue: { setActiveTrades: jest.fn() } },
        { provide: OrderFilterService, useValue: {} },
        EventEmitter2,
      ],
    }).compile();

    positionTracker = module.get<PositionTrackerService>(PositionTrackerService);
  });

  it('should trigger SL exit normally in Paper mode (paper_mode = true)', () => {
    const symbol = 'BTCUSDT';
    const trade = {
      id: 'trade-paper',
      symbol,
      direction: 'LONG',
      entry_price: 50000,
      initial_sl: 49000,
      current_sl: 49000,
      qty: 1.0,
      status: 'OPEN',
      sl_adjustments: [],
    } as any as Trade;

    positionTracker.addTrade(trade);

    const config = {
      paper_mode: true,
      trading_mode: 'paper',
    } as any as SessionConfig;

    const result = positionTracker.checkExitConditions(symbol, 48900, config);

    expect(result).not.toBeNull();
    expect(result?.exitOccurred).toBe(true);
    expect(result?.exitType).toBe('CLOSED_SL');
    expect(result?.exitReason).toContain('SL_HIT');
  });

  it('should BYPASS local SL exit in Live mode (paper_mode = false) when an active stop-loss order is tracked on the exchange', () => {
    const symbol = 'BTCUSDT';
    const trade = {
      id: 'trade-live-protected',
      symbol,
      direction: 'LONG',
      entry_price: 50000,
      initial_sl: 49000,
      current_sl: 49000,
      qty: 1.0,
      status: 'OPEN',
      sl_adjustments: [],
      binance_stop_order_id: 'sl-order-exchange-id',
    } as any as Trade;

    positionTracker.addTrade(trade);

    const config = {
      paper_mode: false,
      trading_mode: 'live',
    } as any as SessionConfig;

    // Price breaches SL price (48900 <= 49000), but bypass should fire because SL is active on exchange.
    const result = positionTracker.checkExitConditions(symbol, 48900, config);

    expect(result).toBeNull();
  });

  it('should TRIGGER local SL exit in Live mode (paper_mode = false) as emergency fallback if binance_stop_order_id is missing', () => {
    const symbol = 'BTCUSDT';
    const trade = {
      id: 'trade-live-unprotected',
      symbol,
      direction: 'LONG',
      entry_price: 50000,
      initial_sl: 49000,
      current_sl: 49000,
      qty: 1.0,
      status: 'OPEN',
      sl_adjustments: [],
      binance_stop_order_id: undefined, // Missing/unprotected!
    } as any as Trade;

    positionTracker.addTrade(trade);

    const config = {
      paper_mode: false,
      trading_mode: 'live',
    } as any as SessionConfig;

    // Price breaches SL price. Fallback triggers because binance_stop_order_id is missing.
    const result = positionTracker.checkExitConditions(symbol, 48900, config);

    expect(result).not.toBeNull();
    expect(result?.exitOccurred).toBe(true);
    expect(result?.exitType).toBe('CLOSED_SL');
    expect(result?.exitReason).toContain('SL_HIT');
  });
});
