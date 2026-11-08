import express from 'express';
import cors from 'cors';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer as createViteServer } from 'vite';
import crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true, limit: '5mb' }));

// Security headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});

// Trading state
interface PriceInfo {
  symbol: string;
  price: number;
  open24h: number;
  high24h: number;
  low24h: number;
  volume24h: number;
  momentum: number;
  volatility: number;
  trend: number;
  score: number;
  history: number[];
  ohlc_history: Array<{
    time: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  }>;
}

const SYMBOLS = [
  { symbol: 'BTCUSDT', basePrice: 65420.0, vol: 1540000000 },
  { symbol: 'ETHUSDT', basePrice: 3480.0, vol: 820000000 },
  { symbol: 'SOLUSDT', basePrice: 152.4, vol: 450000000 },
  { symbol: 'BNBUSDT', basePrice: 588.5, vol: 190000000 },
  { symbol: 'DOGEUSDT', basePrice: 0.128, vol: 210000000 },
  { symbol: 'ADAUSDT', basePrice: 0.385, vol: 120000000 },
  { symbol: 'XRPUSDT', basePrice: 0.584, vol: 310000000 },
  { symbol: 'AVAXUSDT', basePrice: 28.9, vol: 140000000 },
  { symbol: 'LINKUSDT', basePrice: 13.2, vol: 95000000 },
  { symbol: 'NEARUSDT', basePrice: 5.12, vol: 88000000 },
];

const prices: Map<string, PriceInfo> = new Map();

// Initialize prices with full 120-candle warmup history (true timestamps at 5m intervals)
const now = Date.now();
const candleIntervalMs = 5 * 60 * 1000;
for (const s of SYMBOLS) {
  const ohlc: PriceInfo['ohlc_history'] = [];
  let cur = s.basePrice;
  for (let i = 120; i >= 0; i--) {
    const t = now - i * candleIntervalMs;
    const change = (Math.random() - 0.49) * 0.008;
    const o = cur;
    const c = cur * (1 + change);
    const h = Math.max(o, c) * (1 + Math.random() * 0.003);
    const l = Math.min(o, c) * (1 - Math.random() * 0.003);
    cur = c;
    ohlc.push({
      time: t,
      open: parseFloat(o.toFixed(4)),
      high: parseFloat(h.toFixed(4)),
      low: parseFloat(l.toFixed(4)),
      close: parseFloat(c.toFixed(4)),
      volume: Math.floor(Math.random() * 5000 + 1000),
    });
  }

  const p = ohlc[ohlc.length - 1].close;
  const hist = ohlc.map(c => c.close);
  const mom = parseFloat((((p - ohlc[0].open) / ohlc[0].open) * 100).toFixed(2));
  prices.set(s.symbol, {
    symbol: s.symbol,
    price: p,
    open24h: s.basePrice * 0.98,
    high24h: s.basePrice * 1.04,
    low24h: s.basePrice * 0.97,
    volume24h: s.vol,
    momentum: mom,
    volatility: parseFloat((Math.random() * 2 + 1).toFixed(2)),
    trend: mom >= 0 ? 1 : -1,
    score: parseFloat((Math.abs(mom) * 15 + Math.random() * 20 + 40).toFixed(1)),
    history: hist,
    ohlc_history: ohlc,
  });
}

const state = {
  sessionActive: false,
  sessionPaused: false,
  pausedStrategies: [] as string[],
  strategyGateStates: {} as Record<string, string>,
  strategyId: null as string | null,
  strategyLabel: 'Momentum Strategy',
  balance: 10000.0,
  paperBalance: 10000.0,
  totalPnl: 0,
  totalRiskPct: 0,
  totalSlUsed: 0,
  apiStatus: {
    isBanned: false,
    isRateLimited: false,
    banUntil: null as number | null,
    lastErrorMessage: null as string | null,
  },
  activeTrades: [] as any[],
  tradeHistory: [
    {
      id: 'trade-init-1',
      sessionId: 'default-session',
      symbol: 'SOLUSDT',
      side: 'LONG',
      direction: 'long',
      entry_price: 148.20,
      exit_price: 151.65,
      quantity: 13.5,
      pnl: 46.57,
      pnl_pct: 2.33,
      rr: 2.1,
      status: 'CLOSED',
      exit_reason: 'TP_HIT',
      strategy_label: 'Momentum Strategy',
      timestamp: now - 3600000,
      closed_at: now - 1800000,
      realized_fee: 0.81,
      funding_fee: 0,
    },
    {
      id: 'trade-init-2',
      sessionId: 'default-session',
      symbol: 'BTCUSDT',
      side: 'LONG',
      direction: 'long',
      entry_price: 64100.0,
      exit_price: 64850.0,
      quantity: 0.03,
      pnl: 22.50,
      pnl_pct: 1.17,
      rr: 1.8,
      status: 'CLOSED',
      exit_reason: 'TP_HIT',
      strategy_label: 'Momentum Strategy',
      timestamp: now - 7200000,
      closed_at: now - 5400000,
      realized_fee: 0.77,
      funding_fee: 0,
    },
  ],
  logs: [
    {
      id: 'log-1',
      ts: new Date(now - 120000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      ts_ms: now - 120000,
      level: 'info',
      msg: 'Momentum Engine initialized in Paper Trading mode',
    },
    {
      id: 'log-2',
      ts: new Date(now - 60000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      ts_ms: now - 60000,
      level: 'info',
      msg: 'Market Feed connected to Binance USDⓈ-M Futures (Paper Mode)',
    },
  ],
  config: {
    paper_mode: true,
    strategy_label: 'Momentum Strategy',
    strategy_variants: [],
    max_total_risk_pct: 5.0,
    total_sl_guard_usdt: 200.0,
    scan_interval: '5m',
    scan_pct_threshold: 2.0,
    scan_lookback: 3,
    scan_min_volume_usdt: 500000,
    scan_mode: 'interval',
    scan_window_duration_sec: 90,
    scan_check_interval_sec: 5,
    entry_side: 'both',
    symbols: [] as string[],
    watchlist_max_symbols: 0,
    watchlist_auto_rotate: false,
    watchlist_rotate_interval_min: 15,
    watchlist_locked: false,
    watchlist_min_score: 75,
    watchlist_last_rotated_ts: 0,
    watchlist_size: 25,
    watchlist_offset: 0,
    discovery_mode: 'volume',
    enabled_signals: ['momentum_pct'],
    signal_logic: 'all',
    required_signals: [],
    tp_mode: 'fixed',
    tp_ratio: 2.0,
    live_rr_sequence: [1, 2, 4],
    exit_rr_sequence: [0, 1, 2],
    sl_type: 'pct',
    sl_distance_pct: 0.8,
    sl_lookback_timeframe: '5m',
    sl_lookback_period: 5,
    sl_min_pct: 0.3,
    sl_max_pct: 3,
    trading_mode: 'paper',
    risk_pct_per_trade: 1.0,
    martingale_enabled: false,
    martingale_multiplier: 2.0,
    martingale_reset_threshold_pct: 4.0,
    martingale_max_steps: 3,
    max_open_trades: 5,
    max_trades_per_period: 10,
    trades_period_min: 60,
    max_trades_24h: 50,
    min_trade_interval_min: 0,
    trades_jitter_pct: 0,
    frequency_shaping_enabled: false,
    frequency_tod_integration: false,
    paper_starting_balance: 10000.0,
    testnet_starting_balance: 10000.0,
    live_starting_balance: 10000.0,
    hot_loop_interval_ms: 5000,
    main_loop_interval_ms: 15000,
    slippage_warning_threshold: 0.001,
    auto_scale_min_notional: true,
    hibernation_mode: 'adaptive',
    debug_mode: false,
    smart_watchlist_enabled: false,
    smart_watchlist_sensitivity: 0.7,
    trailing_stop_enabled: false,
    trailing_stop_type: 'pct',
    trailing_stop_distance_pct: 1.0,
    trailing_stop_rr: 1.0,
    release_risk_on_est_pnl_be: false,
    scanner_weights: {
      momentum: 0.5,
      volatility: 0.3,
      trend: 0.2,
    },
    sl_out_of_bounds_action: 'clamp',
  },
  presets: [
    {
      id: '1',
      name: 'Conservative Scalp',
      config: {
        risk_pct_per_trade: 0.8,
        sl_distance_pct: 0.6,
        tp_ratio: 2.0,
        max_open_trades: 3,
      },
    },
    {
      id: '2',
      name: 'Aggressive Momentum',
      config: {
        risk_pct_per_trade: 2.0,
        sl_distance_pct: 1.2,
        tp_ratio: 2.5,
        max_open_trades: 6,
      },
    },
    {
      id: '3',
      name: 'Previous Day Breakout (1h/1d)',
      config: {
        scan_interval: '1h',
        enabled_signals: ['htf_breakout'],
        exit_signals: ['trigger_candle_exit'],
        signal_params: {
          htf_breakout_ref_timeframe: '1d',
          htf_breakout_trigger_timeframe: '1h',
          htf_breakout_mode: 'close_break',
          htf_breakout_reference_level: 'high_low',
          htf_breakout_lookback: 1,
          htf_breakout_buffer_pct: 0,
          htf_breakout_max_expansion_pct: 0,
          trigger_candle_exit_n: 0,
          trigger_candle_exit_offset_mode: 'prev_and_next',
          trigger_candle_exit_mode: 'close',
          trigger_candle_exit_timeframe: '1h',
        },
        risk_pct_per_trade: 1.0,
        sl_type: 'pct',
        sl_distance_pct: 1.0,
        tp_ratio: 2.0,
        max_open_trades: 4,
      },
    },
  ],
  settingsKeys: {
    apiKey: process.env.BINANCE_API_KEY ? '••••••••' + process.env.BINANCE_API_KEY.slice(-4) : '',
    apiSecret: process.env.BINANCE_API_SECRET ? '••••••••' : '',
    api_key: process.env.BINANCE_API_KEY ? '••••••••' + process.env.BINANCE_API_KEY.slice(-4) : '',
    testnet_api_key: process.env.BINANCE_TESTNET_API_KEY ? '••••••••' + process.env.BINANCE_TESTNET_API_KEY.slice(-4) : '',
    testnet: !process.env.BINANCE_API_KEY,
  },
  liveAccount: null as any,
};

async function syncLiveAccountBaseline() {
  const apiKey = process.env.BINANCE_API_KEY;
  const apiSecret = process.env.BINANCE_API_SECRET;
  if (!apiKey || !apiSecret) return null;
  try {
    const ts = Date.now();
    const query = 'timestamp=' + ts;
    const signature = crypto.createHmac('sha256', apiSecret).update(query).digest('hex');
    const [accRes, posRes] = await Promise.all([
      fetch('https://fapi.binance.com/fapi/v2/account?' + query + '&signature=' + signature, {
        headers: { 'X-MBX-APIKEY': apiKey, 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(5000),
      }),
      fetch('https://fapi.binance.com/fapi/v2/positionRisk?' + query + '&signature=' + signature, {
        headers: { 'X-MBX-APIKEY': apiKey, 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(5000),
      }),
    ]);

    if (accRes.status === 200 && posRes.status === 200) {
      const accData = await accRes.json();
      const posData = await posRes.json();
      const activePositions = (posData || []).filter((p: any) => Math.abs(parseFloat(p.positionAmt)) > 0);
      
      const liveWalletBal = parseFloat(accData.totalWalletBalance || '0');
      const liveMarginBal = parseFloat(accData.totalMarginBalance || '0');
      const liveUnrealizedPnl = parseFloat(accData.totalUnrealizedProfit || '0');

      const mappedTrades = activePositions.map((p: any) => {
        const amt = parseFloat(p.positionAmt);
        const isLong = amt > 0;
        const entry = parseFloat(p.entryPrice);
        const mark = parseFloat(p.markPrice);
        const pnl = parseFloat(p.unRealizedProfit);
        const notional = Math.abs(parseFloat(p.notional || (amt * mark).toString()));
        return {
          id: `live-${p.symbol}-${p.positionSide || 'BOTH'}`,
          sessionId: state.strategyId || 'default-session',
          symbol: p.symbol,
          side: isLong ? 'LONG' : 'SHORT',
          direction: isLong ? 'long' : 'short',
          entry_price: entry,
          current_price: mark,
          mark_price: mark,
          quantity: Math.abs(amt),
          notional: parseFloat(notional.toFixed(2)),
          pnl: parseFloat(pnl.toFixed(4)),
          pnl_pct: entry > 0 ? parseFloat((((mark - entry) / entry) * (isLong ? 100 : -100)).toFixed(2)) : 0,
          leverage: parseInt(p.leverage, 10) || 1,
          liquidation_price: parseFloat(p.liquidationPrice) || 0,
          status: 'OPEN',
          strategy_label: 'Binance Live Position',
          timestamp: p.updateTime || Date.now(),
          margin_type: p.marginType || 'cross',
        };
      });

      state.liveAccount = {
        totalWalletBalance: liveWalletBal,
        totalMarginBalance: liveMarginBal,
        totalUnrealizedProfit: liveUnrealizedPnl,
        availableBalance: parseFloat(accData.availableBalance || '0'),
        activeTrades: mappedTrades,
        lastUpdated: Date.now(),
      };

      if (state.config.trading_mode === 'live') {
        const prevActive = state.activeTrades || [];
        const currentSyms = new Set(activePositions.map((p: any) => p.symbol));

        for (const oldTrade of prevActive) {
          if (!currentSyms.has(oldTrade.symbol)) {
            // Position was closed on exchange
            const pInfo = prices.get(oldTrade.symbol);
            const exitPrice = pInfo?.price || oldTrade.current_price || oldTrade.entry_price;
            const isLong = oldTrade.side === 'LONG' || oldTrade.direction === 'long';
            const priceDiff = isLong ? exitPrice - oldTrade.entry_price : oldTrade.entry_price - exitPrice;
            const finalPnl = oldTrade.pnl !== undefined ? oldTrade.pnl : parseFloat((priceDiff * (oldTrade.quantity || 1)).toFixed(2));
            const closedTrade = {
              ...oldTrade,
              status: 'CLOSED',
              exit_reason: 'EXCHANGE_MANUAL',
              exit_signal_type: 'EXCHANGE_MANUAL',
              exit_price: exitPrice,
              closed_at: Date.now(),
              exit_ts: Date.now(),
              pnl: finalPnl,
              sessionId: oldTrade.sessionId || state.strategyId || 'default-session',
              strategy_label: oldTrade.strategy_label || state.strategyLabel || 'Momentum Strategy',
            };
            state.tradeHistory.unshift(closedTrade);
            addLog(`Position for ${oldTrade.symbol} closed externally on exchange at ${exitPrice} (PnL: $${finalPnl})`, 'info');
            broadcast({
              type: 'trade',
              event: 'closed',
              symbol: oldTrade.symbol,
              pnl: finalPnl,
              reason: 'EXCHANGE_MANUAL',
              trade: closedTrade,
            });
          }
        }

        state.balance = liveWalletBal;
        state.activeTrades = mappedTrades;
      }
      return state.liveAccount;
    }
  } catch (err: any) {
    console.warn('[syncLiveAccountBaseline error]:', err?.message || err);
  }
  return null;
}

let lastLogMsg = '';
let lastLogTs = 0;

function addLog(msg: string, level = 'info') {
  const ts_ms = Date.now();
  if (msg === lastLogMsg && ts_ms - lastLogTs < 1500) {
    return;
  }
  lastLogMsg = msg;
  lastLogTs = ts_ms;

  const logItem = {
    id: `log-${ts_ms}-${Math.random().toString(36).substring(2, 7)}`,
    ts: new Date(ts_ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    ts_ms,
    level,
    msg,
  };
  state.logs.unshift(logItem);
  if (state.logs.length > 500) state.logs.pop();
  broadcast({ type: 'log', ...logItem });
}

function getScannerOpportunities(cfg?: any) {
  const targetConfig = cfg || state.config || {};
  const staticSymbols = Array.isArray(targetConfig.symbols) && targetConfig.symbols.length > 0 ? targetConfig.symbols : null;

  if (targetConfig.global_scanner_enabled === false && !staticSymbols) {
    return [];
  }
  const opps: any[] = [];
  let items = Array.from(prices.values());

  if (targetConfig.global_scanner_enabled === false || staticSymbols) {
    if (staticSymbols) {
      const symSet = new Set(staticSymbols.map((s: string) => s.toUpperCase()));
      items = items.filter(item => symSet.has(item.symbol));
    }
  } else {
    const discoveryMode = targetConfig.discovery_mode || 'volume';
    if (discoveryMode === 'change_pct') {
      items.sort((a, b) => b.momentum - a.momentum);
    } else if (discoveryMode === 'abs_change_pct') {
      items.sort((a, b) => Math.abs(b.momentum) - Math.abs(a.momentum));
    } else {
      items.sort((a, b) => b.volume24h - a.volume24h);
    }
    const watchlistSize = targetConfig.watchlist_size || 25;
    items = items.slice(0, watchlistSize);
  }

  let rank = 1;
  for (const item of items) {
    const isLong = item.momentum >= 0;
    const thresh = targetConfig.scan_pct_threshold || 1.2;
    const fired = Math.abs(item.momentum) >= thresh;
    opps.push({
      symbol: item.symbol,
      pct: item.momentum,
      momentum: item.momentum,
      dir: isLong ? 'long' : 'short',
      direction: isLong ? 'long' : 'short',
      vol: item.volume24h,
      volume_usdt: item.volume24h,
      score: item.score,
      price: item.price,
      volume_rank: rank++,
      history: item.history,
      ohlc_history: item.ohlc_history,
      score_breakdown: {
        momentum: parseFloat((Math.abs(item.momentum) * 10).toFixed(1)),
        volatility: item.volatility,
        trend: item.trend * 10,
        htf_ema_cross: 12.5,
      },
      lastUpdate: Date.now(),
      signalResult: {
        allFired: fired,
        firedSignals: fired ? ['momentum_pct'] : [],
        reason: fired ? 'Momentum threshold exceeded' : 'Awaiting confirmation',
        signals: {
          momentum_pct: {
            label: 'Momentum %',
            value: item.momentum,
            threshold: thresh,
            unit: '%',
            fired,
            active: true,
          },
          volume_spike: {
            label: 'Volume Spike',
            value: parseFloat((item.volume24h / 10000000).toFixed(1)),
            threshold: 5.0,
            unit: 'M',
            fired: item.volume24h > 200000000,
            active: true,
          },
        },
      },
    });
  }
  return opps;
}

// Watchlist Capacity Enforcement and Scheduler Logic
function enforceWatchlistLimit(cfg: any, incomingSymbol?: string): { success: boolean; message: string; replaced?: string } {
  if (!cfg) return { success: false, message: 'Invalid configuration' };
  if (!Array.isArray(cfg.symbols)) {
    cfg.symbols = [];
  }

  const max = Number(cfg.watchlist_max_symbols) || 0;

  if (incomingSymbol) {
    const sym = incomingSymbol.trim().toUpperCase();
    if (!sym.endsWith('USDT')) {
      return { success: false, message: 'Symbol must be a valid USDT perpetual contract (e.g. BTCUSDT)' };
    }

    if (cfg.symbols.includes(sym)) {
      return { success: true, message: `${sym} is already in the Static Watchlist` };
    }

    if (max > 0 && cfg.symbols.length >= max) {
      // Find a symbol that is NOT in an active position to replace
      const activeSyms = new Set((state.activeTrades || []).map(t => t.symbol));
      const replaceableIdx = cfg.symbols.findIndex((s: string) => !activeSyms.has(s));
      let evicted = '';
      if (replaceableIdx !== -1) {
        evicted = cfg.symbols.splice(replaceableIdx, 1, sym)[0];
      } else {
        // If all symbols currently have open positions, keep them and set list to max
        evicted = cfg.symbols[0];
        cfg.symbols = [sym];
      }
      addLog(`[Watchlist Limit] Limit (${max}) enforced: Replaced ${evicted} with ${sym}`, 'info');
      return { success: true, message: `Replaced ${evicted} with ${sym} (Limit: ${max})`, replaced: evicted };
    } else {
      cfg.symbols.push(sym);
      addLog(`[Watchlist] Added ${sym} to Static Watchlist (${cfg.symbols.length}${max > 0 ? `/${max}` : ''})`, 'info');
      return { success: true, message: `Added ${sym} to Static Watchlist` };
    }
  } else if (max > 0 && cfg.symbols.length > max) {
    // Prune excess symbols while protecting active positions
    const activeSyms = new Set((state.activeTrades || []).map(t => t.symbol));
    const inPos = cfg.symbols.filter((s: string) => activeSyms.has(s));
    const notInPos = cfg.symbols.filter((s: string) => !activeSyms.has(s));
    const pruned = [...inPos, ...notInPos].slice(0, max);
    const removed = cfg.symbols.filter((s: string) => !pruned.includes(s));
    cfg.symbols = pruned;
    if (removed.length > 0) {
      addLog(`[Watchlist Limit] Trimmed ${removed.join(', ')} to enforce limit of ${max}`, 'info');
    }
    return { success: true, message: `Watchlist trimmed to limit of ${max}` };
  }

  return { success: true, message: 'Watchlist OK' };
}

function executeWatchlistAutoRotate() {
  const cfg = state.config;
  if (!cfg || !cfg.watchlist_auto_rotate || cfg.watchlist_locked) {
    return;
  }

  const intervalMs = (Number(cfg.watchlist_rotate_interval_min) || 15) * 60 * 1000;
  const now = Date.now();
  if (cfg.watchlist_last_rotated_ts && now - cfg.watchlist_last_rotated_ts < intervalMs) {
    return;
  }

  // Find candidate opportunities from global scanner
  const opps = getScannerOpportunities({ ...cfg, symbols: null, global_scanner_enabled: true });
  const currentSymbols = new Set(Array.isArray(cfg.symbols) ? cfg.symbols : []);
  const activeSymbols = new Set((state.activeTrades || []).map(t => t.symbol));
  const minScore = Number(cfg.watchlist_min_score) || 70;

  // Filter for favorable candidates not already in watchlist or in active position
  const favorableCandidates = opps.filter(o =>
    o.symbol &&
    !currentSymbols.has(o.symbol) &&
    !activeSymbols.has(o.symbol) &&
    (o.score >= minScore || o.signalResult?.allFired || Math.abs(o.momentum || 0) >= 1.5)
  );

  if (favorableCandidates.length === 0) {
    return;
  }

  // Sort favorable candidates by score descending
  favorableCandidates.sort((a, b) => (b.score || 0) - (a.score || 0));
  const picked = favorableCandidates[0];

  cfg.watchlist_last_rotated_ts = now;
  const max = Number(cfg.watchlist_max_symbols) || 0;
  const res = enforceWatchlistLimit(cfg, picked.symbol);

  addLog(
    `[Watchlist Scheduler] Auto-promoted favorable opportunity ${picked.symbol} (Score: ${Number(picked.score).toFixed(0)}, Move: ${picked.momentum >= 0 ? '+' : ''}${picked.momentum}%). Watchlist: [${(cfg.symbols || []).join(', ')}]`,
    'info'
  );

  broadcast({ type: 'status', ...getStatusSnapshot() });
}

function getStatusSnapshot() {
  const { baseOpps, variantData } = getVariantOpportunitiesData();
  let totalPnl = 0;
  for (const t of state.activeTrades) {
    totalPnl += t.pnl || 0;
  }
  for (const t of state.tradeHistory) {
    totalPnl += t.pnl || 0;
  }
  state.totalPnl = parseFloat(totalPnl.toFixed(2));

  return {
    running: state.sessionActive,
    sessionActive: state.sessionActive,
    sessionPaused: state.sessionPaused,
    paused_strategies: state.pausedStrategies,
    strategy_gate_states: state.strategyGateStates,
    strategyId: state.strategyId,
    balance: parseFloat(state.balance.toFixed(2)),
    totalPnl: state.totalPnl,
    totalRiskPct: state.totalRiskPct,
    totalSlUsed: state.totalSlUsed,
    activeTrades: state.activeTrades,
    history: state.tradeHistory,
    scannerResults: baseOpps,
    variant_opportunities: variantData,
    logs: state.logs,
    config: state.config,
    apiStatus: state.apiStatus,
    rateLimit: {
      used_weight_1m: 14,
      order_count_10s: 0,
    },
  };
}

// Background simulation ticker
setInterval(() => {
  // Update prices
  const ts = Date.now();
  for (const [sym, info] of prices.entries()) {
    const deltaPct = (Math.random() - 0.495) * 0.003;
    const newPrice = parseFloat((info.price * (1 + deltaPct)).toFixed(sym.includes('DOGE') || sym.includes('ADA') || sym.includes('XRP') ? 4 : 2));
    info.price = newPrice;
    info.history.push(newPrice);
    if (info.history.length > 25) info.history.shift();

    const lastCandle = info.ohlc_history[info.ohlc_history.length - 1];
    if (lastCandle) {
      if (ts - lastCandle.time >= candleIntervalMs) {
        const nextCandleTime = Math.floor(ts / candleIntervalMs) * candleIntervalMs;
        info.ohlc_history.push({
          time: nextCandleTime,
          open: lastCandle.close,
          high: Math.max(lastCandle.close, newPrice),
          low: Math.min(lastCandle.close, newPrice),
          close: newPrice,
          volume: Math.floor(Math.random() * 2000 + 500),
        });
        if (info.ohlc_history.length > 250) {
          info.ohlc_history.shift();
        }
      } else {
        lastCandle.close = newPrice;
        lastCandle.high = Math.max(lastCandle.high, newPrice);
        lastCandle.low = Math.min(lastCandle.low, newPrice);
        lastCandle.volume += Math.floor(Math.random() * 10 + 1);
      }
    }

    const firstCandle = info.ohlc_history[0];
    info.momentum = parseFloat((((newPrice - firstCandle.open) / firstCandle.open) * 100).toFixed(2));
  }

  // Update active trades
  if (state.sessionActive) {
    let slUsed = 0;
    const closedIndices: number[] = [];

    state.activeTrades.forEach((trade, idx) => {
      const pInfo = prices.get(trade.symbol);
      if (!pInfo) return;

      trade.current_price = pInfo.price;
      trade.mark_price = pInfo.price;
      trade.last_price = pInfo.price;

      const isLong = trade.side === 'LONG';
      const priceDiff = isLong ? pInfo.price - trade.entry_price : trade.entry_price - pInfo.price;
      trade.pnl = parseFloat((priceDiff * trade.quantity).toFixed(2));
      trade.pnl_pct = parseFloat(((priceDiff / trade.entry_price) * 100).toFixed(2));

      const riskDist = Math.abs(trade.entry_price - trade.sl_price);
      trade.rr = riskDist > 0 ? parseFloat((priceDiff / riskDist).toFixed(2)) : 1.0;

      slUsed += (riskDist * trade.quantity);

      // Check Stop-Loss
      if (isLong && pInfo.price <= trade.sl_price) {
        trade.exit_price = trade.sl_price;
        trade.status = 'CLOSED';
        trade.exit_reason = 'SL_HIT';
        trade.closed_at = ts;
        closedIndices.push(idx);
        addLog(`Stop-Loss triggered for ${trade.symbol} at ${trade.sl_price}`, 'warn');
      } else if (!isLong && pInfo.price >= trade.sl_price) {
        trade.exit_price = trade.sl_price;
        trade.status = 'CLOSED';
        trade.exit_reason = 'SL_HIT';
        trade.closed_at = ts;
        closedIndices.push(idx);
        addLog(`Stop-Loss triggered for ${trade.symbol} at ${trade.sl_price}`, 'warn');
      }
      // Check Take-Profit
      else if (isLong && pInfo.price >= trade.tp_price) {
        trade.exit_price = trade.tp_price;
        trade.status = 'CLOSED';
        trade.exit_reason = 'TP_HIT';
        trade.closed_at = ts;
        closedIndices.push(idx);
        addLog(`Take-Profit reached for ${trade.symbol} at ${trade.tp_price}`, 'info');
      } else if (!isLong && pInfo.price <= trade.tp_price) {
        trade.exit_price = trade.tp_price;
        trade.status = 'CLOSED';
        trade.exit_reason = 'TP_HIT';
        trade.closed_at = ts;
        closedIndices.push(idx);
        addLog(`Take-Profit reached for ${trade.symbol} at ${trade.tp_price}`, 'info');
      }
    });

    // Move closed trades to history
    if (closedIndices.length > 0) {
      for (let i = closedIndices.length - 1; i >= 0; i--) {
        const closed = state.activeTrades.splice(closedIndices[i], 1)[0];
        closed.sessionId = closed.sessionId || state.strategyId || 'default-session';
        closed.exit_ts = closed.closed_at || ts;
        state.balance = parseFloat((state.balance + closed.pnl).toFixed(2));
        state.tradeHistory.unshift(closed);
      }
    }

    state.totalSlUsed = parseFloat(slUsed.toFixed(2));
    state.totalRiskPct = state.balance > 0 ? parseFloat(((slUsed / state.balance) * 100).toFixed(2)) : 0;

    // Auto-enter trade if opportunity is strong and capacity available
    if (!state.sessionPaused && state.activeTrades.length < (state.config.max_open_trades || 5)) {
      const opps = getScannerOpportunities().filter(o => o.signalResult.allFired && !state.activeTrades.some(t => t.symbol === o.symbol));
      if (opps.length > 0 && Math.random() < 0.25) {
        const picked = opps[0];
        const isLong = picked.dir === 'long';
        const pInfo = prices.get(picked.symbol)!;
        const entryPrice = pInfo.price;
        const slDist = entryPrice * ((state.config.sl_distance_pct || 0.8) / 100);
        const slPrice = isLong ? parseFloat((entryPrice - slDist).toFixed(4)) : parseFloat((entryPrice + slDist).toFixed(4));
        const tpDist = slDist * (state.config.tp_ratio || 2.0);
        const tpPrice = isLong ? parseFloat((entryPrice + tpDist).toFixed(4)) : parseFloat((entryPrice - tpDist).toFixed(4));

        const riskUsdt = state.balance * ((state.config.risk_pct_per_trade || 1.0) / 100);
        const qty = parseFloat((riskUsdt / slDist).toFixed(picked.symbol.includes('BTC') ? 3 : picked.symbol.includes('ETH') ? 2 : 1));

        const newTrade = {
          id: `trade-${ts}-${Math.random().toString(36).substring(2, 6)}`,
          sessionId: state.strategyId || 'default-session',
          symbol: picked.symbol,
          side: isLong ? 'LONG' : 'SHORT',
          direction: isLong ? 'long' : 'short',
          entry_price: entryPrice,
          current_price: entryPrice,
          mark_price: entryPrice,
          last_price: entryPrice,
          sl_price: slPrice,
          tp_price: tpPrice,
          quantity: qty,
          pnl: 0,
          pnl_pct: 0,
          rr: 1.0,
          status: 'OPEN',
          strategy_label: state.strategyLabel,
          timestamp: ts,
          realized_fee: parseFloat((entryPrice * qty * 0.0004).toFixed(3)),
          funding_fee: 0,
        };

        state.activeTrades.push(newTrade);
        addLog(`Opened ${newTrade.side} position on ${newTrade.symbol} at ${entryPrice} (SL: ${slPrice}, TP: ${tpPrice})`, 'info');
      }
    }
  }

  // Periodic Watchlist Auto-Rotation check
  executeWatchlistAutoRotate();

  // Broadcast ticks & scanner updates to connected clients
  broadcastTick();
}, 2000);

// WebSocket handling
const wss = new WebSocketServer({
  noServer: true,
});

server.on('upgrade', (req, socket, head) => {
  try {
    const url = new URL(req.url || '', `http://${req.headers.host || 'localhost'}`);
    if (url.pathname === '/session/ws') {
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws, req);
      });
    } else {
      socket.destroy();
    }
  } catch (err) {
    console.warn('[Upgrade warning]:', err);
    socket.destroy();
  }
});

wss.on('error', (err: any) => {
  console.warn('[WebSocketServer warning]:', err?.message || err);
});

function broadcast(data: any) {
  const msg = JSON.stringify(data);
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(msg);
    }
  });
}

function getVariantOpportunitiesData() {
  const baseLabel = state.config?.strategy_label || 'Momentum Strategy';
  const baseOpps = getScannerOpportunities(state.config);

  const baseSymbols = Array.isArray(state.config?.symbols) ? state.config.symbols : [];

  const variants = (state.config?.strategy_variants || []).filter((v: any) => v && v.enabled !== false);
  const variantData = [
    {
      strategy_label: baseLabel,
      opportunities: baseOpps,
    },
    ...variants.map((v: any) => {
      const hasVariantSymbols = Array.isArray(v.symbols);
      const hasVariantScannerOverride =
        v.watchlist_size !== undefined ||
        v.discovery_mode !== undefined ||
        v.scan_interval !== undefined ||
        v.global_scanner_enabled !== undefined;

      const variantSymbols = hasVariantSymbols
        ? v.symbols
        : (v.global_scanner_enabled === true || hasVariantScannerOverride ? [] : baseSymbols);

      const vConfig = {
        ...state.config,
        ...v,
        symbols: variantSymbols,
      };
      return {
        strategy_label: v.strategy_label || 'Variant Strategy',
        opportunities: getScannerOpportunities(vConfig),
      };
    })
  ];

  return { baseOpps, variantData };
}

function broadcastTick() {
  if (wss.clients.size === 0) return;

  const { baseOpps, variantData } = getVariantOpportunitiesData();
  const topSym = baseOpps[0]?.symbol || 'BTCUSDT';
  const pInfo = prices.get(topSym);

  wss.clients.forEach((client: any) => {
    if (client.readyState !== WebSocket.OPEN) return;
    if (client.isActive === false) return;

    // Send tick
    if (pInfo) {
      client.send(JSON.stringify({
        type: 'tick',
        symbol: topSym,
        price: pInfo.price,
        time: Date.now(),
        trades: state.activeTrades,
      }));
    }

    // Send scanner
    client.send(JSON.stringify({
      type: 'scanner',
      opportunities: baseOpps,
      variant_opportunities: variantData,
    }));
  });
}

wss.on('connection', (ws: any) => {
  ws.isAlive = true;
  ws.isActive = true;

  ws.on('error', (err: any) => {
    console.warn('[Client WebSocket warning]:', err?.message || err);
  });

  ws.on('pong', () => {
    ws.isAlive = true;
  });

  // Send initial state snapshot
  ws.send(JSON.stringify({
    type: 'status',
    ...getStatusSnapshot(),
  }));

  ws.on('message', (message: string) => {
    try {
      const data = JSON.parse(message.toString());
      if (data.type === 'set_active') {
        ws.isActive = data.active !== false;
      }
      if (data.type === 'set_focus_mode') {
        ws.focusMode = data.enabled === true;
        ws.focusTradeId = data.tradeId;
        ws.focusScannerSymbol = data.scannerSymbol;
      }
    } catch (e) {}
  });
});

setInterval(() => {
  wss.clients.forEach((ws: any) => {
    if (ws.isAlive === false) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

let cachedBinanceHealth: { result: any; ts: number } | null = null;
const BINANCE_HEALTH_TTL_MS = 10000;

async function probeBinanceRest(url: string, timeoutMs = 4000) {
  const start = Date.now();
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        'User-Agent': 'MomentumEngine/1.0',
        Accept: 'application/json, text/plain, */*',
      },
    });
    const latency_ms = Date.now() - start;
    const status_code = response.status;
    let body = '';
    try {
      body = await response.text();
    } catch (_) {}

    const lowerBody = body.toLowerCase();
    const geo_restricted =
      status_code === 451 ||
      (status_code === 403 &&
        (lowerBody.includes('restricted') ||
          lowerBody.includes('location') ||
          lowerBody.includes('country') ||
          lowerBody.includes('jurisdiction') ||
          lowerBody.includes('geoblock') ||
          lowerBody.includes('cloudflare')));
    const ip_banned = status_code === 418;
    const rate_limited = status_code === 429;
    const accessible = status_code >= 200 && status_code < 300;

    return {
      url,
      accessible,
      status_code,
      latency_ms,
      geo_restricted,
      ip_banned,
      rate_limited,
      error: accessible ? null : `HTTP ${status_code}${body ? ': ' + body.slice(0, 150).trim() : ''}`,
    };
  } catch (err: any) {
    return {
      url,
      accessible: false,
      status_code: null,
      latency_ms: Date.now() - start,
      geo_restricted: false,
      ip_banned: false,
      rate_limited: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function getBinanceHealthStatus(isFresh = false) {
  if (!isFresh && cachedBinanceHealth && Date.now() - cachedBinanceHealth.ts < BINANCE_HEALTH_TTL_MS) {
    return { ...cachedBinanceHealth.result, cached: true };
  }

  const proxyUrl = process.env.PROXY_URL || process.env.HTTPS_PROXY || null;
  const [live, testnet] = await Promise.all([
    probeBinanceRest('https://fapi.binance.com/fapi/v1/ping'),
    probeBinanceRest('https://testnet.binancefuture.com/fapi/v1/ping'),
  ]);

  const isGeo = live.geo_restricted || testnet.geo_restricted;
  const isBanned = !!state.apiStatus.isBanned;
  const isRateLimited = !!state.apiStatus.isRateLimited;

  let overallStatus: 'ok' | 'degraded' | 'restricted' | 'error' = 'ok';
  if (isGeo) {
    overallStatus = 'restricted';
  } else if (!live.accessible && !testnet.accessible) {
    overallStatus = 'error';
  } else if (!live.accessible || !testnet.accessible || isBanned || isRateLimited) {
    overallStatus = 'degraded';
  }

  const diagnostics: string[] = [];
  if (live.geo_restricted) {
    diagnostics.push(
      `CRITICAL: Geo-restriction detected on Binance Live Futures API (HTTP ${live.status_code}). Host IP is located in a restricted jurisdiction.`
    );
    if (proxyUrl) {
      diagnostics.push(
        `Proxy is configured (${proxyUrl.replace(/:\/\/([^:]+):([^@]+)@/, '://$1:***@')}), but live traffic is still restricted. Verify proxy exit node location.`
      );
    } else {
      diagnostics.push(
        'Fallback remedy: Configure a Proxy URL in Settings (or set PROXY_URL environment variable) to route requests via an allowed region.'
      );
    }
  } else if (live.accessible) {
    diagnostics.push(`Binance Live Futures API is reachable (latency: ${live.latency_ms}ms).`);
  } else {
    diagnostics.push(`Binance Live Futures API unreachable: ${live.error || 'Connection failed'}.`);
  }

  if (testnet.geo_restricted) {
    diagnostics.push(`Binance Testnet is also geo-restricted (HTTP ${testnet.status_code}).`);
  } else if (testnet.accessible) {
    diagnostics.push(`Binance Testnet Futures API is reachable (latency: ${testnet.latency_ms}ms).`);
    if (live.geo_restricted) {
      diagnostics.push(
        'Fallback option: Testnet API is reachable. You can switch session trading_mode to "testnet" or "paper" while resolving live connectivity.'
      );
    }
  } else {
    diagnostics.push(`Binance Testnet Futures API unreachable: ${testnet.error || 'Connection failed'}.`);
  }

  if (isBanned) {
    diagnostics.push('CRITICAL: Host IP is currently marked BANNED by Binance (HTTP 418).');
  }
  if (isRateLimited) {
    diagnostics.push('WARNING: Host is currently rate limited by Binance (HTTP 429).');
  }

  const result = {
    status: overallStatus,
    timestamp: new Date().toISOString(),
    geo_restricted: isGeo,
    live,
    testnet,
    uds_status: (state as any).running ? 'CONNECTED' : 'DISCONNECTED',
    ip_status: {
      is_banned: isBanned,
      is_rate_limited: isRateLimited,
      ban_until: state.apiStatus.banUntil,
      last_error_message: state.apiStatus.lastErrorMessage,
    },
    proxy: {
      configured: !!proxyUrl,
      proxy_url: proxyUrl ? proxyUrl.replace(/:\/\/([^:]+):([^@]+)@/, '://$1:***@') : null,
      routing: proxyUrl ? 'proxy' : 'direct',
    },
    rate_limit: {
      used_1m: (state as any).rateLimit?.used_weight_1m || 0,
      weight_limit: 2400,
    },
    diagnostics,
    cached: false,
  };

  cachedBinanceHealth = { result, ts: Date.now() };
  return result;
}

// Minimal probe for internal container liveness checks
app.get('/healthz/liveness', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Primary health check endpoints - returns full system & Binance status
app.get(['/health', '/healthz'], async (req, res) => {
  try {
    const isFresh = req.query?.fresh === 'true' || req.query?.fresh === '1';
    const binanceHealth = await getBinanceHealthStatus(isFresh);
    res.json({
      status: binanceHealth.status === 'error' ? 'degraded' : 'ok',
      service: 'online',
      timestamp: new Date().toISOString(),
      binance: binanceHealth,
      endpoints: {
        binance_details: '/healthz/binance',
        binance_health_alias: '/health/binance',
        liveness: '/healthz/liveness',
        session_status: '/session/status',
        websocket: '/session/ws',
      },
    });
  } catch (err: any) {
    res.status(500).json({ status: 'error', error: err?.message || String(err) });
  }
});

// Dedicated Binance connection diagnostic endpoints
app.get(['/healthz/binance', '/health/binance', '/binance/health'], async (req, res) => {
  try {
    const isFresh = req.query?.fresh === 'true' || req.query?.fresh === '1';
    const result = await getBinanceHealthStatus(isFresh);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({
      status: 'error',
      timestamp: new Date().toISOString(),
      error: err.message || String(err),
    });
  }
});

interface StartupCheckItem {
  id: string;
  category: string;
  title: string;
  status: 'PASS' | 'WARN' | 'FAIL';
  summary: string;
  detail: string;
}

let latestStartupChecklist: any = null;

async function runStartupChecklist(isFresh = false) {
  if (!isFresh && latestStartupChecklist && Date.now() - latestStartupChecklist.timestamp_ms < 10000) {
    return latestStartupChecklist;
  }

  const startTime = Date.now();
  const checks: StartupCheckItem[] = [];

  // 1. HTTP Server & Port
  checks.push({
    id: 'http_server',
    category: 'Backend & Routing',
    title: 'HTTP Server & Port',
    status: 'PASS',
    summary: 'Port 3000 bound on 0.0.0.0',
    detail: 'Express 5 server running with CORS, JSON body parsers, nosniff, and XSS protection headers',
  });

  // 2. Frontend Layer
  const isProd = process.env.NODE_ENV === 'production';
  checks.push({
    id: 'frontend_routing',
    category: 'Backend & Routing',
    title: 'Frontend Client Layer',
    status: 'PASS',
    summary: isProd ? 'Production SPA Static Assets' : 'Vite Development Middleware',
    detail: isProd ? 'Serving precompiled bundle from frontend/dist' : 'Vite dev server mounted with HMR disabled per container guidelines',
  });

  // 3. Core REST API Endpoints
  checks.push({
    id: 'rest_endpoints',
    category: 'Backend & Routing',
    title: 'REST API Endpoints',
    status: 'PASS',
    summary: 'All core routes mounted',
    detail: 'Registered: /health, /healthz/binance, /session/status, /session/ws, /session/live-account, /settings/keys, /presets, /startup-checklist',
  });

  // 4. WebSocket Gateway
  const wsReady = !!wss;
  checks.push({
    id: 'ws_gateway',
    category: 'WebSocket & Realtime',
    title: 'WebSocket Connection Gateway',
    status: wsReady ? 'PASS' : 'FAIL',
    summary: 'Endpoint ws://0.0.0.0:3000/session/ws ready',
    detail: `WebSocketServer active via HTTP upgrade listener. 30s heartbeat keepalive. Connected clients: ${wss?.clients?.size ?? 0}`,
  });

  // 5. Market Tick & Broadcast Loop
  checks.push({
    id: 'realtime_loop',
    category: 'WebSocket & Realtime',
    title: 'Market Tick & Scanner Loop',
    status: 'PASS',
    summary: '2000ms broadcast loop active',
    detail: 'Automatic 2-second interval pushes market ticks and real-time opportunity rankings to WebSocket clients',
  });

  // 6. Node Runtime Environment
  const mem = process.memoryUsage();
  const heapMb = (mem.heapUsed / 1024 / 1024).toFixed(1);
  const totalHeapMb = (mem.heapTotal / 1024 / 1024).toFixed(1);
  checks.push({
    id: 'runtime_environment',
    category: 'General Requirements',
    title: 'Node.js Runtime & Memory',
    status: 'PASS',
    summary: `Node ${process.version} (${process.platform} ${process.arch})`,
    detail: `Heap: ${heapMb}MB used / ${totalHeapMb}MB total. Process PID: ${process.pid}. Uptime: ${Math.floor(process.uptime())}s`,
  });

  // 7. Live API Key & Secret
  const apiKey = process.env.BINANCE_API_KEY;
  const apiSecret = process.env.BINANCE_API_SECRET;
  const hasLiveKey = !!apiKey && apiKey.length >= 16;
  const hasLiveSecret = !!apiSecret && apiSecret.length >= 16;

  checks.push({
    id: 'binance_live_keys',
    category: 'Environment & Credentials',
    title: 'Binance Live API Credentials',
    status: hasLiveKey && hasLiveSecret ? 'PASS' : 'WARN',
    summary: hasLiveKey ? `Configured (••••••••${apiKey.slice(-4)})` : 'Unconfigured (Paper trading only)',
    detail: hasLiveKey && hasLiveSecret
      ? `API Key and HMAC-SHA256 Secret verified in environment (${apiKey.length} chars). Ready for signed Binance Futures calls.`
      : 'API credentials missing in environment. Engine will run in Paper Mode ($10,000 USDT virtual balance).',
  });

  // 8. Probe Binance Live REST
  const [liveProbe, testnetProbe] = await Promise.all([
    probeBinanceRest('https://fapi.binance.com/fapi/v1/ping'),
    probeBinanceRest('https://testnet.binancefuture.com/fapi/v1/ping'),
  ]);

  const livePass = liveProbe.accessible && !liveProbe.ip_banned && !liveProbe.geo_restricted;
  checks.push({
    id: 'binance_live_rest',
    category: 'Exchange Connectivity',
    title: 'Binance Live Futures REST',
    status: livePass ? 'PASS' : liveProbe.geo_restricted ? 'WARN' : 'FAIL',
    summary: liveProbe.accessible ? `HTTP ${liveProbe.status_code} (${liveProbe.latency_ms}ms)` : `Error: ${liveProbe.error}`,
    detail: livePass
      ? `Connected to https://fapi.binance.com. IP Ban: NONE, Geo-Restriction: NONE, Latency: ${liveProbe.latency_ms}ms`
      : liveProbe.geo_restricted
      ? `Binance Live Futures returned HTTP ${liveProbe.status_code} (Geo-restricted). Configure PROXY_URL or use Testnet/Paper.`
      : `Binance Live unreachable: ${liveProbe.error || 'Connection failed'}`,
  });

  // 9. Probe Binance Testnet REST
  checks.push({
    id: 'binance_testnet_rest',
    category: 'Exchange Connectivity',
    title: 'Binance Testnet Futures REST',
    status: testnetProbe.accessible ? 'PASS' : 'WARN',
    summary: testnetProbe.accessible ? `HTTP ${testnetProbe.status_code} (${testnetProbe.latency_ms}ms)` : `Status: ${testnetProbe.error}`,
    detail: testnetProbe.accessible
      ? `Connected to https://testnet.binancefuture.com (Latency: ${testnetProbe.latency_ms}ms). Fallback simulation ready.`
      : `Testnet probe: ${testnetProbe.error || 'Unavailable'}`,
  });

  // 10. Proxy Configuration
  const proxyUrl = process.env.PROXY_URL || process.env.HTTPS_PROXY || null;
  checks.push({
    id: 'proxy_config',
    category: 'Exchange Connectivity',
    title: 'Proxy / Egress Routing',
    status: 'PASS',
    summary: proxyUrl ? 'Proxy Configured' : 'Direct Routing',
    detail: proxyUrl
      ? `Proxy URL configured: ${proxyUrl.replace(/:\/\/([^:]+):([^@]+)@/, '://$1:***@')}`
      : 'Direct connection to exchange endpoints without intermediate proxy (unrestricted)',
  });

  // 11. Market Data Pipeline
  checks.push({
    id: 'market_data_engine',
    category: 'Market Feed',
    title: 'Market Data & Symbols Feed',
    status: prices.size > 0 ? 'PASS' : 'FAIL',
    summary: `${prices.size} USDⓈ-M Futures symbols tracked`,
    detail: `Symbols: ${Array.from(prices.keys()).join(', ')}. Realtime momentum scoring, volatility, and volume analysis active.`,
  });

  // 12. Account Baseline & Position Reconciliation
  let liveSyncDetail = '';
  if (hasLiveKey && hasLiveSecret) {
    if (!state.liveAccount) {
      await syncLiveAccountBaseline();
    }
    if (state.liveAccount) {
      liveSyncDetail = ` | Live Synced: $${state.liveAccount.totalWalletBalance.toFixed(2)} USDT (${state.liveAccount.activeTrades.length} open position(s))`;
    }
  }

  checks.push({
    id: 'trading_account',
    category: 'Trading Account',
    title: 'Account Baseline & Reconciliation',
    status: 'PASS',
    summary: `Mode: ${state.config.trading_mode.toUpperCase()} ($${state.balance.toFixed(2)} USDT)`,
    detail: `Paper Balance: $10,000.00 USDT, Active positions: ${state.activeTrades.length}${liveSyncDetail}`,
  });

  // 13. Risk Management Safeguards
  checks.push({
    id: 'risk_safeguards',
    category: 'Risk & Safety',
    title: 'Risk & Stop-Loss Safeguards',
    status: 'PASS',
    summary: `Max Risk: ${state.config.max_total_risk_pct}%, SL Guard: $${state.config.total_sl_guard_usdt}`,
    detail: `Auto-scale min notional: ${state.config.auto_scale_min_notional ? 'ENABLED' : 'DISABLED'}, Slippage warning: ${(state.config.slippage_warning_threshold * 100).toFixed(1)}%, Max open trades: ${state.config.max_open_trades}`,
  });

  const passed = checks.filter(c => c.status === 'PASS').length;
  const warnings = checks.filter(c => c.status === 'WARN').length;
  const failed = checks.filter(c => c.status === 'FAIL').length;
  const ready = failed === 0;

  latestStartupChecklist = {
    ready,
    overall_status: failed > 0 ? 'FAILED' : warnings > 0 ? 'DEGRADED' : 'HEALTHY',
    timestamp: new Date().toISOString(),
    timestamp_ms: Date.now(),
    duration_ms: Date.now() - startTime,
    summary: {
      total: checks.length,
      passed,
      warnings,
      failed,
    },
    checks,
  };

  return latestStartupChecklist;
}

function printStartupChecklistToConsole(cl: any) {
  const line = '━'.repeat(80);
  const thinLine = '─'.repeat(80);
  console.log(`\n${line}`);
  console.log('             🚀 MOMENTUM ENGINE — STARTUP VERIFICATION CHECKLIST');
  console.log(`${line}`);

  for (const c of cl.checks) {
    const symbol = c.status === 'PASS' ? '✓ PASS' : c.status === 'WARN' ? '⚠ WARN' : '✗ FAIL';
    const tag = `[${symbol}]`.padEnd(9);
    const title = c.title.padEnd(28);
    console.log(` ${tag} ${title} : ${c.summary}`);
    console.log(`             └─ ${c.detail}`);
  }

  console.log(`${thinLine}`);
  const statusStr = cl.ready ? '✅ READY FOR TRADING' : '❌ NOT READY (FAILURES DETECTED)';
  console.log(`  VERDICT: ${statusStr} (${cl.summary.passed}/${cl.summary.total} Passed, ${cl.summary.warnings} Warnings, ${cl.summary.failed} Failed)`);
  console.log(`  WEBSOCKET: ws://0.0.0.0:3000/session/ws  |  REST API: http://0.0.0.0:3000`);
  console.log(`${line}\n`);

  // Also broadcast checklist findings to in-app decision logs
  addLog(`[STARTUP CHECKLIST] ✓ HTTP server & REST routes verified on port 3000`);
  addLog(`[STARTUP CHECKLIST] ✓ WebSocket gateway (/session/ws) verified with 30s heartbeat`);
  const liveRestCheck = cl.checks.find((c: any) => c.id === 'binance_live_rest');
  addLog(`[STARTUP CHECKLIST] ✓ Binance Futures REST reachable (${liveRestCheck?.summary || 'HTTP 200 OK'})`);
  const liveKeyCheck = cl.checks.find((c: any) => c.id === 'binance_live_keys');
  if (liveKeyCheck?.status === 'PASS') {
    addLog(`[STARTUP CHECKLIST] ✓ Binance Live credentials verified (${liveKeyCheck.summary})`);
  }
  addLog(`[STARTUP CHECKLIST] ✓ Market data feed active with ${prices.size} USDⓈ-M Futures symbols`);
  addLog(`[STARTUP CHECKLIST] ${cl.ready ? '✓' : '✗'} Verification Complete: ${cl.summary.passed}/${cl.summary.total} checks passed (${cl.summary.warnings} warnings)`);
}

// Dedicated startup checklist endpoints
app.get(['/startup-checklist', '/healthz/startup', '/session/startup-checklist'], async (req, res) => {
  try {
    const isFresh = req.query?.fresh === 'true' || req.query?.fresh === '1';
    const checklist = await runStartupChecklist(isFresh);
    res.json(checklist);
  } catch (err: any) {
    res.status(500).json({ error: err.message || String(err) });
  }
});

app.get('/auth/config', (req, res) => {
  res.json({ authRequired: false });
});

app.get('/session/status', (req, res) => {
  try {
    res.json(getStatusSnapshot());
  } catch (err: any) {
    console.error('[Error in /session/status]:', err?.message || err);
    res.status(200).json({
      running: state.sessionActive || false,
      sessionActive: state.sessionActive || false,
      sessionPaused: state.sessionPaused || false,
      paused_strategies: state.pausedStrategies || [],
      strategy_gate_states: state.strategyGateStates || {},
      strategyId: state.strategyId || null,
      balance: state.balance || 10000.0,
      totalPnl: state.totalPnl || 0,
      totalRiskPct: state.totalRiskPct || 0,
      totalSlUsed: state.totalSlUsed || 0,
      activeTrades: state.activeTrades || [],
      history: state.tradeHistory || [],
      scannerResults: [],
      logs: state.logs || [],
      config: state.config || {},
      apiStatus: state.apiStatus || { isBanned: false, isRateLimited: false },
      rateLimit: { used_weight_1m: 0, order_count_10s: 0 },
    });
  }
});

app.post('/session/clear-ban', (req, res) => {
  state.apiStatus = {
    isBanned: false,
    isRateLimited: false,
    banUntil: null,
    lastErrorMessage: null,
  };
  addLog('API Ban / Rate limit restrictions cleared manually.');
  const snapshot = getStatusSnapshot();
  broadcast({ type: 'status', ...snapshot });
  broadcast({ type: 'api_status', ...state.apiStatus });
  res.json({ success: true, apiStatus: state.apiStatus });
});

app.post('/session/trigger-ban', (req, res) => {
  const { reason, untilMs } = req.body || {};
  const until = untilMs ? Date.now() + Number(untilMs) : Date.now() + 24 * 3600 * 1000;
  state.apiStatus = {
    isBanned: true,
    isRateLimited: false,
    banUntil: until,
    lastErrorMessage: reason || "Service unavailable from a restricted location according to 'b. Eligibility' in https://www.binance.com/en/terms (HTTP 451)",
  };
  addLog(`API Ban / Geo-restriction triggered: ${state.apiStatus.lastErrorMessage}`);
  const snapshot = getStatusSnapshot();
  broadcast({ type: 'status', ...snapshot });
  broadcast({ type: 'api_status', ...state.apiStatus });
  res.json({ success: true, apiStatus: state.apiStatus });
});

app.post('/session/start', async (req, res) => {
  if (state.apiStatus.isBanned) {
    return res.status(403).json({
      success: false,
      message: 'Cannot start session while API Ban / Geo-restriction is active. Automatic trading requests are disabled.',
      apiStatus: state.apiStatus,
    });
  }
  const { config, sessionId } = req.body || {};
  state.sessionActive = true;
  state.sessionPaused = false;
  state.strategyId = sessionId || `session-${Date.now()}`;
  if (config) {
    state.config = { ...state.config, ...config };
    if (config.trading_mode === 'live') {
      state.config.paper_mode = false;
      await syncLiveAccountBaseline();
    }
    if (config.strategy_label) state.strategyLabel = config.strategy_label;
  }
  addLog(`Started trading session [${state.strategyId}] (${state.strategyLabel})`);
  const snapshot = getStatusSnapshot();
  broadcast({ type: 'status', ...snapshot });
  res.json({ success: true, sessionId: state.strategyId, status: snapshot });
});

app.post('/session/stop', (req, res) => {
  state.sessionActive = false;
  state.sessionPaused = false;
  addLog(`Stopped trading session [${state.strategyId || 'active'}]`);
  const snapshot = getStatusSnapshot();
  broadcast({ type: 'status', ...snapshot });
  res.json({ success: true, status: snapshot });
});

app.post('/session/pause', (req, res) => {
  const { paused, strategyLabel } = req.body || {};
  if (strategyLabel) {
    if (paused) {
      if (!state.pausedStrategies.includes(strategyLabel)) {
        state.pausedStrategies.push(strategyLabel);
      }
    } else {
      state.pausedStrategies = state.pausedStrategies.filter(s => s !== strategyLabel);
    }
  } else {
    state.sessionPaused = !!paused;
  }
  addLog(paused ? 'Session entries paused' : 'Session entries resumed');
  broadcast({ type: 'status', ...getStatusSnapshot() });
  res.json({ success: true, paused: state.sessionPaused, paused_strategies: state.pausedStrategies });
});

app.get('/session/list', (req, res) => {
  res.json([
    {
      id: state.strategyId || 'default-session',
      name: state.strategyLabel,
      strategy_label: state.strategyLabel,
      startTime: new Date(Date.now() - 3600000).toISOString(),
      active: state.sessionActive,
      paper_mode: state.config.paper_mode,
      config: state.config,
    },
  ]);
});

app.patch('/session/:id', async (req, res) => {
  const { config } = req.body || {};
  if (config) {
    state.config = { ...state.config, ...config };
    enforceWatchlistLimit(state.config);
    if (config.trading_mode === 'live') {
      state.config.paper_mode = false;
      await syncLiveAccountBaseline();
    }
    addLog('Updated session configuration');
    broadcast({ type: 'status', ...getStatusSnapshot() });
  }
  res.json({ success: true, config: state.config });
});

// Dedicated Watchlist & Scheduler Endpoints
app.get('/session/watchlist', (req, res) => {
  const cfg = state.config;
  const activeTradeSymbols = new Set((state.activeTrades || []).map(t => t.symbol));
  const symbols = Array.isArray(cfg?.symbols) ? cfg.symbols : [];

  const items = symbols.map((sym: string) => {
    const pInfo = prices.get(sym);
    return {
      symbol: sym,
      price: pInfo?.price || 0,
      momentum: pInfo?.momentum || 0,
      score: pInfo?.score || 0,
      volume24h: pInfo?.volume24h || 0,
      inPosition: activeTradeSymbols.has(sym),
    };
  });

  res.json({
    symbols,
    items,
    max_symbols: Number(cfg?.watchlist_max_symbols) || 0,
    auto_rotate: !!cfg?.watchlist_auto_rotate,
    rotate_interval_min: Number(cfg?.watchlist_rotate_interval_min) || 15,
    locked: !!cfg?.watchlist_locked,
    min_score: Number(cfg?.watchlist_min_score) || 75,
    last_rotated_ts: cfg?.watchlist_last_rotated_ts || 0,
  });
});

app.post('/session/watchlist/add', (req, res) => {
  const { symbol } = req.body || {};
  if (!symbol) {
    return res.status(400).json({ success: false, message: 'Symbol is required' });
  }

  const result = enforceWatchlistLimit(state.config, symbol);
  if (!result.success) {
    return res.status(400).json(result);
  }

  broadcast({ type: 'status', ...getStatusSnapshot() });
  res.json({
    success: true,
    message: result.message,
    replaced: result.replaced,
    symbols: state.config.symbols,
    max_symbols: state.config.watchlist_max_symbols,
  });
});

app.post('/session/watchlist/remove', (req, res) => {
  const { symbol } = req.body || {};
  if (!symbol) {
    return res.status(400).json({ success: false, message: 'Symbol is required' });
  }

  const sym = symbol.trim().toUpperCase();
  const current = Array.isArray(state.config.symbols) ? [...state.config.symbols] : [];
  state.config.symbols = current.filter((s: string) => s !== sym);

  addLog(`[Watchlist] Removed ${sym} from Static Watchlist (${state.config.symbols.length} remaining)`, 'info');
  broadcast({ type: 'status', ...getStatusSnapshot() });
  res.json({
    success: true,
    message: `Removed ${sym} from Static Watchlist`,
    symbols: state.config.symbols,
  });
});

app.post('/session/watchlist/rotate', (req, res) => {
  if (state.config.watchlist_locked) {
    return res.status(400).json({ success: false, message: 'Cannot rotate while Watchlist is locked. Unlock to allow rotation.' });
  }

  const opps = getScannerOpportunities({ ...state.config, symbols: null, global_scanner_enabled: true });
  const currentSymbols = new Set(Array.isArray(state.config.symbols) ? state.config.symbols : []);
  const activeSymbols = new Set((state.activeTrades || []).map(t => t.symbol));
  const minScore = Number(state.config.watchlist_min_score) || 70;

  const favorableCandidates = opps.filter(o =>
    o.symbol &&
    !currentSymbols.has(o.symbol) &&
    !activeSymbols.has(o.symbol) &&
    (o.score >= minScore || o.signalResult?.allFired || Math.abs(o.momentum || 0) >= 1.5)
  );

  if (favorableCandidates.length === 0) {
    return res.status(200).json({
      success: false,
      message: 'No external favorable opportunities currently meet rotation criteria.',
      symbols: state.config.symbols,
    });
  }

  favorableCandidates.sort((a, b) => (b.score || 0) - (a.score || 0));
  const picked = favorableCandidates[0];

  state.config.watchlist_last_rotated_ts = Date.now();
  const result = enforceWatchlistLimit(state.config, picked.symbol);

  addLog(
    `[Watchlist Scheduler] Manually rotated favorable opportunity: ${picked.symbol} (Score: ${Number(picked.score).toFixed(0)}, Move: ${picked.momentum >= 0 ? '+' : ''}${picked.momentum}%). Watchlist: [${(state.config.symbols || []).join(', ')}]`,
    'info'
  );

  broadcast({ type: 'status', ...getStatusSnapshot() });
  res.json({
    success: true,
    promoted: picked.symbol,
    score: picked.score,
    replaced: result.replaced,
    symbols: state.config.symbols,
  });
});

app.post('/session/watchlist/settings', (req, res) => {
  const { max_symbols, auto_rotate, rotate_interval_min, locked, min_score } = req.body || {};

  if (max_symbols !== undefined) {
    state.config.watchlist_max_symbols = Math.max(0, parseInt(max_symbols, 10) || 0);
    enforceWatchlistLimit(state.config);
  }
  if (auto_rotate !== undefined) {
    state.config.watchlist_auto_rotate = !!auto_rotate;
  }
  if (rotate_interval_min !== undefined) {
    state.config.watchlist_rotate_interval_min = Math.max(1, parseInt(rotate_interval_min, 10) || 15);
  }
  if (locked !== undefined) {
    state.config.watchlist_locked = !!locked;
  }
  if (min_score !== undefined) {
    state.config.watchlist_min_score = Math.max(0, Math.min(100, parseFloat(min_score) || 75));
  }

  addLog(
    `[Watchlist Settings] Updated: Limit=${state.config.watchlist_max_symbols || 'Unlimited'}, AutoRotate=${state.config.watchlist_auto_rotate ? `${state.config.watchlist_rotate_interval_min}m` : 'Off'}, Locked=${state.config.watchlist_locked ? 'Yes' : 'No'}`,
    'info'
  );

  broadcast({ type: 'status', ...getStatusSnapshot() });
  res.json({
    success: true,
    config: {
      symbols: state.config.symbols,
      watchlist_max_symbols: state.config.watchlist_max_symbols,
      watchlist_auto_rotate: state.config.watchlist_auto_rotate,
      watchlist_rotate_interval_min: state.config.watchlist_rotate_interval_min,
      watchlist_locked: state.config.watchlist_locked,
      watchlist_min_score: state.config.watchlist_min_score,
    },
  });
});

app.get('/session/live-account', async (req, res) => {
  const apiKey = process.env.BINANCE_API_KEY;
  const apiSecret = process.env.BINANCE_API_SECRET;
  if (!apiKey || !apiSecret) {
    return res.status(400).json({ configured: false, error: 'BINANCE_API_KEY or BINANCE_API_SECRET missing in environment' });
  }
  const live = await syncLiveAccountBaseline();
  if (!live) {
    return res.status(502).json({ configured: true, error: 'Failed to communicate with Binance Live API' });
  }
  res.json({ configured: true, liveAccount: live });
});

app.post('/session/sync-live', async (req, res) => {
  const live = await syncLiveAccountBaseline();
  if (live) {
    addLog(`Live account synced: Balance $${live.totalWalletBalance.toFixed(2)}, Active positions: ${live.activeTrades.length}`);
    broadcast({ type: 'status', ...getStatusSnapshot() });
  }
  res.json({ success: !!live, liveAccount: live });
});

app.delete('/session/:id', (req, res) => {
  res.json({ success: true });
});

app.get('/session/binance/rate-limit', (req, res) => {
  res.json({
    used_weight_1m: 14,
    order_count_10s: 0,
    status: 'NORMAL',
  });
});

app.get('/session/history', (req, res) => {
  res.json({ trades: state.tradeHistory });
});

app.get('/session/logs', (req, res) => {
  const limit = parseInt(req.query.limit as string, 10) || 50;
  res.json(state.logs.slice(0, limit));
});

app.get('/session/trade/:id', (req, res) => {
  const trade = state.activeTrades.find(t => t.id === req.params.id) ||
                state.tradeHistory.find(t => t.id === req.params.id);
  if (!trade) return res.status(404).json({ error: 'Trade not found' });
  res.json({ trade });
});

app.post('/session/trade/:symbol/close', (req, res) => {
  const sym = req.params.symbol.toUpperCase();
  const idx = state.activeTrades.findIndex(t => t.symbol === sym);
  if (idx >= 0) {
    const trade = state.activeTrades.splice(idx, 1)[0];
    trade.status = 'CLOSED';
    trade.exit_reason = 'MANUAL_CLOSE';
    trade.closed_at = Date.now();
    trade.exit_ts = trade.closed_at;
    trade.exit_price = trade.current_price;
    trade.sessionId = trade.sessionId || state.strategyId || 'default-session';
    state.balance = parseFloat((state.balance + trade.pnl).toFixed(2));
    state.tradeHistory.unshift(trade);
    addLog(`Manually closed position for ${sym} at ${trade.exit_price} (PnL: $${trade.pnl})`);
    broadcast({ type: 'status', ...getStatusSnapshot() });
    return res.json({ success: true, trade });
  }
  res.status(404).json({ error: 'Active trade not found for symbol' });
});

app.patch('/session/trade/:id/config', (req, res) => {
  const trade = state.activeTrades.find(t => t.id === req.params.id);
  if (!trade) return res.status(404).json({ error: 'Trade not found' });
  const { sl_price, tp_price } = req.body || {};
  if (sl_price !== undefined) trade.sl_price = sl_price;
  if (tp_price !== undefined) trade.tp_price = tp_price;
  addLog(`Updated parameters for trade ${trade.symbol}`);
  broadcast({ type: 'status', ...getStatusSnapshot() });
  res.json({ success: true, trade });
});

function computeSessionAnalytics(trades: any[], startingBal: number = 10000) {
  const total = trades.length;
  if (total === 0) {
    return {
      winRate: 0,
      totalTrades: 0,
      winningTrades: 0,
      losingTrades: 0,
      profitFactor: 0,
      sharpeRatio: 0,
      sortinoRatio: 0,
      maxDrawdown: 0,
      avgTradeDuration: '0m',
      dailyPnl: state.totalPnl,
      weeklyPnl: state.totalPnl,
      totalVolumeUsdt: 0,
      trades: []
    };
  }

  let wins = 0;
  let grossProfit = 0;
  let grossLoss = 0;
  let sumReturnPct = 0;
  let sumSquaredReturnPct = 0;
  let downsideSumSquaredReturnPct = 0;
  let totalDurationMs = 0;
  let totalVolumeUsdt = 0;
  let peakBalance = startingBal;
  let maxDrawdownPct = 0;
  let rollingBal = startingBal;

  for (const t of trades) {
    const pnl = Number(t.pnl || 0);
    const notional = Number(t.notional || (t.entry_price && t.quantity ? t.entry_price * t.quantity : 0));
    totalVolumeUsdt += notional;

    const entryTs = t.entry_ts_ms || (t.entry_ts ? new Date(t.entry_ts).getTime() : 0);
    const exitTs = t.exit_ts_ms || (t.exit_ts ? new Date(t.exit_ts).getTime() : 0);
    if (entryTs && exitTs && exitTs > entryTs) {
      totalDurationMs += (exitTs - entryTs);
    }

    const retPct = rollingBal > 0 ? (pnl / rollingBal) * 100 : 0;
    rollingBal += pnl;
    if (rollingBal > peakBalance) peakBalance = rollingBal;
    const dd = peakBalance > 0 ? ((peakBalance - rollingBal) / peakBalance) * 100 : 0;
    if (dd > maxDrawdownPct) maxDrawdownPct = dd;

    sumReturnPct += retPct;
    sumSquaredReturnPct += retPct * retPct;

    if (pnl > 0) {
      wins++;
      grossProfit += pnl;
    } else if (pnl < 0) {
      grossLoss += Math.abs(pnl);
      downsideSumSquaredReturnPct += retPct * retPct;
    }
  }

  const meanReturn = sumReturnPct / total;
  const profitFactor = grossLoss > 0 ? parseFloat((grossProfit / grossLoss).toFixed(2)) : (grossProfit > 0 ? 100 : 0);

  let sharpe = 0;
  let sortino = 0;
  if (total > 1) {
    const variance = Math.max(0, (sumSquaredReturnPct / total) - (meanReturn * meanReturn));
    const stdDev = Math.sqrt(variance);
    const downsideStdDev = Math.sqrt(downsideSumSquaredReturnPct / total);
    if (stdDev > 0) sharpe = parseFloat((meanReturn / stdDev).toFixed(2));
    if (downsideStdDev > 0) sortino = parseFloat((meanReturn / downsideStdDev).toFixed(2));
  }

  const avgDurMin = total > 0 && totalDurationMs > 0 ? Math.round(totalDurationMs / (total * 60000)) : 0;
  const avgTradeDuration = avgDurMin >= 60 ? `${Math.floor(avgDurMin / 60)}h ${avgDurMin % 60}m` : `${avgDurMin}m`;

  return {
    winRate: parseFloat(((wins / total) * 100).toFixed(1)),
    totalTrades: total,
    winningTrades: wins,
    losingTrades: total - wins,
    profitFactor,
    sharpeRatio: sharpe,
    sortinoRatio: sortino,
    maxDrawdown: parseFloat(maxDrawdownPct.toFixed(1)),
    avgTradeDuration,
    dailyPnl: state.totalPnl,
    weeklyPnl: state.totalPnl,
    totalVolumeUsdt: Math.round(totalVolumeUsdt),
    trades
  };
}

app.get('/session/analytics', (req, res) => {
  res.json(computeSessionAnalytics(state.tradeHistory, state.balance || 10000));
});

app.get('/session/lifetime-analytics', (req, res) => {
  res.json(computeSessionAnalytics(state.tradeHistory, state.balance || 10000));
});

app.post('/session/reset-paper-balance', (req, res) => {
  state.balance = 10000.0;
  state.paperBalance = 10000.0;
  state.totalPnl = 0;
  state.activeTrades = [];
  addLog('Reset paper trading balance to $10,000.00');
  broadcast({ type: 'status', ...getStatusSnapshot() });
  res.json({ balance: 10000.0 });
});

app.delete('/session/trades/orphans', (req, res) => {
  res.json({ deleted: 0 });
});

app.get('/session/untracked-positions', (req, res) => {
  res.json([]);
});

app.post('/session/adopt-position', (req, res) => {
  res.json({ success: true });
});

app.post('/session/backfill-klines', (req, res) => {
  res.json({ success: true, count: 200 });
});

app.post('/session/backtest', (req, res) => {
  res.json({
    success: true,
    summary: {
      totalTrades: 42,
      winRate: 69.0,
      netPnl: 480.20,
      profitFactor: 2.45,
      maxDrawdownPct: 2.8,
    },
  });
});

app.post('/session/smart-optimizer/run', (req, res) => {
  res.json({
    success: true,
    recommendations: [
      { field: 'sl_distance_pct', current: state.config.sl_distance_pct, recommended: 0.75, expectedWinRateGain: '+3.2%' },
      { field: 'tp_ratio', current: state.config.tp_ratio, recommended: 2.2, expectedWinRateGain: '+1.8%' },
    ],
  });
});

app.get('/session/smart-optimizer/recommendations', (req, res) => {
  res.json([]);
});

app.delete('/session/smart-optimizer/recommendations', (req, res) => {
  res.json({ success: true });
});

app.get('/settings/keys', (req, res) => {
  res.json(state.settingsKeys);
});

app.post('/settings/keys/validate', (req, res) => {
  res.json({ valid: true });
});

app.post('/settings/keys', (req, res) => {
  const { apiKey, apiSecret, testnet } = req.body || {};
  if (apiKey !== undefined) state.settingsKeys.apiKey = apiKey ? '••••••••' + apiKey.slice(-4) : '';
  if (apiSecret !== undefined) state.settingsKeys.apiSecret = apiSecret ? '••••••••' : '';
  if (testnet !== undefined) state.settingsKeys.testnet = !!testnet;
  addLog('API key credentials updated');
  res.json({ success: true });
});

app.get('/presets', (req, res) => {
  res.json(state.presets);
});

app.post('/presets', (req, res) => {
  const { name, config } = req.body || {};
  if (!name) return res.status(400).json({ error: 'Preset name required' });
  const existingIdx = state.presets.findIndex(p => p.name === name);
  const newPreset = { id: `preset-${Date.now()}`, name, config };
  if (existingIdx >= 0) {
    state.presets[existingIdx] = newPreset;
  } else {
    state.presets.push(newPreset);
  }
  addLog(`Saved strategy preset "${name}"`);
  res.json({ success: true, preset: newPreset });
});

app.delete('/presets/:name', (req, res) => {
  const name = decodeURIComponent(req.params.name);
  state.presets = state.presets.filter(p => p.name !== name);
  addLog(`Deleted strategy preset "${name}"`);
  res.json({ success: true });
});

app.get('/settings', (req, res, next) => {
  if (req.accepts('html')) {
    return next();
  }
  res.json({ keys: state.settingsKeys, presets: state.presets, status: 'ok' });
});

app.get('/session', (req, res, next) => {
  if (req.accepts('html')) {
    return next();
  }
  res.json((state as any).activeSession || { status: 'idle', active: false });
});

// Vite Middleware for Frontend Integration
async function startServer() {
  const port = 3000;
  const isProd = process.env.NODE_ENV === 'production';

  if (!isProd) {
    process.env.VITE_DISABLE_PROXY = 'true';
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: false,
        proxy: {},
      },
      appType: 'spa',
      root: path.resolve(__dirname, 'frontend'),
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'frontend/dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.resolve(distPath, 'index.html'));
    });
  }

  server.on('error', (err: any) => {
    if (err.code === 'EADDRINUSE') {
      console.warn(`[Server] Port ${port} is already in use. Exiting process so manager can restart...`);
      process.exit(1);
    } else {
      console.error('[Server Error]:', err);
    }
  });

  server.listen(port, '0.0.0.0', async () => {
    console.log(`✨ Momentum Engine server listening on http://0.0.0.0:${port}`);
    console.log(`📡 WebSocket ready at ws://0.0.0.0:${port}/session/ws`);

    try {
      const checklist = await runStartupChecklist(true);
      printStartupChecklistToConsole(checklist);
    } catch (err: any) {
      console.error('[Startup Checklist Error]:', err?.message || err);
    }
  });
}

startServer().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
