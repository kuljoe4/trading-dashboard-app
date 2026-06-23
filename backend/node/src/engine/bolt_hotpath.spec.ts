import { PositionTrackerService } from './positionTracker';
import { OrderManagerService } from './orderManager';
import { Trade } from '../models/Trade';

describe('Bolt Optimizations: Hot-Path Performance', () => {
  let positionTracker: PositionTrackerService;

  beforeEach(() => {
    positionTracker = new PositionTrackerService(
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      { emit: jest.fn() } as any
    );
  });

  describe('PositionTrackerService.activeList() Cache', () => {
    it('should return the same array instance if no changes occurred', () => {
      const trade1 = { symbol: 'BTCUSDT', risk_usdt: 10 } as Trade;
      positionTracker.addTrade(trade1);

      const list1 = positionTracker.activeList();
      const list2 = positionTracker.activeList();

      expect(list1).toBe(list2); // Same instance (cached)
      expect(list1).toHaveLength(1);
    });

    it('should invalidate cache when a trade is added', () => {
      const trade1 = { symbol: 'BTCUSDT', risk_usdt: 10 } as Trade;
      positionTracker.addTrade(trade1);
      const list1 = positionTracker.activeList();

      const trade2 = { symbol: 'ETHUSDT', risk_usdt: 5 } as Trade;
      positionTracker.addTrade(trade2);
      const list2 = positionTracker.activeList();

      expect(list1).not.toBe(list2);
      expect(list2).toHaveLength(2);
    });

    it('should invalidate cache when a trade is removed', () => {
      const trade1 = { symbol: 'BTCUSDT', risk_usdt: 10 } as Trade;
      positionTracker.addTrade(trade1);
      const list1 = positionTracker.activeList();

      positionTracker.removeTrade('BTCUSDT');
      const list2 = positionTracker.activeList();

      expect(list1).not.toBe(list2);
      expect(list2).toHaveLength(0);
    });
  });

  describe('OrderManagerService.checkExitSignals Optimization', () => {
    let orderManager: OrderManagerService;
    let signalEngine: any;

    beforeEach(() => {
      signalEngine = {
        checkEntry: jest.fn().mockReturnValue({
          allFired: true,
          details: {
            signal1: { fired: true, metric: 'M1', value: 1.5, threshold: 1, unit: '%' }
          }
        })
      };

      orderManager = new OrderManagerService(
        signalEngine,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        { emit: jest.fn() } as any
      );
    });

    it('should call signalEngine.checkEntry exactly once for multiple exit signals', () => {
      const trade = {
        symbol: 'BTCUSDT',
        entry_ts: new Date(Date.now() - 10000), // 10s ago
        direction: 'LONG'
      } as Trade;

      const config = {
        exit_signals: ['signal1', 'signal2'],
        exit_signal_delays: { signal1: 5, signal2: 20 },
        exit_signal_logic: 'any'
      } as any;

      // Mock return with details for both signals
      signalEngine.checkEntry.mockReturnValue({
        allFired: true,
        details: {
          signal1: { fired: true, metric: 'M1' },
          signal2: { fired: true, metric: 'M2' }
        }
      });

      const result = orderManager.checkExitSignals('BTCUSDT', trade, config);

      expect(signalEngine.checkEntry).toHaveBeenCalledTimes(1);
      expect(signalEngine.checkEntry).toHaveBeenCalledWith(
        'BTCUSDT',
        expect.objectContaining({ enabled_signals: ['signal1', 'signal2'] }),
        '1m',
        'LONG',
        'exit'
      );

      // signal1 should be active (10s > 5s delay), signal2 should NOT (10s < 20s delay)
      expect(trade.exit_signals_status?.signal1.active).toBe(true);
      expect(trade.exit_signals_status?.signal2.active).toBe(false);

      // Only signal1 is both fired and active
      expect(result.exitTriggered).toBe(true);
      expect(result.exitSignalType).toBe('signal1');
    });

    it('should correctly handle "all" logic with delays', () => {
        const trade = {
          symbol: 'BTCUSDT',
          entry_ts: new Date(Date.now() - 15000), // 15s ago
          direction: 'LONG'
        } as Trade;

        const config = {
          exit_signals: ['signal1', 'signal2'],
          exit_signal_delays: { signal1: 5, signal2: 20 },
          exit_signal_logic: 'all'
        } as any;

        signalEngine.checkEntry.mockReturnValue({
          allFired: true,
          details: {
            signal1: { fired: true },
            signal2: { fired: true }
          }
        });

        const result = orderManager.checkExitSignals('BTCUSDT', trade, config);

        // 15s < 20s delay for signal2, so not all are active
        expect(result.exitTriggered).toBe(false);

        // Advance time in tradeAgeSec
        trade.entry_ts = new Date(Date.now() - 25000); // 25s ago
        const result2 = orderManager.checkExitSignals('BTCUSDT', trade, config);
        expect(result2.exitTriggered).toBe(true);
        expect(result2.exitSignalType).toBe('combined');
      });
  });

  describe('Trade._sig_json Caching', () => {
    it('should store stringified signals in _sig_json', () => {
      const trade = new Trade();
      trade.exit_signals_status = { signal1: { fired: true } } as any;
      trade._sig_json = JSON.stringify(trade.exit_signals_status);

      expect(trade._sig_json).toBe('{"signal1":{"fired":true}}');
    });
  });
});
