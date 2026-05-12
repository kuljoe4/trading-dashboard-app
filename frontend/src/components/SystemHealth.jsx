import React from 'react';
import { C } from '../lib/theme';

const Stat = ({ label, value, color = C.text, sub = '' }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
    <span style={{ fontSize: 9, color: C.dim, fontWeight: 700, letterSpacing: 0.5 }}>{label.toUpperCase()}</span>
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
      <span style={{ fontSize: 13, fontWeight: 700, color, fontFamily: 'monospace' }}>{value}</span>
      {sub && <span style={{ fontSize: 10, color: C.dim }}>{sub}</span>}
    </div>
  </div>
);

export const SystemHealth = ({ monitoring }) => {
  if (!monitoring) return null;

  const { system, application } = monitoring;
  const cpuColor = system.cpu_usage > 50 ? C.red : system.cpu_usage > 20 ? C.amber : C.green;
  const memColor = system.memory_heap_used > 150 ? C.amber : C.text;
  const lagColor = system.event_loop_lag > 50 ? C.red : system.event_loop_lag > 20 ? C.amber : C.green;

  return (
    <div style={{
      display: 'flex',
      gap: 24,
      padding: '10px 16px',
      background: C.surface,
      border: `1px solid ${C.border}`,
      borderRadius: 8,
      marginBottom: 16,
      alignItems: 'center'
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, borderRight: `1px solid ${C.border}`, paddingRight: 24 }}>
        <div style={{ width: 8, height: 8, borderRadius: '50%', background: C.green, boxShadow: `0 0 8px ${C.green}` }} />
        <span style={{ fontSize: 12, fontWeight: 700, color: C.text }}>SYSTEM HEALTH</span>
      </div>

      <Stat label="CPU" value={`${system.cpu_usage}%`} color={cpuColor} />
      <Stat label="Memory" value={`${system.memory_heap_used}MB`} sub={`/ ${system.memory_rss}MB`} color={memColor} />
      <Stat label="Loop Lag" value={`${system.event_loop_lag}ms`} color={lagColor} />
      <Stat label="Hot Loop" value={`${application.hot_loop_ms}ms`} />
      <Stat label="Main Loop" value={`${application.main_loop_ms}ms`} />
      <Stat label="API Calls" value={application.api_requests_total} />

      <div style={{ marginLeft: 'auto', fontSize: 10, color: C.dim, fontFamily: 'monospace' }}>
        UPTIME: {Math.floor(system.uptime / 3600)}h {Math.floor((system.uptime % 3600) / 60)}m
      </div>
    </div>
  );
};
