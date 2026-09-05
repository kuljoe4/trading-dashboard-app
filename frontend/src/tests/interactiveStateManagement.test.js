import test from 'node:test';
import assert from 'node:assert';

test('Strategy Pause/Resume State Management & Race Condition Guards', async (t) => {
  await t.test('prevents duplicate pause toggle requests while request is in flight', () => {
    const pausingMap = {};
    const key = 'Momentum Strategy';

    const triggerPause = (strategyLabel) => {
      const targetKey = strategyLabel || '__session__';
      if (pausingMap[targetKey]) {
        return { dispatched: false, reason: 'in_flight' };
      }
      pausingMap[targetKey] = true;
      return { dispatched: true, targetKey };
    };

    const first = triggerPause(key);
    assert.strictEqual(first.dispatched, true);
    assert.strictEqual(pausingMap[key], true);

    const second = triggerPause(key);
    assert.strictEqual(second.dispatched, false);
    assert.strictEqual(second.reason, 'in_flight');

    delete pausingMap[key];
    const third = triggerPause(key);
    assert.strictEqual(third.dispatched, true);
  });

  await t.test('computes WCAG accessibility and spinner attributes when isPausing is active', () => {
    const isPausing = true;
    const paused = false;

    const buttonProps = {
      disabled: isPausing,
      'aria-busy': isPausing,
      'aria-disabled': isPausing,
      'aria-label': isPausing ? (paused ? "Resuming Strategy Engine" : "Pausing Strategy Engine") : (paused ? "Resume Strategy Engine" : "Pause Strategy Engine"),
      className: isPausing ? "cursor-wait opacity-60 text-dim" : "cursor-pointer"
    };

    assert.strictEqual(buttonProps.disabled, true);
    assert.strictEqual(buttonProps['aria-busy'], true);
    assert.strictEqual(buttonProps['aria-disabled'], true);
    assert.strictEqual(buttonProps['aria-label'], 'Pausing Strategy Engine');
    assert.strictEqual(buttonProps.className.includes('cursor-wait'), true);
  });
});

test('RR Milestone Copy/Paste Format Parser', async (t) => {
  await t.test('parses arrow format "1 -> 0\\n2 -> 1\\n4 -> 2"', () => {
    const rawInput = "1 -> 0\n2 -> 1\n4 -> 2";
    const lines = rawInput.split(/[\r\n]+/);
    const parsedPairs = [];

    lines.forEach(line => {
      const trimmed = line.trim();
      if (!trimmed) return;
      if (trimmed.includes('->') || trimmed.includes(':') || trimmed.includes(',')) {
        const parts = trimmed.split(/->|:|,/);
        const trig = parseFloat(parts[0]);
        const ex = parseFloat(parts[1] ?? '0');
        if (!isNaN(trig)) {
          parsedPairs.push({ trigger: trig, exit: isNaN(ex) ? 0 : ex });
        }
      }
    });

    parsedPairs.sort((a, b) => a.trigger - b.trigger);

    assert.strictEqual(parsedPairs.length, 3);
    assert.deepStrictEqual(parsedPairs[0], { trigger: 1, exit: 0 });
    assert.deepStrictEqual(parsedPairs[1], { trigger: 2, exit: 1 });
    assert.deepStrictEqual(parsedPairs[2], { trigger: 4, exit: 2 });
  });

  await t.test('parses comma-separated values "1, 2, 4"', () => {
    const rawInput = "1, 2, 4";
    const lines = rawInput.split(/[\r\n]+/);
    const parsedPairs = [];

    lines.forEach(line => {
      const trimmed = line.trim();
      if (!trimmed) return;
      const parts = trimmed.split(',');
      parts.forEach(p => {
        const val = parseFloat(p.trim());
        if (!isNaN(val)) {
          parsedPairs.push({ trigger: val, exit: Math.max(0, val - 1) });
        }
      });
    });

    parsedPairs.sort((a, b) => a.trigger - b.trigger);

    assert.strictEqual(parsedPairs.length, 3);
    assert.deepStrictEqual(parsedPairs[0], { trigger: 1, exit: 0 });
    assert.deepStrictEqual(parsedPairs[1], { trigger: 2, exit: 1 });
    assert.deepStrictEqual(parsedPairs[2], { trigger: 4, exit: 3 });
  });
});

test('Trade Liquidation Closing Map Race Condition Guard', async (t) => {
  await t.test('prevents concurrent closeTrade requests for the same symbol', () => {
    const closingMap = {};
    const symbol = 'BTCUSDT';

    const requestClose = (sym) => {
      if (closingMap[sym]) return { allowed: false };
      closingMap[sym] = true;
      return { allowed: true };
    };

    assert.strictEqual(requestClose(symbol).allowed, true);
    assert.strictEqual(requestClose(symbol).allowed, false);

    delete closingMap[symbol];
    assert.strictEqual(requestClose(symbol).allowed, true);
  });
});
