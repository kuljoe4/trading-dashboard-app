import { OrderFilterService } from './order-filter.service';
import { OrderManagerService } from './orderManager';
import { Trade } from '../models/Trade';
import { ENGINE_EVENTS } from './events';
import { EXIT_REASONS } from '../models/constants';

describe('Chronos: Multi-part PnL Integrity Recovery', () => {
  let service: OrderManagerService;
  let mockSignalEngine: any;
  let mockBinanceClient: any;
  let mockMarketFeed: any;
  let mockSessionState: any;
  let eventEmitter: any;
  let mockTickerCache: any;

  beforeEach(() => {
    mockSignalEngine = { checkEntry: jest.fn() };
    mockMarketFeed = {
      getSymbolFilters: jest.fn().mockReturnValue({
        tickSize: 0.01,
        stepSize: 0.001,
        qtyPrecision: 3,
        pricePrecision: 2
      }),
    };
    mockSessionState = {
      isRateLimited: jest.fn().mockReturnValue(false),
      isBanned: jest.fn().mockReturnValue(false),
      isOrderRateLimited: jest.fn().mockReturnValue(false),
      binanceRateLimit: { used_1m: 0, limit: 2400 },
      realTimeOrders: new Map(),
      realTimePositions: new Map(),
      activeTrades: [],
      getBinanceRateLimit: jest.fn().mockReturnValue({ used_1m: 0, limit: 2400 }),
    };
    eventEmitter = { emit: jest.fn() };
    mockTickerCache = { getTicker: jest.fn(), getPrice: jest.fn().mockReturnValue(100) };

    service = new OrderManagerService(
      mockSignalEngine,
      mockMarketFeed,
      mockTickerCache,
      { incrementApiRequests: jest.fn() } as any,
      { getInFlightEntry: jest.fn(), setInFlight: jest.fn(), clearInFlight: jest.fn(), addTrade: jest.fn() } as any,
      mockSessionState,
      { broadcast: jest.fn() } as any,
      { log: jest.fn() } as any,
      eventEmitter as any,
      { findOne: jest.fn().mockResolvedValue({}), update: jest.fn().mockResolvedValue({}) } as any,
      new OrderFilterService(mockMarketFeed as any, mockTickerCache as any, { broadcast: jest.fn() } as any)
    );

    mockBinanceClient = {
      restAPI: {
        userCommissionRate: jest.fn().mockResolvedValue({ data: () => Promise.resolve({ takerCommissionRate: '0.0004' }) }),
        queryOrder: jest.fn(),
        accountTradeList: jest.fn(),
      },
    };
    service.setBinanceClient(mockBinanceClient, false);
  });

  it('should correctly calculate PnL when recovering from missed slices using average order price', async () => {
    // SCENARIO:
    // Entry: 1.0 @ 100
    // Exit Slice 1 (UDS processed): 0.5 @ 120. PnL = +10. Remaining Qty = 0.5.
    // Exit Slice 2 (UDS MISSED): 0.5 @ 110.
    // Watchdog triggers recovery. Total average exit price = 115.
    // CORRECT: (115 - 100) * 1.0 = 15.0 gross.
    // Costs: Slice 2 estimated fee = 115 * 0.5 * 0.0004 = 0.023.
    // Final Net PnL = 15.0 - 0.023 = 14.977.

    const trade = {
      id: 'trade-recovery-test',
      symbol: 'BTCUSDT',
      direction: 'LONG',
      qty: 1.0,
      entry_price: 100,
      initial_sl: 90,
      initial_risk_usdt: 10, // (100 - 90) * 1.0
      pnl: 0,
      status: 'OPEN',
      binance_order_id: '12345',
      binance_stop_order_id: '67890'
    } as any;

    mockSessionState.activeTrades = [trade];

    // 1. Process Slice 1 via UDS: 0.5 @ 120. RP = (120-100)*0.5 = 10.
    const slice1 = {
      o: {
        s: 'BTCUSDT',
        X: 'PARTIALLY_FILLED',
        i: '67890',
        S: 'SELL',
        ot: 'STOP_MARKET',
        x: 'TRADE',
        q: '1.0',
        z: '0.5',
        l: '0.5',
        ap: '120',
        n: '0',
        rp: '10',
        t: '1001',
        T: Date.now()
      }
    };
    await service.handleBinanceOrderUpdate(slice1 as any);

    expect(trade.pnl).toBe(10);
    expect(trade.qty).toBe(0.5);

    // 2. Mock missed Slice 2 and subsequent recovery.
    // Total order: 1.0 @ 115 avg.
    mockBinanceClient.restAPI.queryOrder.mockResolvedValue({
      headers: {},
      data: jest.fn().mockResolvedValue({
        orderId: '67890',
        status: 'FILLED',
        avgPrice: '115',
        executedQty: '1.0',
        origQty: '1.0',
        type: 'STOP_MARKET'
      })
    });

    // Simulate recovery closure
    const result = await service.closeTrade('BTCUSDT', trade, 0, EXIT_REASONS.EXCHANGE_SYNC, false, true, {
        orderId: '67890'
    });

    // EXPECTATION: (115 - 100) * 1.0 - 0.023 = 14.977
    expect(result.trade.pnl).toBe(14.977);
    expect(result.trade.qty).toBe(1.0);
  });
});
