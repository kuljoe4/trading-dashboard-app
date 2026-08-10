import 'reflect-metadata';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { SessionConfig, SingleSymbolConfig } from '../models/SessionConfig';

describe('Sentinel: SessionConfig Input Gating & XSS Prevention', () => {
  it('should accept standard valid strategy labels', async () => {
    const config = plainToInstance(SessionConfig, {
      strategy_label: 'Momentum Strategy (EMA 50 > 200)',
    });
    const errors = await validate(config);
    expect(errors.find(e => e.property === 'strategy_label')).toBeUndefined();
  });

  it('should reject strategy labels containing script tags or HTML-like structures', async () => {
    const xssPayloads = [
      '<script>alert("XSS")</script>',
      '<img src=x onerror=alert(1)>',
      '<<SCRIPT>alert("XSS")//<</SCRIPT>',
      '<div style="width:100px">Custom Strategy</div>',
    ];

    for (const payload of xssPayloads) {
      const config = plainToInstance(SessionConfig, {
        strategy_label: payload,
      });
      const errors = await validate(config);
      const labelError = errors.find(e => e.property === 'strategy_label');
      expect(labelError).toBeDefined();
      expect(labelError?.constraints?.matches).toBeDefined();
    }
  });

  it('should reject strategy labels containing disallowed dangerous characters', async () => {
    const dangerousLabels = [
      'Strategy; DROP TABLE sessions;',
      'Strategy\nwith\rnewlines',
      'Strategy"with\'quotes',
    ];

    for (const label of dangerousLabels) {
      const config = plainToInstance(SessionConfig, {
        strategy_label: label,
      });
      const errors = await validate(config);
      const labelError = errors.find(e => e.property === 'strategy_label');
      expect(labelError).toBeDefined();
      expect(labelError?.constraints?.matches).toBeDefined();
    }
  });

  it('should reject overly long strategy labels', async () => {
    const config = plainToInstance(SessionConfig, {
      strategy_label: 'A'.repeat(101),
    });
    const errors = await validate(config);
    const labelError = errors.find(e => e.property === 'strategy_label');
    expect(labelError).toBeDefined();
    expect(labelError?.constraints?.maxLength).toBeDefined();
  });

  it('should accept valid symbols lists and reject invalid entries', async () => {
    const validConfig = plainToInstance(SessionConfig, {
      symbols: ['BTCUSDT', 'ETH-USDT', 'SOL_USDT'],
    });
    const validErrors = await validate(validConfig);
    expect(validErrors.find(e => e.property === 'symbols')).toBeUndefined();

    const invalidConfig = plainToInstance(SessionConfig, {
      symbols: ['BTCUSDT<script>', 'ETH;DROP', 'SOL_USDT_EXTREMELY_LONG_SYMBOL_NAME'],
    });
    const invalidErrors = await validate(invalidConfig);
    const symbolsError = invalidErrors.find(e => e.property === 'symbols');
    expect(symbolsError).toBeDefined();
  });

  it('should accept valid signals lists and reject invalid entries', async () => {
    const validConfig = plainToInstance(SessionConfig, {
      enabled_signals: ['momentum_pct', 'macd_impulse', 'supertrend'],
    });
    const validErrors = await validate(validConfig);
    expect(validErrors.find(e => e.property === 'enabled_signals')).toBeUndefined();

    const invalidConfig = plainToInstance(SessionConfig, {
      enabled_signals: ['momentum_pct;DROP', 'macd-impulse', 'supertrend<script>'],
    });
    const invalidErrors = await validate(invalidConfig);
    const signalsError = invalidErrors.find(e => e.property === 'enabled_signals');
    expect(signalsError).toBeDefined();
  });

  it('should reject invalid symbols in SingleSymbolConfig', async () => {
    const validConfig = plainToInstance(SingleSymbolConfig, {
      symbol: 'BTCUSDT',
    });
    const validErrors = await validate(validConfig);
    expect(validErrors.find(e => e.property === 'symbol')).toBeUndefined();

    const invalidConfig = plainToInstance(SingleSymbolConfig, {
      symbol: 'BTCUSDT<script>',
    });
    const invalidErrors = await validate(invalidConfig);
    const symbolError = invalidErrors.find(e => e.property === 'symbol');
    expect(symbolError).toBeDefined();
    expect(symbolError?.constraints?.matches).toBeDefined();
  });

  describe('Sentinel: SessionConfig Interval Validation', () => {
    it('should accept valid scan_interval and sl_lookback_timeframe', async () => {
      const config = plainToInstance(SessionConfig, {
        scan_interval: '5m',
        sl_lookback_timeframe: '1h',
      });
      const errors = await validate(config);
      expect(errors.find(e => e.property === 'scan_interval')).toBeUndefined();
      expect(errors.find(e => e.property === 'sl_lookback_timeframe')).toBeUndefined();
    });

    it('should reject invalid interval formats or values', async () => {
      const invalidIntervals = [
        'invalid',
        '5',
        'abc',
        '0m',
        '5s',
        '2y',
        '<script>',
        '',
      ];

      for (const val of invalidIntervals) {
        const config = plainToInstance(SessionConfig, {
          scan_interval: val,
          sl_lookback_timeframe: val,
        });
        const errors = await validate(config);

        // Either scan_interval or sl_lookback_timeframe should have error
        const scanError = errors.find(e => e.property === 'scan_interval');
        expect(scanError).toBeDefined();
        expect(scanError?.constraints?.matches).toBeDefined();

        const slError = errors.find(e => e.property === 'sl_lookback_timeframe');
        expect(slError).toBeDefined();
        expect(slError?.constraints?.matches).toBeDefined();
      }
    });
  });

  describe('Sentinel: SessionConfig Paused Strategies Gating & XSS Prevention', () => {
    it('should accept standard valid paused strategies list', async () => {
      const config = plainToInstance(SessionConfig, {
        paused_strategies: ['Momentum Strategy (EMA 50 > 200)', 'EMA Cross [9,21] > 2.5%'],
      });
      const errors = await validate(config);
      expect(errors.find(e => e.property === 'paused_strategies')).toBeUndefined();
    });

    it('should reject paused strategies containing script tags or HTML-like structures', async () => {
      const xssPayloads = [
        '<script>alert("XSS")</script>',
        '<img src=x onerror=alert(1)>',
        '<<SCRIPT>alert("XSS")//<</SCRIPT>',
        '<div style="width:100px">Custom Strategy</div>',
      ];

      for (const payload of xssPayloads) {
        const config = plainToInstance(SessionConfig, {
          paused_strategies: [payload],
        });
        const errors = await validate(config);
        const labelError = errors.find(e => e.property === 'paused_strategies');
        expect(labelError).toBeDefined();
        expect(labelError?.constraints?.matches).toBeDefined();
      }
    });

    it('should reject paused strategies containing disallowed dangerous characters', async () => {
      const dangerousLabels = [
        'Strategy; DROP TABLE sessions;',
        'Strategy\nwith\rnewlines',
        'Strategy"with\'quotes',
      ];

      for (const label of dangerousLabels) {
        const config = plainToInstance(SessionConfig, {
          paused_strategies: [label],
        });
        const errors = await validate(config);
        const labelError = errors.find(e => e.property === 'paused_strategies');
        expect(labelError).toBeDefined();
        expect(labelError?.constraints?.matches).toBeDefined();
      }
    });

    it('should reject overly long paused strategy labels', async () => {
      const config = plainToInstance(SessionConfig, {
        paused_strategies: ['A'.repeat(101)],
      });
      const errors = await validate(config);
      const labelError = errors.find(e => e.property === 'paused_strategies');
      expect(labelError).toBeDefined();
      expect(labelError?.constraints?.maxLength).toBeDefined();
    });

    it('should reject overly large array of paused strategies', async () => {
      const config = plainToInstance(SessionConfig, {
        paused_strategies: Array(101).fill('Valid Strategy'),
      });
      const errors = await validate(config);
      const labelError = errors.find(e => e.property === 'paused_strategies');
      expect(labelError).toBeDefined();
      expect(labelError?.constraints?.arrayMaxSize).toBeDefined();
    });
  });
});
