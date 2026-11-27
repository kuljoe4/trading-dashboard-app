import { dualEngineEnabled, enginePath, getSelectedEngine } from '../utils/engineMode.js'
import axios from 'axios'

export const normalizeUrl = (url, forceProtocol = null) => {
  if (!url) return url;
  let normalized = url.trim();

  // DEPLOY-04: Aggressive URL normalization to handle common environment variable misconfigurations
  // Strip all protocol-like prefixes repeatedly (handles 'https://https//', 'https//', etc.)
  while (/^(https?|wss?)[:/]+/i.test(normalized)) {
    normalized = normalized.replace(/^(https?|wss?)[:/]+/i, '');
  }

  // Determine which protocol to use: forced, existing (if it was valid), or fallback to https
  const proto = forceProtocol || (url.match(/^(https?|wss?)[:/]+/i)?.[1]?.toLowerCase() || 'https');

  // Re-assemble with exactly one protocol and no trailing slashes
  return `${proto}://${normalized.replace(/\/+$/, '')}`;
}

const isDevPreview = typeof window !== 'undefined' && 
  (window.location.hostname.includes('.run.app') || 
   window.location.hostname.includes('googleusercontent.com') ||
   window.location.hostname === 'localhost' ||
   window.location.hostname === '127.0.0.1');

const baseUrlEnv = typeof import.meta !== 'undefined' && typeof import.meta.env !== 'undefined' ? import.meta.env.VITE_API_URL : undefined;

// When running inside AI Studio dev/preview environment (Cloud Run / run.app / localhost),
// the backend Express server co-hosts the routes on the same origin (port 3000).
// In standalone production environments (such as Railway or custom domains), VITE_API_URL is fully honored.
const initialEngine = getSelectedEngine();
const initialBaseURL = initialEngine ? enginePath(initialEngine) : (!isDevPreview && baseUrlEnv ? normalizeUrl(baseUrlEnv) : '') || '';
let currentBaseURL = initialBaseURL;

const api = axios.create({
  baseURL: currentBaseURL,
  timeout: 15000, // 15 seconds default timeout to prevent indefinite hangs
})

export const setApiEngineMode = (mode) => {
  if (!dualEngineEnabled && !mode) return;
  const nextBase = mode ? enginePath(mode) : ((!isDevPreview && baseUrlEnv ? normalizeUrl(baseUrlEnv) : '') || '');
  currentBaseURL = nextBase;
  api.defaults.baseURL = nextBase;
};

// Dynamically inject Admin API Key
let adminKey = typeof localStorage !== 'undefined' ? localStorage.getItem('MOMENTUM_ADMIN_API_KEY') : null;
let resolveAuth = null;
const authInitialized = new Promise((resolve) => {
  resolveAuth = resolve;
  // If we already have a key from localStorage, we can resolve immediately
  if (adminKey) resolve();
});

export const setAdminApiKey = (key) => {
  adminKey = key;
  if (typeof localStorage !== 'undefined') {
    if (key) {
      localStorage.setItem('MOMENTUM_ADMIN_API_KEY', key);
    } else {
      localStorage.removeItem('MOMENTUM_ADMIN_API_KEY');
    }
  }
  if (resolveAuth) resolveAuth();
};

// Allow manual initialization if no key is available (to prevent hanging)
export const initializeAuth = () => {
  if (resolveAuth) resolveAuth();
};

api.interceptors.response.use(
  (response) => {
    // Detect if an endpoint returned HTML (e.g. 502/404 Nginx or Vite fallback page) instead of JSON
    const isHtml = typeof response.data === 'string' &&
      (response.data.trim().startsWith('<!DOCTYPE') || response.data.trim().startsWith('<html') || response.data.trim().startsWith('<!doctype'));
    const contentType = response.headers?.['content-type'] || '';
    if (isHtml || (contentType.includes('text/html') && typeof response.data === 'string')) {
      const url = response.config?.url || 'endpoint';
      const msg = `API response for ${url} returned HTML instead of JSON. The backend route or reverse proxy may be misconfigured.`;
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('system-api-error', {
          detail: {
            type: 'non-json',
            url,
            status: response.status,
            message: msg
          }
        }));
      }
      const err = new Error(msg);
      err.isNonJson = true;
      err.response = response;
      return Promise.reject(err);
    }
    // SRE: Notify system that API endpoint responded with valid JSON
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('system-api-resolved', {
        detail: {
          url: response.config?.url,
          status: response.status
        }
      }));
    }
    return response;
  },
  async (error) => {
    // Failover: If an external API URL failed (e.g. network failure, CORS error, DNS error, or 404 from defunct staging host),
    // and we haven't tried same-origin yet, automatically retry once against same-origin ('')
    if (!getSelectedEngine() && currentBaseURL && (!error.response || error.response.status === 404 || error.response.status >= 500 || error.code === 'ERR_NETWORK')) {
      if (error.config && !error.config._retriedSameOrigin) {
        error.config._retriedSameOrigin = true;
        error.config.baseURL = '';
        currentBaseURL = '';
        api.defaults.baseURL = '';
        console.warn('[API] External API failed. Failing over to same-origin API...');
        return api.request(error.config);
      }
    }

    const isHtmlError = error.response && typeof error.response.data === 'string' &&
      (error.response.data.trim().startsWith('<!DOCTYPE') || error.response.data.trim().startsWith('<html') || (error.response.headers?.['content-type'] || '').includes('text/html'));

    const url = error.config?.url || 'endpoint';
    const isCanceled = axios.isCancel(error) || error?.code === 'ERR_CANCELED' || error?.name === 'CanceledError';
    const suppressGlobal = Boolean(error.config?._suppressGlobalApiError);
    if (typeof window !== 'undefined' && !isCanceled && !suppressGlobal) {
      const errorDetail = {
        type: isHtmlError ? 'non-json' : 'network-error',
        url,
        status: error.response?.status,
        message: isHtmlError
          ? `API request to ${url} returned non-JSON (HTML status ${error.response?.status}). Backend service may be unreachable or returned an error page.`
          : (error.message || 'API request failed')
      };
      window.dispatchEvent(new CustomEvent('system-api-error', { detail: errorDetail }));
    }

    if (error.response && error.response.status === 401 && error.config?.url !== '/auth/config') {
      // Broadcast event for the UI to show auth overlay
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('auth-required'));
      }
    }
    return Promise.reject(error);
  }
);

api.interceptors.request.use(async (config) => {
  const activeEngine = getSelectedEngine();
  if (activeEngine && !config.headers['X-Trading-Engine']) {
    config.headers['X-Trading-Engine'] = activeEngine;
  }
  // If we haven't fetched the key yet, wait until it is set.
  // Note: auth/config should not be protected by this, or it will deadlock.
  if (config.url !== '/auth/config') {
    await authInitialized;
    if (adminKey) {
      config.headers['X-API-Key'] = adminKey;
    }
  }
  return config;
});

const sessionConfigAllowedKeys = [
  'strategy_label',
  'strategy_variants',
  'scan_interval',
  'scan_lookback',
  'scan_pct_threshold',
  'scan_min_volume_usdt',
  'scan_mode',
  'scan_window_duration_sec',
  'scan_check_interval_sec',
  'watchlist_size',
  'watchlist_offset',
  'watchlist_max_symbols',
  'watchlist_auto_rotate',
  'watchlist_locked',
  'watchlist_rotate_interval_min',
  'watchlist_min_score',
  'watchlist_last_rotated_ts',
  'watchlist_rotate_mode',
  'watchlist_htf_freshness_filter',
  'watchlist_htf_direction_filter',
  'watchlist_htf_min_score',
  'discovery_mode',
  'entry_side',
  'excluded_symbols',
  'symbols',
  'enabled_signals',
  'signal_logic',
  'required_signals',
  'signal_params',
  'sl_type',
  'sl_distance_pct',
  'sl_lookback_period',
  'sl_lookback_timeframe',
  'sl_include_forming_candle',
  'sl_pct_limit',
  'sl_min_pct',
  'sl_max_pct',
  'tp_mode',
  'tp_ratio',
  'live_rr_sequence',
  'exit_rr_sequence',
  'peak_rr_switch_threshold',
  'peak_rr_switch_count',
  'switched_sl_distance_pct',
  'switched_live_rr_sequence',
  'switched_exit_rr_sequence',
  'exit_signals',
  'exit_signal_logic',
  'required_exit_signals',
  'exit_signal_delays',
  'exit_signal_actions',
  'exit_signals_override_ratchet',
  'risk_pct_per_trade',
  'martingale_enabled',
  'martingale_multiplier',
  'martingale_reset_threshold_pct',
  'martingale_max_steps',
  'martingale_post_reset_behavior',
  'max_open_trades',
  'max_open_trades_per_symbol',
  'auto_adjust_max_trades_enabled',
  'auto_adjust_max_trades_min',
  'auto_adjust_max_trades_max',
  'auto_adjust_max_trades_step',
  'max_trades_per_period',
  'trades_period_min',
  'max_trades_24h',
  'min_trade_interval_min',
  'trades_jitter_pct',
  'trades_jitter_market_aware',
  'frequency_shaping_enabled',
  'frequency_tod_integration',
  'max_total_risk_pct',
  'total_sl_guard_usdt',
  'auto_scale_min_notional',
  'auto_scale_max_overshoot',
  'is_nominal_overshoot',
  'paper_mode',
  'trading_mode',
  'paper_starting_balance',
  'testnet_starting_balance',
  'live_starting_balance',
  'leverage',
  'track_binance_rate_limits',
  'telemetry_enabled',
  'rate_limit_warning_interval_min',
  'global_scanner_enabled',
  'single_symbol_configs',
  'trading_windows',
  'risk_use_tod_stats',
  'tod_min_winrate',
  'hot_loop_interval_ms',
  'main_loop_interval_ms',
  'slippage_warning_threshold',
  'slippage_abort_threshold',
  'max_fee_drag_pct',
  'debug_mode',
  'hibernation_mode',
  'hibernation_grace_period_sec',
  'trailing_guard_buffer_pct',
  'scanner_weights',
  'sl_out_of_bounds_action',
  'scanner_signal_depth',
  'engulfing_mode',
  'engulfing_timing',
  'engulfing_volume_confirm',
  'engulfing_lookback',
  'engulfing_streak',
  'engulfing_sequential',
  'engulfing_max_expansion_pct',
  'macd_pbc_trend_ema',
  'macd_pbc_lookback',
  'macd_pbc_max_continuation',
  'risk_hardening_enabled',
  'max_single_trade_risk_pct',
  'smart_watchlist_enabled',
  'smart_watchlist_sensitivity',
  'trailing_stop_enabled',
  'trailing_stop_type',
  'trailing_execution_mode',
  'trailing_stop_distance_pct',
  'trailing_stop_rr',
  'trailing_activation_rr',
  'knife_trailing_enabled',
  'knife_trailing_distance_pct',
  'knife_auto_ratchet_be_rr',
  'knife_auto_ratchet_lock_rr',
  'anti_whipsaw_allow_knife',
  'anti_whipsaw_per_strategy',
  'anti_whipsaw_candle_delay',
  'anti_whipsaw_tf_delay_min',
  'anti_whipsaw_max_tf',
  'anti_whipsaw_timeframes',
  'allow_knife_when_gated',
  'release_risk_on_est_pnl_be',
  'release_risk_est_pnl_mode',
  'release_risk_est_pnl_min_usdt',
  'release_risk_est_pnl_min_rr',
  'signal_timeframes',
  'paused',
  'paused_strategies',
  'reject_entry_if_sl_exceeds_max',
  'htf_ema_cross_boost_enabled',
  'htf_ema_cross_interval',
  'htf_ema_cross_count',
  'htf_ema_fast_period',
  'htf_ema_slow_period',
  'htf_ema_cross_max_boost',
  'htf_ema_cross_rr_weight',
  'htf_ema_cross_prefer_fresh',
  'htf_ema_cross_max_bars',
  'htf_ema_cross_catalog_enabled',
  'htf_breakout_ref_timeframe',
  'htf_breakout_trigger_timeframe',
  'htf_breakout_mode',
  'htf_breakout_reference_level',
  'htf_breakout_lookback',
  'htf_breakout_buffer_pct',
  'htf_breakout_max_expansion_pct',
  'trigger_candle_exit_enabled',
  'trigger_candle_exit_n',
  'trigger_candle_exit_offset_mode',
  'trigger_candle_exit_mode',
  'trigger_candle_exit_timeframe',
  'trigger_candle_exit_buffer_pct',
  'force_risk_release',
  'log_retention_days',
  'trade_retention_days',
]

const sanitizeSessionConfig = (config) => {
  if (!config || typeof config !== 'object' || Array.isArray(config)) return {}

  const sanitized = {}
  sessionConfigAllowedKeys.forEach((key) => {
    if (config[key] !== undefined) {
      // Recursively sanitize strategy_variants and single_symbol_configs
      if (key === 'strategy_variants' && Array.isArray(config[key])) {
        sanitized[key] = config[key].map(v => sanitizeSessionConfig(v))
      } else if (key === 'single_symbol_configs' && Array.isArray(config[key])) {
        sanitized[key] = config[key].map(sc => {
          const ssc = {
            symbol: sc.symbol,
            enabled: sc.enabled,
            follow_schedule: sc.follow_schedule,
            use_custom_config: sc.use_custom_config
          }
          if (sc.custom_config) {
            ssc.custom_config = sanitizeSessionConfig(sc.custom_config)
          }
          return ssc
        })
      } else {
        sanitized[key] = config[key]
      }
    }
  })

  // BOLT: Ensure signal_params is always an object to match backend schema.
  // This handles cases where local state or variants might still have stringified JSON or null.
  if (sanitized.signal_params === null) {
    delete sanitized.signal_params
  } else if (typeof sanitized.signal_params === 'string') {
    try {
      sanitized.signal_params = JSON.parse(sanitized.signal_params || '{}')
    } catch (e) {
      sanitized.signal_params = {}
    }
  }

  return sanitized
}

export const createSessionAPI = (apiInstance = api) => ({
  start: (config, paperMode, sessionId) => apiInstance.post('/session/start', {
    config: sanitizeSessionConfig(config),
    paper_mode: paperMode ?? true,
    sessionId,
  }, { timeout: 60000 }),
  stop: () => apiInstance.post('/session/stop'),
  status: (config) => apiInstance.get('/session/status', config),
  engineStatus: (mode, signal) => apiInstance.get('/session/engine-status', {
    baseURL: enginePath(mode),
    headers: { 'X-Trading-Engine': mode },
    signal,
    _suppressGlobalApiError: true,
  }),
  getSymbols: (includeNonUsdt = false, includeHtfCross = false) => {
    const params = {};
    if (includeNonUsdt) params.includeNonUsdt = '1';
    if (includeHtfCross) params.htfCross = '1';
    return apiInstance.get('/session/symbols', {
      params: Object.keys(params).length > 0 ? params : undefined,
    });
  },
  list: (limit, withCounts = true, requestConfig = {}) => apiInstance.get('/session/list', {
    ...requestConfig,
    params: {
      ...(limit ? { limit } : {}),
      ...(withCounts ? { withCounts: '1' } : {}),
      ...(requestConfig?.params || {}),
    }
  }),
  update: (id, config) => apiInstance.patch(`/session/${id}`, { config: sanitizeSessionConfig(config) }),
  pause: (paused, strategyLabel) => apiInstance.post('/session/pause', { paused, strategyLabel }),
  delete: (id) => apiInstance.delete(`/session/${id}`),
  rateLimit: () => apiInstance.get('/session/binance/rate-limit'),
  history: (sessionId, limit, requestConfig = {}) => apiInstance.get('/session/history', {
    ...requestConfig,
    params: { sessionId, limit, ...(requestConfig?.params || {}) }
  }),
  logs: (limit) => apiInstance.get('/session/logs', { params: { limit } }),
  getTrade: (id) => apiInstance.get(`/session/trade/${id}`),
  closeTrade: (symbol) => apiInstance.post(`/session/trade/${symbol}/close`),
  updateTradeConfig: (id, payload) => apiInstance.patch(`/session/trade/${id}/config`, payload),
  analytics: (requestConfig = {}) => apiInstance.get('/session/analytics', requestConfig),
  getLifetimeAnalytics: (mode) => apiInstance.get('/session/lifetime-analytics', { params: { mode } }),
  resetPaperBalance: () => apiInstance.post('/session/reset-paper-balance'),
  deleteOrphans: () => apiInstance.delete('/session/trades/orphans'),
  getUntrackedPositions: () => apiInstance.get('/session/untracked-positions'),
  adoptPosition: (symbol, strategyLabel, initialSl, currentSl) => apiInstance.post('/session/adopt-position', { symbol, strategyLabel, initialSl, currentSl }),
  backfillKlines: (symbol, interval) => apiInstance.post('/session/backfill-klines', { symbol, interval }),
  clearBan: () => apiInstance.post('/session/clear-ban'),
  triggerBan: (reason, untilMs) => apiInstance.post('/session/trigger-ban', { reason, untilMs }),
  backtest: (payload) => apiInstance.post('/session/backtest', {
    ...payload,
    config: sanitizeSessionConfig(payload.config || {}),
  }),
  checkAgreementStatus: () => apiInstance.get('/session/agreement/status'),
  signTradFiAgreement: () => apiInstance.post('/session/agreement/sign-tradfi'),
  resetAgreementRequirement: () => apiInstance.post('/session/agreement/reset'),
})

export const sessionAPI = createSessionAPI()

export const settingsAPI = {
  getKeys: () => api.get('/settings/keys'),
  validateKeys: (keys) => api.post('/settings/keys/validate', keys),
  updateKeys: (keys) => api.post('/settings/keys', keys),
}

export const presetsAPI = {
  list: () => api.get('/presets'),
  save: (name, config, options = {}) => {
    const body = { name, config: sanitizeSessionConfig(config) };
    if (typeof options?.overwrite === 'boolean') {
      body.overwrite = options.overwrite;
    }
    return api.post('/presets', body);
  },
  delete: (name) => api.delete(`/presets/${encodeURIComponent(name)}`),
}

export const smartOptimizerAPI = {
  run: (payload) => api.post('/session/smart-optimizer/run', {
    ...payload,
    baseConfig: sanitizeSessionConfig(payload?.baseConfig || {}),
  }),
  getRecommendations: () => api.get('/session/smart-optimizer/recommendations'),
  clearRecommendations: () => api.delete('/session/smart-optimizer/recommendations'),
}

export const healthAPI = {
  getStartupChecklist: (fresh = false) => api.get(`/session/startup-checklist${fresh ? '?fresh=true' : ''}`),
  getBinanceHealth: (fresh = false) => api.get(`/session/binance-health${fresh ? '?fresh=true' : ''}`),
}

export const formatApiErrorMessage = (error, fallback = 'Request failed') => {
  if (!error) return fallback;
  if (error.code === 'ECONNABORTED' || String(error.message || '').toLowerCase().includes('timeout')) {
    return 'Request timed out while waiting for the backend. Check server status and try again.';
  }
  if (error.message === 'Network Error' || error.code === 'ERR_NETWORK') {
    return 'Network Error: Failed to reach backend. Check your connection or backend health.';
  }
  const data = error.response?.data;
  const extract = (val) => {
    if (!val) return '';
    if (typeof val === 'string') return val.trim();
    if (Array.isArray(val)) {
      return val.map(item => (typeof item === 'string' ? item : (item?.message || (item?.constraints ? Object.values(item.constraints).join(', ') : JSON.stringify(item))))).filter(Boolean).join('; ');
    }
    if (typeof val === 'object') {
      return Object.values(val).map(v => extract(v)).filter(Boolean).join('; ');
    }
    return String(val);
  };
  const detailMsg = extract(data?.detail);
  const bodyMsg = extract(data?.message || data?.error);
  if (detailMsg && bodyMsg && detailMsg !== bodyMsg) {
    return `${bodyMsg}: ${detailMsg}`;
  }
  if (detailMsg) return detailMsg;
  if (bodyMsg) return bodyMsg;
  if (error.response?.status) {
    return `${fallback} (HTTP ${error.response.status})`;
  }
  return error.message || fallback;
}

export { sanitizeSessionConfig, sessionConfigAllowedKeys }

export default api
