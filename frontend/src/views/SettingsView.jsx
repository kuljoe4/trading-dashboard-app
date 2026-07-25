import React, { useState, useEffect } from 'react'
import { settingsAPI, setAdminApiKey } from '../api/client'
import { SectionLabel, Btn, StatCard, cn, ViewHeader, Tooltip } from '../components/ui/primitives'
import { Settings as SettingsIcon, ShieldAlert, Key, Lock, CheckCircle2, AlertCircle, Activity, Zap, Eye, EyeOff, RotateCcw, Bug, X } from 'lucide-react'
import { motion } from 'framer-motion'
import { useTradingStore } from '../store/trading'
import { Sidebar, BottomNav } from '../components/Navigation'
import { ConfirmationModal } from '../components/ConfirmationModal'

export function SettingsView() {
  const { healthEnabled, setHealthEnabled, streamingEnabled, setStreamingEnabled, sidebarCollapsed, logFilters, toggleLogFilter, resetPaperBalance, connectWS, disconnectWS } = useTradingStore()
  const [adminApiKey, setAdminApiKeyValue] = useState(localStorage.getItem('MOMENTUM_ADMIN_API_KEY') || '')
  const [showAdminKey, setShowAdminKey] = useState(false)
  const [apiKey, setApiKey] = useState('')
  const [apiSecret, setApiSecret] = useState('')
  const [showLiveSecret, setShowLiveSecret] = useState(false)
  const [testnetApiKey, setTestnetApiKey] = useState('')
  const [testnetApiSecret, setTestnetApiSecret] = useState('')
  const [showTestnetSecret, setShowTestnetSecret] = useState(false)
  const [maskedKey, setMaskedKey] = useState('')
  const [maskedTestnetKey, setMaskedTestnetKey] = useState('')
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState(null)
  const [validating, setValidating] = useState(false)
  const [validationResults, setValidationResults] = useState(null)

  useEffect(() => {
    loadKeys()
  }, [])

  async function loadKeys() {
    try {
      const res = await settingsAPI.getKeys()
      setMaskedKey(res.data.api_key)
      setMaskedTestnetKey(res.data.testnet_api_key)
    } catch (e) {
      console.error('Failed to load keys', e)
    }
  }

  async function handleValidate() {
    setValidating(true)
    setValidationResults(null)
    try {
      const res = await settingsAPI.validateKeys({
        api_key: apiKey,
        api_secret: apiSecret,
        testnet_api_key: testnetApiKey,
        testnet_api_secret: testnetApiSecret
      })
      setValidationResults(res.data)
    } catch (e) {
      setValidationResults({
        valid: false,
        checks: [{
          type: 'error',
          status: 'error',
          message: `Validation request failed: ${e.message || 'Unknown error'}`
        }]
      })
      console.error('Validation failed', e)
    } finally {
      setValidating(false)
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
    setResetting(true)
    useTradingStore.getState().setSyncing(true)
    try {
      await resetPaperBalance()
      setStatus({ type: 'success', msg: 'Paper balance reset to $10,000' })
    } catch (e) {
      setStatus({ type: 'error', msg: 'Failed to reset balance' })
    } finally {
      setResetting(false)
      setResetConfirm(false)
      useTradingStore.getState().setSyncing(false)
    }
  }

  async function handleSave() {
    setLoading(true)
    setStatus(null)
    try {
      // Save Admin API Key locally
      if (adminApiKey) {
        setAdminApiKey(adminApiKey)
        // Reconnect WS to use new key
        disconnectWS()
        connectWS()
      } else {
        setAdminApiKey('')
      }

      console.log('[DEBUG] Sending credentials update...', { 
        has_api_key: !!apiKey, 
        has_api_secret: !!apiSecret,
        has_testnet_api_key: !!testnetApiKey, 
        has_testnet_api_secret: !!testnetApiSecret 
      })
      
      const response = await settingsAPI.updateKeys({
        api_key: apiKey,
        api_secret: apiSecret,
        testnet_api_key: testnetApiKey,
        testnet_api_secret: testnetApiSecret
      })
      
      setStatus({ type: 'success', msg: 'Credentials updated successfully!' })
      setApiKey('')
      setApiSecret('')
      setTestnetApiKey('')
      setTestnetApiSecret('')
      loadKeys()
    } catch (e) {
      const errorMsg = e.response?.data?.message || e.message || 'Update failed. Check backend logs.'
      setStatus({ type: 'error', msg: errorMsg })
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
      <div className={cn(
        "max-w-[800px] mx-auto p-4 md:p-8 animate-in fade-in slide-in-from-bottom-4 duration-500 lg:pb-8 transition-all",
        healthEnabled ? "pb-48" : "pb-32"
      )}>
        <ViewHeader
          icon={SettingsIcon}
          title="System Settings"
          subTitle="Manage API credentials and engine parameters"
          backAction={() => window.location.hash = '#/'}
        />

        <div className="flex flex-col gap-6 lg:gap-8">
          <section>
            <SectionLabel className="mb-4">Dashboard Security</SectionLabel>
            <div className="bg-surface border border-border rounded-2xl p-5 md:p-6 shadow-sm">
              <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-2">
                  <label htmlFor="adminApiKey" className="text-[10px] text-dim font-bold tracking-widest uppercase">Admin API Key</label>
                  <p className="text-[11px] text-dim font-medium uppercase mb-2">Required for dashboard authentication in production</p>
                  <div className="relative">
                    <input
                      id="adminApiKey"
                      type={showAdminKey ? "text" : "password"}
                      value={adminApiKey}
                      onChange={e => setAdminApiKeyValue(e.target.value)}
                      className="w-full bg-background border border-border focus:border-accent focus:outline-none rounded-xl px-4 py-3 pr-20 text-sm font-mono text-text transition-all"
                      placeholder="••••••••••••••••"
                    />
                    <div className="absolute right-4 top-1/2 -translate-y-1/2 flex items-center gap-2 text-dim">
                      {adminApiKey && (
                        <Tooltip content="Clear Key">
                          <button
                            type="button"
                            onClick={() => setAdminApiKeyValue('')}
                            aria-label="Clear Admin API Key"
                            className="hover:text-red transition-colors focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none rounded-md"
                          >
                            <X size={18} />
                          </button>
                        </Tooltip>
                      )}
                      <Tooltip content={showAdminKey ? "Hide Key" : "Show Key"}>
                        <button
                          type="button"
                          onClick={() => setShowAdminKey(!showAdminKey)}
                          aria-label={showAdminKey ? "Hide key" : "Show key"}
                          className="hover:text-accent transition-colors focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none rounded-md"
                        >
                          {showAdminKey ? <EyeOff size={18} /> : <Eye size={18} />}
                        </button>
                      </Tooltip>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {window.location.protocol !== 'https:' && window.location.hostname !== 'localhost' && (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="bg-red/10 border border-red/20 rounded-2xl p-6 flex gap-4 items-center shadow-sm"
            >
              <div className="w-12 h-12 rounded-2xl bg-red/10 flex items-center justify-center shrink-0">
                <ShieldAlert size={24} className="text-red" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-red uppercase tracking-tight">Insecure Connection</h3>
                <p className="text-xs text-dim font-medium leading-relaxed mt-1">
                  You are accessing the dashboard over an unencrypted <span className="text-red font-bold">HTTP</span> connection.
                  Entering API credentials now is <span className="text-red font-bold">HIGHLY DISCOURAGED</span> as they could be intercepted.
                </p>
              </div>
            </motion.div>
          )}

          <section>
            <SectionLabel className="mb-4">Dashboard & Streaming</SectionLabel>
            <div className="bg-surface border border-border rounded-2xl p-5 md:p-6 shadow-sm space-y-6">
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
                    "w-12 h-6 rounded-full transition-colors relative shrink-0 focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none",
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
                    "w-12 h-6 rounded-full transition-colors relative shrink-0 focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none",
                    streamingEnabled ? "bg-green" : "bg-border"
                  )}
                >
                  <div className={cn(
                    "absolute top-1 w-4 h-4 bg-white rounded-full transition-transform",
                    streamingEnabled ? "translate-x-7" : "translate-x-1"
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
                          "rounded-full border px-4 py-2 text-xs font-bold uppercase tracking-tight transition-all focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none",
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
            <SectionLabel className="mb-4">Exchange Integration (Live)</SectionLabel>
            <div className="bg-surface border border-border rounded-2xl p-5 md:p-6 shadow-sm">
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
                    <div className="relative">
                      <input
                        id="apiKey"
                        type="text"
                        value={apiKey}
                        onChange={e => setApiKey(e.target.value)}
                        className="w-full bg-background border border-border focus:border-accent focus:outline-none rounded-xl px-4 py-3 pr-12 text-sm font-mono text-text transition-all"
                        placeholder="8080...2025"
                      />
                      {apiKey && (
                        <div className="absolute right-4 top-1/2 -translate-y-1/2 flex items-center gap-2">
                          <Tooltip content="Clear Key">
                            <button
                              type="button"
                              onClick={() => setApiKey('')}
                              aria-label="Clear API Key"
                              className="text-dim hover:text-red transition-colors focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none rounded-md"
                            >
                              <X size={18} />
                            </button>
                          </Tooltip>
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-col gap-2">
                    <label htmlFor="apiSecret" className="text-[10px] text-dim font-bold tracking-widest uppercase">Update Live API Secret</label>
                    <div className="relative">
                      <input
                        id="apiSecret"
                        type={showLiveSecret ? "text" : "password"}
                        value={apiSecret}
                        onChange={e => setApiSecret(e.target.value)}
                        className="w-full bg-background border border-border focus:border-accent focus:outline-none rounded-xl px-4 py-3 pr-20 text-sm font-mono text-text transition-all"
                        placeholder="••••••••••••••••"
                      />
                      <div className="absolute right-4 top-1/2 -translate-y-1/2 flex items-center gap-2 text-dim">
                        {apiSecret && (
                          <Tooltip content="Clear Secret">
                            <button
                              type="button"
                              onClick={() => setApiSecret('')}
                              aria-label="Clear API Secret"
                              className="hover:text-red transition-colors focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none rounded-md"
                            >
                              <X size={18} />
                            </button>
                          </Tooltip>
                        )}
                        <Tooltip content={showLiveSecret ? "Hide Secret" : "Show Secret"}>
                          <button
                            type="button"
                            onClick={() => setShowLiveSecret(!showLiveSecret)}
                            aria-label={showLiveSecret ? "Hide secret" : "Show secret"}
                            className="hover:text-accent transition-colors focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none rounded-md"
                          >
                            {showLiveSecret ? <EyeOff size={18} /> : <Eye size={18} />}
                          </button>
                        </Tooltip>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section>
            <SectionLabel className="mb-4 text-purple">Binance Demo (Testnet)</SectionLabel>
            <div className="bg-surface border border-border rounded-2xl p-5 md:p-6 shadow-sm">
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
                    <div className="relative">
                      <input
                        id="testnetApiKey"
                        type="text"
                        value={testnetApiKey}
                        onChange={e => setTestnetApiKey(e.target.value)}
                        className="w-full bg-background border border-border focus:border-purple focus:outline-none rounded-xl px-4 py-3 pr-12 text-sm font-mono text-text transition-all"
                        placeholder="abcd...1234"
                      />
                      {testnetApiKey && (
                        <div className="absolute right-4 top-1/2 -translate-y-1/2 flex items-center gap-2">
                          <Tooltip content="Clear Key">
                            <button
                              type="button"
                              onClick={() => setTestnetApiKey('')}
                              aria-label="Clear Testnet API Key"
                              className="text-dim hover:text-red transition-colors focus-visible:ring-2 focus-visible:ring-purple focus-visible:outline-none rounded-md"
                            >
                              <X size={18} />
                            </button>
                          </Tooltip>
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-col gap-2">
                    <label htmlFor="testnetApiSecret" className="text-[10px] text-dim font-bold tracking-widest uppercase">Update Testnet API Secret</label>
                    <div className="relative">
                      <input
                        id="testnetApiSecret"
                        type={showTestnetSecret ? "text" : "password"}
                        value={testnetApiSecret}
                        onChange={e => setTestnetApiSecret(e.target.value)}
                        className="w-full bg-background border border-border focus:border-purple focus:outline-none rounded-xl px-4 py-3 pr-20 text-sm font-mono text-text transition-all"
                        placeholder="••••••••••••••••"
                      />
                      <div className="absolute right-4 top-1/2 -translate-y-1/2 flex items-center gap-2 text-dim">
                        {testnetApiSecret && (
                          <Tooltip content="Clear Secret">
                            <button
                              type="button"
                              onClick={() => setTestnetApiSecret('')}
                              aria-label="Clear Testnet API Secret"
                              className="hover:text-red transition-colors focus-visible:ring-2 focus-visible:ring-purple focus-visible:outline-none rounded-md"
                            >
                              <X size={18} />
                            </button>
                          </Tooltip>
                        )}
                        <Tooltip content={showTestnetSecret ? "Hide Secret" : "Show Secret"}>
                          <button
                            type="button"
                            onClick={() => setShowTestnetSecret(!showTestnetSecret)}
                            aria-label={showTestnetSecret ? "Hide secret" : "Show secret"}
                            className="hover:text-purple transition-colors focus-visible:ring-2 focus-visible:ring-purple focus-visible:outline-none rounded-md"
                          >
                            {showTestnetSecret ? <EyeOff size={18} /> : <Eye size={18} />}
                          </button>
                        </Tooltip>
                      </div>
                    </div>
                  </div>
                </div>

                {(apiKey || testnetApiKey) && (
                  <div className="flex flex-col gap-4 pt-4 border-t border-border/50">
                    <div className="flex items-center gap-2">
                      <Bug size={16} className="text-purple" />
                      <h4 className="text-xs font-bold uppercase tracking-tight">Validate API Keys</h4>
                    </div>
                    <p className="text-[10px] text-dim font-medium">Test your Binance API keys before saving. This will attempt to authenticate with Binance without modifying anything.</p>
                    <Btn
                      onClick={handleValidate}
                      disabled={validating || (!apiKey && !testnetApiKey)}
                      loading={validating}
                      className="w-full"
                      variant="secondary"
                    >
                      {validating ? 'Validating...' : 'Test API Keys'}
                    </Btn>
                    
                    {validationResults && (
                      <motion.div
                        initial={{ opacity: 0, y: -10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className={cn("rounded-xl border p-4", validationResults.valid ? "bg-green/10 border-green/30" : "bg-red/10 border-red/30")}
                      >
                        <div className="flex items-start gap-3">
                          <div className="mt-0.5">
                            {validationResults.valid ? (
                              <CheckCircle2 size={16} className="text-green" />
                            ) : (
                              <AlertCircle size={16} className="text-red" />
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className={cn("text-xs font-bold uppercase tracking-tight mb-2", validationResults.valid ? "text-green" : "text-red")}>
                              {validationResults.valid ? 'All Keys Valid ✓' : 'Validation Failed'}
                            </p>
                            <div className="space-y-1">
                              {validationResults.checks && validationResults.checks.map((check, i) => (
                                <div key={i} className="text-[10px] text-dim font-medium">
                                  <span className={check.status === 'valid' ? 'text-green' : 'text-red'}>
                                    {check.type}: {check.message}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </div>
                )}

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
                    disabled={loading || (!apiKey && !apiSecret && !testnetApiKey && !testnetApiSecret)}
                    loading={loading}
                    className="w-full md:w-auto min-w-[160px]"
                  >
                    Apply All Credentials
                  </Btn>
                </div>
              </div>
            </div>
          </section>

          <section>
            <SectionLabel className="mb-4">Account Maintenance</SectionLabel>
            <div className="bg-surface border border-border rounded-2xl p-5 md:p-6 shadow-sm">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-xl bg-red/10 flex items-center justify-center">
                    <RotateCcw size={20} className="text-red" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold uppercase tracking-tight text-red">Reset Paper Balance</h3>
                    <p className="text-[11px] text-dim font-medium uppercase mt-1">Reset your global paper trading balance to $10,000.00</p>
                  </div>
                </div>
                <Btn
                  variant="ghost"
                  onClick={() => setResetConfirm(true)}
                  disabled={resetting}
                  className="px-6 py-3 rounded-xl text-[11px] font-bold uppercase tracking-widest text-red hover:bg-red/5 hover:border-red"
                >
                  Reset Balance
                </Btn>
              </div>
            </div>

            <ConfirmationModal
              isOpen={resetConfirm}
              onClose={() => setResetConfirm(false)}
              onConfirm={() => {
                setResetConfirm(false);
                handleResetBalance();
              }}
              title="Reset Paper Balance?"
              message="This will reset your simulated paper trading balance to $10,000.00. Your trade history will remain intact, but active session metrics might be affected. This action cannot be undone."
              confirmText="Reset Now"
              variant="danger"
              loading={resetting}
            />
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
