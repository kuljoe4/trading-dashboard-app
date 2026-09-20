import test from 'node:test';
import assert from 'node:assert';
import { calculateProximity } from '../lib/formatters.js';

test('Card and Modal Proximity Alignment Tests', async (t) => {
  await t.test('ActiveTradeCard fallback and backend estimation proximity resolution', () => {
    const tradeWithBackendEst = {
      symbol: 'BTCUSDT',
      direction: 'LONG',
      entry_price: 100,
      current_price: 102,
      qty: 1,
      exit_estimation: {
        proximity: 78,
        selectedSignalKey: 'ema_dual_cross',
        signalEstimations: {
          ema_dual_cross: {
            proximity: 78,
            signalType: 'ema_dual_cross',
            state: 'approaching'
          }
        }
      },
      exit_signals_status: {
        ema_dual_cross: {
          fired: false,
          active: false,
          value: 101.2,
          threshold: 101.8,
          threshold_is_price: true
        }
      }
    };

    // Card proximity logic:
    const cardProximity = tradeWithBackendEst.exit_estimation?.proximity;
    assert.strictEqual(cardProximity, 78);

    // Modal signal proximity logic:
    const sigKey = 'ema_dual_cross';
    const sigEst = tradeWithBackendEst.exit_estimation?.signalEstimations?.[sigKey];
    const modalSignalProximity = (sigEst && typeof sigEst.proximity === 'number')
      ? sigEst.proximity
      : calculateProximity(tradeWithBackendEst.exit_signals_status[sigKey], 102, 100, true, true);

    assert.strictEqual(modalSignalProximity, 78);
    assert.strictEqual(cardProximity, modalSignalProximity, 'Card and Modal proximity must be equal when backend estimation exists');
  });

  await t.test('Modal falls back gracefully to calculateProximity when exit_estimation is missing', () => {
    const tradeWithoutBackendEst = {
      symbol: 'ETHUSDT',
      direction: 'LONG',
      entry_price: 3000,
      current_price: 3050,
      qty: 1,
      exit_signals_status: {
        ema_cross: {
          fired: false,
          active: false,
          value: 3040,
          threshold: 3050,
          threshold_is_price: true
        }
      }
    };

    const sigKey = 'ema_cross';
    const sigEst = tradeWithoutBackendEst.exit_estimation?.signalEstimations?.[sigKey];
    const modalSignalProximity = (sigEst && typeof sigEst.proximity === 'number')
      ? sigEst.proximity
      : calculateProximity(tradeWithoutBackendEst.exit_signals_status[sigKey], 3050, 3000, true, true);

    assert.strictEqual(modalSignalProximity > 0, true);
    assert.strictEqual(sigEst, undefined);
  });
});
