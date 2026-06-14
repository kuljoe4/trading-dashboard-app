import { OrderManagerService } from './orderManager';
import { roundEight, floorStep } from '../lib/math';

describe('Industry Fixes Verification', () => {
  describe('Financial Precision (math.ts)', () => {
    it('correctly rounds to 8 decimal places using roundEight', () => {
      expect(roundEight(0.1 + 0.2)).toBe(0.30000000);
      expect(roundEight(1.000000005)).toBe(1.00000001);
      expect(roundEight(1.000000004)).toBe(1.00000000);
      expect(roundEight(0)).toBe(0);
    });

    it('correctly floors to step size using floorStep', () => {
      expect(floorStep(1.234567, 0.01)).toBe(1.23);
      expect(floorStep(100.9, 1)).toBe(100);
      expect(floorStep(0.000789, 0.0001)).toBe(0.0007);
    });
  });

  describe('Exchange Filter Compliance (orderManager.ts)', () => {
    let orderManager: OrderManagerService;
    let mockSignalEngine: any;
    let mockMarketFeed: any;

    beforeEach(() => {
      mockSignalEngine = {};
      mockMarketFeed = {
        getSymbolFilters: jest.fn().mockReturnValue({
          _indexed: { tickSize: 0.1, stepSize: 0.01, minNotional: 0, multiplierUp: 1.1, multiplierDown: 0.9, pricePrecision: 1, qtyPrecision: 2 }, filters: [
            { filterType: 'PRICE_FILTER', tickSize: '0.1' },
            { filterType: 'LOT_SIZE', stepSize: '0.01' }
          ]
        })
      };
      orderManager = new OrderManagerService(
        mockSignalEngine,
        mockMarketFeed,
        null as any, // tickerCache
        { isRateLimited: () => false } as any, // sessionState
        { log: jest.fn() } as any, // auditLog
        { emit: jest.fn() } as any, // eventEmitter
      );
    });

    it('applies PRICE_FILTER and LOT_SIZE during trade entry', async () => {
      const result = await orderManager.enter(
        'session-1',
        'BTCUSDT',
        'LONG',
        50000.123, // Should round to 50000.1 (tick 0.1)
        0.12345,   // Should floor to 0.12 (step 0.01)
        49000.55,  // Should round to 49000.6 (tick 0.1)
        51000.77   // Should round to 51000.8 (tick 0.1)
      );

      const trade = result.data;
      expect(trade?.entry_price).toBe(50000.1);
      expect(trade?.qty).toBe(0.12);
      expect(trade?.initial_sl).toBe(49000.6);
      expect(trade?.tp).toBe(51000.8);
    });

    it('handles symbols with no filter data gracefully', async () => {
      mockMarketFeed.getSymbolFilters.mockReturnValue(null);

      const result = await orderManager.enter(
        'session-1',
        'UNKNOWN',
        'LONG',
        1.23456,
        0.1,
        1.0,
        2.0
      );

      expect(result.data?.entry_price).toBe(1.23456);
    });
  });
});
