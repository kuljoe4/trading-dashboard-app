import { Test } from '@nestjs/testing';
import { SignalEngineService } from './signalEngine';
import { KlineStoreService } from './kline_store.service';
describe('HTF Breakout / Previous-Day Breakout Signal (PDH / PDL Breakout)', () => {
    let signalEngine;
    let klineStore;
    beforeEach(async () => {
        const module = await Test.createTestingModule({
            providers: [
                SignalEngineService,
                {
                    provide: KlineStoreService,
                    useValue: {
                        getRawCandles: jest.fn(),
                        getLookbackExtremes: jest.fn(),
                    },
                },
            ],
        }).compile();
        signalEngine = module.get(SignalEngineService);
        klineStore = module.get(KlineStoreService);
    });
    // Helper to create test candles
    const makeCandle = (time, open, high, low, close, volume = 1000) => ({
        time, open, high, low, close, volume,
    });
    describe('Core User Scenario: 1h close vs prev 1d high/low', () => {
        // 1-Day candles: Index 0 is previous completed day (High: 50000, Low: 48000), Index 1 is today's active forming candle
        const dailyCandles = [
            makeCandle(1000, 48500, 50000, 48000, 49500), // Prev Day (PDH = 50000, PDL = 48000)
            makeCandle(2000, 49500, 50500, 49000, 50200), // Today's forming candle
        ];
        it('should fire LONG when 1h candle close > prev 1d high', () => {
            const hourlyCandles = [
                makeCandle(1500, 49200, 49800, 49000, 49700),
                makeCandle(1600, 49700, 50300, 49600, 50150), // 1h close (50150) > 50000
            ];
            jest.spyOn(klineStore, 'getRawCandles').mockImplementation((symbol, interval) => {
                if (interval === '1d')
                    return dailyCandles;
                if (interval === '1h')
                    return hourlyCandles;
                return [];
            });
            const config = {
                enabled_signals: ['htf_breakout'],
                signal_params: {
                    htf_breakout_ref_timeframe: '1d',
                    htf_breakout_trigger_timeframe: '1h',
                    htf_breakout_mode: 'close_break',
                },
            };
            const result = signalEngine.checkEntry('BTCUSDT', config, '1h', 'LONG', 'entry', false);
            expect(result.allFired).toBe(true);
            expect(result.firedSignals).toContain('htf_breakout');
            expect(result.details?.htf_breakout.value).toBe(50150);
            expect(result.details?.htf_breakout.threshold).toBe(50000);
            expect(result.details?.htf_breakout.pattern_high).toBe(50000);
            expect(result.details?.htf_breakout.pattern_low).toBe(48000);
            expect(result.details?.htf_breakout.slPrice).toBe(48000);
        });
        it('should NOT fire LONG when 1h candle close <= prev 1d high', () => {
            const hourlyCandles = [
                makeCandle(1500, 49200, 49800, 49000, 49700),
                makeCandle(1600, 49700, 50000, 49500, 49950), // 1h close (49950) <= 50000
            ];
            jest.spyOn(klineStore, 'getRawCandles').mockImplementation((symbol, interval) => {
                if (interval === '1d')
                    return dailyCandles;
                if (interval === '1h')
                    return hourlyCandles;
                return [];
            });
            const config = {
                enabled_signals: ['htf_breakout'],
                signal_params: {
                    htf_breakout_ref_timeframe: '1d',
                    htf_breakout_trigger_timeframe: '1h',
                },
            };
            const result = signalEngine.checkEntry('BTCUSDT', config, '1h', 'LONG', 'entry', false);
            expect(result.allFired).toBe(false);
            expect(result.firedSignals).not.toContain('htf_breakout');
        });
        it('should fire SHORT when 1h candle close < prev 1d low', () => {
            const hourlyCandles = [
                makeCandle(1500, 48500, 48700, 48100, 48200),
                makeCandle(1600, 48200, 48300, 47800, 47900), // 1h close (47900) < 48000
            ];
            jest.spyOn(klineStore, 'getRawCandles').mockImplementation((symbol, interval) => {
                if (interval === '1d')
                    return dailyCandles;
                if (interval === '1h')
                    return hourlyCandles;
                return [];
            });
            const config = {
                enabled_signals: ['htf_breakout'],
                signal_params: {
                    htf_breakout_ref_timeframe: '1d',
                    htf_breakout_trigger_timeframe: '1h',
                },
            };
            const result = signalEngine.checkEntry('BTCUSDT', config, '1h', 'SHORT', 'entry', false);
            expect(result.allFired).toBe(true);
            expect(result.firedSignals).toContain('htf_breakout');
            expect(result.details?.htf_breakout.value).toBe(47900);
            expect(result.details?.htf_breakout.threshold).toBe(48000);
            expect(result.details?.htf_breakout.slPrice).toBe(50000);
        });
        it('should NOT fire SHORT when 1h candle close >= prev 1d low', () => {
            const hourlyCandles = [
                makeCandle(1500, 48500, 48700, 48100, 48200),
                makeCandle(1600, 48200, 48400, 48050, 48100), // 1h close (48100) >= 48000
            ];
            jest.spyOn(klineStore, 'getRawCandles').mockImplementation((symbol, interval) => {
                if (interval === '1d')
                    return dailyCandles;
                if (interval === '1h')
                    return hourlyCandles;
                return [];
            });
            const config = {
                enabled_signals: ['htf_breakout'],
            };
            const result = signalEngine.checkEntry('BTCUSDT', config, '1h', 'SHORT', 'entry', false);
            expect(result.allFired).toBe(false);
        });
    });
    describe('Customizable Parameters & Modes', () => {
        const dailyCandles = [
            makeCandle(1000, 100, 110, 90, 105), // Prev Day (High: 110, Low: 90, Body: 100-105)
            makeCandle(2000, 105, 115, 102, 112), // Today's forming
        ];
        it('should respect buffer_pct filter', () => {
            // With high=110 and buffer_pct=1%, required threshold is 110 * 1.01 = 111.1
            const hourlyCandles = [
                makeCandle(1500, 108, 112, 107, 110.5), // 110.5 > 110 but < 111.1
            ];
            jest.spyOn(klineStore, 'getRawCandles').mockImplementation((s, i) => i === '1d' ? dailyCandles : hourlyCandles);
            const config = {
                enabled_signals: ['htf_breakout'],
                signal_params: {
                    htf_breakout_buffer_pct: 1.0,
                },
            };
            // 110.5 should fail because of 1% buffer
            let res = signalEngine.checkEntry('TESTUSDT', config, '1h', 'LONG', 'entry', false);
            expect(res.allFired).toBe(false);
            // 111.5 should pass (> 111.1)
            hourlyCandles[0].close = 111.5;
            res = signalEngine.checkEntry('TESTUSDT', config, '1h', 'LONG', 'entry', false);
            expect(res.allFired).toBe(true);
        });
        it('should reject overextended entries when max_expansion_pct is set', () => {
            // With high=110 and max_expansion_pct=5%, cap is 110 * 1.05 = 115.5
            const hourlyCandles = [
                makeCandle(1500, 108, 118, 107, 116.0), // 116.0 > 115.5 cap
            ];
            jest.spyOn(klineStore, 'getRawCandles').mockImplementation((s, i) => i === '1d' ? dailyCandles : hourlyCandles);
            const config = {
                enabled_signals: ['htf_breakout'],
                signal_params: {
                    htf_breakout_max_expansion_pct: 5.0,
                },
            };
            const res = signalEngine.checkEntry('TESTUSDT', config, '1h', 'LONG', 'entry', false);
            expect(res.allFired).toBe(false);
            expect(res.details?.htf_breakout.description).toContain('expanded > 5%');
        });
        it('should support closed_candle_confirm mode', () => {
            // closed_candle_confirm looks at candles[length - 2]
            const hourlyCandles = [
                makeCandle(1400, 105, 112, 104, 111), // Completed candle 1: closed above 110
                makeCandle(1500, 111, 113, 109, 108), // Active forming candle: pulled back below 110
            ];
            jest.spyOn(klineStore, 'getRawCandles').mockImplementation((s, i) => i === '1d' ? dailyCandles : hourlyCandles);
            const config = {
                enabled_signals: ['htf_breakout'],
                signal_params: {
                    htf_breakout_mode: 'closed_candle_confirm',
                },
            };
            const res = signalEngine.checkEntry('TESTUSDT', config, '1h', 'LONG', 'entry', false);
            // Fired because completed candle closed at 111 (> 110)
            expect(res.allFired).toBe(true);
            expect(res.details?.htf_breakout.value).toBe(111);
        });
        it('should support wick_break mode', () => {
            const hourlyCandles = [
                makeCandle(1500, 108, 112.5, 107, 109.5), // High wicked to 112.5 (> 110), but close is 109.5 (< 110)
            ];
            jest.spyOn(klineStore, 'getRawCandles').mockImplementation((s, i) => i === '1d' ? dailyCandles : hourlyCandles);
            const config = {
                enabled_signals: ['htf_breakout'],
                signal_params: {
                    htf_breakout_mode: 'wick_break',
                },
            };
            const res = signalEngine.checkEntry('TESTUSDT', config, '1h', 'LONG', 'entry', false);
            expect(res.allFired).toBe(true);
        });
        it('should support open_close_body reference level', () => {
            // Prev day: Open 100, High 110, Low 90, Close 105. Body High = 105.
            const hourlyCandles = [
                makeCandle(1500, 104, 107, 103, 106), // Close 106 > Body High 105 (even though < Wick High 110)
            ];
            jest.spyOn(klineStore, 'getRawCandles').mockImplementation((s, i) => i === '1d' ? dailyCandles : hourlyCandles);
            const config = {
                enabled_signals: ['htf_breakout'],
                signal_params: {
                    htf_breakout_reference_level: 'open_close_body',
                },
            };
            const res = signalEngine.checkEntry('TESTUSDT', config, '1h', 'LONG', 'entry', false);
            expect(res.allFired).toBe(true);
            expect(res.details?.htf_breakout.threshold).toBe(105);
        });
        it('should support multi-day lookback (e.g. 3-day high)', () => {
            const multiDayCandles = [
                makeCandle(1000, 95, 102, 94, 100),
                makeCandle(2000, 100, 108, 98, 105),
                makeCandle(3000, 105, 115, 103, 112), // Highest High of past 3 days = 115
                makeCandle(4000, 112, 120, 110, 118), // Today's forming candle
            ];
            const hourlyCandles = [
                makeCandle(3500, 110, 117, 109, 116), // 116 > 115
            ];
            jest.spyOn(klineStore, 'getRawCandles').mockImplementation((s, i) => i === '1d' ? multiDayCandles : hourlyCandles);
            const config = {
                enabled_signals: ['htf_breakout'],
                signal_params: {
                    htf_breakout_lookback: 3,
                },
            };
            const res = signalEngine.checkEntry('TESTUSDT', config, '1h', 'LONG', 'entry', false);
            expect(res.allFired).toBe(true);
            expect(res.details?.htf_breakout.threshold).toBe(115);
        });
        it('should handle exit purpose cleanly', () => {
            // Long position exit: trigger when price drops below reference level (e.g. 90)
            const hourlyCandles = [
                makeCandle(1500, 92, 93, 88, 89), // Close 89 < Low 90
            ];
            jest.spyOn(klineStore, 'getRawCandles').mockImplementation((s, i) => i === '1d' ? dailyCandles : hourlyCandles);
            const config = {
                exit_signals: ['htf_breakout'],
            };
            const res = signalEngine.checkEntry('TESTUSDT', config, '1h', 'LONG', 'exit', false);
            expect(res.allFired).toBe(true);
            expect(res.details?.htf_breakout.description).toContain('dropped below prev');
        });
        it('should return insufficientData when reference candles are missing', () => {
            jest.spyOn(klineStore, 'getRawCandles').mockReturnValue([]);
            const config = {
                enabled_signals: ['htf_breakout'],
            };
            const res = signalEngine.checkEntry('TESTUSDT', config, '1h', 'LONG', 'entry', false);
            expect(res.allFired).toBe(false);
            expect(res.details?.htf_breakout.insufficientData).toBe(true);
        });
    });
    describe('Trigger Candle Exit Signal (Exit on breach of trigger candle low/high or ±N candles)', () => {
        // Simulated trade entered on a 1h trigger candle (Low: 50000, High: 51000, Time: 2000)
        const mockLongTrade = {
            id: 'trade-long-1',
            symbol: 'BTCUSDT',
            direction: 'LONG',
            entry_price: 50800,
            qty: 0.1,
            trigger_candle_low: 50000,
            trigger_candle_high: 51000,
            trigger_candle_time: 2000,
            trigger_candle_timeframe: '1h',
        };
        const mockShortTrade = {
            id: 'trade-short-1',
            symbol: 'BTCUSDT',
            direction: 'SHORT',
            entry_price: 49200,
            qty: 0.1,
            trigger_candle_low: 49000,
            trigger_candle_high: 50000,
            trigger_candle_time: 2000,
            trigger_candle_timeframe: '1h',
        };
        it('should fire LONG exit when candle close drops below trigger candle low (N=0)', () => {
            // 1h candles: candle 0 is trigger candle, candle 1 is subsequent candle closing at 49900 (< 50000)
            const candles = [
                makeCandle(2000, 50200, 51000, 50000, 50800),
                makeCandle(3000, 50800, 50900, 49800, 49900), // Close 49900 < 50000
            ];
            jest.spyOn(klineStore, 'getRawCandles').mockReturnValue(candles);
            const config = {
                exit_signals: ['trigger_candle_exit'],
                trigger_candle_exit_n: 0,
                trigger_candle_exit_mode: 'close',
            };
            const result = signalEngine.checkEntry('BTCUSDT', config, '1h', 'LONG', 'exit', false, undefined, mockLongTrade);
            expect(result.allFired).toBe(true);
            expect(result.firedSignals).toContain('trigger_candle_exit');
            expect(result.details?.trigger_candle_exit.value).toBe(49900);
            expect(result.details?.trigger_candle_exit.threshold).toBe(50000);
            expect(result.details?.trigger_candle_exit.label).toBe('Trigger Candle Low');
        });
        it('should NOT fire LONG exit when candle close stays above trigger candle low (N=0)', () => {
            const candles = [
                makeCandle(2000, 50200, 51000, 50000, 50800),
                makeCandle(3000, 50800, 51200, 50050, 50500), // Close 50500 >= 50000
            ];
            jest.spyOn(klineStore, 'getRawCandles').mockReturnValue(candles);
            const config = {
                exit_signals: ['trigger_candle_exit'],
                trigger_candle_exit_n: 0,
                trigger_candle_exit_mode: 'close',
            };
            const result = signalEngine.checkEntry('BTCUSDT', config, '1h', 'LONG', 'exit', false, undefined, mockLongTrade);
            expect(result.allFired).toBe(false);
            expect(result.firedSignals).not.toContain('trigger_candle_exit');
        });
        it('should fire SHORT exit when candle close rises above trigger candle high (N=0)', () => {
            const candles = [
                makeCandle(2000, 49800, 50000, 49000, 49200),
                makeCandle(3000, 49200, 50300, 49100, 50150), // Close 50150 > 50000
            ];
            jest.spyOn(klineStore, 'getRawCandles').mockReturnValue(candles);
            const config = {
                exit_signals: ['trigger_candle_exit'],
                trigger_candle_exit_n: 0,
                trigger_candle_exit_mode: 'close',
            };
            const result = signalEngine.checkEntry('BTCUSDT', config, '1h', 'SHORT', 'exit', false, undefined, mockShortTrade);
            expect(result.allFired).toBe(true);
            expect(result.firedSignals).toContain('trigger_candle_exit');
            expect(result.details?.trigger_candle_exit.value).toBe(50150);
            expect(result.details?.trigger_candle_exit.threshold).toBe(50000);
            expect(result.details?.trigger_candle_exit.label).toBe('Trigger Candle High');
        });
        it('should support ±N surrounding candles window (N=1)', () => {
            // Candle 0 (prev): Low 49800 (lower than trigger candle's 50000)
            // Candle 1 (trigger, time: 2000): Low 50000
            // Candle 2 (eval, time: 3000): Close 49850
            // With N=0, boundary would be 50000, so close 49850 would fire.
            // With N=1 (prev_and_next), boundary is min(49800, 50000) = 49800.
            // Since close 49850 > 49800, it does NOT fire!
            const candles = [
                makeCandle(1000, 50000, 50500, 49800, 50200), // Prev candle low = 49800
                makeCandle(2000, 50200, 51000, 50000, 50800), // Trigger candle low = 50000
                makeCandle(3000, 50800, 50900, 49820, 49850), // Eval candle close = 49850
            ];
            jest.spyOn(klineStore, 'getRawCandles').mockReturnValue(candles);
            const config = {
                exit_signals: ['trigger_candle_exit'],
                trigger_candle_exit_n: 1,
                trigger_candle_exit_offset_mode: 'prev_and_next',
                trigger_candle_exit_mode: 'close',
            };
            const result = signalEngine.checkEntry('BTCUSDT', config, '1h', 'LONG', 'exit', false, undefined, mockLongTrade);
            // Close 49850 is >= lowest low of window (49800), so should NOT fire
            expect(result.allFired).toBe(false);
            expect(result.details?.trigger_candle_exit.threshold).toBe(49800);
        });
        it('should respect close vs wick evaluation mode', () => {
            // Candle wicks down to 49700 (< 50000) but closes at 50200 (> 50000)
            const candles = [
                makeCandle(2000, 50200, 51000, 50000, 50800),
                makeCandle(3000, 50800, 50900, 49700, 50200),
            ];
            jest.spyOn(klineStore, 'getRawCandles').mockReturnValue(candles);
            // Close mode: Should NOT fire because close (50200) > 50000
            const closeConfig = {
                exit_signals: ['trigger_candle_exit'],
                trigger_candle_exit_n: 0,
                trigger_candle_exit_mode: 'close',
            };
            const closeResult = signalEngine.checkEntry('BTCUSDT', closeConfig, '1h', 'LONG', 'exit', false, undefined, mockLongTrade);
            expect(closeResult.allFired).toBe(false);
            // Wick mode: Should FIRE because low (49700) < 50000
            const wickConfig = {
                exit_signals: ['trigger_candle_exit'],
                trigger_candle_exit_n: 0,
                trigger_candle_exit_mode: 'wick',
            };
            const wickResult = signalEngine.checkEntry('BTCUSDT', wickConfig, '1h', 'LONG', 'exit', false, undefined, mockLongTrade);
            expect(wickResult.allFired).toBe(true);
            expect(wickResult.details?.trigger_candle_exit.value).toBe(49700);
        });
    });
});
