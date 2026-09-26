import { OrderManagerService } from './orderManager';
import { OrderFilterService } from './order-filter.service';

describe('Chronos: Cross-Endpoint Order Cancellation Fallback & String ID Compliance', () => {
  let service: OrderManagerService;
  let mockBinanceClient: any;
  let sessionState: any;

  beforeEach(() => {
    sessionState = {
      isRateLimited: () => false,
      isOrderRateLimited: () => false,
      isBanned: () => false,
      apiStatus: { isBanned: false, banUntil: null },
      binanceRateLimit: { used_1m: 0, limit: 2400 },
      updateRateLimit: jest.fn(),
      updateOrderRateLimits: jest.fn(),
      realTimePositions: new Map(),
      realTimeOrders: new Map(),
      config: {},
      hasOrderCapacity: () => true
    };

    mockBinanceClient = {
      restAPI: {
        cancelOrder: jest.fn(),
        cancelAlgoOrder: jest.fn(),
      }
    };

    service = new OrderManagerService(
      { checkEntry: jest.fn() } as any,
      { getSymbolFilters: jest.fn().mockReturnValue({ filters: [] }) } as any,
      { getTicker: jest.fn(), getPrice: jest.fn() } as any,
      { incrementApiRequests: jest.fn() } as any,
      {
        getInFlightEntry: jest.fn(),
        setInFlight: jest.fn(),
        clearInFlight: jest.fn(),
        onRatchetComplete: jest.fn().mockResolvedValue(undefined),
        markDirty: jest.fn(),
        recordRatchetDeferral: jest.fn()
      } as any,
      sessionState,
      { broadcast: jest.fn() } as any,
      { log: jest.fn() } as any,
      { emit: jest.fn() } as any,
      { findOne: jest.fn().mockResolvedValue({}), update: jest.fn().mockResolvedValue({}) } as any,
      new OrderFilterService({ getSymbolFilters: () => ({ filters: [] }) } as any, { getTicker: jest.fn(), getPrice: jest.fn() } as any, { broadcast: jest.fn() } as any)
    );

    service.setBinanceClient(mockBinanceClient, false); // Live mode
  });

  it('falls back from cancelOrder to cancelAlgoOrder when cancelOrder returns -2011 Unknown order', async () => {
    // Standard cancelOrder fails with -2011 Unknown order
    mockBinanceClient.restAPI.cancelOrder.mockRejectedValueOnce(
      new Error('Binance error: -2011 Unknown order sent.')
    );
    // Secondary cancelAlgoOrder succeeds
    mockBinanceClient.restAPI.cancelAlgoOrder.mockResolvedValueOnce({
      data: () => Promise.resolve({ algoId: '500123', algoStatus: 'CANCELLED' }),
      headers: {}
    });

    const result = await service.cancelBinanceOrder('BTCUSDT', '500123', 'standard');

    expect(result).toBe(true);
    expect(mockBinanceClient.restAPI.cancelOrder).toHaveBeenCalledWith({
      symbol: 'BTCUSDT',
      orderId: BigInt('500123')
    });
    expect(mockBinanceClient.restAPI.cancelAlgoOrder).toHaveBeenCalledWith({
      symbol: 'BTCUSDT',
      algoId: '500123'
    });
  });

  it('handles non-numeric client order IDs without throwing SyntaxError for BigInt', async () => {
    const clientOrderId = 'sl-a1b2c3d4';

    mockBinanceClient.restAPI.cancelOrder.mockResolvedValueOnce({
      data: () => Promise.resolve({ clientOrderId, status: 'CANCELED' }),
      headers: {}
    });

    const result = await service.cancelBinanceOrder('BTCUSDT', clientOrderId, 'standard');

    expect(result).toBe(true);
    expect(mockBinanceClient.restAPI.cancelOrder).toHaveBeenCalledWith({
      symbol: 'BTCUSDT',
      origClientOrderId: clientOrderId
    });
  });

  it('handles non-numeric clientAlgoId for algo orders without throwing SyntaxError', async () => {
    const clientAlgoId = 'sl-a1b2c3d4';

    mockBinanceClient.restAPI.cancelAlgoOrder.mockResolvedValueOnce({
      data: () => Promise.resolve({ clientAlgoId, algoStatus: 'CANCELLED' }),
      headers: {}
    });

    const result = await service.cancelBinanceOrder('BTCUSDT', clientAlgoId, 'algo');

    expect(result).toBe(true);
    expect(mockBinanceClient.restAPI.cancelAlgoOrder).toHaveBeenCalledWith({
      symbol: 'BTCUSDT',
      clientAlgoId
    });
  });

  it('returns true when BOTH standard and algo endpoints return -2011 Unknown order', async () => {
    mockBinanceClient.restAPI.cancelOrder.mockRejectedValueOnce(
      new Error('Binance error: -2011 Unknown order sent.')
    );
    mockBinanceClient.restAPI.cancelAlgoOrder.mockRejectedValueOnce(
      new Error('Binance error: -2011 Unknown order sent.')
    );

    const result = await service.cancelBinanceOrder('BTCUSDT', '999999', 'standard');

    expect(result).toBe(true);
    expect(mockBinanceClient.restAPI.cancelOrder).toHaveBeenCalled();
    expect(mockBinanceClient.restAPI.cancelAlgoOrder).toHaveBeenCalled();
  });

  it('returns false when fallback endpoint returns a systemic or network error', async () => {
    mockBinanceClient.restAPI.cancelOrder.mockRejectedValueOnce(
      new Error('Binance error: -2011 Unknown order sent.')
    );
    mockBinanceClient.restAPI.cancelAlgoOrder.mockRejectedValueOnce(
      new Error('Too many requests (-1015)')
    );

    const result = await service.cancelBinanceOrder('BTCUSDT', '888888', 'standard');

    expect(result).toBe(false);
  });
});
