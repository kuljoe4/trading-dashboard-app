import { rankByBreakoutOpportunity } from './breakout-ranking';
describe('breakout opportunity ranking', () => {
    const config = {
        enabled_signals: ['htf_breakout', 'ema_dual'],
    };
    const opportunity = (symbol, score, value, expansionPct) => ({
        symbol,
        score,
        signalResult: {
            details: {
                htf_breakout: {
                    fired: expansionPct >= 0 && expansionPct <= 2,
                    value,
                    threshold: 100,
                    expansion_pct: expansionPct,
                    max_expansion_pct: 2,
                },
            },
        },
    });
    it('puts within-cap candidates first, nearest approaching candidates next, and past-cap candidates last', () => {
        const ranked = rankByBreakoutOpportunity([
            opportunity('PAST', 99, 106, 6),
            opportunity('FAR', 95, 97, -3),
            opportunity('NEAR', 80, 99.5, -0.5),
            opportunity('IN_CAP', 70, 100.4, 0.4),
        ], config);
        expect(ranked.map(item => item.symbol)).toEqual(['IN_CAP', 'NEAR', 'FAR', 'PAST']);
        expect(ranked[0].breakout_rank?.cap_room_pct).toBeCloseTo(1.6);
        expect(ranked[3].breakout_rank?.status).toBe('past_cap');
    });
    it('keeps composite-score ordering when no breakout expansion cap applies', () => {
        const ranked = rankByBreakoutOpportunity([
            { symbol: 'LOW', score: 60 },
            { symbol: 'HIGH', score: 90 },
        ], { enabled_signals: ['ema_dual'] });
        expect(ranked.map(item => item.symbol)).toEqual(['HIGH', 'LOW']);
    });
});
