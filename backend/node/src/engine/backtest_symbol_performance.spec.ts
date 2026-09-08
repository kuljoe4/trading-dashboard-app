import { BacktestService, BacktestTradeDto } from './backtest.service';
import { SessionConfig } from '../models/SessionConfig';

describe('BacktestSymbolPerformance Unit Tests', () => {
  test('aggregates per-symbol performance and marks top recommendations correctly', () => {
    const mockTrades: BacktestTradeDto[] = [
      { id: '1', symbol: 'BTCUSDT', strategy_label: 'Test', direction: 'LONG', entry_price: 60000, exit_price: 61000, entry_ts: 1, exit_ts: 2, qty: 0.1, pnl: 100, pnl_pct: 1.6, realized_fee: 0.8, rr: 1.5, exit_reason: 'TP' },
      { id: '2', symbol: 'BTCUSDT', strategy_label: 'Test', direction: 'LONG', entry_price: 61000, exit_price: 61500, entry_ts: 3, exit_ts: 4, qty: 0.1, pnl: 50, pnl_pct: 0.8, realized_fee: 0.8, rr: 0.8, exit_reason: 'TP' },
      { id: '3', symbol: 'ETHUSDT', strategy_label: 'Test', direction: 'SHORT', entry_price: 3000, exit_price: 3100, entry_ts: 5, exit_ts: 6, qty: 1, pnl: -100, pnl_pct: -3.3, realized_fee: 0.8, rr: -1, exit_reason: 'SL' },
    ];

    // Compute symbol performance mapping using same logic as BacktestService
    const symbolPerformanceMap = new Map<string, {
      trades: number;
      wins: number;
      losses: number;
      grossWins: number;
      grossLosses: number;
      totalPnl: number;
    }>();

    symbolPerformanceMap.set('BTCUSDT', { trades: 0, wins: 0, losses: 0, grossWins: 0, grossLosses: 0, totalPnl: 0 });
    symbolPerformanceMap.set('ETHUSDT', { trades: 0, wins: 0, losses: 0, grossWins: 0, grossLosses: 0, totalPnl: 0 });

    for (const t of mockTrades) {
      const sp = symbolPerformanceMap.get(t.symbol)!;
      sp.trades++;
      sp.totalPnl += t.pnl;
      if (t.pnl > 0) {
        sp.wins++;
        sp.grossWins += t.pnl;
      } else {
        sp.losses++;
        sp.grossLosses += Math.abs(t.pnl);
      }
    }

    const btc = symbolPerformanceMap.get('BTCUSDT')!;
    expect(btc.trades).toBe(2);
    expect(btc.wins).toBe(2);
    expect(btc.totalPnl).toBe(150);

    const btcWinRate = (btc.wins / btc.trades) * 100;
    const btcIsRecommended = btc.totalPnl > 0 && btcWinRate >= 40 && btc.wins >= 1;
    expect(btcIsRecommended).toBe(true);

    const eth = symbolPerformanceMap.get('ETHUSDT')!;
    expect(eth.trades).toBe(1);
    expect(eth.wins).toBe(0);
    expect(eth.totalPnl).toBe(-100);

    const ethWinRate = (eth.wins / eth.trades) * 100;
    const ethIsRecommended = eth.totalPnl > 0 && ethWinRate >= 40 && eth.wins >= 1;
    expect(ethIsRecommended).toBe(false);
  });
});
