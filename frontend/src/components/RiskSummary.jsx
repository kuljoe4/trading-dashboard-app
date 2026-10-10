import React, { useMemo } from 'react';
import { ShieldCheck, Zap, Activity, AlertTriangle } from 'lucide-react';
import { cn, Tooltip } from './ui/primitives';

const fmtUSD = (v) => `$${Number(v || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const RiskSummary = React.memo(({ cfg, balance }) => {
  const riskPct = Number(cfg.risk_pct_per_trade || 0);
  const slPct = Number(cfg.sl_distance_pct || 0.8);
  const maxTrades = Number(cfg.max_open_trades || 1);

  const riskAmount = balance * (riskPct / 100);
  const notional = slPct > 0 ? (riskAmount / (slPct / 100)) : 0;
  const totalExposure = notional * maxTrades;

  const isAggressive = riskPct > 4 || slPct > 5;
  const isTooSmall = notional > 0 && notional < 5.05 && cfg.auto_scale_min_notional !== false;

  return (
    <div className="px-5 py-4 bg-accent/5 border-t border-accent/10 flex flex-col gap-3 animate-in fade-in slide-in-from-bottom-2 duration-500">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-[9.5px] font-bold uppercase tracking-wider text-accent font-mono">
          <ShieldCheck size={13} /> Live Risk Projection
        </div>
        {isAggressive && (
          <Tooltip content="Risk per trade exceeds 4% or Stop Loss distance exceeds 5%">
            <div
              tabIndex={0}
              role="region"
              aria-label="Aggressive Risk Profile: Risk per trade exceeds 4% or Stop Loss distance exceeds 5%"
              className="flex items-center gap-1 text-[8.5px] font-bold text-amber font-mono uppercase tracking-wider cursor-help focus-visible:ring-2 focus-visible:ring-amber focus-visible:outline-none"
            >
              <AlertTriangle size={11} /> Aggressive Profile
            </div>
          </Tooltip>
        )}
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="flex flex-col gap-0.5">
          <span className="text-[8.5px] text-dim font-bold uppercase tracking-wider">Risk / Trade</span>
          <span className="text-xs font-mono font-bold tabular-nums text-text">{fmtUSD(riskAmount)}</span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-[8.5px] text-dim font-bold uppercase tracking-wider">Est. Notional</span>
          <span className={cn("text-xs font-mono font-bold tabular-nums", isTooSmall ? "text-amber" : "text-text")}>
            {fmtUSD(isTooSmall ? 5.05 : notional)}
          </span>
        </div>
        <div className="flex flex-col gap-0.5 text-right">
          <span className="text-[8.5px] text-dim font-bold uppercase tracking-wider">Max Exposure</span>
          <span className="text-xs font-mono font-bold tabular-nums text-accent">{fmtUSD(totalExposure)}</span>
        </div>
      </div>

      {isTooSmall && (
        <div className="text-[9px] text-amber/80 font-medium italic leading-tight flex items-start gap-1.5">
          <Activity size={10} className="shrink-0 mt-0.5" />
          Notional scaled to $5.05 to meet Binance minimum requirements.
        </div>
      )}
    </div>
  );
});

RiskSummary.displayName = 'RiskSummary';
