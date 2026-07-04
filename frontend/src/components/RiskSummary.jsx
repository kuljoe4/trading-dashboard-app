import React, { useMemo } from 'react';
import { ShieldCheck, Zap, Activity, AlertTriangle } from 'lucide-react';
import { cn } from './ui/primitives';

const fmtUSD = (v) => `$${Number(v || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const RiskSummary = React.memo(({ cfg, balance }) => {
  const riskPct = Number(cfg.risk_pct_per_trade || 0);
  const slPct = Number(cfg.sl_distance_pct || 0.8);
  const maxTrades = Number(cfg.max_open_trades || 1);

  const riskAmount = balance * (riskPct / 100);
  const notional = slPct > 0 ? (riskAmount / (slPct / 100)) : 0;
  const totalExposure = notional * maxTrades;

  const isAggressive = riskPct > 2 || slPct > 5;
  const isTooSmall = notional > 0 && notional < 5.05 && cfg.auto_scale_min_notional !== false;

  return (
    <div className="px-5 py-4 bg-accent/5 border-t border-accent/10 flex flex-col gap-3 animate-in fade-in slide-in-from-bottom-2 duration-500">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-accent">
          <ShieldCheck size={12} /> Live Risk Projection
        </div>
        {isAggressive && (
          <div className="flex items-center gap-1.5 px-2 py-0.5 bg-amber/10 border border-amber/20 rounded text-[8px] font-black text-amber uppercase tracking-tighter">
            <AlertTriangle size={10} /> Aggressive Profile
          </div>
        )}
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="flex flex-col gap-0.5">
          <span className="text-[8px] text-dim font-bold uppercase tracking-widest">Risk / Trade</span>
          <span className="text-xs font-mono font-black text-text">{fmtUSD(riskAmount)}</span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-[8px] text-dim font-bold uppercase tracking-widest">Est. Notional</span>
          <span className={cn("text-xs font-mono font-black", isTooSmall ? "text-amber" : "text-text")}>
            {fmtUSD(isTooSmall ? 5.05 : notional)}
          </span>
        </div>
        <div className="flex flex-col gap-0.5 text-right">
          <span className="text-[8px] text-dim font-bold uppercase tracking-widest">Max Exposure</span>
          <span className="text-xs font-mono font-black text-accent">{fmtUSD(totalExposure)}</span>
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
