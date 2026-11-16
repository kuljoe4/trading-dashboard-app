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
      detail.live_price !== undefined ? roundTo(Number(detail.live_price) || 0, 8) : null,
      detail.closed_value !== undefined ? roundTo(Number(detail.closed_value) || 0, 8) : null,
      detail.ref_high !== undefined ? roundTo(Number(detail.ref_high) || 0, 8) : null,
      detail.ref_low !== undefined ? roundTo(Number(detail.ref_low) || 0, 8) : null,
      detail.breakout_level !== undefined ? roundTo(Number(detail.breakout_level) || 0, 8) : null,
      detail.expansion_cap !== undefined ? roundTo(Number(detail.expansion_cap) || 0, 8) : null,
      detail.candle_confirm_state || '',
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
  return JSON.stringify((results || []).map(result => [
    result.symbol,
    result.direction,
    roundTo(Number(result.score) || 0, 2),
    roundTo(Number(result.price) || 0, 8),
    roundTo(Number(result.pct ?? result.momentum) || 0, 4),
    signalFingerprint(result.signalResult),
    result.breakout_rank || null,
  ]));
}

export function scannerVariantsFingerprint(variants: any[]): string {
  if (!Array.isArray(variants) || variants.length === 0) return '[]';
  return JSON.stringify(variants.map(v => [
    v?.strategy_label || 'Momentum Strategy',
    scannerResultsFingerprint(Array.isArray(v?.opportunities) ? v.opportunities : []),
  ]));
}

