import { SessionConfig } from '../models/SessionConfig';

export type BreakoutRankStatus = 'within_cap' | 'approaching' | 'past_cap';

export interface BreakoutRank {
  status: BreakoutRankStatus;
  distance_to_target_pct: number;
  expansion_pct: number;
  cap_pct: number;
  cap_room_pct: number;
}

interface RankedOpportunity {
  score: number;
  signalResult?: {
    details?: Record<string, any>;
  };
  breakout_rank?: BreakoutRank;
}

function getBreakoutRank(opportunity: RankedOpportunity, config: SessionConfig): BreakoutRank | undefined {
  const enabledSignals = config.enabled_signals || [];
  const breakoutSignal = enabledSignals.find(signal =>
    signal === 'htf_breakout' ||
    signal.startsWith('htf_breakout_') ||
    signal === 'prev_day_breakout' ||
    signal.startsWith('prev_day_breakout_')
  );
  if (!breakoutSignal) return undefined;

  const detail = opportunity.signalResult?.details?.[breakoutSignal];
  const value = Number(detail?.value);
  const threshold = Number(detail?.threshold);
  const expansionPct = Number(detail?.expansion_pct);
  const effCapPct = Number(detail?.effective_max_expansion_pct);
  const rawCapPct = Number(detail?.max_expansion_pct);
  const capPct = Number.isFinite(effCapPct) && effCapPct > 0 ? effCapPct : rawCapPct;

  if (
    detail?.insufficientData ||
    !Number.isFinite(value) ||
    !Number.isFinite(threshold) ||
    threshold <= 0 ||
    !Number.isFinite(expansionPct) ||
    !Number.isFinite(capPct) ||
    capPct <= 0
  ) {
    return undefined;
  }

  const distanceToTargetPct = Math.abs(value - threshold) / threshold * 100;
  const pastCap = detail?.rejected === true || expansionPct > capPct;
  const withinCap = detail?.fired === true && !pastCap;

  return {
    status: pastCap ? 'past_cap' : withinCap ? 'within_cap' : 'approaching',
    distance_to_target_pct: distanceToTargetPct,
    expansion_pct: expansionPct,
    cap_pct: capPct,
    cap_room_pct: Math.max(0, capPct - Math.max(0, expansionPct)),
  };
}

function rankGroup(rank?: BreakoutRank): number {
  if (!rank) return 1;
  if (rank.status === 'within_cap') return 2;
  if (rank.status === 'past_cap') return 0;
  return 1;
}

/**
 * Prioritizes actionable HTF breakouts without changing the scanner's composite score.
 * Within-cap candidates come first, approaching candidates are ordered by proximity,
 * and candidates beyond the configured expansion cap move to the bottom.
 */
export function rankByBreakoutOpportunity<T extends RankedOpportunity>(
  opportunities: T[],
  config: SessionConfig,
): Array<T & { breakout_rank?: BreakoutRank }> {
  const ranked = opportunities.map(opportunity => {
    const breakoutRank = getBreakoutRank(opportunity, config);
    return breakoutRank ? { ...opportunity, breakout_rank: breakoutRank } : opportunity;
  });

  ranked.sort((left, right) => {
    const groupDifference = rankGroup(right.breakout_rank) - rankGroup(left.breakout_rank);
    if (groupDifference !== 0) return groupDifference;

    const leftRank = left.breakout_rank;
    const rightRank = right.breakout_rank;
    if (leftRank && rightRank) {
      const distanceDifference = leftRank.distance_to_target_pct - rightRank.distance_to_target_pct;
      if (Math.abs(distanceDifference) > 1e-9) return distanceDifference;
    }

    return right.score - left.score;
  });

  return ranked as Array<T & { breakout_rank?: BreakoutRank }>;
}
