import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { sanitizeSessionConfig, createSessionAPI, normalizeUrl } from './client.js'

describe('normalizeUrl', () => {
  it('passes through null/undefined', () => {
    assert.strictEqual(normalizeUrl(null), null)
    assert.strictEqual(normalizeUrl(undefined), undefined)
  })

  it('removes trailing slashes', () => {
    assert.equal(normalizeUrl('https://api.example.com/'), 'https://api.example.com')
    assert.equal(normalizeUrl('https://api.example.com///'), 'https://api.example.com')
  })

  it('fixes double protocols', () => {
    assert.equal(normalizeUrl('https://https://api.example.com'), 'https://api.example.com')
    assert.equal(normalizeUrl('http://http://api.example.com'), 'http://api.example.com')
    assert.equal(normalizeUrl('https://https//api.example.com'), 'https://api.example.com')
  })

  it('fixes missing colons', () => {
    assert.equal(normalizeUrl('https//api.example.com'), 'https://api.example.com')
    assert.equal(normalizeUrl('http//api.example.com'), 'http://api.example.com')
  })

  it('handles user provided case from logs', () => {
    assert.equal(normalizeUrl('https://https//backend-staging2-7ec5.up.railway.app'), 'https://backend-staging2-7ec5.up.railway.app')
  })
})

describe('sanitizeSessionConfig', () => {
  it('keeps only allowed session config keys', () => {
    const config = {
      scan_interval: '1m',
      entry_side: 'long',
      unsupported_field: 'remove-me',
      signal_params: { ma_period: 10 },
    }

    const sanitized = sanitizeSessionConfig(config)

    assert.equal(sanitized.scan_interval, '1m')
    assert.equal(sanitized.entry_side, 'long')
    assert.strictEqual(sanitized.unsupported_field, undefined)
    assert.deepEqual(sanitized.signal_params, { ma_period: 10 })
  })

  it('returns an empty object for invalid config values', () => {
    assert.deepEqual(sanitizeSessionConfig(null), {})
    assert.deepEqual(sanitizeSessionConfig([]), {})
    assert.deepEqual(sanitizeSessionConfig('not-an-object'), {})
  })

  it('preserves numeric and boolean config values', () => {
    const config = {
      max_open_trades: 3,
      paper_mode: false,
      trading_mode: 'testnet',
    }

    const sanitized = sanitizeSessionConfig(config)

    assert.equal(sanitized.max_open_trades, 3)
    assert.equal(sanitized.paper_mode, false)
    assert.equal(sanitized.trading_mode, 'testnet')
  })

  it('passes sanitized payload to axios on start', async () => {
    const postCalls = []
    const mockApi = {
      post: (url, body) => {
        postCalls.push({ url, body })
        return Promise.resolve({ data: { strategyId: 'abc123' } })
      },
      get: () => Promise.resolve({}),
      patch: () => Promise.resolve({}),
      delete: () => Promise.resolve({}),
    }

    const customSessionAPI = createSessionAPI(mockApi)
    const config = {
      scan_interval: '1m',
      unsupported_field: 'remove-me',
    }

    const result = await customSessionAPI.start(config, true)

    assert.equal(postCalls.length, 1)
    assert.equal(postCalls[0].url, '/session/start')
    assert.deepEqual(postCalls[0].body, {
      config: { scan_interval: '1m' },
      paper_mode: true,
      sessionId: undefined,
    })
    assert.equal(result.data.strategyId, 'abc123')
  })

  it('passes sanitized payload to axios on update', async () => {
    const patchCalls = []
    const mockApi = {
      post: () => Promise.resolve({}),
      get: () => Promise.resolve({}),
      patch: (url, body) => {
        patchCalls.push({ url, body })
        return Promise.resolve({ data: { success: true } })
      },
      delete: () => Promise.resolve({}),
    }

    const customSessionAPI = createSessionAPI(mockApi)
    const config = {
      max_open_trades: 2,
      illegal_key: 'drop-this',
    }

    const result = await customSessionAPI.update('session-123', config)

    assert.equal(patchCalls.length, 1)
    assert.equal(patchCalls[0].url, '/session/session-123')
    assert.deepEqual(patchCalls[0].body, {
      config: { max_open_trades: 2 },
    })
    assert.equal(result.data.success, true)
  })

  it('sanitizes a browser-like session start payload before sending', async () => {
    const postCalls = []
    const mockApi = {
      post: (url, body) => {
        postCalls.push({ url, body })
        return Promise.resolve({ data: { strategyId: 'browser-style' } })
      },
      get: () => Promise.resolve({}),
      patch: () => Promise.resolve({}),
      delete: () => Promise.resolve({}),
    }

    const customSessionAPI = createSessionAPI(mockApi)
    const config = {
      scan_interval: '5m',
      scan_lookback: 3,
      enabled_signals: ['momentum_pct'],
      signal_logic: 'any',
      signal_params: { ma_period: 10, ema_period: 20 },
      paper_mode: true,
      trading_mode: 'paper',
      unsupported_field: 'should-be-removed',
      extra_debug: true,
    }

    const result = await customSessionAPI.start(config, true)

    assert.equal(postCalls.length, 1)
    assert.equal(postCalls[0].url, '/session/start')
    assert.deepEqual(postCalls[0].body, {
      config: {
        scan_interval: '5m',
        scan_lookback: 3,
        enabled_signals: ['momentum_pct'],
        signal_logic: 'any',
        signal_params: { ma_period: 10, ema_period: 20 },
        paper_mode: true,
        trading_mode: 'paper',
      },
      paper_mode: true,
      sessionId: undefined,
    })
    assert.equal(result.data.strategyId, 'browser-style')
  })

  it('recursively sanitizes strategy_variants and single_symbol_configs', () => {
    const config = {
      strategy_label: 'Main',
      strategy_variants: [
        {
          strategy_label: 'Variant 1',
          unknown_variant_prop: 'oops',
          signal_params: { ma_period: 20 }
        }
      ],
      single_symbol_configs: [
        {
          symbol: 'BTCUSDT',
          enabled: true,
          unknown_symbol_prop: 'oops',
          custom_config: {
            strategy_label: 'Custom BTC',
            unknown_custom_prop: 'oops'
          }
        }
      ]
    }
    const sanitized = sanitizeSessionConfig(config)

    assert.equal(sanitized.strategy_variants.length, 1)
    assert.equal(sanitized.strategy_variants[0].strategy_label, 'Variant 1')
    assert.strictEqual(sanitized.strategy_variants[0].unknown_variant_prop, undefined)
    assert.deepEqual(sanitized.strategy_variants[0].signal_params, { ma_period: 20 })

    assert.equal(sanitized.single_symbol_configs.length, 1)
    assert.equal(sanitized.single_symbol_configs[0].symbol, 'BTCUSDT')
    assert.strictEqual(sanitized.single_symbol_configs[0].unknown_symbol_prop, undefined)
    assert.equal(sanitized.single_symbol_configs[0].custom_config.strategy_label, 'Custom BTC')
    assert.strictEqual(sanitized.single_symbol_configs[0].custom_config.unknown_custom_prop, undefined)
  })

  it('converts stringified signal_params back to object', () => {
    const config = {
      signal_params: JSON.stringify({ ma_period: 50 })
    }
    const sanitized = sanitizeSessionConfig(config)
    assert.deepEqual(sanitized.signal_params, { ma_period: 50 })
  })

  it('preserves auto_scale_min_notional', () => {
    const config = {
      auto_scale_min_notional: false
    }
    const sanitized = sanitizeSessionConfig(config)
    assert.strictEqual(sanitized.auto_scale_min_notional, false)
  })

  it('removes signal_params if it is null', () => {
    const config = {
      signal_params: null
    }
    const sanitized = sanitizeSessionConfig(config)
    assert.strictEqual(sanitized.signal_params, undefined)
  })
})
