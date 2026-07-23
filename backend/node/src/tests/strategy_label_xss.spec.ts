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
});
