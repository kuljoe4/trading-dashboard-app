import { OrderFilterService } from './order-filter.service';
import { OrderManagerService } from './orderManager';
import { Trade } from '../models/Trade';
import { roundEight } from '../lib/math';
import { ENGINE_EVENTS } from './events';

describe('OrderManagerService - Multi-part SL Integrity', () => {
  let service: OrderManagerService;
  let mockSignalEngine: any;
  let mockBinanceClient: any;
  let mockMarketFeed: any;
  let mockSessionState: any;
  let eventEmitter: any;

  beforeEach(() => {
    mockSignalEngine = {
      checkEntry: jest.fn(),
    };
    mockMarketFeed = {
      getSymbolFilters: jest.fn().mockReturnValue({
        tickSize: 0.01,
        stepSize: 0.001,
        qtyPrecision: 3,
        pricePrecision: 2
      }),
    };
    mockSessionState = {
      isRateLimited: jest.fn().mockReturnValue(false), isBanned: jest.fn().mockReturnValue(false),
      isOrderRateLimited: jest.fn().mockReturnValue(false),
      binanceRateLimit: { used_1m: 0, limit: 2400 },
      realTimeOrders: new Map(),
      realTimePositions: new Map(),
      activeTrades: [],
      getBinanceRateLimit: jest.fn().mockReturnValue({ used_1m: 0, limit: 2400 }),
    };
    eventEmitter = {
      emit: jest.fn(),
    };

    service = new OrderManagerService(
      mockSignalEngine,
      mockMarketFeed,
      { getTicker: jest.fn(), getPrice: jest.fn() } as any, // tickerCache
      { incrementApiRequests: jest.fn() } as any, // monitoringService
      { getInFlightEntry: jest.fn(), setInFlight: jest.fn(), clearInFlight: jest.fn() } as any, // positionTracker
      mockSessionState,
      { broadcast: jest.fn() } as any, // broadcastService
      { log: jest.fn() } as any, // auditLog
      eventEmitter as any,
      { findOne: jest.fn().mockResolvedValue({}), update: jest.fn().mockResolvedValue({}) } as any // settingsRepository
    , new OrderFilterService(mockMarketFeed as any, { getTicker: jest.fn(), getPrice: jest.fn() } as any, { broadcast: jest.fn() } as any));

    mockBinanceClient = {
      restAPI: {
        userCommissionRate: jest.fn().mockResolvedValue({ data: () => Promise.resolve({ takerCommissionRate: '0.0004' }) }),
        queryOrder: jest.fn(),
        accountTradeList: jest.fn(),
        newOrder: jest.fn(),
        newAlgoOrder: jest.fn(),
      },
    };
    service.setBinanceClient(mockBinanceClient, false);
  });

  it('accumulates commissions and syncs quantity for multi-part SL fill', async () => {
    const trade = {
      id: 'test-trade-12345678',
      symbol: 'BTCUSDT',
      direction: 'LONG',
      qty: 0.1,
      entry_price: 50000,
      initial_sl: 49500,
      current_sl: 49000,
      realized_fee: 2.0, // Entry fee
      binance_stop_order_id: 'sl-123',
      status: 'OPEN',
    } as Trade;

    mockSessionState.activeTrades = [trade];

    // 1. First slice: PARTIALLY_FILLED (50% fill)
    const slice1 = {
      o: {
        s: 'BTCUSDT',
        X: 'PARTIALLY_FILLED',
        i: 'sl-123',
        S: 'SELL',
        ot: 'STOP_MARKET',
        x: 'TRADE',
        q: '0.1',  // Original total qty
        z: '0.05', // Cumulative filled qty
        ap: '49200',
        n: '0.984', // Commission for this slice (0.04% of 49200 * 0.05)
        t: 'trade-slice-1', // Trade ID
        T: Date.now()
      }
    };

    await service.handleBinanceOrderUpdate(slice1 as any);

    // Verify quantity sync for partial fill (should reflect remaining 0.05)
    expect(trade.qty).toBe(0.05);
    expect(trade.realized_fee).toBe(2.0 + 0.984);
    expect(eventEmitter.emit).toHaveBeenCalledWith(ENGINE_EVENTS.QUANTITY_SYNC, { symbol: 'BTCUSDT', qty: 0.05 });

    // 1b. Redelivery of slice 1 (Deduplication Check)
    await service.handleBinanceOrderUpdate(slice1 as any);
    expect(trade.realized_fee).toBe(2.0 + 0.984); // Should NOT increase

    // 2. Second slice: FILLED (Remaining 50%)
    const slice2 = {
      o: {
        s: 'BTCUSDT',
        X: 'FILLED',
        i: 'sl-123',
        S: 'SELL',
        ot: 'STOP_MARKET',
        x: 'TRADE',
        q: '0.1',  // Original total qty
        z: '0.1',  // Cumulative filled qty (now 100%)
        ap: '49100', // Final average price
        n: '0.982', // Commission for second slice
        t: 'trade-slice-2', // Trade ID
        T: Date.now()
      }
    };

    await service.handleBinanceOrderUpdate(slice2 as any);

    // CHRONOS: Under Incremental PnL Architecture, trade.qty is NOT restored in the handler.
    // It is restored during final closure in closeTrade() to ensure history accuracy without double-counting.
    expect(trade.qty).toBe(0.05); // Still at remaining from previous slice
    expect(trade.realized_fee).toBe(roundEight(2.0 + 0.984 + 0.982));

    // Verify closure event was emitted with feesAlreadyAccounted and alreadyRealized flags
    expect(eventEmitter.emit).toHaveBeenCalledWith('trade.exchange_close', expect.objectContaining({
      symbol: 'BTCUSDT',
      exitPrice: 49100,
      feesAlreadyAccounted: true,
      alreadyRealized: true
    }));
  });

  it('attributes entry fees from fills and prevents double-counting in UDS', async () => {
    mockBinanceClient.restAPI.newOrder.mockResolvedValue({
      data: () => Promise.resolve({
        orderId: 'ent-123',
        status: 'FILLED',
        avgPrice: '50000',
        executedQty: '0.1',
        cumQuote: '5000',
        fills: [
          { tradeId: 'fill-1', commission: '1.0', price: '50000', qty: '0.05' },
          { tradeId: 'fill-2', commission: '1.0', price: '50000', qty: '0.05' }
        ]
      }),
      headers: { get: () => '10' }
    });

    mockBinanceClient.restAPI.newAlgoOrder.mockResolvedValue({
      data: () => Promise.resolve({ orderId: 'sl-123', status: 'NEW' }),
      headers: { get: () => '10' }
    });

    const result = await service.enter('session-1', 'BTCUSDT', 'LONG', 50000, 0.1, 49000, null);

    expect(result.status).toBe('SUCCESS');
    const trade = result.data!;
    expect(trade.realized_fee).toBe(2.0); // 1.0 + 1.0

    // Now simulate UDS arrival for one of those fills
    mockSessionState.activeTrades = [trade];
    const udsFill = {
      o: {
        s: 'BTCUSDT',
        X: 'FILLED',
        i: 'ent-123',
        S: 'BUY',
        ot: 'MARKET',
        x: 'TRADE',
        q: '0.1',
        z: '0.05',
        ap: '50000',
        n: '1.0',
        t: 'fill-1', // Duplicate ID
        T: Date.now()
      }
    };

    await service.handleBinanceOrderUpdate(udsFill as any);

    // Fee should NOT increase
    expect(trade.realized_fee).toBe(2.0);
  });
});
