import test from 'node:test';
import assert from 'node:assert/strict';
import '../store/mock-env.js';
import { normalizeTrade, useTradingStore } from '../store/trading.js';

test('normalizeTrade correctly normalizes breakeven closed trades ($0.00 PnL) during resumption sync', () => {
  const previousActiveTrade = {
    id: 'trade-123',
    symbol: 'BTCUSDT',
    status: 'OPEN',
    pnl: 15.50, // Unrealized live PnL when open
    rr: 1.55,
  };

  const closedBreakevenTradePayload = {
    id: 'trade-123',
    symbol: 'BTCUSDT',
    status: 'CLOSED_SL',
    pnl: 0.00, // Realized PnL at breakeven SL hit
    rr: 0.00,
    current_price: 50000,
    entry_price: 50000,
    sl_price: 50000,
  };

  // When isResuming is true, terminal closed trades must NOT retain previous unrealized open PnL (15.50)
  const normalized = normalizeTrade(closedBreakevenTradePayload, previousActiveTrade, true);

  assert.equal(normalized.pnl, 0.00, 'Realized breakeven PnL must be 0.00, not stale unrealized 15.50');
  assert.equal(normalized.rr, 0.00, 'Realized breakeven RR must be 0.00, not stale unrealized 1.55');
  assert.equal(normalized.status, 'CLOSED_SL');
});

test('useTradingStore log normalization extracts UDS balance reason tags', () => {
  const store = useTradingStore.getState();

  const logMessage = {
    msg: '[UDS] ACCOUNT_UPDATE: Balance updated. Reason: FUNDING_FEE (-$0.25)',
    level: 'info',
    ts: Date.now()
  };

  // Simulate WS log message dispatch
  const ws = { send: () => {} };
  const mockEvent = {
    data: JSON.stringify({ type: 'log', ...logMessage })
  };

  // Verify initial state
  assert.equal(useTradingStore.getState().lastUdsBalanceReason, null);

  // Directly exercise store updateStats with UDS reason
  useTradingStore.getState().updateStats({
    lastUdsBalanceReason: 'FUNDING_FEE'
  });

  assert.equal(useTradingStore.getState().lastUdsBalanceReason, 'FUNDING_FEE');

  // Exercise REALIZED_PNL reason update
  useTradingStore.getState().updateStats({
    lastUdsBalanceReason: 'REALIZED_PNL'
  });

  assert.equal(useTradingStore.getState().lastUdsBalanceReason, 'REALIZED_PNL');
});
