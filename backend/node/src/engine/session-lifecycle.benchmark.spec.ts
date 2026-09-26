import { SessionStateService } from './session_state.service';
import { Trade } from '../models/Trade';

describe('SessionLifecycleService Benchmark', () => {
  it('measures executeSyncClose overhead', () => {
    const sessionState = new SessionStateService(null as any);

    // Setup 1000 dummy trades
    const trades: Trade[] = [];
    for (let i = 0; i < 1000; i++) {
      trades.push({
        id: `trade-${i}`,
        symbol: `SYMBOL${i}USDT`,
        status: 'OPEN',
      } as Trade);
    }

    // Add target trade near the end
    const targetSymbol = 'TARGETUSDT';
    trades.push({
      id: 'target-trade',
      symbol: targetSymbol,
      status: 'OPEN',
    } as Trade);

    sessionState.activeTrades = trades;

    let totalTime = 0;
    const iterations = 10000;

    for (let i = 0; i < iterations; i++) {
      const start = process.hrtime.bigint();

      // Simulate the O(N) lookup inside executeSyncClose
      const currentTrade = sessionState.activeTrades.find(t => t.symbol === targetSymbol);

      const end = process.hrtime.bigint();
      totalTime += Number(end - start);
    }

    console.log(`[Baseline] Array.find overhead: ${totalTime / 1_000_000} ms for ${iterations} iterations`);

    // Map approach
    const tradeMap = new Map<string, Trade>();
    for (const t of trades) {
      tradeMap.set(t.symbol, t);
    }

    let totalTimeMap = 0;
    for (let i = 0; i < iterations; i++) {
      const start = process.hrtime.bigint();

      // Simulate O(1) map lookup
      const currentTrade = tradeMap.get(targetSymbol);

      const end = process.hrtime.bigint();
      totalTimeMap += Number(end - start);
    }

    console.log(`[Optimized] Map.get overhead: ${totalTimeMap / 1_000_000} ms for ${iterations} iterations`);

    expect(true).toBe(true);
  });
});
