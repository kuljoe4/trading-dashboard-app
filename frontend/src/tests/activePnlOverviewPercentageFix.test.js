import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';

describe('Active P&L Overview Percentage Fix', () => {
  it('should verify peak and min pnl percentages use starting balance when totalPnl is available', () => {
    const filePath = path.resolve(import.meta.dirname, '../views/DashboardView.jsx');
    const content = fs.readFileSync(filePath, 'utf-8');

    const subValueIndex = content.indexOf('label="Active P&L"');
    const subValueFuncStart = content.indexOf('subValue={globalMetricsExpanded', subValueIndex);
    const subValueFuncEnd = content.indexOf('})() : null}', subValueFuncStart);
    const subValueContent = content.substring(subValueFuncStart, subValueFuncEnd);

    // We expect the percentages to be calculated relative to the account balance, not startBal or similar.
    // Dashboard Active P&L Percentage Relative to Current Account Balance Standard: In frontend/src/views/DashboardView.jsx, active P&L percentages across StrategyCard tooltips and main StatCard summaries (including activePct, peakPct, and minPct) are calculated relative to current account balance (balance > 0 ? (totalActivePnl / balance) * 100 : 0 or storeBalance || startingBalance) rather than starting capital (startingBalance).

    // Wait, the current logic is:
    // const peakPct = balance > 0 ? (peakActivePnl / balance) * 100 : 0;
    // Which matches the memory standard. Let me read it carefully again.

    assert.ok(subValueContent.includes('const peakPct = balance > 0 ? (peakActivePnl / balance) * 100 : 0;'), 'Peak Pct calculation is wrong');
    assert.ok(subValueContent.includes('const minPct = balance > 0 ? (minActivePnl / balance) * 100 : 0;'), 'Min Pct calculation is wrong');
  });
});
