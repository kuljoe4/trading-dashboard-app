import test from 'node:test';
import assert from 'node:assert/strict';
import { belongsToSignal } from '../utils/signalIdentity.js';

test('named EMA signals remain independent when removing numeric layers', () => {
  const signals = ['ema_dual', 'ema_dual_2', 'ema_dual_cross', 'ema_dual_cross_2', 'ema_dual_close'];
  assert.deepEqual(signals.filter(key => !belongsToSignal(key, 'ema_dual')), ['ema_dual_cross', 'ema_dual_cross_2', 'ema_dual_close']);
  assert.equal(belongsToSignal('ema_dual_cross_2', 'ema_dual_cross'), true);
});
