import React, { useState, useEffect } from 'react'
import { settingsAPI } from '../api/client'
import { SectionLabel, Btn, StatCard, cn } from '../components/ui/primitives'
import { Settings as SettingsIcon, ShieldAlert, Key, Lock, CheckCircle2, AlertCircle, Activity, Zap, Eye, EyeOff, RotateCcw, Bug, Database } from 'lucide-react'
import { motion } from 'framer-motion'
import { useTradingStore } from '../store/trading'
import { Sidebar, BottomNav } from '../components/Navigation'

export function SettingsView() {
  const { healthEnabled, setHealthEnabled, streamingEnabled, setStreamingEnabled, debugToolsEnabled, setDebugToolsEnabled, sidebarCollapsed, logFilters, toggleLogFilter, resetPaperBalance } = useTradingStore()
  const [apiKey, setApiKey] = useState('')
  const [apiSecret, setApiSecret] = useState('')
  const [logRetention, setLogRetention] = useState(30)
  const [tradeRetention, setTradeRetention] = useState(90)
  const [showLiveSecret, setShowLiveSecret] = useState(false)
  const [testnetApiKey, setTestnetApiKey] = useState('')
  const [testnetApiSecret, setTestnetApiSecret] = useState('')
  const [showTestnetSecret, setShowTestnetSecret] = useState(false)
  const [maskedKey, setMaskedKey] = useState('')
  const [maskedTestnetKey, setMaskedTestnetKey] = useState('')
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState(null)

  useEffect(() => {
    loadSettings()
  }, [])

  async function loadSettings() {
    try {
      const [keysRes, maintRes] = await Promise.all([
        settingsAPI.getKeys(),
        settingsAPI.getMaintenance()
      ])
      setMaskedKey(keysRes.data.api_key)
      setMaskedTestnetKey(keysRes.data.testnet_api_key)
      setLogRetention(maintRes.data.log_retention_days)
      setTradeRetention(maintRes.data.trade_retention_days)
    } catch (e) {
      console.error('Failed to load settings', e)
    }
  }

  const [resetConfirm, setResetConfirm] = useState(false)
  const [resetting, setResetting] = useState(false)

  useEffect(() => {
    if (resetConfirm) {
      const timer = setTimeout(() => setResetConfirm(false), 3000)
      return () => clearTimeout(timer)
    }
  }, [resetConfirm])

  async function handleResetBalance() {
    if (!resetConfirm) {
      setResetConfirm(true)
      return
    }
    setResetting(true)
    try {
      await resetPaperBalance()
      setStatus({ type: 'success', msg: 'Paper balance reset to $10,000' })
    } catch (e) {
      setStatus({ type: 'error', msg: 'Failed to reset balance' })
    } finally {
      setResetting(false)
      setResetConfirm(false)
    }
  }

  async function handleSave() {
    setLoading(true)
    setStatus(null)
    try {
      const tasks = []

      // Only update keys if they were actually entered
      if (apiKey.trim() || apiSecret.trim() || testnetApiKey.trim() || testnetApiSecret.trim()) {
        tasks.push(settingsAPI.updateKeys({
          api_key: apiKey,
          api_secret: apiSecret,
          testnet_api_key: testnetApiKey,
          testnet_api_secret: testnetApiSecret
        }))
      }

      tasks.push(settingsAPI.updateMaintenance({
        log_retention_days: Number(logRetention),
        trade_retention_days: Number(tradeRetention)
      }))

      await Promise.all(tasks)
      setStatus({ type: 'success', msg: 'Settings updated successfully!' })
      setApiKey('')
      setApiSecret('')
      setTestnetApiKey('')
      setTestnetApiSecret('')
      loadSettings()
    } catch (e) {
      setStatus({ type: 'error', msg: 'Update failed. Check backend logs.' })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className={cn(
      "min-h-screen transition-all duration-300",
      sidebarCollapsed ? "lg:pl-[80px]" : "lg:pl-[260px]"
    )}>
      <Sidebar />
      <div className="max-w-[800px] mx-auto p-4 md:p-8 animate-in fade-in slide-in-from-bottom-4 duration-500 pb-32 lg:pb-8">
        <div className="flex items-center gap-4 mb-10 bg-surface border border-border rounded-2xl p-6 shadow-sm">
          <div className="w-12 h-12 rounded-2xl bg-accent/10 border border-accent/20 flex items-center justify-center">
            <SettingsIcon size={24} className="text-accent" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">System Settings</h1>
            <p className="text-[11px] text-dim font-bold uppercase tracking-widest mt-1">Manage API credentials and engine parameters</p>
          </div>
        </div>

        <div className="space-y-10">
          <section>
            <SectionLabel className="mb-6">Dashboard & Streaming</SectionLabel>
            <div className="bg-surface border border-border rounded-2xl p-6 md:p-8 shadow-sm space-y-8">
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center">
                    <Activity size={20} className="text-accent" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold uppercase tracking-tight">System Health Bar</h3>
                    <p className="text-[11px] text-dim font-medium uppercase mt-1">Show CPU, Memory and event loop lag</p>
                  </div>
                </div>
                <button 
                  onClick={() => setHealthEnabled(!healthEnabled)}
                  role="switch"
                  aria-checked={healthEnabled}
                  aria-label="Toggle System Health Bar"
                  className={cn(
                    "w-12 h-6 rounded-full transition-colors relative shrink-0",
                    healthEnabled ? "bg-green" : "bg-border"
                  )}
                >
                  <div className={cn(
                    "absolute top-1 w-4 h-4 bg-white rounded-full transition-transform",
                    healthEnabled ? "translate-x-7" : "translate-x-1"
                  )} />
                </button>
              </div>

              <div className="flex items-center justify-between gap-4 pt-8 border-t border-border/50">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-xl bg-green/10 flex items-center justify-center">
                    <Zap size={20} className="text-green" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold uppercase tracking-tight">Real-time Streaming</h3>
                    <p className="text-[11px] text-dim font-medium uppercase mt-1">Enable/Disable all incoming WebSocket updates</p>
                  </div>
                </div>
                <button 
                  onClick={() => setStreamingEnabled(!streamingEnabled)}
                  role="switch"
                  aria-checked={streamingEnabled}
                  aria-label="Toggle Real-time Streaming"
                  className={cn(
                    "w-12 h-6 rounded-full transition-colors relative shrink-0",
                    streamingEnabled ? "bg-green" : "bg-border"
                  )}
                >
                  <div className={cn(
                    "absolute top-1 w-4 h-4 bg-white rounded-full transition-transform",
                    streamingEnabled ? "translate-x-7" : "translate-x-1"
                  )} />
                </button>
              </div>

              <div className="flex items-center justify-between gap-4 pt-8 border-t border-border/50">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-xl bg-amber/10 flex items-center justify-center">
                    <Bug size={20} className="text-amber" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold uppercase tracking-tight">Developer Debug Console</h3>
                    <p className="text-[11px] text-dim font-medium uppercase mt-1">Load the in-app diagnostics overlay</p>
                  </div>
                </div>
                <button
                  onClick={() => setDebugToolsEnabled(!debugToolsEnabled)}
                  role="switch"
                  aria-checked={debugToolsEnabled}
                  aria-label="Toggle Developer Debug Console"
                  className={cn(
                    "w-12 h-6 rounded-full transition-colors relative shrink-0",
                    debugToolsEnabled ? "bg-amber" : "bg-border"
                  )}
                >
                  <div className={cn(
                    "absolute top-1 w-4 h-4 bg-white rounded-full transition-transform",
                    debugToolsEnabled ? "translate-x-7" : "translate-x-1"
                  )} />
                </button>
              </div>

              <div className="pt-8 border-t border-border/50">
                <div className="mb-4">
                  <h3 className="text-sm font-bold uppercase tracking-tight">Backend Log Feed</h3>
                  <p className="text-[11px] text-dim font-medium uppercase mt-1">Select which backend log levels are sent to this dashboard.</p>
                </div>
                <div className="flex flex-wrap gap-3">
                  {['info', 'warn', 'error'].map((level) => {
                    const enabled = logFilters[level]
                    const label = level === 'info' ? 'Info' : level === 'warn' ? 'Warnings' : 'Errors'
                    return (
                      <button
                        key={level}
                        type="button"
                        onClick={() => toggleLogFilter(level)}
                        className={cn(
                          "rounded-full border px-4 py-2 text-xs font-bold uppercase tracking-tight transition-all",
                          enabled ? 'border-accent bg-accent/10 text-text' : 'border-border text-dim bg-transparent'
                        )}
                      >
                        {label}
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>
          </section>

          <section>
            <SectionLabel className="mb-6">Exchange Integration (Live)</SectionLabel>
            <div className="bg-surface border border-border rounded-2xl p-6 md:p-8 shadow-sm">
              <div className="grid grid-cols-1 gap-8">
                <div className="flex flex-col gap-2">
                  <div className="text-[10px] text-dim font-bold tracking-widest uppercase mb-1">Live Credentials</div>
                  <div className="flex items-center gap-3 p-4 bg-background/50 border border-border rounded-xl">
                    <div className="w-8 h-8 rounded-lg bg-green/10 flex items-center justify-center">
                      <Key size={16} className="text-green" />
                    </div>
                    <div className="text-xs font-mono text-dim tracking-tight truncate">
                      {maskedKey || 'No live API key configured'}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="flex flex-col gap-2">
                    <label htmlFor="apiKey" className="text-[10px] text-dim font-bold tracking-widest uppercase">Update Live API Key</label>
                    <input
                      id="apiKey"
                      type="text"
                      value={apiKey}
                      onChange={e => setApiKey(e.target.value)}
                      className="w-full bg-background border border-border focus:border-accent focus:outline-none rounded-xl px-4 py-3 text-sm font-mono text-text transition-all"
                      placeholder="8080...2025"
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    <label htmlFor="apiSecret" className="text-[10px] text-dim font-bold tracking-widest uppercase">Update Live API Secret</label>
                    <div className="relative">
                      <input
                        id="apiSecret"
                        type={showLiveSecret ? "text" : "password"}
                        value={apiSecret}
                        onChange={e => setApiSecret(e.target.value)}
                        className="w-full bg-background border border-border focus:border-accent focus:outline-none rounded-xl px-4 py-3 pr-12 text-sm font-mono text-text transition-all"
                        placeholder="••••••••••••••••"
                      />
                      <button
                        type="button"
                        onClick={() => setShowLiveSecret(!showLiveSecret)}
                        aria-label={showLiveSecret ? "Hide secret" : "Show secret"}
                        className="absolute right-4 top-1/2 -translate-y-1/2 text-dim hover:text-accent transition-colors"
                      >
                        {showLiveSecret ? <EyeOff size={18} /> : <Eye size={18} />}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section>
            <SectionLabel className="mb-6 text-purple">Binance Demo (Testnet)</SectionLabel>
            <div className="bg-surface border border-border rounded-2xl p-6 md:p-8 shadow-sm">
              <div className="grid grid-cols-1 gap-8">
                <div className="flex flex-col gap-2">
                  <div className="text-[10px] text-dim font-bold tracking-widest uppercase mb-1">Demo Credentials</div>
                  <div className="flex items-center gap-3 p-4 bg-background/50 border border-border rounded-xl">
                    <div className="w-8 h-8 rounded-lg bg-purple/10 flex items-center justify-center">
                      <Key size={16} className="text-purple" />
                    </div>
                    <div className="text-xs font-mono text-dim tracking-tight truncate">
                      {maskedTestnetKey || 'No testnet API key configured'}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="flex flex-col gap-2">
                    <label htmlFor="testnetApiKey" className="text-[10px] text-dim font-bold tracking-widest uppercase">Update Testnet API Key</label>
                    <input
                      id="testnetApiKey"
                      type="text"
                      value={testnetApiKey}
                      onChange={e => setTestnetApiKey(e.target.value)}
                      className="w-full bg-background border border-border focus:border-purple focus:outline-none rounded-xl px-4 py-3 text-sm font-mono text-text transition-all"
                      placeholder="abcd...1234"
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    <label htmlFor="testnetApiSecret" className="text-[10px] text-dim font-bold tracking-widest uppercase">Update Testnet API Secret</label>
                    <div className="relative">
                      <input
                        id="testnetApiSecret"
                        type={showTestnetSecret ? "text" : "password"}
                        value={testnetApiSecret}
                        onChange={e => setTestnetApiSecret(e.target.value)}
                        className="w-full bg-background border border-border focus:border-purple focus:outline-none rounded-xl px-4 py-3 pr-12 text-sm font-mono text-text transition-all"
                        placeholder="••••••••••••••••"
                      />
                      <button
                        type="button"
                        onClick={() => setShowTestnetSecret(!showTestnetSecret)}
                        aria-label={showTestnetSecret ? "Hide secret" : "Show secret"}
                        className="absolute right-4 top-1/2 -translate-y-1/2 text-dim hover:text-purple transition-colors"
                      >
                        {showTestnetSecret ? <EyeOff size={18} /> : <Eye size={18} />}
                      </button>
                    </div>
                  </div>
                </div>

                <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 pt-4 border-t border-border/50">
                  <div className="max-w-md">
                    {status && (
                      <motion.div
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        className={cn("flex items-center gap-2 text-xs font-bold uppercase tracking-tight", status.type === 'success' ? "text-green" : "text-red")}
                      >
                        {status.type === 'success' ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}
                        {status.msg}
                      </motion.div>
                    )}
                  </div>
                  <Btn
                    onClick={handleSave}
                    disabled={loading}
                    loading={loading}
                    className="w-full md:w-auto min-w-[160px]"
                  >
                    Apply Settings
                  </Btn>
                </div>
              </div>
            </div>
          </section>

          <section>
            <SectionLabel className="mb-6">Account & Data Maintenance</SectionLabel>
            <div className="bg-surface border border-border rounded-2xl p-6 md:p-8 shadow-sm space-y-8">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <div className="flex flex-col gap-4">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-accent/10 flex items-center justify-center">
                      <Database size={16} className="text-accent" />
                    </div>
                    <div>
                      <h3 className="text-xs font-bold uppercase tracking-tight">Log Retention</h3>
                      <p className="text-[10px] text-dim font-medium uppercase">Prune backend logs after N days</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <input
                      type="number"
                      min="1"
                      max="365"
                      value={logRetention}
                      onChange={e => setLogRetention(e.target.value)}
                      className="w-24 bg-background border border-border focus:border-accent focus:outline-none rounded-xl px-4 py-2 text-sm font-bold text-text transition-all"
                    />
                    <span className="text-[10px] text-dim font-bold uppercase tracking-widest">Days</span>
                  </div>
                </div>

                <div className="flex flex-col gap-4">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-green/10 flex items-center justify-center">
                      <RotateCcw size={16} className="text-green" />
                    </div>
                    <div>
                      <h3 className="text-xs font-bold uppercase tracking-tight">Trade History Retention</h3>
                      <p className="text-[10px] text-dim font-medium uppercase">Prune history and analytics data</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <input
                      type="number"
                      min="1"
                      max="1000"
                      value={tradeRetention}
                      onChange={e => setTradeRetention(e.target.value)}
                      className="w-24 bg-background border border-border focus:border-accent focus:outline-none rounded-xl px-4 py-2 text-sm font-bold text-text transition-all"
                    />
                    <span className="text-[10px] text-dim font-bold uppercase tracking-widest">Days</span>
                  </div>
                </div>
              </div>

              <div className="pt-8 border-t border-border/50 flex flex-col md:flex-row md:items-center justify-between gap-6">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-xl bg-red/10 flex items-center justify-center">
                    <RotateCcw size={20} className="text-red" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold uppercase tracking-tight text-red">Reset Paper Balance</h3>
                    <p className="text-[11px] text-dim font-medium uppercase mt-1">Reset your global paper trading balance to $10,000.00</p>
                  </div>
                </div>
                <button
                  onClick={handleResetBalance}
                  disabled={resetting}
                  aria-label={resetting ? "Resetting balance" : resetConfirm ? "Confirm reset balance" : "Reset balance"}
                  className={cn(
                    "px-6 py-3 rounded-xl text-[11px] font-bold uppercase tracking-widest transition-all",
                    resetConfirm
                      ? "bg-red text-white animate-pulse shadow-lg shadow-red/20"
                      : "bg-surface border border-border text-dim hover:text-red hover:border-red"
                  )}
                >
                  <span aria-live="polite">
                    {resetting ? "Resetting..." : resetConfirm ? "Confirm Reset?" : "Reset Balance"}
                  </span>
                </button>
              </div>
            </div>
          </section>

          <section className="bg-amber/5 border border-amber/20 rounded-2xl p-6 flex gap-4">
            <div className="w-10 h-10 rounded-xl bg-amber/10 flex items-center justify-center shrink-0">
              <ShieldAlert size={20} className="text-amber" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-amber mb-1 uppercase tracking-tight">Security Protocol</h3>
              <p className="text-xs text-dim leading-relaxed font-medium">
                API credentials are encrypted at rest on the backend and never exposed to the frontend after initial submission.
                Always ensure your Binance API keys have <span className="text-text font-bold">"Withdrawals" disabled</span> and are restricted to your current IP address if possible.
              </p>
            </div>
          </section>
        </div>
        <BottomNav />
      </div>
    </div>
  )
}
