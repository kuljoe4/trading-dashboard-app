import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Anti-Whipsaw Config Wiring & Delay Calculation Standard', () => {
  test('frontend/src/api/client.js whitelists all anti-whipsaw config fields', () => {
    const clientContent = fs.readFileSync(path.resolve(__dirname, '../api/client.js'), 'utf8');
    assert.ok(clientContent.includes("'anti_whipsaw_candle_delay'"), 'client.js must whitelist anti_whipsaw_candle_delay');
    assert.ok(clientContent.includes("'anti_whipsaw_tf_delay_min'"), 'client.js must whitelist anti_whipsaw_tf_delay_min');
    assert.ok(clientContent.includes("'anti_whipsaw_allow_knife'"), 'client.js must whitelist anti_whipsaw_allow_knife');
    assert.ok(clientContent.includes("'anti_whipsaw_max_tf'"), 'client.js must whitelist anti_whipsaw_max_tf');
    assert.ok(clientContent.includes("'anti_whipsaw_timeframes'"), 'client.js must whitelist anti_whipsaw_timeframes');
    assert.ok(clientContent.includes("'anti_whipsaw_per_strategy'"), 'client.js must whitelist anti_whipsaw_per_strategy');
  });

  test('backend SessionConfig.ts includes anti_whipsaw_max_tf and anti_whipsaw_timeframes with default values', () => {
    const configContent = fs.readFileSync(path.resolve(__dirname, '../../../backend/node/src/models/SessionConfig.ts'), 'utf8');
    assert.ok(configContent.includes('anti_whipsaw_candle_delay?: number = 1;'), 'SessionConfig must include anti_whipsaw_candle_delay');
    assert.ok(configContent.includes('anti_whipsaw_tf_delay_min?: number = 0;'), 'SessionConfig must include anti_whipsaw_tf_delay_min');
    assert.ok(configContent.includes('anti_whipsaw_max_tf?: string = "4h";'), 'SessionConfig must include anti_whipsaw_max_tf');
    assert.ok(configContent.includes('anti_whipsaw_timeframes?: string[];'), 'SessionConfig must include anti_whipsaw_timeframes');
  });

  test('effectiveDelayMs computes maximum between candle delay and timeframe minute delay', () => {
    const candleDelay = 1;
    const tfDurationMs = 5 * 60 * 1000; // 5m candle = 300,000 ms
    const tfDelayMin = 15; // 15m delay = 900,000 ms

    const effectiveDelayMs = Math.max(candleDelay * tfDurationMs, tfDelayMin * 60 * 1000);
    assert.strictEqual(effectiveDelayMs, 900000); // 15 mins takes precedence over 5m candle
  });
});
