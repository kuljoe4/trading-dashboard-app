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
      isRateLimited: jest.fn().mockReturnValue(false)
    };
    service = new OrderManagerService(mockSignalEngine, mockMarketFeed, mockTradingSession);

    mockBinanceClient = {
      restAPI: {
        tradeApi: {
          newOrder: jest.fn(),
          cancelOrder: jest.fn(),
        },
        accountApi: {
          futuresPositionRiskV2: jest.fn(),
        }
      },
    };
  });

  it('captures fee when exchange SL already closed the position', async () => {
    service.setBinanceClient(mockBinanceClient, false); // Live mode

    const trade = {
      symbol: 'BTCUSDT',
      direction: 'LONG',
      qty: 0.1,
      entry_price: 50000,
      realized_fee: 2.0, // Initial fee (0.04% of 50000 * 0.1)
      binance_stop_order_id: 'sl_order_id',
      status: 'OPEN'
    } as Trade;

    const exitPrice = 49500;

    // Simulate Binance rejecting the close order because position is already closed
    mockBinanceClient.restAPI.tradeApi.newOrder.mockRejectedValue(new Error('Position side does not match'));
    mockBinanceClient.restAPI.accountApi.futuresPositionRiskV2.mockResolvedValue({ data: [{ positionAmt: '0' }] });
    mockBinanceClient.restAPI.tradeApi.cancelOrder.mockResolvedValue({ data: {} });

    const result = await service.closeTrade('BTCUSDT', trade, exitPrice, 'SL_HIT', false);

    expect(result.exitOccurred).toBe(true);
    expect(trade.exit_reason).toBe('EXCHANGE_SL_OR_MANUAL');

    // Fee simulation: 0.04% of (49500 * 0.1) = 1.98
    // Total fee = 2.0 + 1.98 = 3.98
    expect(trade.realized_fee).toBe(3.98);

    // PnL calculation: (49500 - 50000) * 0.1 - 3.98 = -50 - 3.98 = -53.98
    expect(trade.pnl).toBe(-53.98);
  });

  it('uses paperMode parameter for fee simulation in catch block', async () => {
    // Set service to LIVE mode globally
    service.setBinanceClient(mockBinanceClient, false);

    const trade = {
      symbol: 'BTCUSDT',
      direction: 'LONG',
      qty: 0.1,
      entry_price: 50000,
      realized_fee: 0,
      status: 'OPEN'
    } as Trade;

    const exitPrice = 51000;

    // Simulate failure in live mode but passing paperMode=true to closeTrade
    mockBinanceClient.restAPI.tradeApi.newOrder.mockRejectedValue(new Error('API Error'));

    const result = await service.closeTrade('BTCUSDT', trade, exitPrice, 'MANUAL_CLOSE', true);

    expect(result.exitOccurred).toBe(true);
    // Fee should be simulated because paperMode=true was passed
    expect(trade.realized_fee).toBe(roundEight(51000 * 0.1 * 0.0004));
  });
});
