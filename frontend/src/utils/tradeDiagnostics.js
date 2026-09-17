import { fmtUSD } from '../lib/theme.js';

export function analyzeTradeDiagnostics(trade, config = {}) {
  if (!trade) {
    return {
      hasError: false,
      hasWarning: false,
      issues: [],
      expectedSl: 0,
      traceSnippet: 'No trade provided'
    };
  }

  const issues = [];
  const entry = Number(trade.entry_price || 0);
  const mark = Number(trade.current_price || trade.mark_price || trade.last_price || 0);
  const sl = Number(trade.current_sl || trade.sl_price || 0);
  const initialSl = Number(trade.initial_sl || 0);
  const isLong = trade.direction === 'LONG';
  const qty = Number(trade.qty || 0);

  const rawRiskUnit = Math.abs(entry - (initialSl || sl));
  const riskUnit = rawRiskUnit > 0 ? rawRiskUnit : (entry > 0 ? entry * 0.01 : 1);

  // 1. Critical SL Order Protection Check
  const isPaper = config?.paper_mode ?? trade?.strategy_config?.paper_mode ?? true;
  if (sl <= 0 && initialSl <= 0) {
    issues.push({
      type: 'error',
      code: 'SL_MISSING',
      title: 'Missing Stop Loss Protection',
      message: 'Active trade has no valid or initialized Stop Loss price (SL <= 0).'
    });
  } else if (!isPaper && !trade.binance_stop_order_id && trade.status === 'OPEN') {
    issues.push({
      type: 'warning',
      code: 'SL_UNLINKED_EXCHANGE',
      title: 'Unlinked Exchange Stop Loss',
      message: 'No active Binance stop order ID is currently associated with this live trade.'
    });
  }

  // 2. Guard Ladder & Milestone SL Target Alignment Check
  const triggers = trade.live_rr_sequence || trade.strategy_config?.live_rr_sequence || config?.live_rr_sequence || [];
  const exits = trade.exit_rr_sequence || trade.strategy_config?.exit_rr_sequence || config?.exit_rr_sequence || [];
  const maxRR = Number(trade.max_rr ?? trade.max_rr_achieved ?? 0);
  const activeIdx = Number(trade.rr_sequence_index ?? -1);

  let expectedSl = initialSl > 0 ? initialSl : sl;
  if (activeIdx >= 0 && exits[activeIdx] !== undefined) {
    const exitR = exits[activeIdx];
    expectedSl = isLong ? entry + riskUnit * exitR : entry - riskUnit * exitR;
  }

  if (sl > 0 && expectedSl > 0 && Math.abs(sl - expectedSl) > entry * 0.0001) {
    const isSlBetterThanExpected = isLong ? sl > expectedSl + entry * 0.0001 : sl < expectedSl - entry * 0.0001;
    if (!isSlBetterThanExpected) {
      issues.push({
        type: 'warning',
        code: 'SL_LADDER_DISCREPANCY',
        title: 'Guard Ladder Discrepancy',
        message: `Current SL (${sl.toFixed(5)}) differs from the target milestone SL (${expectedSl.toFixed(5)}) for active Guard R ${triggers[activeIdx] ?? 0}R.`
      });
    }
  }

  // 3. Close Blocked / Illiquidity Execution Failures
  if (trade.close_blocked || trade.illiquid_blocked) {
    issues.push({
      type: 'error',
      code: 'CLOSE_BLOCKED',
      title: 'Trade Close Blocked',
      message: `Automated trade close operations are currently blocked (${trade.illiquid_blocked ? 'Illiquid Orderbook' : 'Exchange Execution Error'}).`
    });
  } else if (trade.close_attempts > 0) {
    issues.push({
      type: 'warning',
      code: 'CLOSE_ATTEMPTS_FAILED',
      title: 'Failed Close Attempts',
      message: `${trade.close_attempts} failed close attempts recorded for this trade.`
    });
  }

  // 4. Exit Signal Warmup Starvation
  if (trade.exit_signals_status) {
    const warmingSigs = [];
    for (const [sigKey, sig] of Object.entries(trade.exit_signals_status)) {
      if (sig && sig.is_warming_up) {
        warmingSigs.push(`${sigKey} (${sig.warmup_candles || 0}/${sig.required_warmup || 0} candles)`);
      }
    }
    if (warmingSigs.length > 0) {
      issues.push({
        type: 'warning',
        code: 'EXIT_WARMUP_INCOMPLETE',
        title: 'Exit Indicators Warming Up',
        message: `Exit indicators are warming up candles: ${warmingSigs.join(', ')}`
      });
    }
  }

  // 5. App Restart & Reconciliation Adoption
  if (trade.is_reconciliation) {
    issues.push({
      type: 'info',
      code: 'RECONCILIATION_ADOPTED',
      title: 'Exchange Reconciliation Trade',
      message: 'This trade was adopted from Binance exchange state reconciliation during boot or downtime recovery.'
    });
  }

  const hasError = issues.some(i => i.type === 'error');
  const hasWarning = issues.some(i => i.type === 'warning');

  // Generate complete, formatted markdown diagnostic trace snippet
  const traceSnippet = [
    `### Active Trade Diagnostic Trace: ${trade.symbol} (${trade.direction})`,
    `**Timestamp:** ${new Date().toISOString()}`,
    `**Trade ID:** ${trade.id || 'N/A'}`,
    `**Session ID:** ${trade.sessionId || 'N/A'}`,
    `**Strategy Label:** ${trade.strategy_label || config?.strategy_label || 'Default Strategy'}`,
    `**Direction:** ${trade.direction} | **Quantity:** ${qty}`,
    `**Entry Price:** $${entry}`,
    `**Mark Price:** $${mark}`,
    `**Unrealized PnL:** ${fmtUSD(trade.pnl)} (${Number(trade.pnl_pct || 0).toFixed(2)}%)`,
    `**Peak R:R Achieved:** ${maxRR.toFixed(2)}R (Current R: ${Number(trade.rr || 0).toFixed(2)}R)`,
    ``,
    `#### Stop Loss & Protection State:`,
    `- **Current SL:** $${sl} (Initial SL: $${initialSl})`,
    `- **Exchange Order ID:** ${trade.binance_stop_order_id || 'None'} (${trade.binance_stop_order_type || 'standard'})`,
    `- **Active Risk USDT:** $${trade.risk_usdt ?? '0.00'} (Initial Risk: $${trade.initial_risk_usdt ?? '0.00'})`,
    `- **Milestone Index:** ${activeIdx} (Target Milestone SL: $${expectedSl.toFixed(5)})`,
    ``,
    `#### Guard Ladder Configuration:`,
    `- **Triggers (R):** [${triggers.join(', ')}]`,
    `- **Secured Exit (R):** [${exits.join(', ')}]`,
    ``,
    `#### Exit Signal Telemetry:`,
    trade.exit_signals_status && Object.keys(trade.exit_signals_status).length > 0
      ? Object.entries(trade.exit_signals_status).map(([k, s]) => `- \`${k}\`: Fired=${!!s?.fired}, Active=${!!s?.active}, Progress=${(s?.progress ?? s?.distPct ?? 0).toFixed(1)}%${s?.is_warming_up ? ` (Warming: ${s.warmup_candles}/${s.required_warmup} - ${s.warmup_tf})` : ''}`).join('\n')
      : '- None active',
    ``,
    `#### Execution & Recovery Flags:`,
    `- **App Restart Reconciliation:** ${trade.is_reconciliation ? 'YES' : 'NO'}`,
    `- **Close Blocked:** ${trade.close_blocked ? 'YES' : 'NO'}`,
    `- **Illiquid Blocked:** ${trade.illiquid_blocked ? 'YES' : 'NO'}`,
    `- **Close Attempts:** ${trade.close_attempts || 0} (Last: ${trade.last_close_attempt_ts ? new Date(trade.last_close_attempt_ts).toISOString() : 'N/A'})`,
    ``,
    `#### Detected Discrepancies & Warnings:`,
    issues.length > 0
      ? issues.map(i => `- [${i.type.toUpperCase()}] **${i.title}:** ${i.message}`).join('\n')
      : '- No discrepancies or errors detected'
  ].join('\n');

  return {
    hasError,
    hasWarning,
    issues,
    expectedSl,
    traceSnippet
  };
}
