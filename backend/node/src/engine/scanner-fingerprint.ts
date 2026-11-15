import { roundTo } from '../lib/math';

function signalFingerprint(signalResult: any): any {
  if (!signalResult || typeof signalResult !== 'object') return null;

  const details = signalResult.details || signalResult.signals || {};
  const signalDetails = Object.keys(details).sort().map(key => {
    const detail = details[key] || {};
    return [
      key,
      roundTo(Number(detail.value) || 0, 8),
      roundTo(Number(detail.threshold) || 0, 8),
      detail.fired === true,
      detail.active !== false,
      detail.rejected === true,
      detail.insufficientData === true,
      detail.status || '',
      detail.description || '',
    ];
  });

  return [
    signalResult.allFired === true,
    signalResult.firedSignals || [],
    signalResult.reason || '',
    signalDetails,
  ];
}

/** Compact representation of fields that can visibly change scanner and rule widgets. */
export function scannerResultsFingerprint(results: any[]): string {
  return JSON.stringify(results.map(result => [
    result.symbol,
    result.direction,
    roundTo(Number(result.score) || 0, 2),
    roundTo(Number(result.price) || 0, 8),
    roundTo(Number(result.pct ?? result.momentum) || 0, 4),
    signalFingerprint(result.signalResult),
    result.breakout_rank || null,
  ]));
}
