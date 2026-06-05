import axios from 'axios'

const baseUrlEnv = typeof import.meta !== 'undefined' && typeof import.meta.env !== 'undefined' ? import.meta.env.VITE_API_URL : undefined
const baseURL = baseUrlEnv || (typeof window !== 'undefined' && window.location.hostname === 'localhost' ? 'http://localhost:3000' : '')
const api = axios.create({
  baseURL,
})

// Dynamically inject Admin API Key
let adminKey = localStorage.getItem('MOMENTUM_ADMIN_API_KEY') || null;
let resolveAuth = null;
const authInitialized = new Promise((resolve) => {
  resolveAuth = resolve;
  // If we already have a key from localStorage, we can resolve immediately
  if (adminKey) resolve();
});

export const setAdminApiKey = (key) => {
  adminKey = key;
  if (key) {
    localStorage.setItem('MOMENTUM_ADMIN_API_KEY', key);
  } else {
    localStorage.removeItem('MOMENTUM_ADMIN_API_KEY');
  }
  if (resolveAuth) resolveAuth();
};

// Allow manual initialization if no key is available (to prevent hanging)
export const initializeAuth = () => {
  if (resolveAuth) resolveAuth();
};

api.interceptors.request.use(async (config) => {
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
  'entry_side',
  'excluded_symbols',
  'symbols',
  'enabled_signals',
  'signal_logic',
  'signal_params',
  'sl_type',
  'sl_distance_pct',
  'sl_lookback_period',
  'sl_lookback_timeframe',
  'sl_pct_limit',
  'sl_min_pct',
  'sl_max_pct',
  'tp_mode',
  'tp_ratio',
  'live_rr_sequence',
  'exit_rr_sequence',
  'exit_signals',
  'exit_signal_logic',
  'exit_signal_delays',
  'risk_pct_per_trade',
  'max_open_trades',
  'max_open_trades_per_symbol',
  'max_trades_per_period',
  'trades_period_min',
  'max_total_risk_pct',
  'total_sl_guard_usdt',
  'paper_mode',
  'trading_mode',
  'paper_starting_balance',
  'live_starting_balance',
  'track_binance_rate_limits',
  'global_scanner_enabled',
  'single_symbol_configs',
  'trading_windows',
  'risk_use_tod_stats',
  'tod_min_winrate',
  'hot_loop_interval_ms',
  'main_loop_interval_ms',
  'debug_mode',
]

const sanitizeSessionConfig = (config) => {
  if (!config || typeof config !== 'object' || Array.isArray(config)) return {}

  const sanitized = {}
  sessionConfigAllowedKeys.forEach((key) => {
    if (config[key] !== undefined) {
      sanitized[key] = config[key]
    }
  })

  if (sanitized.signal_params !== undefined && typeof sanitized.signal_params !== 'string') {
    try {
      sanitized.signal_params = JSON.stringify(sanitized.signal_params)
    } catch (error) {
      /* keep original if serialization fails */
    }
  } else if (typeof sanitized.signal_params === 'string') {
    // If it's already a string, ensure it's not double-stringified elsewhere
    // ConfigModal.jsx might stringify it before passing to sanitizeSessionConfig
  }

  return sanitized
}

export const createSessionAPI = (apiInstance = api) => ({
  start: (config, paperMode, sessionId) => apiInstance.post('/session/start', {
    config: sanitizeSessionConfig(config),
    paper_mode: paperMode ?? true,
    sessionId,
  }),
  stop: () => apiInstance.post('/session/stop'),
  status: (config) => apiInstance.get('/session/status', config),
  list: () => apiInstance.get('/session/list'),
  update: (id, config) => apiInstance.patch(`/session/${id}`, { config: sanitizeSessionConfig(config) }),
  pause: (paused) => apiInstance.post('/session/pause', { paused }),
  delete: (id) => apiInstance.delete(`/session/${id}`),
  rateLimit: () => apiInstance.get('/session/binance/rate-limit'),
  history: () => apiInstance.get('/session/history'),
  getTrade: (id) => apiInstance.get(`/session/trade/${id}`),
  closeTrade: (symbol) => apiInstance.post(`/session/trade/${symbol}/close`),
  analytics: () => apiInstance.get('/session/analytics'),
  getLifetimeAnalytics: (mode) => apiInstance.get('/session/lifetime-analytics', { params: { mode } }),
  resetPaperBalance: () => apiInstance.post('/session/reset-paper-balance'),
})

export const sessionAPI = createSessionAPI()

export const settingsAPI = {
  getKeys: () => api.get('/settings/keys'),
  updateKeys: (keys) => api.post('/settings/keys', keys),
}

export { sanitizeSessionConfig }

export default api
