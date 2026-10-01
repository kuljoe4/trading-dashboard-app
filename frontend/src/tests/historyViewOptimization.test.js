import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const historyViewContent = fs.readFileSync(path.join(__dirname, '../views/HistoryView.jsx'), 'utf-8');

test('HistoryView Optimization - sessionTopWins and sessionTopLosses bounded insertion sort check', () => {
    assert.ok(historyViewContent.includes('while (j < winsArr.length && pnlVal <= winsArr[j].pnlVal) j++;'), 'Bounded insertion sort for winsArr missing');
    assert.ok(historyViewContent.includes('while (j < lossesArr.length && pnlVal >= lossesArr[j].pnlVal) j++;'), 'Bounded insertion sort for lossesArr missing');
    assert.ok(!historyViewContent.includes('winsArr.sort((a, b) => safeNum(b.pnl) - safeNum(a.pnl));'), 'O(N log N) winsArr sort still present');
    assert.ok(!historyViewContent.includes('lossesArr.sort((a, b) => safeNum(a.pnl) - safeNum(b.pnl));'), 'O(N log N) lossesArr sort still present');
});

test('HistoryView Optimization - topWins and topLosses bounded insertion sort check', () => {
    assert.ok(historyViewContent.includes('while (j < wins.length && pnlVal <= wins[j].pnlVal) j++;'), 'Bounded insertion sort for wins missing');
    assert.ok(historyViewContent.includes('while (j < losses.length && pnlVal >= losses[j].pnlVal) j++;'), 'Bounded insertion sort for losses missing');
    assert.ok(!historyViewContent.includes('wins.sort((a, b) => safeNum(b.pnl) - safeNum(a.pnl));'), 'O(N log N) wins sort still present');
    assert.ok(!historyViewContent.includes('losses.sort((a, b) => safeNum(a.pnl) - safeNum(b.pnl));'), 'O(N log N) losses sort still present');
});

test('HistoryView UX - General Overview Card structure updated', () => {
    assert.ok(historyViewContent.includes('bg-surface/50 p-2.5 rounded-lg border border-border/30 group hover:border-accent/30 transition-colors'), 'Session UUID structure missing');
    assert.ok(historyViewContent.includes('F: {fmtUSD(-sessionFees)}'), 'Fees abbreviation structure missing');
    assert.ok(historyViewContent.includes('FD: {fmtUSD(-sessionFunding)}'), 'Funding abbreviation structure missing');
});
