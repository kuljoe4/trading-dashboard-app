import { SignalEngineService } from './signalEngine';
import { KlineStoreService, Candle } from './kline_store.service';
import { SessionConfig } from '../models/SessionConfig';

describe('HTF Breakout / Previous-Day Breakout Signal (PDH / PDL Breakout)', () => {
  let signalEngine: SignalEngineService;
  let klineStore: KlineStoreService;

  beforeEach(() => {
    klineStore = {
      getRawCandles: jest.fn(),
      getLookbackExtremes: jest.fn(),
    } as any as KlineStoreService;
    signalEngine = new SignalEngineService(klineStore);
  });

  // Helper to create test candles
  const makeCandle = (time: number, open: number, high: number, low: number, close: number, volume = 1000): Candle => ({
    time, open, high, low, close, volume,
  });

  describe('Core User Scenario: 1h close vs prev 1d high/low', () => {
    // 1-Day candles: Index 0 is previous completed day (High: 50000, Low: 48000), Index 1 is today's active forming candle
    const dailyCandles: Candle[] = [
      makeCandle(1000, 48500, 50000, 48000, 49500), // Prev Day (PDH = 50000, PDL = 48000)
      makeCandle(2000, 49500, 50500, 49000, 50200), // Today's forming candle
    ];

    it('should fire LONG when 1h candle close > prev 1d high', () => {
      const hourlyCandles: Candle[] = [
        makeCandle(1500, 49200, 49800, 49000, 49700),
        makeCandle(1600, 49700, 50300, 49600, 50150), // 1h close (50150) > 50000
      ];

      jest.spyOn(klineStore, 'getRawCandles').mockImplementation((symbol, interval) => {
        if (interval === '1d') return dailyCandles;
        if (interval === '1h') return hourlyCandles;
        return [];
      });

      const config: Partial<SessionConfig> = {
        enabled_signals: ['htf_breakout'],
        signal_params: {
          htf_breakout_ref_timeframe: '1d',
          htf_breakout_trigger_timeframe: '1h',
          htf_breakout_mode: 'close_break',
        },
      };

      const result = signalEngine.checkEntry('BTCUSDT', config as any, '1h', 'LONG', 'entry', false);

      expect(result.allFired).toBe(true);
      expect(result.firedSignals).toContain('htf_breakout');
      expect(result.details?.htf_breakout.value).toBe(50150);
      expect(result.details?.htf_breakout.threshold).toBe(50000);
      expect(result.details?.htf_breakout.pattern_high).toBe(50000);
      expect(result.details?.htf_breakout.pattern_low).toBe(48000);
      expect(result.details?.htf_breakout.slPrice).toBe(48000);
    });

    it('should NOT fire LONG when 1h candle close <= prev 1d high', () => {
      const hourlyCandles: Candle[] = [
        makeCandle(1500, 49200, 49800, 49000, 49700),
        makeCandle(1600, 49700, 50000, 49500, 49950), // 1h close (49950) <= 50000
      ];

      jest.spyOn(klineStore, 'getRawCandles').mockImplementation((symbol, interval) => {
        if (interval === '1d') return dailyCandles;
        if (interval === '1h') return hourlyCandles;
        return [];
      });

      const config: Partial<SessionConfig> = {
        enabled_signals: ['htf_breakout'],
        signal_params: {
          htf_breakout_ref_timeframe: '1d',
          htf_breakout_trigger_timeframe: '1h',
        },
      };

      const result = signalEngine.checkEntry('BTCUSDT', config as any, '1h', 'LONG', 'entry', false);

      expect(result.allFired).toBe(false);
      expect(result.firedSignals).not.toContain('htf_breakout');
    });

    it('should fire SHORT when 1h candle close < prev 1d low', () => {
      const hourlyCandles: Candle[] = [
        makeCandle(1500, 48500, 48700, 48100, 48200),
        makeCandle(1600, 48200, 48300, 47800, 47900), // 1h close (47900) < 48000
      ];

      jest.spyOn(klineStore, 'getRawCandles').mockImplementation((symbol, interval) => {
        if (interval === '1d') return dailyCandles;
        if (interval === '1h') return hourlyCandles;
        return [];
      });

      const config: Partial<SessionConfig> = {
        enabled_signals: ['htf_breakout'],
        signal_params: {
          htf_breakout_ref_timeframe: '1d',
          htf_breakout_trigger_timeframe: '1h',
        },
      };

      const result = signalEngine.checkEntry('BTCUSDT', config as any, '1h', 'SHORT', 'entry', false);

      expect(result.allFired).toBe(true);
      expect(result.firedSignals).toContain('htf_breakout');
      expect(result.details?.htf_breakout.value).toBe(47900);
      expect(result.details?.htf_breakout.threshold).toBe(48000);
      expect(result.details?.htf_breakout.slPrice).toBe(50000);
    });

    it('should NOT fire SHORT when 1h candle close >= prev 1d low', () => {
      const hourlyCandles: Candle[] = [
        makeCandle(1500, 48500, 48700, 48100, 48200),
        makeCandle(1600, 48200, 48400, 48050, 48100), // 1h close (48100) >= 48000
      ];

      jest.spyOn(klineStore, 'getRawCandles').mockImplementation((symbol, interval) => {
        if (interval === '1d') return dailyCandles;
        if (interval === '1h') return hourlyCandles;
        return [];
      });

      const config: Partial<SessionConfig> = {
        enabled_signals: ['htf_breakout'],
      };

      const result = signalEngine.checkEntry('BTCUSDT', config as any, '1h', 'SHORT', 'entry', false);

      expect(result.allFired).toBe(false);
    });
  });

  describe('Customizable Parameters & Modes', () => {
    const dailyCandles: Candle[] = [
      makeCandle(1000, 100, 110, 90, 105), // Prev Day (High: 110, Low: 90, Body: 100-105)
      makeCandle(2000, 105, 115, 102, 112), // Today's forming
    ];

    it('should respect buffer_pct filter', () => {
      // With high=110 and buffer_pct=1%, required threshold is 110 * 1.01 = 111.1
      const hourlyCandles: Candle[] = [
        makeCandle(1500, 108, 112, 107, 110.5), // 110.5 > 110 but < 111.1
      ];

      jest.spyOn(klineStore, 'getRawCandles').mockImplementation((s, i) => i === '1d' ? dailyCandles : hourlyCandles);

      const config: Partial<SessionConfig> = {
        enabled_signals: ['htf_breakout'],
        signal_params: {
          htf_breakout_buffer_pct: 1.0,
        },
      };

      // 110.5 should fail because of 1% buffer
      let res = signalEngine.checkEntry('TESTUSDT', config as any, '1h', 'LONG', 'entry', false);
      expect(res.allFired).toBe(false);

      // 111.5 should pass (> 111.1)
      hourlyCandles[0].close = 111.5;
      res = signalEngine.checkEntry('TESTUSDT', config as any, '1h', 'LONG', 'entry', false);
      expect(res.allFired).toBe(true);
    });

    it('should reject overextended entries when max_expansion_pct (% of HTF ref candle distance) is exceeded for LONG and SHORT', () => {
      // 6% ref candle distance: High = 110, Low = 103.4 -> span = 6.6 (6.0% of 110)
      // 10% of 6.0% ref candle distance = 0.60% max expansion -> LONG cap = 110.66
      const refLongDaily: Candle[] = [
        makeCandle(1000, 105, 110, 103.4, 109),
        makeCandle(2000, 109, 111.5, 108, 110.5),
      ];
      const hourlyCandles: Candle[] = [
        makeCandle(1500, 108, 111, 107, 110.5), // +0.45% <= 0.60% -> passes
      ];

      jest.spyOn(klineStore, 'getRawCandles').mockImplementation((_s, i) => (i === '1d' ? refLongDaily : hourlyCandles));

      const config: Partial<SessionConfig> = {
        enabled_signals: ['htf_breakout'],
        sl_type: 'pct',
        sl_distance_pct: 2.0,
        signal_params: {
          htf_breakout_max_expansion_pct: 10,
        },
      };

      const passRes = signalEngine.checkEntry('TESTUSDT', config as any, '1h', 'LONG', 'entry', false);
      expect(passRes.allFired).toBe(true);
      expect(passRes.details?.htf_breakout.max_expansion_pct).toBe(10);
      expect(passRes.details?.htf_breakout.ref_range_pct).toBeCloseTo(6.0, 3);
      expect(passRes.details?.htf_breakout.effective_max_expansion_pct).toBeCloseTo(0.6, 5);
      expect(passRes.details?.htf_breakout.expansion_cap).toBeCloseTo(110.66, 4);

      hourlyCandles[0].close = 110.8; // +0.73% > 0.60% -> rejects
      const rejectRes = signalEngine.checkEntry('TESTUSDT', config as any, '1h', 'LONG', 'entry', false);
      expect(rejectRes.allFired).toBe(false);
      expect(rejectRes.details?.htf_breakout.rejected).toBe(true);
      expect(rejectRes.details?.htf_breakout.description).toContain('0.60% (10% of 6.00% 1d range)');

      // SHORT: 6% ref candle distance: High = 95.4, Low = 90 -> span = 5.4 (6.0% of 90)
      // 10% of 6.0% = 0.60% -> SHORT cap = 90 - 5.4 * 0.10 = 89.46
      const refShortDaily: Candle[] = [
        makeCandle(1000, 94, 95.4, 90, 91),
        makeCandle(2000, 91, 92, 89, 89.4),
      ];
      hourlyCandles[0] = makeCandle(1500, 91, 91.5, 89.3, 89.4); // -0.67% beyond 90 -> rejects
      jest.spyOn(klineStore, 'getRawCandles').mockImplementation((_s, i) => (i === '1d' ? refShortDaily : hourlyCandles));

      const shortReject = signalEngine.checkEntry('TESTUSDT', config as any, '1h', 'SHORT', 'entry', false);
      expect(shortReject.allFired).toBe(false);
      expect(shortReject.details?.htf_breakout.rejected).toBe(true);
      expect(shortReject.details?.htf_breakout.ref_range_pct).toBeCloseTo(6.0, 3);
      expect(shortReject.details?.htf_breakout.expansion_cap).toBeCloseTo(89.46, 4);
    });

    it('should keep max_expansion_pct independent of sl_max_pct/sl_distance_pct and handle body/close_only ref ranges', () => {
      // dailyCandles: Open 100, High 110, Low 90, Close 105 (full wick span 20, body span 5)
      const hourlyCandles: Candle[] = [
        makeCandle(1500, 108, 112, 107, 111.5), // +1.36% beyond 110
      ];
      jest.spyOn(klineStore, 'getRawCandles').mockImplementation((_s, i) => (i === '1d' ? dailyCandles : hourlyCandles));

      // With high_low: ref span = 20 -> 10% = +2.0 -> cap = 112.0 (111.5 passes regardless of tight SL settings)
      const tightSlCfg: Partial<SessionConfig> = {
        enabled_signals: ['htf_breakout'],
        sl_type: 'pct',
        sl_distance_pct: 0.5,
        sl_max_pct: 1.0,
        signal_params: {
          htf_breakout_max_expansion_pct: 10,
        },
      };
      const wideSlCfg: Partial<SessionConfig> = {
        ...tightSlCfg,
        sl_type: 'lookback_low/high',
        sl_distance_pct: 10.0,
        sl_max_pct: 10.0,
      };

      const resTight = signalEngine.checkEntry('TESTUSDT', tightSlCfg as any, '1h', 'LONG', 'entry', false);
      const resWide = signalEngine.checkEntry('TESTUSDT', wideSlCfg as any, '1h', 'LONG', 'entry', false);
      expect(resTight.allFired).toBe(true);
      expect(resTight.details?.htf_breakout.expansion_cap).toBeCloseTo(112.0, 4);
      expect(resWide.details?.htf_breakout.expansion_cap).toBeCloseTo(112.0, 4);
      expect(resTight.details?.htf_breakout.effective_max_expansion_pct).toBeCloseTo(
        resWide.details?.htf_breakout.effective_max_expansion_pct,
        5,
      );

      // open_close_body: body range 100..105 (span 5) -> 10% cap = 105 + 0.5 = 105.5
      hourlyCandles[0].close = 105.4;
      const bodyPass = signalEngine.checkEntry('TESTUSDT', {
        ...tightSlCfg,
        signal_params: {
          htf_breakout_reference_level: 'open_close_body',
          htf_breakout_max_expansion_pct: 10,
        },
      } as any, '1h', 'LONG', 'entry', false);
      expect(bodyPass.allFired).toBe(true);
      expect(bodyPass.details?.htf_breakout.expansion_cap).toBeCloseTo(105.5, 4);

      // close_only: falls back to full wick range (20) -> cap = 105 + 2.0 = 107.0
      hourlyCandles[0].close = 106.5;
      const closeOnlyPass = signalEngine.checkEntry('TESTUSDT', {
        ...tightSlCfg,
        signal_params: {
          htf_breakout_reference_level: 'close_only',
          htf_breakout_max_expansion_pct: 10,
        },
      } as any, '1h', 'LONG', 'entry', false);
      expect(closeOnlyPass.allFired).toBe(true);
      expect(closeOnlyPass.details?.htf_breakout.expansion_cap).toBeCloseTo(107.0, 4);
    });

    it('should support closed_candle_confirm mode', () => {
      // closed_candle_confirm looks at candles[length - 2]
      const hourlyCandles: Candle[] = [
        makeCandle(1400, 105, 112, 104, 111), // Completed candle 1: closed above 110
        makeCandle(1500, 111, 113, 109, 108), // Active forming candle: pulled back below 110
      ];

      jest.spyOn(klineStore, 'getRawCandles').mockImplementation((s, i) => i === '1d' ? dailyCandles : hourlyCandles);

      const config: Partial<SessionConfig> = {
        enabled_signals: ['htf_breakout'],
        signal_params: {
          htf_breakout_mode: 'closed_candle_confirm',
        },
      };

      const res = signalEngine.checkEntry('TESTUSDT', config as any, '1h', 'LONG', 'entry', false);
      // Fired because completed candle closed at 111 (> 110); value reflects live candle close while closed_value tracks confirmed candle close
      expect(res.allFired).toBe(true);
      expect(res.details?.htf_breakout.closed_value).toBe(111);
      expect(res.details?.htf_breakout.value).toBe(108);
    });

    it('should support wick_break mode', () => {
      const hourlyCandles: Candle[] = [
        makeCandle(1500, 108, 112.5, 107, 109.5), // High wicked to 112.5 (> 110), but close is 109.5 (< 110)
      ];

      jest.spyOn(klineStore, 'getRawCandles').mockImplementation((s, i) => i === '1d' ? dailyCandles : hourlyCandles);

      const config: Partial<SessionConfig> = {
        enabled_signals: ['htf_breakout'],
        signal_params: {
          htf_breakout_mode: 'wick_break',
        },
      };

      const res = signalEngine.checkEntry('TESTUSDT', config as any, '1h', 'LONG', 'entry', false);
      expect(res.allFired).toBe(true);
    });

    it('should support open_close_body reference level', () => {
      // Prev day: Open 100, High 110, Low 90, Close 105. Body High = 105.
      const hourlyCandles: Candle[] = [
        makeCandle(1500, 104, 107, 103, 106), // Close 106 > Body High 105 (even though < Wick High 110)
      ];

      jest.spyOn(klineStore, 'getRawCandles').mockImplementation((s, i) => i === '1d' ? dailyCandles : hourlyCandles);

      const config: Partial<SessionConfig> = {
        enabled_signals: ['htf_breakout'],
        signal_params: {
          htf_breakout_reference_level: 'open_close_body',
        },
      };

      const res = signalEngine.checkEntry('TESTUSDT', config as any, '1h', 'LONG', 'entry', false);
      expect(res.allFired).toBe(true);
      expect(res.details?.htf_breakout.threshold).toBe(105);
    });

    it('should support multi-day lookback (e.g. 3-day high)', () => {
      const multiDayCandles: Candle[] = [
        makeCandle(1000, 95, 102, 94, 100),
        makeCandle(2000, 100, 108, 98, 105),
        makeCandle(3000, 105, 115, 103, 112), // Highest High of past 3 days = 115
        makeCandle(4000, 112, 120, 110, 118), // Today's forming candle
      ];

      const hourlyCandles: Candle[] = [
        makeCandle(3500, 110, 117, 109, 116), // 116 > 115
      ];

      jest.spyOn(klineStore, 'getRawCandles').mockImplementation((s, i) => i === '1d' ? multiDayCandles : hourlyCandles);

      const config: Partial<SessionConfig> = {
        enabled_signals: ['htf_breakout'],
        signal_params: {
          htf_breakout_lookback: 3,
        },
      };

      const res = signalEngine.checkEntry('TESTUSDT', config as any, '1h', 'LONG', 'entry', false);
      expect(res.allFired).toBe(true);
      expect(res.details?.htf_breakout.threshold).toBe(115);
    });

    it('should handle exit purpose cleanly', () => {
      // Long position exit: trigger when price drops below reference level (e.g. 90)
      const hourlyCandles: Candle[] = [
        makeCandle(1500, 92, 93, 88, 89), // Close 89 < Low 90
      ];

      jest.spyOn(klineStore, 'getRawCandles').mockImplementation((s, i) => i === '1d' ? dailyCandles : hourlyCandles);

      const config: Partial<SessionConfig> = {
        exit_signals: ['htf_breakout'],
      };

      const res = signalEngine.checkEntry('TESTUSDT', config as any, '1h', 'LONG', 'exit', false);
      expect(res.allFired).toBe(true);
      expect(res.details?.htf_breakout.description).toContain('dropped below prev');
    });

    it('should return insufficientData when reference candles are missing', () => {
      jest.spyOn(klineStore, 'getRawCandles').mockReturnValue([]);

      const config: Partial<SessionConfig> = {
        enabled_signals: ['htf_breakout'],
      };

      const res = signalEngine.checkEntry('TESTUSDT', config as any, '1h', 'LONG', 'entry', false);
      expect(res.allFired).toBe(false);
      expect(res.details?.htf_breakout.insufficientData).toBe(true);
    });
  });

  describe('Trigger Candle Exit Signal (Exit on breach of trigger candle low/high or ±N candles)', () => {
    // Simulated trade entered on a 1h trigger candle (Low: 50000, High: 51000, Time: 2000)
    const mockLongTrade = {
      id: 'trade-long-1',
      symbol: 'BTCUSDT',
      direction: 'LONG' as const,
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
      direction: 'SHORT' as const,
      entry_price: 49200,
      qty: 0.1,
      trigger_candle_low: 49000,
      trigger_candle_high: 50000,
      trigger_candle_time: 2000,
      trigger_candle_timeframe: '1h',
    };

    it('should fire LONG exit when candle close drops below trigger candle low (N=0)', () => {
      // 1h candles: candle 0 is trigger candle, candle 1 is subsequent candle closing at 49900 (< 50000)
      const candles: Candle[] = [
        makeCandle(2000, 50200, 51000, 50000, 50800),
        makeCandle(3000, 50800, 50900, 49800, 49900), // Close 49900 < 50000
      ];

      jest.spyOn(klineStore, 'getRawCandles').mockReturnValue(candles);

      const config: Partial<SessionConfig> = {
        exit_signals: ['trigger_candle_exit'],
        trigger_candle_exit_n: 0,
        trigger_candle_exit_mode: 'close',
      };

      const result = signalEngine.checkEntry('BTCUSDT', config as any, '1h', 'LONG', 'exit', false, undefined, mockLongTrade);

      expect(result.allFired).toBe(true);
      expect(result.firedSignals).toContain('trigger_candle_exit');
      expect(result.details?.trigger_candle_exit.value).toBe(49900);
      expect(result.details?.trigger_candle_exit.threshold).toBe(50000);
      expect(result.details?.trigger_candle_exit.label).toBe('Trigger Candle Low');
    });

    it('should NOT fire LONG exit when candle close stays above trigger candle low (N=0)', () => {
      const candles: Candle[] = [
        makeCandle(2000, 50200, 51000, 50000, 50800),
        makeCandle(3000, 50800, 51200, 50050, 50500), // Close 50500 >= 50000
      ];

      jest.spyOn(klineStore, 'getRawCandles').mockReturnValue(candles);

      const config: Partial<SessionConfig> = {
        exit_signals: ['trigger_candle_exit'],
        trigger_candle_exit_n: 0,
        trigger_candle_exit_mode: 'close',
      };

      const result = signalEngine.checkEntry('BTCUSDT', config as any, '1h', 'LONG', 'exit', false, undefined, mockLongTrade);

      expect(result.allFired).toBe(false);
      expect(result.firedSignals).not.toContain('trigger_candle_exit');
    });

    it('should fire SHORT exit when candle close rises above trigger candle high (N=0)', () => {
      const candles: Candle[] = [
        makeCandle(2000, 49800, 50000, 49000, 49200),
        makeCandle(3000, 49200, 50300, 49100, 50150), // Close 50150 > 50000
      ];

      jest.spyOn(klineStore, 'getRawCandles').mockReturnValue(candles);

      const config: Partial<SessionConfig> = {
        exit_signals: ['trigger_candle_exit'],
        trigger_candle_exit_n: 0,
        trigger_candle_exit_mode: 'close',
      };

      const result = signalEngine.checkEntry('BTCUSDT', config as any, '1h', 'SHORT', 'exit', false, undefined, mockShortTrade);

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
      const candles: Candle[] = [
        makeCandle(1000, 50000, 50500, 49800, 50200), // Prev candle low = 49800
        makeCandle(2000, 50200, 51000, 50000, 50800), // Trigger candle low = 50000
        makeCandle(3000, 50800, 50900, 49820, 49850), // Eval candle close = 49850
      ];

      jest.spyOn(klineStore, 'getRawCandles').mockReturnValue(candles);

      const config: Partial<SessionConfig> = {
        exit_signals: ['trigger_candle_exit'],
        trigger_candle_exit_n: 1,
        trigger_candle_exit_offset_mode: 'prev_and_next',
        trigger_candle_exit_mode: 'close',
      };

      const result = signalEngine.checkEntry('BTCUSDT', config as any, '1h', 'LONG', 'exit', false, undefined, mockLongTrade);

      // Close 49850 is >= lowest low of window (49800), so should NOT fire
      expect(result.allFired).toBe(false);
      expect(result.details?.trigger_candle_exit.threshold).toBe(49800);
    });

    it('should respect close vs wick evaluation mode', () => {
      // Candle wicks down to 49700 (< 50000) but closes at 50200 (> 50000)
      const candles: Candle[] = [
        makeCandle(2000, 50200, 51000, 50000, 50800),
        makeCandle(3000, 50800, 50900, 49700, 50200),
      ];

      jest.spyOn(klineStore, 'getRawCandles').mockReturnValue(candles);

      // Close mode: Should NOT fire because close (50200) > 50000
      const closeConfig: Partial<SessionConfig> = {
        exit_signals: ['trigger_candle_exit'],
        trigger_candle_exit_n: 0,
        trigger_candle_exit_mode: 'close',
      };
      const closeResult = signalEngine.checkEntry('BTCUSDT', closeConfig as any, '1h', 'LONG', 'exit', false, undefined, mockLongTrade);
      expect(closeResult.allFired).toBe(false);

      // Wick mode: Should FIRE because low (49700) < 50000
      const wickConfig: Partial<SessionConfig> = {
        exit_signals: ['trigger_candle_exit'],
        trigger_candle_exit_n: 0,
        trigger_candle_exit_mode: 'wick',
      };
      const wickResult = signalEngine.checkEntry('BTCUSDT', wickConfig as any, '1h', 'LONG', 'exit', false, undefined, mockLongTrade);
      expect(wickResult.allFired).toBe(true);
      expect(wickResult.details?.trigger_candle_exit.value).toBe(49700);
    });
  });
});
