import 'reflect-metadata';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { PauseSessionDto } from '../trading/dto/pause-session.dto';

describe('Sentinel: PauseSessionDto strategyLabel Input Gating & XSS Prevention', () => {
  it('should accept standard valid strategy labels', async () => {
    const validLabels = [
      'Momentum Strategy',
      'Strategy (EMA 50 > 200)',
      'Variant_1',
      'Test-Label-123',
      'Strategy 100% []',
    ];

    for (const label of validLabels) {
      const dto = plainToInstance(PauseSessionDto, {
        paused: true,
        strategyLabel: label,
      });
      const errors = await validate(dto);
      const labelError = errors.find(e => e.property === 'strategyLabel');
      expect(labelError).toBeUndefined();
    }
  });

  it('should accept optional/undefined strategy labels', async () => {
    const dto = plainToInstance(PauseSessionDto, {
      paused: true,
    });
    const errors = await validate(dto);
    const labelError = errors.find(e => e.property === 'strategyLabel');
    expect(labelError).toBeUndefined();
  });

  it('should reject strategy labels containing script tags or HTML-like structures', async () => {
    const xssPayloads = [
      '<script>alert("XSS")</script>',
      '<img src=x onerror=alert(1)>',
      '<<SCRIPT>alert("XSS")//<</SCRIPT>',
      '<div style="width:100px">Custom Strategy</div>',
    ];

    for (const payload of xssPayloads) {
      const dto = plainToInstance(PauseSessionDto, {
        paused: true,
        strategyLabel: payload,
      });
      const errors = await validate(dto);
      const labelError = errors.find(e => e.property === 'strategyLabel');
      expect(labelError).toBeDefined();
      expect(labelError?.constraints?.matches).toBeDefined();
    }
  });

  it('should reject strategy labels containing disallowed dangerous characters', async () => {
    const dangerousLabels = [
      'Strategy; DROP TABLE sessions;',
      'Strategy\nwith\rnewlines',
      'Strategy"with\'quotes',
      'Strategy\\with\\backslashes',
    ];

    for (const label of dangerousLabels) {
      const dto = plainToInstance(PauseSessionDto, {
        paused: true,
        strategyLabel: label,
      });
      const errors = await validate(dto);
      const labelError = errors.find(e => e.property === 'strategyLabel');
      expect(labelError).toBeDefined();
      expect(labelError?.constraints?.matches).toBeDefined();
    }
  });

  it('should reject overly long strategy labels', async () => {
    const dto = plainToInstance(PauseSessionDto, {
      paused: true,
      strategyLabel: 'A'.repeat(101),
    });
    const errors = await validate(dto);
    const labelError = errors.find(e => e.property === 'strategyLabel');
    expect(labelError).toBeDefined();
    expect(labelError?.constraints?.maxLength).toBeDefined();
  });
});
