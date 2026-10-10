import express from 'express';
import cors from 'cors';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer as createViteServer } from 'vite';

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

// Initialize prices
const now = Date.now();
for (const s of SYMBOLS) {
  const ohlc: PriceInfo['ohlc_history'] = [];
  let cur = s.basePrice;
  for (let i = 20; i >= 0; i--) {
    const t = now - i * 5 * 60 * 1000;
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
  activeTrades: [] as any[],
  tradeHistory: [
    {
      id: 'trade-init-1',
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
  ],
  settingsKeys: {
    apiKey: '',
    apiSecret: '',
    testnet: true,
  },
};

function addLog(msg: string, level = 'info') {
  const ts_ms = Date.now();
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

function getScannerOpportunities() {
  const opps: any[] = [];
  let rank = 1;
  const sorted = Array.from(prices.values()).sort((a, b) => Math.abs(b.momentum) - Math.abs(a.momentum));

  for (const item of sorted) {
    const isLong = item.momentum >= 0;
    const fired = Math.abs(item.momentum) >= 1.2;
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
            threshold: 1.2,
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

function getStatusSnapshot() {
  const opps = getScannerOpportunities();
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
    scannerResults: opps,
    logs: state.logs,
    config: state.config,
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
      lastCandle.close = newPrice;
      lastCandle.high = Math.max(lastCandle.high, newPrice);
      lastCandle.low = Math.min(lastCandle.low, newPrice);
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

  // Broadcast ticks & scanner updates to connected clients
  broadcastTick();
}, 2000);

// WebSocket handling
const wss = new WebSocketServer({
  server,
  path: '/session/ws',
});

function broadcast(data: any) {
  const msg = JSON.stringify(data);
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(msg);
    }
  });
}

function broadcastTick() {
  if (wss.clients.size === 0) return;

  const opps = getScannerOpportunities();
  const topSym = opps[0]?.symbol || 'BTCUSDT';
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
      opportunities: opps,
      variant_opportunities: [],
    }));
  });
}

wss.on('connection', (ws: any) => {
  ws.isAlive = true;
  ws.isActive = true;

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

// API Endpoints
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/healthz', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/auth/config', (req, res) => {
  res.json({ authRequired: false });
});

app.get('/session/status', (req, res) => {
  res.json(getStatusSnapshot());
});

app.post('/session/start', (req, res) => {
  const { config, sessionId } = req.body || {};
  state.sessionActive = true;
  state.sessionPaused = false;
  state.strategyId = sessionId || `session-${Date.now()}`;
  if (config) {
    state.config = { ...state.config, ...config };
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
      paper_mode: true,
      config: state.config,
    },
  ]);
});

app.patch('/session/:id', (req, res) => {
  const { config } = req.body || {};
  if (config) {
    state.config = { ...state.config, ...config };
    addLog('Updated session configuration');
    broadcast({ type: 'status', ...getStatusSnapshot() });
  }
  res.json({ success: true, config: state.config });
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
    trade.exit_price = trade.current_price;
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

app.get('/session/analytics', (req, res) => {
  const total = state.tradeHistory.length;
  const wins = state.tradeHistory.filter(t => t.pnl > 0).length;
  const winRate = total > 0 ? parseFloat(((wins / total) * 100).toFixed(1)) : 0;
  res.json({
    winRate,
    totalTrades: total,
    winningTrades: wins,
    losingTrades: total - wins,
    profitFactor: 2.34,
    sharpeRatio: 1.95,
    maxDrawdown: 2.1,
    avgTradeDuration: '24m',
    dailyPnl: state.totalPnl,
    weeklyPnl: state.totalPnl,
    totalVolumeUsdt: 125000,
  });
});

app.get('/session/lifetime-analytics', (req, res) => {
  const total = state.tradeHistory.length;
  const wins = state.tradeHistory.filter(t => t.pnl > 0).length;
  const winRate = total > 0 ? parseFloat(((wins / total) * 100).toFixed(1)) : 0;
  res.json({
    winRate,
    totalTrades: total,
    winningTrades: wins,
    losingTrades: total - wins,
    profitFactor: 2.34,
    sharpeRatio: 1.95,
    maxDrawdown: 2.1,
    avgTradeDuration: '24m',
    dailyPnl: state.totalPnl,
    weeklyPnl: state.totalPnl,
    totalVolumeUsdt: 125000,
  });
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

// Vite Middleware for Frontend Integration
async function startServer() {
  const port = 3000;
  const isProd = process.env.NODE_ENV === 'production';

  if (!isProd) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
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

  server.listen(port, '0.0.0.0', () => {
    console.log(`✨ Momentum Engine server listening on http://0.0.0.0:${port}`);
    console.log(`📡 WebSocket ready at ws://0.0.0.0:${port}/session/ws`);
  });
}

startServer().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
