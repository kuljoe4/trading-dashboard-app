import React, { useState, useEffect, useRef } from 'react'
import { settingsAPI, setAdminApiKey } from '../api/client'
import { SectionLabel, Btn, StatCard, cn, ViewHeader, Tooltip } from '../components/ui/primitives'
import { Settings as SettingsIcon, ShieldAlert, Key, Lock, CheckCircle2, AlertCircle, Activity, Zap, Eye, EyeOff, RotateCcw, Bug, X, ShieldCheck } from 'lucide-react'
import { motion } from 'framer-motion'
import { useTradingStore } from '../store/trading'
import { Sidebar, BottomNav } from '../components/Navigation'
import { ConfirmationModal } from '../components/ConfirmationModal'
import { CONFIG_LIMITS } from '../constants/configLimits'
import { THEMES } from '../lib/theme.js'

export function SettingsView() {
  const { theme: currentTheme, setTheme, healthEnabled, setHealthEnabled, streamingEnabled, setStreamingEnabled, sidebarCollapsed, logFilters, toggleLogFilter, resetPaperBalance, connectWS, disconnectWS, config, patchConfig, configSyncing } = useTradingStore()
  const cfg = config || {}
  const [adminApiKey, setAdminApiKeyValue] = useState(localStorage.getItem('MOMENTUM_ADMIN_API_KEY') || '')
  const [showAdminKey, setShowAdminKey] = useState(false)
  const [apiKey, setApiKey] = useState('')
  const [apiSecret, setApiSecret] = useState('')
  const [showLiveSecret, setShowLiveSecret] = useState(false)
  const [testnetApiKey, setTestnetApiKey] = useState('')
  const [testnetApiSecret, setTestnetApiSecret] = useState('')

  const adminApiKeyRef = useRef(null)
  const apiKeyRef = useRef(null)
  const apiSecretRef = useRef(null)
  const testnetApiKeyRef = useRef(null)
  const testnetApiSecretRef = useRef(null)
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
            <SectionLabel className="mb-4">Dashboard Visual Theme</SectionLabel>
            <div className="bg-surface border border-border rounded-2xl p-5 md:p-6 shadow-sm space-y-4">
              <div>
                <p className="text-[11px] text-dim font-medium uppercase mb-4">Choose a modern look for your trading cockpit and analytics dashboard</p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {Object.entries(THEMES).map(([id, t]) => {
                  const isActive = currentTheme === id;
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setTheme(id)}
                      aria-label={`Select ${t.name} theme`}
                      aria-pressed={isActive}
                      className={cn(
                        "p-4 rounded-xl border-2 text-left transition-all relative group focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none flex flex-col justify-between h-32 cursor-pointer",
                        isActive ? "border-accent bg-accent/5 ring-2 ring-accent/15" : "border-border bg-background hover:border-border-hover hover:bg-surface"
                      )}
                    >
                      <div className="w-full">
                        <div className="flex items-center justify-between mb-1">
                          <span className={cn("text-[11px] font-black uppercase tracking-tighter", isActive ? "text-accent" : "text-text")}>{t.name}</span>
                          {isActive && <CheckCircle2 size={14} className="text-accent" />}
                        </div>
                        <p className="text-[9px] text-dim font-bold uppercase tracking-tight leading-tight mb-3">{t.desc}</p>
                      </div>

                      {/* Visual Color Preview Capsule */}
                      <div className="flex items-center gap-1 bg-surface/50 p-1.5 rounded-lg border border-border/40 w-fit">
                        <span className="w-3 h-3 rounded-full border border-black/10 shrink-0" title="Background" style={{ backgroundColor: t.colors['--color-background-theme'] }} />
                        <span className="w-3 h-3 rounded-full border border-black/10 shrink-0" title="Surface" style={{ backgroundColor: t.colors['--color-surface-theme'] }} />
                        <span className="w-3 h-3 rounded-full border border-black/10 shrink-0" title="Accent" style={{ backgroundColor: t.colors['--color-accent-theme'] }} />
                        <span className="w-3 h-3 rounded-full border border-black/10 shrink-0" title="Green" style={{ backgroundColor: t.colors['--color-green-theme'] }} />
                        <span className="w-3 h-3 rounded-full border border-black/10 shrink-0" title="Red" style={{ backgroundColor: t.colors['--color-red-theme'] }} />
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </section>

          <section>
            <SectionLabel className="mb-4">Dashboard Security</SectionLabel>
            <div className="bg-surface border border-border rounded-2xl p-5 md:p-6 shadow-sm">
              <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-2">
                  <label htmlFor="adminApiKey" className="text-[10px] text-dim font-bold tracking-widest uppercase">Admin API Key</label>
                  <p className="text-[11px] text-dim font-medium uppercase mb-2">Required for dashboard authentication in production</p>
                  <div className="relative">
                    <input
                      ref={adminApiKeyRef}
                      id="adminApiKey"
                      type={showAdminKey ? "text" : "password"}
                      value={adminApiKey}
                      onChange={e => setAdminApiKeyValue(e.target.value)}
                      className="w-full bg-background border border-border focus:border-accent focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none rounded-xl px-4 py-3 pr-20 text-sm font-mono text-text transition-all"
                      placeholder="••••••••••••••••"
                    />
                    <div className="absolute right-4 top-1/2 -translate-y-1/2 flex items-center gap-2 text-dim">
                      {adminApiKey && (
                        <Tooltip content="Clear Key">
                          <button
                            type="button"
                            onClick={() => { setAdminApiKeyValue(''); adminApiKeyRef.current?.focus(); }}
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
                        ref={apiKeyRef}
                        id="apiKey"
                        type="text"
                        value={apiKey}
                        onChange={e => setApiKey(e.target.value)}
                        className="w-full bg-background border border-border focus:border-accent focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none rounded-xl px-4 py-3 pr-12 text-sm font-mono text-text transition-all"
                        placeholder="8080...2025"
                      />
                      {apiKey && (
                        <div className="absolute right-4 top-1/2 -translate-y-1/2 flex items-center gap-2">
                          <Tooltip content="Clear Key">
                            <button
                              type="button"
                              onClick={() => { setApiKey(''); apiKeyRef.current?.focus(); }}
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
                        ref={apiSecretRef}
                        id="apiSecret"
                        type={showLiveSecret ? "text" : "password"}
                        value={apiSecret}
                        onChange={e => setApiSecret(e.target.value)}
                        className="w-full bg-background border border-border focus:border-accent focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none rounded-xl px-4 py-3 pr-20 text-sm font-mono text-text transition-all"
                        placeholder="••••••••••••••••"
                      />
                      <div className="absolute right-4 top-1/2 -translate-y-1/2 flex items-center gap-2 text-dim">
                        {apiSecret && (
                          <Tooltip content="Clear Secret">
                            <button
                              type="button"
                              onClick={() => { setApiSecret(''); apiSecretRef.current?.focus(); }}
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
                        ref={testnetApiKeyRef}
                        id="testnetApiKey"
                        type="text"
                        value={testnetApiKey}
                        onChange={e => setTestnetApiKey(e.target.value)}
                        className="w-full bg-background border border-border focus:border-purple focus-visible:ring-2 focus-visible:ring-purple focus-visible:outline-none rounded-xl px-4 py-3 pr-12 text-sm font-mono text-text transition-all"
                        placeholder="abcd...1234"
                      />
                      {testnetApiKey && (
                        <div className="absolute right-4 top-1/2 -translate-y-1/2 flex items-center gap-2">
                          <Tooltip content="Clear Key">
                            <button
                              type="button"
                              onClick={() => { setTestnetApiKey(''); testnetApiKeyRef.current?.focus(); }}
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
                        ref={testnetApiSecretRef}
                        id="testnetApiSecret"
                        type={showTestnetSecret ? "text" : "password"}
                        value={testnetApiSecret}
                        onChange={e => setTestnetApiSecret(e.target.value)}
                        className="w-full bg-background border border-border focus:border-purple focus-visible:ring-2 focus-visible:ring-purple focus-visible:outline-none rounded-xl px-4 py-3 pr-20 text-sm font-mono text-text transition-all"
                        placeholder="••••••••••••••••"
                      />
                      <div className="absolute right-4 top-1/2 -translate-y-1/2 flex items-center gap-2 text-dim">
                        {testnetApiSecret && (
                          <Tooltip content="Clear Secret">
                            <button
                              type="button"
                              onClick={() => { setTestnetApiSecret(''); testnetApiSecretRef.current?.focus(); }}
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
              </div>
            </div>
          </section>

          <section>
            <SectionLabel className="mb-4">Validate & Apply Credentials</SectionLabel>
            <div className="bg-surface border border-border rounded-2xl p-5 md:p-6 shadow-sm">
              <div className="grid grid-cols-1 gap-8">
                {(apiKey || testnetApiKey) && (
                  <div className="flex flex-col gap-4">
                    <div className="flex items-center gap-2">
                      <Bug size={16} className="text-accent" />
                      <h4 className="text-xs font-bold uppercase tracking-tight">Validate API Keys</h4>
                    </div>
                    <p className="text-[10px] text-dim font-medium uppercase">Test your Binance API keys before saving. This will attempt to authenticate with Binance without modifying anything.</p>
                    <Tooltip
                      content={
                        validating
                          ? "Validating API keys with Binance..."
                          : (!apiKey && !testnetApiKey)
                          ? "Enter live or testnet API keys above to run the validation check"
                          : "Test entered API keys on Binance without saving"
                      }
                    >
                      <div className="w-full">
                        <Btn
                          onClick={handleValidate}
                          disabled={validating || (!apiKey && !testnetApiKey)}
                          loading={validating}
                          className="w-full"
                          variant="secondary"
                        >
                          {validating ? 'Validating...' : 'Test API Keys'}
                        </Btn>
                      </div>
                    </Tooltip>
                    
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
                  <Tooltip
                    content={
                      loading
                        ? "Applying credentials..."
                        : (!apiKey && !apiSecret && !testnetApiKey && !testnetApiSecret && !adminApiKey)
                        ? "Enter live, testnet, or admin keys to apply changes"
                        : "Save and apply all configured credentials"
                    }
                  >
                    <div className="w-full md:w-auto">
                      <Btn
                        onClick={handleSave}
                        disabled={loading || (!apiKey && !apiSecret && !testnetApiKey && !testnetApiSecret && !adminApiKey)}
                        loading={loading}
                        className="w-full md:w-auto min-w-[160px]"
                      >
                        Apply All Credentials
                      </Btn>
                    </div>
                  </Tooltip>
                </div>
              </div>
            </div>
          </section>

          <section>
            <SectionLabel className="mb-4">Engine Performance & Resources</SectionLabel>
            <div className="bg-surface border border-border rounded-2xl p-5 md:p-6 shadow-sm space-y-6">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
                <div className="flex flex-col gap-2">
                  <div className="flex items-center gap-1.5">
                    <label htmlFor="hot_loop_interval_ms" className="text-[10px] text-dim font-bold tracking-widest uppercase">Hot Loop (ms)</label>
                    <Tooltip content="Frequency of the pricing loop execution for real-time tracking (minimum 500ms)">
                      <AlertCircle size={12} className="text-dim cursor-help" />
                    </Tooltip>
                  </div>
                  <input
                    id="hot_loop_interval_ms"
                    type="number"
                    min={CONFIG_LIMITS.HOT_LOOP_MIN}
                    value={cfg.hot_loop_interval_ms || 5000}
                    onChange={(e) => patchConfig({ hot_loop_interval_ms: Number(e.target.value) })}
                    className="w-full bg-background border border-border focus:border-accent focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none rounded-xl px-4 py-3 text-sm font-mono text-text transition-all"
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <div className="flex items-center gap-1.5">
                    <label htmlFor="main_loop_interval_ms" className="text-[10px] text-dim font-bold tracking-widest uppercase">Main Loop (ms)</label>
                    <Tooltip content="Frequency of the main technical analysis loop execution (minimum 1000ms)">
                      <AlertCircle size={12} className="text-dim cursor-help" />
                    </Tooltip>
                  </div>
                  <input
                    id="main_loop_interval_ms"
                    type="number"
                    min={CONFIG_LIMITS.MAIN_LOOP_MIN}
                    value={cfg.main_loop_interval_ms || 15000}
                    onChange={(e) => patchConfig({ main_loop_interval_ms: Number(e.target.value) })}
                    className="w-full bg-background border border-border focus:border-accent focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none rounded-xl px-4 py-3 text-sm font-mono text-text transition-all"
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <div className="flex items-center gap-1.5">
                    <label htmlFor="slippage_warning_threshold" className="text-[10px] text-dim font-bold tracking-widest uppercase">Slippage Limit (%)</label>
                    <Tooltip content="Maximum acceptable execution slippage before emitting system warnings">
                      <AlertCircle size={12} className="text-dim cursor-help" />
                    </Tooltip>
                  </div>
                  <input
                    id="slippage_warning_threshold"
                    type="number"
                    min="0"
                    step="0.1"
                    value={cfg.slippage_warning_threshold !== undefined ? (cfg.slippage_warning_threshold * 100).toFixed(1) : '0.1'}
                    onChange={(e) => patchConfig({ slippage_warning_threshold: Number(e.target.value) / 100 })}
                    className="w-full bg-background border border-border focus:border-accent focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none rounded-xl px-4 py-3 text-sm font-mono text-text transition-all"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4 border-t border-border/50">
                <div className="flex items-center justify-between p-4 bg-background rounded-2xl border border-border/50 group hover:border-accent/30 transition-colors">
                  <div>
                    <div className="text-sm font-bold">Track Rate Limits</div>
                    <div className="text-[10px] text-dim font-medium uppercase tracking-tight">Monitor Binance API weights</div>
                  </div>
                  <button
                    onClick={() => patchConfig({ track_binance_rate_limits: cfg.track_binance_rate_limits === false ? true : false })}
                    role="switch"
                    aria-checked={cfg.track_binance_rate_limits !== false}
                    aria-label="Toggle Track Rate Limits"
                    className={cn(
                      "w-12 h-6 rounded-full transition-colors relative shrink-0 focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none",
                      (cfg.track_binance_rate_limits !== false) ? "bg-green" : "bg-border"
                    )}
                  >
                    <div className={cn(
                      "absolute top-1 w-4 h-4 bg-white rounded-full transition-transform",
                      (cfg.track_binance_rate_limits !== false) ? "translate-x-7" : "translate-x-1"
                    )} />
                  </button>
                </div>

                <div className="flex items-center justify-between p-4 bg-background rounded-2xl border border-border/50 group hover:border-amber/30 transition-colors">
                  <div>
                    <div className="text-sm font-bold">Debug Mode</div>
                    <div className="text-[10px] text-dim font-medium uppercase tracking-tight">Verbose server-side logs</div>
                  </div>
                  <button
                    onClick={() => patchConfig({ debug_mode: !cfg.debug_mode })}
                    role="switch"
                    aria-checked={cfg.debug_mode === true}
                    aria-label="Toggle Debug Mode"
                    className={cn(
                      "w-12 h-6 rounded-full transition-colors relative shrink-0 focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none",
                      (cfg.debug_mode === true) ? "bg-amber" : "bg-border"
                    )}
                  >
                    <div className={cn(
                      "absolute top-1 w-4 h-4 bg-white rounded-full transition-transform",
                      (cfg.debug_mode === true) ? "translate-x-7" : "translate-x-1"
                    )} />
                  </button>
                </div>
              </div>

              <div className="pt-4 border-t border-border/50 space-y-4">
                <div>
                  <h3 className="text-sm font-bold uppercase tracking-tight">Hibernation Management</h3>
                  <p className="text-[11px] text-dim font-medium uppercase mt-1">Gated idle resource strategy</p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {[
                    { id: 'light', label: 'Light Sleep', desc: 'Fastest resumption. Keeps market streams active. Best for low latency.' },
                    { id: 'adaptive', label: 'Adaptive', desc: 'SRE Recommended. 30s light grace period before deep sleep. Balanced.' },
                    { id: 'deep', label: 'Deep Sleep', desc: 'Maximum resource savings. Immediate stream teardown and cache purge.' }
                  ].map(mode => (
                    <button
                      key={mode.id}
                      type="button"
                      onClick={() => patchConfig({ hibernation_mode: mode.id })}
                      className={cn(
                        "p-4 rounded-xl border-2 text-left transition-all relative group focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none",
                        (cfg.hibernation_mode || 'adaptive') === mode.id ? "border-accent bg-accent/10 ring-2 ring-accent/20" : "border-border bg-surface hover:border-border-hover"
                      )}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className={cn("text-[10px] font-black uppercase tracking-tighter", (cfg.hibernation_mode || 'adaptive') === mode.id ? "text-accent" : "text-text")}>{mode.label}</span>
                        {(cfg.hibernation_mode || 'adaptive') === mode.id && <CheckCircle2 size={14} className="text-accent" />}
                      </div>
                      <p className="text-[9px] text-dim font-bold uppercase tracking-tight leading-tight">{mode.desc}</p>
                    </button>
                  ))}
                </div>

                {(cfg.hibernation_mode || 'adaptive') === 'adaptive' && (
                  <div className="animate-in fade-in slide-in-from-top-2 duration-300">
                    <div className="flex flex-col gap-2">
                      <label htmlFor="hibernation_grace_period_sec" className="text-[10px] text-dim font-bold tracking-widest uppercase">Adaptive Grace Period (s)</label>
                      <input
                        id="hibernation_grace_period_sec"
                        type="number"
                        min="5"
                        max="3600"
                        value={cfg.hibernation_grace_period_sec || 30}
                        onChange={(e) => patchConfig({ hibernation_grace_period_sec: Number(e.target.value) })}
                        className="w-full max-w-[200px] bg-background border border-border focus:border-accent focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none rounded-xl px-4 py-3 text-sm font-mono text-text transition-all"
                      />
                    </div>
                    <p className="mt-1.5 text-[9px] text-dim font-medium uppercase tracking-tight">Time to maintain Light Sleep before full cache purge.</p>
                  </div>
                )}

                <div className="p-4 bg-background/40 border border-border/40 rounded-xl space-y-2">
                   <div className="flex items-center gap-2 text-[9px] font-black uppercase tracking-widest text-accent">
                      <ShieldCheck size={12} /> Resource vs. Latency Trade-off
                   </div>
                   <p className="text-[10px] text-dim leading-relaxed font-medium italic border-l border-accent/20 pl-3">
                      {(cfg.hibernation_mode || 'adaptive') === 'light' ?
                        "Maintaining MarketFeed during hibernation avoids the 250+ weight REST backfill burst, ensuring the engine is ready to trade the millisecond gating clears." :
                        (cfg.hibernation_mode || 'adaptive') === 'deep' ?
                        "Deep sleep minimizes CPU, network, and memory by purging all non-essential data. Resumption requires a heavy API burst and short warmup period." :
                        "Adaptive mode provides 30 seconds of high-readiness light sleep before transitioning to deep sleep for prolonged gating periods."
                      }
                   </p>
                </div>
              </div>
            </div>
          </section>

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
