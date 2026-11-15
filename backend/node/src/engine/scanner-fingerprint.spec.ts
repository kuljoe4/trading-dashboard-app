import { scannerResultsFingerprint } from './scanner-fingerprint';

describe('scanner results fingerprint', () => {
  const result = (value: number, threshold = 100) => [{
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

  it('ignores numeric noise below displayed precision', () => {
    expect(scannerResultsFingerprint(result(99))).toBe(scannerResultsFingerprint(result(99.000000001)));
  });
});
