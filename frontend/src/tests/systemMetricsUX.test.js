import { test, describe } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('SystemMetrics & RiskSummary Micro-UX & Keyboard Accessibility Standard', () => {
  const metricsFilePath = path.join(__dirname, '../components/SystemMetrics.jsx');
  const riskFilePath = path.join(__dirname, '../components/RiskSummary.jsx');

  const metricsSource = fs.readFileSync(metricsFilePath, 'utf-8');
  const riskSource = fs.readFileSync(riskFilePath, 'utf-8');

  test('SystemMetrics rate limit element enforces tabIndex={0} and role="region"', () => {
    assert.ok(metricsSource.includes('tabIndex={0}'), 'Rate limit wrapper must include tabIndex={0} for keyboard focus');
    assert.ok(metricsSource.includes('role="region"'), 'Rate limit wrapper must specify role="region"');
  });

  test('SystemMetrics rate limit element provides dynamic aria-label and focus-visible ring', () => {
    assert.ok(metricsSource.includes('aria-label={`Binance API Weight: ${rateLimit'), 'Rate limit wrapper must include dynamic aria-label');
    assert.ok(metricsSource.includes('focus-visible:ring-2 focus-visible:ring-accent'), 'Rate limit wrapper must include high-contrast focus-visible ring');
    assert.ok(metricsSource.includes('focus-visible:outline-none'), 'Rate limit wrapper must include focus-visible:outline-none');
  });

  test('RiskSummary aggressive profile badge includes Tooltip, tabIndex={0}, and aria-label', () => {
    assert.ok(riskSource.includes('<Tooltip content="Risk per trade exceeds 2% or Stop Loss distance exceeds 5%">'), 'Aggressive profile badge must be wrapped with Tooltip');
    assert.ok(riskSource.includes('tabIndex={0}'), 'Aggressive profile badge must specify tabIndex={0} for keyboard focus');
    assert.ok(riskSource.includes('role="region"'), 'Aggressive profile badge must specify role="region"');
    assert.ok(riskSource.includes('aria-label="Aggressive Risk Profile: Risk per trade exceeds 2% or Stop Loss distance exceeds 5%"'), 'Aggressive profile badge must specify informative aria-label');
    assert.ok(riskSource.includes('focus-visible:ring-2 focus-visible:ring-amber'), 'Aggressive profile badge must specify amber focus-visible ring');
  });
});
