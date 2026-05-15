import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { sanitizeSessionConfig, createSessionAPI } from './client.js'

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
    assert.equal(sanitized.signal_params, JSON.stringify({ ma_period: 10 }))
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
        signal_params: JSON.stringify({ ma_period: 10, ema_period: 20 }),
        paper_mode: true,
        trading_mode: 'paper',
      },
      paper_mode: true,
      sessionId: undefined,
    })
    assert.equal(result.data.strategyId, 'browser-style')
  })
})
