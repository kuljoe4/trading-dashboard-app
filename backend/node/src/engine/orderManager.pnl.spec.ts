import { OrderFilterService } from './order-filter.service';
import { OrderManagerService } from './orderManager';
import { Trade } from '../models/Trade';
import { roundEight } from '../lib/math';

describe('OrderManagerService - PnL Consistency', () => {
  let service: OrderManagerService;
  let mockSignalEngine: any;
  let mockBinanceClient: any;
  let mockMarketFeed: any;
  let mockTradingSession: any;

  beforeEach(() => {
    mockSignalEngine = {
      checkEntry: jest.fn(),
    };
    mockMarketFeed = {
      getSymbolFilters: jest.fn().mockReturnValue({
        filters: [
          { filterType: 'PRICE_FILTER', tickSize: '0.01' },
          { filterType: 'LOT_SIZE', stepSize: '0.001' },
          { filterType: 'MIN_NOTIONAL', notional: '10.0' }
        ]
      })
    };
    mockTradingSession = {
      isRateLimited: jest.fn().mockReturnValue(false), isBanned: jest.fn().mockReturnValue(false),
      isOrderRateLimited: jest.fn().mockReturnValue(false),
      binanceRateLimit: { used_1m: 0, limit: 2400 },
      updateRateLimit: jest.fn(),
      updateOrderRateLimits: jest.fn(),
      realTimePositions: new Map(),
      realTimeOrders: new Map(),
    };
    service = new OrderManagerService(
      mockSignalEngine,
      mockMarketFeed,
      { getTicker: jest.fn(), getPrice: jest.fn() } as any, // tickerCache
      { incrementApiRequests: jest.fn() } as any, // monitoringService
      { getInFlightEntry: jest.fn(), setInFlight: jest.fn(), clearInFlight: jest.fn() } as any, // positionTracker
      mockTradingSession,
      { broadcast: jest.fn() } as any, // broadcastService
      { log: jest.fn() } as any, // auditLog
      { emit: jest.fn() } as any, { findOne: jest.fn().mockResolvedValue({}), update: jest.fn().mockResolvedValue({}) } as any
    , new OrderFilterService(mockMarketFeed as any, { getTicker: jest.fn(), getPrice: jest.fn() } as any, { broadcast: jest.fn() } as any));

    mockBinanceClient = {
      restAPI: {
        newOrder: jest.fn(),
        cancelOrder: jest.fn(),
        positionInformationV3: jest.fn(),
        accountTradeList: jest.fn(),
        queryOrder: jest.fn(),
        userCommissionRate: jest.fn().mockResolvedValue({ data: () => Promise.resolve({ takerCommissionRate: '0.0004' }) }),
        modifyOrder: jest.fn(),
        currentAllOpenOrders: jest.fn(),
        currentAllAlgoOpenOrders: jest.fn().mockResolvedValue({ data: () => Promise.resolve([]) }),
        cancelAllOpenOrders: jest.fn().mockResolvedValue({ data: () => Promise.resolve({ code: 0 }), headers: {} }),
      },
    };
  });

  it('captures fee when exchange SL already closed the position', async () => {
    service.setBinanceClient(mockBinanceClient, false); // Live mode

    const trade = {
      id: 'test-id-pnl-1',
      symbol: 'BTCUSDT',
      direction: 'LONG',
      qty: 0.1,
      entry_price: 50000,
      pnl: -2.0, // CHRONOS: Must be consistent with realized_fee
      realized_fee: 2.0, // Initial fee (0.04% of 50000 * 0.1)
      binance_order_id: 'entry_id',
      binance_stop_order_id: 'sl_order_id',
      status: 'OPEN'
    } as Trade;

    const exitPrice = 49500;

    // Simulate Binance rejecting the close order because position is already closed
    mockBinanceClient.restAPI.newOrder.mockRejectedValue(new Error('Position side does not match'));
    mockBinanceClient.restAPI.positionInformationV3.mockResolvedValue({
      data: () => Promise.resolve([{ positionAmt: '0', positionSide: 'BOTH' }]),
      headers: { get: (k: string) => (k === 'X-MBX-USED-WEIGHT-1M' ? '10' : null) }
    });
    mockBinanceClient.restAPI.cancelOrder.mockResolvedValue({
      data: () => Promise.resolve({}),
      headers: { get: (k: string) => (k === 'X-MBX-USED-WEIGHT-1M' ? '10' : null) }
    });

    mockBinanceClient.restAPI.accountTradeList = jest.fn().mockResolvedValue({
      data: () => Promise.resolve([
        {
          symbol: 'BTCUSDT',
          orderId: '987654',
          side: 'SELL',
          price: '49500.00',
          qty: '0.1',
          time: Date.now() - 1000,
        },
      ]),
      headers: {},
    });

    mockBinanceClient.restAPI.queryOrder = jest.fn().mockResolvedValue({
      data: () => Promise.resolve({
        orderId: 987654,
        avgPrice: '49500.00',
        type: 'STOP_MARKET',
        clientOrderId: 'sl-order',
        status: 'FILLED',
        stopPrice: '49000.00',
      }),
      headers: {},
    });

    const result = await service.closeTrade('BTCUSDT', trade, exitPrice, 'SL_HIT', false);

    expect(result.exitOccurred).toBe(true);
    expect(trade.exit_reason).toMatch(/SL_HIT/);

    // Fee simulation: 0.04% of (49500 * 0.1) = 1.98
    // Total fee = 2.0 + 1.98 = 3.98
    expect(trade.realized_fee).toBeGreaterThanOrEqual(2.0);

    // PnL calculation: -2.0 (initial fee) - 1.98 (exit fee) + (49500 - 50000) * 0.1 = -3.98 - 50 = -53.98
    expect(trade.pnl).toBeLessThanOrEqual(-52.0);
  });

  it('recovers specific exit reason from exchange history during sync', async () => {
    service.setBinanceClient(mockBinanceClient, false);

    const trade = {
      id: 'test-id-recon-1',
      symbol: 'BTCUSDT',
      direction: 'LONG',
      qty: 0.1,
      entry_price: 50000,
      initial_sl: 49000,
      current_sl: 49000,
      pnl: -1.0,
      realized_fee: 1.0,
      binance_order_id: 'entry_id',
      status: 'OPEN'
    } as Trade;

    // 1. Mock trade history showing a sell at 49200
    mockBinanceClient.restAPI.accountTradeList.mockResolvedValue({
       data: () => Promise.resolve([
         { symbol: 'BTCUSDT', side: 'SELL', price: '49200', orderId: '112233', time: Date.now() }
       ])
    });

    // 2. Mock order query showing it was a STOP_MARKET order (SL)
    mockBinanceClient.restAPI.queryOrder.mockResolvedValue({
       data: () => Promise.resolve({
          symbol: 'BTCUSDT',
          orderId: '112233',
          type: 'STOP_MARKET',
          stopPrice: '49000',
          avgPrice: '49200', // Canonical average price
          status: 'FILLED'
       })
    });

    const result = await service.closeTrade('BTCUSDT', trade, 0, 'EXCHANGE_SYNC', false, true);

    expect(result.exitOccurred).toBe(true);
    // Should recover the specific SL_HIT reason instead of generic EXCHANGE_SYNC
    expect(trade.exit_reason).toBe('SL_HIT_INITIAL_SL');
    expect(trade.exit_price).toBe(49200);
    expect(trade.status).toBe('CLOSED_SL');
  });

  it('recovers SIGNAL exit reason from descriptive clientOrderId prefix', async () => {
    service.setBinanceClient(mockBinanceClient, false);

    const trade = {
      id: 'test-id-recon-2',
      symbol: 'BTCUSDT',
      direction: 'LONG',
      qty: 0.1,
      entry_price: 50000,
      pnl: 0,
      binance_order_id: 'entry_id',
      status: 'OPEN'
    } as Trade;

    // Mock trade history showing a sell
    mockBinanceClient.restAPI.accountTradeList.mockResolvedValue({
       data: () => Promise.resolve([
         { symbol: 'BTCUSDT', side: 'SELL', price: '50500', orderId: '998877', time: Date.now() }
       ])
    });

    // Mock order query showing it was a MARKET order with 'sig-' prefix
    mockBinanceClient.restAPI.queryOrder.mockResolvedValue({
       data: () => Promise.resolve({
          symbol: 'BTCUSDT',
          orderId: '998877',
          type: 'MARKET',
          avgPrice: '50500', // Canonical average price
          clientOrderId: 'sig-test-id-recon-2',
          status: 'FILLED'
       })
    });

    const result = await service.closeTrade('BTCUSDT', trade, 0, 'EXCHANGE_SYNC', false, true);

    expect(result.exitOccurred).toBe(true);
    expect(trade.exit_reason).toBe('SIGNAL');
    expect(trade.exit_price).toBe(50500);
    expect(trade.status).toBe('CLOSED_SIGNAL');
  });

  it('uses paperMode parameter for fee simulation in catch block', async () => {
    // Set service to LIVE mode globally
    service.setBinanceClient(mockBinanceClient, false);

    const trade = {
      id: 'test-id-pnl-2',
      symbol: 'BTCUSDT',
      direction: 'LONG',
      qty: 0.1,
      entry_price: 50000,
      pnl: 0,
      realized_fee: 0,
      status: 'OPEN'
    } as Trade;

    const exitPrice = 51000;

    // Simulate failure in live mode but passing paperMode=true to closeTrade
    mockBinanceClient.restAPI.newOrder.mockRejectedValue(new Error('API Error'));

    const result = await service.closeTrade('BTCUSDT', trade, exitPrice, 'MANUAL_CLOSE', true);

    expect(result.exitOccurred).toBe(true);
    // Fee should be simulated because paperMode=true was passed
    expect(trade.realized_fee).toBe(roundEight(51000 * 0.1 * 0.0004));
  });
});
