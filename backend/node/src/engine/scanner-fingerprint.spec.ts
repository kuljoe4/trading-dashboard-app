import { scannerResultsFingerprint, scannerVariantsFingerprint } from './scanner-fingerprint';

describe('scanner results fingerprint', () => {
  const result = (value: number, threshold = 100, extra: Record<string, any> = {}) => [{
    symbol: 'BTCUSDT',
    direction: 'LONG',
    score: 90,
    price: 99,
    momentum: 2,
    signalResult: {
      allFired: false,
      firedSignals: [],
      details: {
        htf_breakout: {
          value,
          threshold,
          fired: false,
          description: 'Monitoring target',
          ...extra,
        },
      },
    },
  }];

  it('changes when a displayed condition value changes', () => {
    expect(scannerResultsFingerprint(result(99))).not.toBe(scannerResultsFingerprint(result(99.1)));
  });

  it('changes when a displayed condition threshold changes', () => {
    expect(scannerResultsFingerprint(result(99, 100))).not.toBe(scannerResultsFingerprint(result(99, 101)));
  });

  it('changes when live_price or closed_value or ref_high changes on a condition widget', () => {
    expect(scannerResultsFingerprint(result(99, 100, { live_price: 99.1 }))).not.toBe(
      scannerResultsFingerprint(result(99, 100, { live_price: 99.5 })),
    );
    expect(scannerResultsFingerprint(result(99, 100, { closed_value: 98.8 }))).not.toBe(
      scannerResultsFingerprint(result(99, 100, { closed_value: 99.0 })),
    );
  });

  it('changes when variant opportunities change via scannerVariantsFingerprint', () => {
    const v1 = [{ strategy_label: 'Variant A', opportunities: result(99, 100) }];
    const v2 = [{ strategy_label: 'Variant A', opportunities: result(99.4, 100) }];
    expect(scannerVariantsFingerprint(v1)).not.toBe(scannerVariantsFingerprint(v2));
  });

  it('ignores numeric noise below displayed precision', () => {
    expect(scannerResultsFingerprint(result(99))).toBe(scannerResultsFingerprint(result(99.000000001)));
  });
});

