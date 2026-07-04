import { SignalEngineService } from './signalEngine';
import { Candle } from './kline_store.service';

describe('SignalEngineService - Engulfing Expert Mode', () => {
  let service: SignalEngineService;
  const mockKlineStore = {
    getRawCandles: jest.fn(),
  };

  beforeEach(() => {
    service = new SignalEngineService(mockKlineStore as any);
  });

  const createCandle = (o: number, h: number, l: number, c: number, v: number = 100): Candle => ({
    time: Date.now(),
    open: o,
    high: h,
    low: l,
    close: c,
    volume: v,
  });

  describe('Range Engulfing', () => {
    it('should fire LONG when current high/low engulfs previous high/low and current is bullish and prev is bearish', () => {
      const candles = [
        createCandle(102, 105, 95, 100), // Prev (Bearish, Body 102-100)
        createCandle(101, 110, 90, 108), // Curr (Bullish, High > 105, Low < 95)
      ];
      mockKlineStore.getRawCandles.mockReturnValue(candles);
      const config = { enabled_signals: ['engulfing'], engulfing_mode: 'range' };

      const result = service.checkEntry('BTCUSDT', config as any, '1m', 'LONG');
      expect(result.allFired).toBe(true);
      expect(result.details?.engulfing.fired).toBe(true);
    });

    it('should NOT fire LONG if current is bearish even if range engulfs', () => {
      const candles = [
        createCandle(102, 105, 95, 100),
        createCandle(108, 110, 90, 101), // Curr (Bearish)
      ];
      mockKlineStore.getRawCandles.mockReturnValue(candles);
      const config = { enabled_signals: ['engulfing'], engulfing_mode: 'range' };

      const result = service.checkEntry('BTCUSDT', config as any, '1m', 'LONG');
      expect(result.allFired).toBe(false);
      expect(result.details?.engulfing.description).toBe('Not a bullish candle');
    });
  });

  describe('Body Engulfing', () => {
    it('should fire LONG when current body engulfs previous bearish body', () => {
      const candles = [
        createCandle(103, 105, 95, 101), // Body: 103-101 (Bearish)
        createCandle(100, 105, 95, 104), // Body: 100-104 (Bullish, Engulfs 103-101)
      ];
      mockKlineStore.getRawCandles.mockReturnValue(candles);
      const config = { enabled_signals: ['engulfing'], engulfing_mode: 'body' };

      const result = service.checkEntry('BTCUSDT', config as any, '1m', 'LONG');
      expect(result.allFired).toBe(true);
    });

    it('should NOT fire LONG if current body does not engulf previous body', () => {
      const candles = [
        createCandle(104, 105, 95, 100), // Body: 104-100 (Bearish)
        createCandle(101, 110, 90, 103), // Body: 101-103 (Bullish, Inside previous body)
      ];
      mockKlineStore.getRawCandles.mockReturnValue(candles);
      const config = { enabled_signals: ['engulfing'], engulfing_mode: 'body' };

      const result = service.checkEntry('BTCUSDT', config as any, '1m', 'LONG');
      expect(result.allFired).toBe(false);
      expect(result.details?.engulfing.description).toBe('Body did not engulf');
    });
  });

  describe('Volume Confirmation', () => {
    it('should fire if volume is higher and engulfing matches', () => {
      const candles = [
        createCandle(102, 105, 95, 100, 100),
        createCandle(101, 110, 90, 108, 150), // Vol 150 > 100
      ];
      mockKlineStore.getRawCandles.mockReturnValue(candles);
      const config = { enabled_signals: ['engulfing'], engulfing_mode: 'range', engulfing_volume_confirm: true };

      const result = service.checkEntry('BTCUSDT', config as any, '1m', 'LONG');
      expect(result.allFired).toBe(true);
    });

    it('should REJECT if volume is lower even if engulfing matches', () => {
      const candles = [
        createCandle(102, 105, 95, 100, 200),
        createCandle(101, 110, 90, 108, 150), // Vol 150 < 200
      ];
      mockKlineStore.getRawCandles.mockReturnValue(candles);
      const config = { enabled_signals: ['engulfing'], engulfing_mode: 'range', engulfing_volume_confirm: true };

      const result = service.checkEntry('BTCUSDT', config as any, '1m', 'LONG');
      expect(result.allFired).toBe(false);
      expect(result.details?.engulfing.description).toBe('Insufficient volume confirmation');
    });
  });

  describe('Strict Mode', () => {
    it('should fire only if BOTH body and range engulf', () => {
      const candles = [
        createCandle(103, 105, 95, 101), // Body: 103-101, Range: 95-105
        createCandle(100, 110, 90, 104), // Body: 100-104 (Engulfs), Range: 90-110 (Engulfs)
      ];
      mockKlineStore.getRawCandles.mockReturnValue(candles);
      const config = { enabled_signals: ['engulfing'], engulfing_mode: 'strict' };

      const result = service.checkEntry('BTCUSDT', config as any, '1m', 'LONG');
      expect(result.allFired).toBe(true);
    });

    it('should NOT fire if only body engulfs but range does not', () => {
       const candles = [
        createCandle(103, 115, 85, 101), // Body: 103-101, Range: 85-115
        createCandle(100, 110, 90, 104), // Body: 100-104 (Engulfs), Range: 90-110 (Fails Range)
      ];
      mockKlineStore.getRawCandles.mockReturnValue(candles);
      const config = { enabled_signals: ['engulfing'], engulfing_mode: 'strict' };

      const result = service.checkEntry('BTCUSDT', config as any, '1m', 'LONG');
      expect(result.allFired).toBe(false);
      expect(result.details?.engulfing.description).toBe('Strict engulfing failed');
    });
  });

  describe('Multi-Bar Reverse Engulfing', () => {
    it('should fire LONG when one bullish candle engulfs 2 previous bearish candles', () => {
      const candles = [
        createCandle(105, 106, 102, 103), // Bearish 1 (Body: 105-103)
        createCandle(103, 104, 100, 101), // Bearish 2 (Body: 103-101)
        createCandle(100, 110, 95, 108),  // Bullish (Engulfs combined range 100-106 and body 101-105)
      ];
      mockKlineStore.getRawCandles.mockReturnValue(candles);
      const config = { enabled_signals: ['engulfing'], engulfing_mode: 'range', engulfing_lookback: 2 };

      const result = service.checkEntry('BTCUSDT', config as any, '1m', 'LONG');
      expect(result.allFired).toBe(true);
    });

    it('should REJECT LONG if any of the lookback candles are NOT bearish', () => {
      const candles = [
        createCandle(102, 105, 100, 104), // Bullish (Wrong for LONG reverse engulfing)
        createCandle(103, 104, 100, 101), // Bearish
        createCandle(100, 110, 95, 108),  // Bullish
      ];
      mockKlineStore.getRawCandles.mockReturnValue(candles);
      const config = { enabled_signals: ['engulfing'], engulfing_mode: 'range', engulfing_lookback: 2 };

      const result = service.checkEntry('BTCUSDT', config as any, '1m', 'LONG');
      expect(result.allFired).toBe(false);
      expect(result.details?.engulfing.description).toBe('Previous 2 candles not bearish');
    });

    it('should fire SHORT when one bearish candle engulfs 2 previous bullish candles', () => {
      const candles = [
        createCandle(100, 105, 100, 103), // Bullish
        createCandle(103, 106, 102, 105), // Bullish
        createCandle(106, 108, 98, 99),   // Bearish (Engulfs combined range 100-106)
      ];
      mockKlineStore.getRawCandles.mockReturnValue(candles);
      const config = { enabled_signals: ['engulfing'], engulfing_mode: 'range', engulfing_lookback: 2 };

      const result = service.checkEntry('BTCUSDT', config as any, '1m', 'SHORT');
      expect(result.allFired).toBe(true);
    });
  });
});
