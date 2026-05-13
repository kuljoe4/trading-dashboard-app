import React from 'react';
import { cn, PulseDot } from './ui/primitives';

const Stat = ({ label, value, colorClass = "text-text", sub = '', className }) => (
  <div className={cn("flex flex-col gap-0.5", className)}>
    <span className="text-[9px] text-dim font-bold uppercase tracking-wider">{label}</span>
    <div className="flex items-baseline gap-1.5">
      <span className={cn(
        "text-sm font-bold font-mono tabular-nums leading-none",
        colorClass
      )}>{value}</span>
      {sub && <span className="text-[10px] text-dim font-mono tabular-nums">{sub}</span>}
    </div>
  </div>
);

export const SystemHealth = ({ monitoring }) => {
  if (!monitoring) return (
    <div className="flex items-center gap-6 px-4 py-3 bg-surface border border-border rounded-xl mb-8 opacity-40 animate-pulse">
      <div className="flex items-center gap-2.5 pr-6 border-r border-border shrink-0">
        <div className="w-2 h-2 rounded-full bg-dim" />
        <span className="text-[11px] font-bold text-dim uppercase tracking-widest leading-none">Initializing Monitor...</span>
      </div>
    </div>
  );

  const { system, application } = monitoring;
  const cpuColor = system.cpu_usage > 50 ? "text-red" : system.cpu_usage > 20 ? "text-amber" : "text-green";
  const memColor = system.memory_heap_used > 150 ? "text-amber" : "text-text";
  const lagColor = system.event_loop_lag > 50 ? "text-red" : system.event_loop_lag > 20 ? "text-amber" : "text-green";

  return (
    <div className="flex items-center gap-6 px-4 py-3 bg-surface border border-border rounded-xl mb-8 overflow-x-auto no-scrollbar shadow-sm">
      <div className="flex items-center gap-2.5 pr-6 border-r border-border shrink-0">
        <PulseDot color="bg-green" />
        <span className="text-[11px] font-black text-text uppercase tracking-widest leading-none">System Health</span>
      </div>

      <div className="flex items-center gap-8">
        <Stat label="CPU" value={`${system.cpu_usage}%`} colorClass={cpuColor} className="min-w-[50px]" />
        <Stat label="Memory" value={`${system.memory_heap_used}MB`} sub={`/ ${system.memory_rss}MB`} colorClass={memColor} className="min-w-[120px]" />
        <Stat label="Loop Lag" value={`${system.event_loop_lag}ms`} colorClass={lagColor} className="min-w-[80px]" />
        <Stat label="Hot Loop" value={`${application.hot_loop_ms}ms`} className="min-w-[80px]" />
        <Stat label="Main Loop" value={`${application.main_loop_ms}ms`} className="min-w-[80px]" />
        <Stat label="API Req" value={application.api_requests_total} className="min-w-[60px]" />
      </div>

      <div className="ml-auto text-[10px] text-dim font-bold font-mono tabular-nums uppercase tracking-widest shrink-0">
        Up: {Math.floor(system.uptime / 3600)}h {Math.floor((system.uptime % 3600) / 60)}m
      </div>
    </div>
  );
};
