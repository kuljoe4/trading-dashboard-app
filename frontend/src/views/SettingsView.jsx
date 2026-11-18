import React, { useState, useEffect, useRef, useMemo } from 'react'
import { settingsAPI, healthAPI, setAdminApiKey } from '../api/client'
import { SectionLabel, Btn, StatCard, cn, ViewHeader, Tooltip } from '../components/ui/primitives'
import {
  Settings as SettingsIcon,
  ShieldAlert,
  Key,
  CheckCircle2,
  AlertCircle,
  Activity,
  Zap,
  Eye,
  EyeOff,
  RotateCcw,
  Bug,
  ShieldCheck,
  ChevronDown,
  Database,
  XCircle,
  Layers,
  ArrowUpRight
} from 'lucide-react'
import { motion } from 'framer-motion'
import { useTradingStore } from '../store/trading'
import { Sidebar, BottomNav } from '../components/Navigation'
import { ConfirmationModal } from '../components/ConfirmationModal'
import { CONFIG_LIMITS } from '../constants/configLimits'
import { THEMES, APPEARANCE_PRESETS, DEFAULT_APPEARANCE } from '../lib/theme.js'

const APPEARANCE_SLIDERS = [
  {
    key: 'screenBrightness',
    label: 'Overall Luminance',
    desc: 'Dims overall canvas and surface brightness for dark rooms',
    min: 60,
    max: 100,
    step: 1,
  },
  {
    key: 'textBrightness',
    label: 'Text & Number Brightness',
    desc: 'Softens stark white headlines and telemetry numbers to stop glare',
    min: 50,
    max: 100,
    step: 1,
  },
  {
    key: 'accentIntensity',
    label: 'Signal & Accent Intensity',
    desc: 'Desaturates neon green/red PnL and chart colors to reduce eye fatigue',
    min: 40,
    max: 100,
    step: 1,
  },
  {
    key: 'borderContrast',
    label: 'Border & Grid Contrast',
    desc: 'Quiets card outlines and table dividers to reduce visual box clutter',
    min: 25,
    max: 100,
    step: 1,
  },
  {
    key: 'glowIntensity',
    label: 'Ambient Glow & Shine',
    desc: 'Suppresses neon drop-shadows, status glows, and pulsing effects',
    min: 0,
    max: 100,
    step: 5,
  },
]

const SETTINGS_CATEGORIES = [
  { id: 'all', label: 'All Sections' },
  { id: 'security', label: 'Security & Keys' },
  { id: 'engine', label: 'Engine & Data' },
  { id: 'workspace', label: 'Workspace & UI' },
  { id: 'diagnostics', label: 'Diagnostics & Reset' }
]

const SECTION_CATEGORY_MAP = {
  theme: 'workspace',
  streaming: 'workspace',
  security: 'security',
  exchange_live: 'security',
  exchange_testnet: 'security',
  credentials: 'security',
  performance: 'engine',
  scanner_bandwidth: 'engine',
  startup_checklist: 'diagnostics',
  maintenance: 'diagnostics'
}

export function SettingsView() {
  const {
    theme: currentTheme,
    setTheme,
    appearance: storeAppearance,
    setAppearance,
    resetAppearance,
    healthEnabled,
    setHealthEnabled,
    streamingEnabled,
    setStreamingEnabled,
    uiEcoMode,
    setUiEcoMode,
    sidebarCollapsed,
    logFilters,
    toggleLogFilter,
    resetPaperBalance,
    connectWS,
    disconnectWS,
    config,
    patchConfig
  } = useTradingStore()
  const cfg = config || {}
  const appearance = { ...DEFAULT_APPEARANCE, ...(storeAppearance || {}) }
  const isCustomDimmed = Object.keys(DEFAULT_APPEARANCE).some(
    (k) => Number(appearance[k]) !== Number(DEFAULT_APPEARANCE[k])
  )
  const activeAppearancePreset = Object.values(APPEARANCE_PRESETS).find((preset) =>
    Object.entries(preset.values).every(([k, v]) => Number(appearance[k]) === Number(v))
  )?.id || null

  // Collapsible section state - defaults to all sections collapsed for clean, ultra-dense UI flow
  const [openSections, setOpenSections] = useState(new Set())
  const [activeCategory, setActiveCategory] = useState('all')

  const toggleSection = (id) => {
    setOpenSections(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const jumpToSection = (id) => {
    const cat = SECTION_CATEGORY_MAP[id] || 'all'
    if (activeCategory !== 'all' && activeCategory !== cat) {
      setActiveCategory(cat)
    }
    setOpenSections(prev => {
      const next = new Set(prev)
      next.add(id)
      return next
    })
    requestAnimationFrame(() => {
      const el = document.getElementById(`settings-section-${id}`)
      if (el && typeof el.scrollIntoView === 'function') {
        try {
          el.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
        } catch {
          // Ignore in non-DOM test runners
        }
      }
    })
  }

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
  const [startupChecklist, setStartupChecklist] = useState(null)
  const [checkingStartup, setCheckingStartup] = useState(false)

  const fetchStartupChecklist = async (fresh = false) => {
    setCheckingStartup(true)
    try {
      const res = await healthAPI.getStartupChecklist(fresh)
      setStartupChecklist(res.data)
    } catch (e) {
      console.error('Failed to load startup checklist', e)
    } finally {
      setCheckingStartup(false)
    }
  }

  useEffect(() => {
    loadKeys()
    fetchStartupChecklist()
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
      if (adminApiKey) {
        setAdminApiKey(adminApiKey)
        disconnectWS()
        connectWS()
      } else {
        setAdminApiKey('')
      }

      await settingsAPI.updateKeys({
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

  const visibleSectionIds = useMemo(() => {
    return Object.entries(SECTION_CATEGORY_MAP)
      .filter(([, cat]) => activeCategory === 'all' || cat === activeCategory)
      .map(([id]) => id)
  }, [activeCategory])

  const allVisibleExpanded = visibleSectionIds.length > 0 && visibleSectionIds.every(id => openSections.has(id))

  const handleToggleExpandAll = () => {
    setOpenSections(prev => {
      const next = new Set(prev)
      if (allVisibleExpanded) {
        visibleSectionIds.forEach(id => next.delete(id))
      } else {
        visibleSectionIds.forEach(id => next.add(id))
      }
      return next
    })
  }

  const isSectionVisible = (id) => activeCategory === 'all' || SECTION_CATEGORY_MAP[id] === activeCategory

  const keySummaryLabel = maskedKey && maskedTestnetKey
    ? 'Live + Demo'
    : maskedKey
    ? 'Live Ready'
    : maskedTestnetKey
    ? 'Demo Ready'
    : 'Paper Only'

  const keySummaryColor = maskedKey ? 'text-green' : maskedTestnetKey ? 'text-purple' : 'text-dim'
  const hibernationLabel = (cfg.hibernation_mode || 'adaptive').charAt(0).toUpperCase() + (cfg.hibernation_mode || 'adaptive').slice(1)
  const themeName = THEMES[currentTheme]?.name || currentTheme
  const hasPendingCredentialDraft = Boolean(apiKey || apiSecret || testnetApiKey || testnetApiSecret)

  return (
    <div className={cn(
      "min-h-screen transition-all duration-300",
      sidebarCollapsed ? "lg:pl-[80px]" : "lg:pl-[260px]"
    )}>
      <Sidebar />
      <div className={cn(
        "max-w-[1160px] mx-auto px-2.5 pt-2.5 sm:px-4 sm:pt-4 md:px-6 md:pt-6 animate-in fade-in slide-in-from-bottom-4 duration-500 transition-all",
        healthEnabled ? "pb-48 sm:pb-48 md:pb-48 lg:pb-16" : "pb-36 sm:pb-36 md:pb-36 lg:pb-16"
      )}>
        <ViewHeader
          icon={SettingsIcon}
          title="System Settings"
          subTitle="Global workspace, credentials & engine infrastructure"
          backAction={() => { window.location.hash = '#/' }}
          sticky={false}
          hideMetrics
          mobileOneRow
        >
          <button
            type="button"
            onClick={handleToggleExpandAll}
            className="h-9 sm:h-8 px-2.5 sm:px-3 rounded-lg bg-surface border border-border/70 hover:border-border-hover text-[10px] font-bold uppercase tracking-wider text-dim hover:text-text transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
          >
            {allVisibleExpanded ? 'Collapse All' : 'Expand All'}
          </button>
        </ViewHeader>

        {/* System Overview KPI Strip (matches Dashboard & StrategyDetail grid grammar) */}
        <div className="grid grid-cols-2 lg:grid-cols-4 auto-rows-fr items-stretch gap-2.5 mb-3">
          <button
            type="button"
            onClick={() => jumpToSection('startup_checklist')}
            className="text-left h-full rounded-xl focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none cursor-pointer"
          >
            <StatCard
              compact
              label="Readiness"
              value={startupChecklist?.ready
                ? `Ready ${startupChecklist.summary?.passed}/${startupChecklist.summary?.total}`
                : checkingStartup ? 'Checking...' : 'Pending'}
              color={startupChecklist?.ready ? 'text-green' : 'text-amber'}
              subValue="Click to inspect health checks"
            />
          </button>

          <button
            type="button"
            onClick={() => jumpToSection('exchange_live')}
            className="text-left h-full rounded-xl focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none cursor-pointer"
          >
            <StatCard
              compact
              label="Exchange Keys"
              value={keySummaryLabel}
              color={keySummaryColor}
              subValue={adminApiKey ? 'Admin lock active' : 'Local open auth'}
            />
          </button>

          <button
            type="button"
            onClick={() => jumpToSection('performance')}
            className="text-left h-full rounded-xl focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none cursor-pointer"
          >
            <StatCard
              compact
              label="Engine Loop"
              value={hibernationLabel}
              color="text-accent"
              subValue={`${((cfg.hot_loop_interval_ms || 5000) / 1000).toFixed(1)}s hot · ${((cfg.main_loop_interval_ms || 15000) / 1000).toFixed(0)}s main`}
            />
          </button>

          <button
            type="button"
            onClick={() => jumpToSection('theme')}
            className="text-left h-full rounded-xl focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none cursor-pointer"
          >
            <StatCard
              compact
              label="Workspace UI"
              value={themeName}
              color="text-text"
              subValue={`${isCustomDimmed ? `Dimmed ${appearance.screenBrightness}%` : (uiEcoMode ? 'Eco graphics' : 'Full graphics')} · ${streamingEnabled ? 'Live WS' : 'Paused WS'}`}
            />
          </button>
        </div>

        {/* Category Filter Bar + Cockpit Cross-Link */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 mb-4">
          <div
            role="tablist"
            aria-label="Settings categories"
            className="flex items-center gap-1 p-1 bg-surface border border-border/70 rounded-xl overflow-x-auto no-scrollbar w-full sm:w-fit"
          >
            {SETTINGS_CATEGORIES.map(cat => {
              const selected = activeCategory === cat.id
              return (
                <button
                  key={cat.id}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  onClick={() => setActiveCategory(cat.id)}
                  className={cn(
                    "h-9 sm:h-8 px-3 rounded-lg text-[11px] font-bold tracking-tight transition-all whitespace-nowrap shrink-0 cursor-pointer focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none",
                    selected
                      ? "bg-accent text-white shadow-xs"
                      : "text-dim hover:text-text hover:bg-white/[0.04]"
                  )}
                >
                  {cat.label}
                </button>
              )
            })}
          </div>

          <button
            type="button"
            onClick={() => { window.location.hash = '#/' }}
            className="hidden sm:inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-border/60 bg-surface/60 hover:bg-surface hover:border-border-hover text-[11px] font-semibold text-dim hover:text-text transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Layers size={13} className="text-accent" />
            <span>Per-strategy rules live in Cockpit</span>
            <ArrowUpRight size={13} />
          </button>
        </div>

        {window.location.protocol !== 'https:' && window.location.hostname !== 'localhost' && (
          <motion.div
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-red/10 border border-red/20 rounded-2xl p-4 sm:p-5 flex gap-3.5 items-center shadow-sm mb-3"
          >
            <div className="w-10 h-10 rounded-xl bg-red/10 flex items-center justify-center shrink-0">
              <ShieldAlert size={20} className="text-red" />
            </div>
            <div>
              <h3 className="text-xs font-bold text-red uppercase tracking-tight">Insecure Connection</h3>
              <p className="text-xs text-dim font-medium leading-relaxed mt-0.5">
                You are accessing the dashboard over unencrypted <span className="text-red font-bold">HTTP</span>.
                Entering API credentials now is <span className="text-red font-bold">HIGHLY DISCOURAGED</span>.
              </p>
            </div>
          </motion.div>
        )}

        <div className="flex flex-col gap-3">
          {/* Section 1: Dashboard Visual Theme */}
          {isSectionVisible('theme') && (
            <section id="settings-section-theme" className="bg-surface border border-border/80 rounded-2xl overflow-hidden shadow-xs">
              <button
                type="button"
                onClick={() => toggleSection('theme')}
                aria-expanded={openSections.has('theme')}
                aria-controls="theme-content"
                aria-label={openSections.has('theme') ? "Collapse Dashboard Visual Theme section" : "Expand Dashboard Visual Theme section"}
                className="w-full p-4 sm:p-5 flex items-center justify-between text-left cursor-pointer hover:bg-surface-hover/50 transition-colors focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none min-h-[56px]"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <SectionLabel className="mb-0 truncate">Dashboard Visual Theme</SectionLabel>
                  <span className="text-[10px] font-mono font-bold text-accent uppercase tracking-wider whitespace-nowrap shrink-0 tabular-nums">
                    · {themeName}{isCustomDimmed ? ` · Dimmed ${appearance.screenBrightness}%` : ''}
                  </span>
                </div>
                <ChevronDown size={16} className={cn("text-dim transition-transform duration-200 shrink-0", openSections.has('theme') && "rotate-180")} />
              </button>
              {openSections.has('theme') && (
                <div id="theme-content" className="p-4 sm:p-5 border-t border-border/50 flex flex-col gap-5 animate-in fade-in duration-200">
                  <div className="flex flex-col gap-3">
                    <p className="text-xs text-dim font-medium">Choose a color palette for your trading cockpit and analytics views.</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                      {Object.entries(THEMES).map(([id, t]) => {
                        const isActive = currentTheme === id
                        return (
                          <button
                            key={id}
                            type="button"
                            onClick={() => setTheme(id)}
                            aria-label={`Select ${t.name} theme`}
                            aria-pressed={isActive}
                            className={cn(
                              "p-4 rounded-xl border text-left transition-all relative group focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none flex flex-col justify-between min-h-[112px] cursor-pointer",
                              isActive ? "border-accent bg-accent/5 ring-1 ring-accent/30" : "border-border bg-background hover:border-border-hover hover:bg-surface"
                            )}
                          >
                            <div className="w-full">
                              <div className="flex items-center justify-between mb-1 gap-2">
                                <span className={cn("text-xs font-bold tracking-tight", isActive ? "text-accent" : "text-text")}>{t.name}</span>
                                {isActive && <CheckCircle2 size={15} className="text-accent shrink-0" />}
                              </div>
                              <p className="text-[11px] text-dim leading-snug mb-3">{t.desc}</p>
                            </div>

                            <div className="flex items-center gap-1.5 bg-surface/60 px-2 py-1 rounded-lg border border-border/40 w-fit">
                              <span className="w-3 h-3 rounded-full border border-black/15 shrink-0" title="Background" style={{ backgroundColor: t.colors['--color-background-theme'] }} />
                              <span className="w-3 h-3 rounded-full border border-black/15 shrink-0" title="Surface" style={{ backgroundColor: t.colors['--color-surface-theme'] }} />
                              <span className="w-3 h-3 rounded-full border border-black/15 shrink-0" title="Accent" style={{ backgroundColor: t.colors['--color-accent-theme'] }} />
                              <span className="w-3 h-3 rounded-full border border-black/15 shrink-0" title="Green" style={{ backgroundColor: t.colors['--color-green-theme'] }} />
                              <span className="w-3 h-3 rounded-full border border-black/15 shrink-0" title="Red" style={{ backgroundColor: t.colors['--color-red-theme'] }} />
                            </div>
                          </button>
                        )
                      })}
                    </div>
                  </div>

                  {/* Night Dimming & Cognitive Load Range Controls */}
                  <div className="pt-4 border-t border-border/60 flex flex-col gap-4">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                      <div>
                        <h3 className="text-xs font-bold text-text tracking-tight">Night Dimming & Cognitive Load</h3>
                        <p className="text-[11px] text-dim mt-0.5">
                          Reduce dark-room glare, soften bright numbers, and quiet grid lines. Automatically persists across reloads.
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        {Object.values(APPEARANCE_PRESETS).map((preset) => {
                          const isPresetActive = activeAppearancePreset === preset.id
                          return (
                            <button
                              key={preset.id}
                              type="button"
                              onClick={() => setAppearance(preset.values)}
                              aria-pressed={isPresetActive}
                              aria-label={`Apply ${preset.label} dimming preset`}
                              className={cn(
                                "min-h-[36px] sm:min-h-[30px] px-2.5 rounded-lg border text-[11px] font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none",
                                isPresetActive
                                  ? "border-accent bg-accent/15 text-accent"
                                  : "border-border bg-background text-dim hover:text-text hover:border-border-hover"
                              )}
                            >
                              {preset.label}
                            </button>
                          )
                        })}
                        {isCustomDimmed && (
                          <button
                            type="button"
                            onClick={resetAppearance}
                            aria-label="Reset appearance dimming to 100%"
                            className="min-h-[36px] sm:min-h-[30px] px-2.5 rounded-lg border border-border/70 bg-background hover:border-border-hover text-[11px] font-semibold text-dim hover:text-text transition-colors inline-flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
                          >
                            <RotateCcw size={12} />
                            <span>Reset</span>
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {APPEARANCE_SLIDERS.map((slider) => {
                        const val = Number(appearance[slider.key] ?? DEFAULT_APPEARANCE[slider.key])
                        const inputId = `appearance-range-${slider.key}`
                        return (
                          <div
                            key={slider.key}
                            className="p-3.5 rounded-xl bg-background border border-border/70 flex flex-col justify-between gap-2.5"
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <label
                                  htmlFor={inputId}
                                  className="text-xs font-bold text-text tracking-tight block cursor-pointer"
                                >
                                  {slider.label}
                                </label>
                                <p className="text-[11px] text-dim leading-snug mt-0.5">
                                  {slider.desc}
                                </p>
                              </div>
                              <span className="text-xs font-mono font-bold text-accent tabular-nums whitespace-nowrap shrink-0">
                                {val}%
                              </span>
                            </div>

                            <div className="flex items-center gap-2.5 pt-0.5">
                              <span className="text-[10px] font-mono text-dim tabular-nums whitespace-nowrap shrink-0">
                                {slider.min}%
                              </span>
                              <input
                                id={inputId}
                                type="range"
                                min={slider.min}
                                max={slider.max}
                                step={slider.step}
                                value={val}
                                aria-label={slider.label}
                                onChange={(e) => setAppearance({ [slider.key]: Number(e.target.value) })}
                                className="w-full h-2 rounded-lg appearance-none bg-surface border border-border/60 accent-accent cursor-pointer focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
                              />
                              <span className="text-[10px] font-mono text-dim tabular-nums whitespace-nowrap shrink-0">
                                {slider.max}%
                              </span>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                </div>
              )}
            </section>
          )}

          {/* Section 2: Dashboard Security */}
          {isSectionVisible('security') && (
            <section id="settings-section-security" className="bg-surface border border-border/80 rounded-2xl overflow-hidden shadow-xs">
              <button
                type="button"
                onClick={() => toggleSection('security')}
                aria-expanded={openSections.has('security')}
                aria-controls="security-content"
                aria-label={openSections.has('security') ? "Collapse Dashboard Security section" : "Expand Dashboard Security section"}
                className="w-full p-4 sm:p-5 flex items-center justify-between text-left cursor-pointer hover:bg-surface-hover/50 transition-colors focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none min-h-[56px]"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <SectionLabel className="mb-0 truncate">Dashboard Security</SectionLabel>
                  <span className={cn("text-[10px] font-mono font-bold uppercase tracking-wider flex items-center gap-1.5 whitespace-nowrap shrink-0", adminApiKey ? "text-green" : "text-amber")}>
                    <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", adminApiKey ? "bg-green" : "bg-amber")} />
                    {adminApiKey ? "Key Configured" : "Unprotected Local"}
                  </span>
                </div>
                <ChevronDown size={16} className={cn("text-dim transition-transform duration-200 shrink-0", openSections.has('security') && "rotate-180")} />
              </button>
              {openSections.has('security') && (
                <div id="security-content" className="p-4 sm:p-5 border-t border-border/50 flex flex-col gap-3 animate-in fade-in duration-200">
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="adminApiKey" className="text-[10px] text-dim font-bold tracking-widest uppercase">Admin API Key</label>
                    <p className="text-xs text-dim mb-1">Required for dashboard authentication in production deployments.</p>
                    <div className="relative">
                      <input
                        ref={adminApiKeyRef}
                        id="adminApiKey"
                        type={showAdminKey ? "text" : "password"}
                        autoCapitalize="none"
                        autoCorrect="off"
                        value={adminApiKey}
                        onChange={e => setAdminApiKeyValue(e.target.value)}
                        className="w-full bg-background border border-border focus:border-accent focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none rounded-lg px-3 py-1.5 pr-20 min-h-[34px] text-xs font-mono text-text transition-all"
                        placeholder="••••••••••••••••"
                      />
                      <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-0.5 text-dim">
                        {adminApiKey && (
                          <Tooltip content="Clear Key">
                            <button
                              type="button"
                              onClick={() => { setAdminApiKeyValue(''); adminApiKeyRef.current?.focus(); }}
                              aria-label="Clear Admin API Key"
                              className="h-7 w-7 flex items-center justify-center hover:text-red transition-colors focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none rounded-lg cursor-pointer"
                            >
                              <XCircle size={14} />
                            </button>
                          </Tooltip>
                        )}
                        <Tooltip content={showAdminKey ? "Hide Key" : "Show Key"}>
                          <button
                            type="button"
                            onClick={() => setShowAdminKey(!showAdminKey)}
                            aria-label={showAdminKey ? "Hide key" : "Show key"}
                            className="h-7 w-7 flex items-center justify-center hover:text-accent transition-colors focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none rounded-lg cursor-pointer"
                          >
                            {showAdminKey ? <EyeOff size={14} /> : <Eye size={14} />}
                          </button>
                        </Tooltip>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </section>
          )}

          {/* Section 3: Live Exchange Integration */}
          {isSectionVisible('exchange_live') && (
            <section id="settings-section-exchange_live" className="bg-surface border border-border/80 rounded-2xl overflow-hidden shadow-xs">
              <button
                type="button"
                onClick={() => toggleSection('exchange_live')}
                aria-expanded={openSections.has('exchange_live')}
                aria-controls="exchange_live-content"
                aria-label={openSections.has('exchange_live') ? "Collapse Exchange Integration (Live) section" : "Expand Exchange Integration (Live) section"}
                className="w-full p-4 sm:p-5 flex items-center justify-between text-left cursor-pointer hover:bg-surface-hover/50 transition-colors focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none min-h-[56px]"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <SectionLabel className="mb-0 truncate">Exchange Integration (Live)</SectionLabel>
                  <span className={cn("text-[10px] font-mono font-bold uppercase tracking-wider flex items-center gap-1.5 whitespace-nowrap shrink-0", maskedKey ? "text-green" : "text-dim")}>
                    <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", maskedKey ? "bg-green" : "bg-dim/40")} />
                    {maskedKey ? "Live Key Set" : "Unconfigured"}
                  </span>
                </div>
                <ChevronDown size={16} className={cn("text-dim transition-transform duration-200 shrink-0", openSections.has('exchange_live') && "rotate-180")} />
              </button>
              {openSections.has('exchange_live') && (
                <div id="exchange_live-content" className="p-4 sm:p-5 border-t border-border/50 flex flex-col gap-4 animate-in fade-in duration-200">
                  <div className="flex items-center gap-3 p-3.5 bg-background/50 border border-border rounded-xl">
                    <div className="w-9 h-9 rounded-lg bg-green/10 flex items-center justify-center shrink-0">
                      <Key size={16} className="text-green" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-[10px] text-dim font-bold tracking-widest uppercase">Stored Live Key</div>
                      <div className="text-xs font-mono text-text/80 tracking-tight truncate mt-0.5">
                        {maskedKey || 'No live API key configured'}
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="flex flex-col gap-1.5">
                      <label htmlFor="apiKey" className="text-[10px] text-dim font-bold tracking-widest uppercase">Update Live API Key</label>
                      <div className="relative">
                        <input
                          ref={apiKeyRef}
                          id="apiKey"
                          type="text"
                          autoCapitalize="none"
                          autoCorrect="off"
                          value={apiKey}
                          onChange={e => setApiKey(e.target.value)}
                          className="w-full bg-background border border-border focus:border-accent focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none rounded-lg px-3 py-1.5 pr-10 min-h-[34px] text-xs font-mono text-text transition-all"
                          placeholder="8080...2025"
                        />
                        {apiKey && (
                          <div className="absolute right-1.5 top-1/2 -translate-y-1/2 flex items-center">
                            <Tooltip content="Clear Key">
                              <button
                                type="button"
                                onClick={() => { setApiKey(''); apiKeyRef.current?.focus(); }}
                                aria-label="Clear API Key"
                                className="h-7 w-7 flex items-center justify-center text-dim hover:text-red transition-colors focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none rounded-lg cursor-pointer"
                              >
                                <XCircle size={14} />
                              </button>
                            </Tooltip>
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <label htmlFor="apiSecret" className="text-[10px] text-dim font-bold tracking-widest uppercase">Update Live API Secret</label>
                      <div className="relative">
                        <input
                          ref={apiSecretRef}
                          id="apiSecret"
                          type={showLiveSecret ? "text" : "password"}
                          autoCapitalize="none"
                          autoCorrect="off"
                          value={apiSecret}
                          onChange={e => setApiSecret(e.target.value)}
                          className="w-full bg-background border border-border focus:border-accent focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none rounded-lg px-3 py-1.5 pr-20 min-h-[34px] text-xs font-mono text-text transition-all"
                          placeholder="••••••••••••••••"
                        />
                        <div className="absolute right-1.5 top-1/2 -translate-y-1/2 flex items-center gap-0.5 text-dim">
                          {apiSecret && (
                            <Tooltip content="Clear Secret">
                              <button
                                type="button"
                                onClick={() => { setApiSecret(''); apiSecretRef.current?.focus(); }}
                                aria-label="Clear API Secret"
                                className="h-7 w-7 flex items-center justify-center hover:text-red transition-colors focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none rounded-lg cursor-pointer"
                              >
                                <XCircle size={14} />
                              </button>
                            </Tooltip>
                          )}
                          <Tooltip content={showLiveSecret ? "Hide Secret" : "Show Secret"}>
                            <button
                              type="button"
                              onClick={() => setShowLiveSecret(!showLiveSecret)}
                              aria-label={showLiveSecret ? "Hide secret" : "Show secret"}
                              className="h-7 w-7 flex items-center justify-center hover:text-accent transition-colors focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none rounded-lg cursor-pointer"
                            >
                              {showLiveSecret ? <EyeOff size={14} /> : <Eye size={14} />}
                            </button>
                          </Tooltip>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </section>
          )}

          {/* Section 4: Binance Demo (Testnet) */}
          {isSectionVisible('exchange_testnet') && (
            <section id="settings-section-exchange_testnet" className="bg-surface border border-border/80 rounded-2xl overflow-hidden shadow-xs">
              <button
                type="button"
                onClick={() => toggleSection('exchange_testnet')}
                aria-expanded={openSections.has('exchange_testnet')}
                aria-controls="exchange_testnet-content"
                aria-label={openSections.has('exchange_testnet') ? "Collapse Binance Demo (Testnet) section" : "Expand Binance Demo (Testnet) section"}
                className="w-full p-4 sm:p-5 flex items-center justify-between text-left cursor-pointer hover:bg-surface-hover/50 transition-colors focus-visible:ring-2 focus-visible:ring-purple focus-visible:outline-none min-h-[56px]"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <SectionLabel className="mb-0 text-purple truncate">Binance Demo (Testnet)</SectionLabel>
                  <span className={cn("text-[10px] font-mono font-bold uppercase tracking-wider flex items-center gap-1.5 whitespace-nowrap shrink-0", maskedTestnetKey ? "text-purple" : "text-dim")}>
                    <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", maskedTestnetKey ? "bg-purple" : "bg-dim/40")} />
                    {maskedTestnetKey ? "Demo Key Set" : "Unconfigured"}
                  </span>
                </div>
                <ChevronDown size={16} className={cn("text-dim transition-transform duration-200 shrink-0", openSections.has('exchange_testnet') && "rotate-180")} />
              </button>
              {openSections.has('exchange_testnet') && (
                <div id="exchange_testnet-content" className="p-4 sm:p-5 border-t border-border/50 flex flex-col gap-4 animate-in fade-in duration-200">
                  <div className="flex items-center gap-3 p-3.5 bg-background/50 border border-border rounded-xl">
                    <div className="w-9 h-9 rounded-lg bg-purple/10 flex items-center justify-center shrink-0">
                      <Key size={16} className="text-purple" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-[10px] text-dim font-bold tracking-widest uppercase">Stored Demo Key</div>
                      <div className="text-xs font-mono text-text/80 tracking-tight truncate mt-0.5">
                        {maskedTestnetKey || 'No testnet API key configured'}
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="flex flex-col gap-1.5">
                      <label htmlFor="testnetApiKey" className="text-[10px] text-dim font-bold tracking-widest uppercase">Update Testnet API Key</label>
                      <div className="relative">
                        <input
                          ref={testnetApiKeyRef}
                          id="testnetApiKey"
                          type="text"
                          autoCapitalize="none"
                          autoCorrect="off"
                          value={testnetApiKey}
                          onChange={e => setTestnetApiKey(e.target.value)}
                          className="w-full bg-background border border-border focus:border-purple focus-visible:ring-2 focus-visible:ring-purple focus-visible:outline-none rounded-lg px-3 py-1.5 pr-10 min-h-[34px] text-xs font-mono text-text transition-all"
                          placeholder="abcd...1234"
                        />
                        {testnetApiKey && (
                          <div className="absolute right-1.5 top-1/2 -translate-y-1/2 flex items-center">
                            <Tooltip content="Clear Key">
                              <button
                                type="button"
                                onClick={() => { setTestnetApiKey(''); testnetApiKeyRef.current?.focus(); }}
                                aria-label="Clear Testnet API Key"
                                className="h-7 w-7 flex items-center justify-center text-dim hover:text-red transition-colors focus-visible:ring-2 focus-visible:ring-purple focus-visible:outline-none rounded-lg cursor-pointer"
                              >
                                <XCircle size={14} />
                              </button>
                            </Tooltip>
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <label htmlFor="testnetApiSecret" className="text-[10px] text-dim font-bold tracking-widest uppercase">Update Testnet API Secret</label>
                      <div className="relative">
                        <input
                          ref={testnetApiSecretRef}
                          id="testnetApiSecret"
                          type={showTestnetSecret ? "text" : "password"}
                          autoCapitalize="none"
                          autoCorrect="off"
                          value={testnetApiSecret}
                          onChange={e => setTestnetApiSecret(e.target.value)}
                          className="w-full bg-background border border-border focus:border-purple focus-visible:ring-2 focus-visible:ring-purple focus-visible:outline-none rounded-lg px-3 py-1.5 pr-20 min-h-[34px] text-xs font-mono text-text transition-all"
                          placeholder="••••••••••••••••"
                        />
                        <div className="absolute right-1.5 top-1/2 -translate-y-1/2 flex items-center gap-0.5 text-dim">
                          {testnetApiSecret && (
                            <Tooltip content="Clear Secret">
                              <button
                                type="button"
                                onClick={() => { setTestnetApiSecret(''); testnetApiSecretRef.current?.focus(); }}
                                aria-label="Clear Testnet API Secret"
                                className="h-7 w-7 flex items-center justify-center hover:text-red transition-colors focus-visible:ring-2 focus-visible:ring-purple focus-visible:outline-none rounded-lg cursor-pointer"
                              >
                                <XCircle size={14} />
                              </button>
                            </Tooltip>
                          )}
                          <Tooltip content={showTestnetSecret ? "Hide Secret" : "Show Secret"}>
                            <button
                              type="button"
                              onClick={() => setShowTestnetSecret(!showTestnetSecret)}
                              aria-label={showTestnetSecret ? "Hide secret" : "Show secret"}
                              className="h-7 w-7 flex items-center justify-center hover:text-purple transition-colors focus-visible:ring-2 focus-visible:ring-purple focus-visible:outline-none rounded-lg cursor-pointer"
                            >
                              {showTestnetSecret ? <EyeOff size={14} /> : <Eye size={14} />}
                            </button>
                          </Tooltip>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </section>
          )}

          {/* Section 5: Validate & Apply Credentials */}
          {isSectionVisible('credentials') && (
            <section id="settings-section-credentials" className="bg-surface border border-border/80 rounded-2xl overflow-hidden shadow-xs">
              <button
                type="button"
                onClick={() => toggleSection('credentials')}
                aria-expanded={openSections.has('credentials')}
                aria-controls="credentials-content"
                aria-label={openSections.has('credentials') ? "Collapse Validate & Apply Credentials section" : "Expand Validate & Apply Credentials section"}
                className="w-full p-4 sm:p-5 flex items-center justify-between text-left cursor-pointer hover:bg-surface-hover/50 transition-colors focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none min-h-[56px]"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <SectionLabel className="mb-0 truncate">Validate & Apply Credentials</SectionLabel>
                  {hasPendingCredentialDraft && (
                    <span className="text-[10px] font-mono font-bold text-amber uppercase tracking-wider whitespace-nowrap shrink-0">
                      · Unsaved Keys
                    </span>
                  )}
                </div>
                <ChevronDown size={16} className={cn("text-dim transition-transform duration-200 shrink-0", openSections.has('credentials') && "rotate-180")} />
              </button>
              {openSections.has('credentials') && (
                <div id="credentials-content" className="p-4 sm:p-5 border-t border-border/50 flex flex-col gap-4 animate-in fade-in duration-200 bg-surface/50">
                  {(apiKey || testnetApiKey) && (
                    <div className="flex flex-col gap-3">
                      <div className="flex items-center gap-2">
                        <Bug size={15} className="text-accent" />
                        <h4 className="text-xs font-bold uppercase tracking-tight">Validate API Keys</h4>
                      </div>
                      <p className="text-xs text-dim">Test your Binance API keys before saving. Verifies read/trade permissions without modifying account state.</p>
                      <Tooltip
                        content={
                          validating
                            ? "Validating API keys with Binance..."
                            : (!apiKey && !testnetApiKey)
                            ? "Enter live or testnet API keys above to run the validation check"
                            : "Test entered API keys on Binance without saving"
                        }
                      >
                        <div className="w-full sm:w-fit">
                          <Btn
                            onClick={handleValidate}
                            disabled={validating || (!apiKey && !testnetApiKey)}
                            loading={validating}
                            className="w-full sm:w-auto min-h-[42px]"
                            variant="secondary"
                          >
                            {validating ? 'Validating...' : 'Test API Keys'}
                          </Btn>
                        </div>
                      </Tooltip>

                      {validationResults && (
                        <motion.div
                          initial={{ opacity: 0, y: -8 }}
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
                              <p className={cn("text-xs font-bold uppercase tracking-tight mb-1.5", validationResults.valid ? "text-green" : "text-red")}>
                                {validationResults.valid ? 'All Keys Valid ✓' : 'Validation Failed'}
                              </p>
                              <div className="flex flex-col gap-1">
                                {validationResults.checks && validationResults.checks.map((check, i) => (
                                  <div key={i} className="text-xs text-dim font-medium">
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

                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pt-3 border-t border-border/50">
                    <div className="max-w-md">
                      {status ? (
                        <motion.div
                          initial={{ opacity: 0, x: -8 }}
                          animate={{ opacity: 1, x: 0 }}
                          className={cn("flex items-center gap-2 text-xs font-bold", status.type === 'success' ? "text-green" : "text-red")}
                        >
                          {status.type === 'success' ? <CheckCircle2 size={15} /> : <AlertCircle size={15} />}
                          {status.msg}
                        </motion.div>
                      ) : (
                        <p className="text-xs text-dim">
                          {hasPendingCredentialDraft || adminApiKey
                            ? 'Ready to encrypt and save updated credentials.'
                            : 'Enter any key above to test or save credentials.'}
                        </p>
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
                          className="w-full md:w-auto min-w-[170px] min-h-[42px]"
                        >
                          Apply All Credentials
                        </Btn>
                      </div>
                    </Tooltip>
                  </div>
                </div>
              )}
            </section>
          )}

          {/* Section 6: Startup & Connection Checklist */}
          {isSectionVisible('startup_checklist') && (
            <section id="settings-section-startup_checklist" className="bg-surface border border-border/80 rounded-2xl overflow-hidden shadow-xs">
              <button
                type="button"
                onClick={() => toggleSection('startup_checklist')}
                aria-expanded={openSections.has('startup_checklist')}
                aria-controls="startup_checklist-content"
                aria-label={openSections.has('startup_checklist') ? "Collapse Startup & Connection Checklist section" : "Expand Startup & Connection Checklist section"}
                className="w-full p-4 sm:p-5 flex items-center justify-between text-left cursor-pointer hover:bg-surface-hover/50 transition-colors focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none min-h-[56px]"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <SectionLabel className="mb-0 truncate">Startup & Connection Checklist</SectionLabel>
                  <span className={cn(
                    "text-[10px] font-mono font-bold uppercase tracking-wider flex items-center gap-1.5 whitespace-nowrap shrink-0",
                    startupChecklist?.ready ? "text-green" : "text-amber"
                  )}>
                    <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", startupChecklist?.ready ? "bg-green" : "bg-amber")} />
                    {startupChecklist?.ready ? `Ready ${startupChecklist.summary?.passed}/${startupChecklist.summary?.total}` : 'Checklist Pending'}
                  </span>
                </div>
                <ChevronDown size={16} className={cn("text-dim transition-transform duration-200 shrink-0", openSections.has('startup_checklist') && "rotate-180")} />
              </button>
              {openSections.has('startup_checklist') && (
                <div id="startup_checklist-content" className="p-4 sm:p-5 border-t border-border/50 flex flex-col gap-4 animate-in fade-in duration-200">
                  <div className="flex items-center justify-between gap-4 flex-wrap pb-3 border-b border-border/40">
                    <div>
                      <h3 className="text-xs font-bold uppercase tracking-tight text-text">Full Stack Startup & Environment Readiness</h3>
                      <p className="text-xs text-dim mt-0.5">
                        Backend HTTP, WebSocket gateway, Binance exchange latency, market feed, and risk limits
                      </p>
                    </div>
                    <Btn
                      size="sm"
                      variant="outline"
                      onClick={() => fetchStartupChecklist(true)}
                      disabled={checkingStartup}
                      loading={checkingStartup}
                      className="text-[11px] font-bold uppercase tracking-wider min-h-[38px]"
                    >
                      Re-verify Checklist
                    </Btn>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                    {(startupChecklist?.checks || []).map((check) => {
                      const isPass = check.status === 'PASS'
                      const isWarn = check.status === 'WARN'
                      return (
                        <div
                          key={check.id}
                          className={cn(
                            "p-4 rounded-xl border flex flex-col justify-between gap-2.5 transition-all",
                            isPass ? "bg-background/40 border-border/60 hover:border-accent/40" : isWarn ? "bg-amber/5 border-amber/30" : "bg-red/5 border-red/30"
                          )}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-[10px] font-bold uppercase tracking-wider text-dim">{check.category}</span>
                            <span className={cn(
                              "text-[10px] font-mono font-bold uppercase tracking-wider",
                              isPass ? "text-green" : isWarn ? "text-amber" : "text-red"
                            )}>
                              {check.status === 'PASS' ? '✓ PASS' : check.status === 'WARN' ? '⚠ WARN' : '✗ FAIL'}
                            </span>
                          </div>
                          <div>
                            <div className="text-xs font-bold text-text mb-0.5">{check.title}</div>
                            <div className="text-[11px] font-mono font-semibold text-accent mb-1">{check.summary}</div>
                            <p className="text-[11px] text-dim leading-snug">{check.detail}</p>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </section>
          )}

          {/* Section 7: Engine Performance & Resources */}
          {isSectionVisible('performance') && (
            <section id="settings-section-performance" className="bg-surface border border-border/80 rounded-2xl overflow-hidden shadow-xs">
              <button
                type="button"
                onClick={() => toggleSection('performance')}
                aria-expanded={openSections.has('performance')}
                aria-controls="performance-content"
                aria-label={openSections.has('performance') ? "Collapse Engine Performance & Resources section" : "Expand Engine Performance & Resources section"}
                className="w-full p-4 sm:p-5 flex items-center justify-between text-left cursor-pointer hover:bg-surface-hover/50 transition-colors focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none min-h-[56px]"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <SectionLabel className="mb-0 truncate">Engine Performance & Resources</SectionLabel>
                  <span className="text-[10px] font-mono font-bold text-accent uppercase tracking-wider whitespace-nowrap shrink-0">
                    · {hibernationLabel}
                  </span>
                </div>
                <ChevronDown size={16} className={cn("text-dim transition-transform duration-200 shrink-0", openSections.has('performance') && "rotate-180")} />
              </button>
              {openSections.has('performance') && (
                <div id="performance-content" className="p-4 sm:p-5 border-t border-border/50 flex flex-col gap-5 animate-in fade-in duration-200">
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    <div className="flex flex-col gap-1.5">
                      <div className="flex items-center gap-1.5">
                        <label htmlFor="hot_loop_interval_ms" className="text-[10px] text-dim font-bold tracking-widest uppercase">Hot Loop (ms)</label>
                        <Tooltip content="Frequency of the pricing loop execution for real-time tracking (minimum 500ms)">
                          <AlertCircle size={12} className="text-dim cursor-help" />
                        </Tooltip>
                      </div>
                      <input
                        id="hot_loop_interval_ms"
                        type="number"
                        inputMode="numeric"
                        min={CONFIG_LIMITS.HOT_LOOP_MIN}
                        value={cfg.hot_loop_interval_ms || 5000}
                        onChange={(e) => patchConfig({ hot_loop_interval_ms: Number(e.target.value) })}
                        className="w-full bg-background border border-border focus:border-accent focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none rounded-lg px-3 py-1.5 min-h-[34px] text-xs font-mono text-text transition-all"
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <div className="flex items-center gap-1.5">
                        <label htmlFor="main_loop_interval_ms" className="text-[10px] text-dim font-bold tracking-widest uppercase">Main Loop (ms)</label>
                        <Tooltip content="Frequency of the main technical analysis loop execution (minimum 1000ms)">
                          <AlertCircle size={12} className="text-dim cursor-help" />
                        </Tooltip>
                      </div>
                      <input
                        id="main_loop_interval_ms"
                        type="number"
                        inputMode="numeric"
                        min={CONFIG_LIMITS.MAIN_LOOP_MIN}
                        value={cfg.main_loop_interval_ms || 15000}
                        onChange={(e) => patchConfig({ main_loop_interval_ms: Number(e.target.value) })}
                        className="w-full bg-background border border-border focus:border-accent focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none rounded-lg px-3 py-1.5 min-h-[34px] text-xs font-mono text-text transition-all"
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <div className="flex items-center gap-1.5">
                        <label htmlFor="slippage_warning_threshold" className="text-[10px] text-dim font-bold tracking-widest uppercase">Slippage Limit (%)</label>
                        <Tooltip content="Maximum acceptable execution slippage before emitting system warnings">
                          <AlertCircle size={12} className="text-dim cursor-help" />
                        </Tooltip>
                      </div>
                      <input
                        id="slippage_warning_threshold"
                        type="number"
                        inputMode="decimal"
                        min="0"
                        step="0.1"
                        value={cfg.slippage_warning_threshold !== undefined ? (cfg.slippage_warning_threshold * 100).toFixed(1) : '0.1'}
                        onChange={(e) => patchConfig({ slippage_warning_threshold: Number(e.target.value) / 100 })}
                        className="w-full bg-background border border-border focus:border-accent focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none rounded-lg px-3 py-1.5 min-h-[34px] text-xs font-mono text-text transition-all"
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <div className="flex items-center gap-1.5">
                        <label htmlFor="rate_limit_warning_interval_min" className="text-[10px] text-dim font-bold tracking-widest uppercase">Rate Warning Cooldown</label>
                        <Tooltip content="Minimum interval between rate limit surge & prerequisite warning alerts (default: 5 minutes, in 5-min multiples)">
                          <AlertCircle size={12} className="text-dim cursor-help" />
                        </Tooltip>
                      </div>
                      <select
                        id="rate_limit_warning_interval_min"
                        value={cfg.rate_limit_warning_interval_min || 5}
                        onChange={(e) => patchConfig({ rate_limit_warning_interval_min: Number(e.target.value) })}
                        className="w-full bg-background border border-border focus:border-accent focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none rounded-lg px-3 py-1.5 min-h-[34px] text-xs font-mono text-text transition-all cursor-pointer"
                      >
                        <option value={5}>5 Minutes (Default)</option>
                        <option value={10}>10 Minutes</option>
                        <option value={15}>15 Minutes</option>
                        <option value={20}>20 Minutes</option>
                        <option value={30}>30 Minutes</option>
                        <option value={60}>60 Minutes (1 Hour)</option>
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4 border-t border-border/50">
                    <div className="flex items-center justify-between p-4 bg-background rounded-xl border border-border/60 hover:border-accent/30 transition-colors">
                      <label htmlFor="track_binance_rate_limits" className="cursor-pointer select-none flex-grow mr-4">
                        <div className="text-sm font-bold">Track Rate Limits</div>
                        <div className="text-xs text-dim mt-0.5">Monitor Binance API weights & throttles</div>
                      </label>
                      <button
                        id="track_binance_rate_limits"
                        type="button"
                        onClick={() => patchConfig({ track_binance_rate_limits: cfg.track_binance_rate_limits === false ? true : false })}
                        role="switch"
                        aria-checked={cfg.track_binance_rate_limits !== false}
                        aria-label="Toggle Track Rate Limits"
                        className={cn(
                          "w-12 h-6 rounded-full transition-colors relative shrink-0 cursor-pointer focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none",
                          (cfg.track_binance_rate_limits !== false) ? "bg-green" : "bg-border"
                        )}
                      >
                        <div className={cn(
                          "absolute top-1 w-4 h-4 bg-white rounded-full transition-transform",
                          (cfg.track_binance_rate_limits !== false) ? "translate-x-7" : "translate-x-1"
                        )} />
                      </button>
                    </div>

                    <div className="flex items-center justify-between p-4 bg-background rounded-xl border border-border/60 hover:border-amber/30 transition-colors">
                      <label htmlFor="debug_mode" className="cursor-pointer select-none flex-grow mr-4">
                        <div className="text-sm font-bold">Debug Mode</div>
                        <div className="text-xs text-dim mt-0.5">Verbose server-side engine logs</div>
                      </label>
                      <button
                        id="debug_mode"
                        type="button"
                        onClick={() => patchConfig({ debug_mode: !cfg.debug_mode })}
                        role="switch"
                        aria-checked={cfg.debug_mode === true}
                        aria-label="Toggle Debug Mode"
                        className={cn(
                          "w-12 h-6 rounded-full transition-colors relative shrink-0 cursor-pointer focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none",
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

                  <div className="pt-4 border-t border-border/50 flex flex-col gap-4">
                    <div>
                      <h3 className="text-xs font-bold uppercase tracking-wider text-text">Hibernation Management</h3>
                      <p className="text-xs text-dim mt-0.5">Idle resource strategy when active gates block trading</p>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      {[
                        { id: 'light', label: 'Light Sleep', desc: 'Fastest resumption. Keeps market streams active for instant readiness.' },
                        { id: 'adaptive', label: 'Adaptive', desc: 'Balanced default. Light grace window before deep stream sleep.' },
                        { id: 'deep', label: 'Deep Sleep', desc: 'Maximum CPU/network savings. Immediate teardown and cache purge.' }
                      ].map(mode => {
                        const isActive = (cfg.hibernation_mode || 'adaptive') === mode.id;
                        return (
                          <button
                            key={mode.id}
                            type="button"
                            onClick={() => patchConfig({ hibernation_mode: mode.id })}
                            aria-pressed={isActive}
                            aria-label={`Select ${mode.label} hibernation mode`}
                            className={cn(
                              "p-4 rounded-xl border text-left transition-all relative group focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none cursor-pointer",
                              isActive ? "border-accent bg-accent/10 ring-1 ring-accent/30" : "border-border bg-background hover:border-border-hover"
                            )}
                          >
                            <div className="flex items-center justify-between mb-1.5">
                              <span className={cn("text-xs font-bold", isActive ? "text-accent" : "text-text")}>{mode.label}</span>
                              {isActive && <CheckCircle2 size={15} className="text-accent shrink-0" />}
                            </div>
                            <p className="text-[11px] text-dim leading-snug">{mode.desc}</p>
                          </button>
                        )
                      })}
                    </div>

                    {(cfg.hibernation_mode || 'adaptive') === 'adaptive' && (
                      <div className="animate-in fade-in slide-in-from-top-2 duration-300">
                        <div className="flex flex-col gap-1.5">
                          <label htmlFor="hibernation_grace_period_sec" className="text-[10px] text-dim font-bold tracking-widest uppercase">Adaptive Grace Period (s)</label>
                          <input
                            id="hibernation_grace_period_sec"
                            type="number"
                            inputMode="numeric"
                            min="5"
                            max="3600"
                            value={cfg.hibernation_grace_period_sec || 30}
                            onChange={(e) => patchConfig({ hibernation_grace_period_sec: Number(e.target.value) })}
                            className="w-full sm:max-w-[220px] bg-background border border-border focus:border-accent focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none rounded-lg px-3 py-1.5 min-h-[34px] text-xs font-mono text-text transition-all"
                          />
                        </div>
                        <p className="mt-1.5 text-xs text-dim">Time to maintain Light Sleep before full cache purge.</p>
                      </div>
                    )}

                    {/* Database Auto-Pruning Retention Management */}
                    <div className="pt-4 border-t border-border/50 flex flex-col gap-4">
                      <div>
                        <h3 className="text-xs font-bold uppercase tracking-wider text-text flex items-center gap-2">
                          <Database size={14} className="text-accent" /> Database Auto-Pruning & Egress Limits
                        </h3>
                        <p className="text-xs text-dim mt-0.5">Configure automated data retention to minimize database storage & RAM footprint.</p>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div className="flex flex-col gap-1.5">
                          <label htmlFor="log_retention_days" className="text-[10px] text-dim font-bold tracking-widest uppercase">Log Retention (Days)</label>
                          <input
                            id="log_retention_days"
                            type="number"
                            inputMode="numeric"
                            min="1"
                            max="365"
                            value={cfg.log_retention_days || 7}
                            onChange={(e) => patchConfig({ log_retention_days: Number(e.target.value) })}
                            className="w-full bg-background border border-border focus:border-accent focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none rounded-lg px-3 py-1.5 min-h-[34px] text-xs font-mono text-text transition-all"
                          />
                          <p className="text-[11px] text-dim">Prune debug and system logs older than threshold.</p>
                        </div>

                        <div className="flex flex-col gap-1.5">
                          <label htmlFor="trade_retention_days" className="text-[10px] text-dim font-bold tracking-widest uppercase">Trade Retention (Days)</label>
                          <input
                            id="trade_retention_days"
                            type="number"
                            inputMode="numeric"
                            min="1"
                            max="365"
                            value={cfg.trade_retention_days || 30}
                            onChange={(e) => patchConfig({ trade_retention_days: Number(e.target.value) })}
                            className="w-full bg-background border border-border focus:border-accent focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none rounded-lg px-3 py-1.5 min-h-[34px] text-xs font-mono text-text transition-all"
                          />
                          <p className="text-[11px] text-dim">Prune closed trade history and balance snapshots.</p>
                        </div>
                      </div>
                    </div>

                    <div className="p-4 bg-background/40 border border-border/60 rounded-xl flex flex-col gap-1.5">
                      <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-accent">
                        <ShieldCheck size={13} /> Resource vs. Latency Trade-off
                      </div>
                      <p className="text-xs text-dim leading-relaxed border-l-2 border-accent/25 pl-3">
                        {(cfg.hibernation_mode || 'adaptive') === 'light'
                          ? "Maintaining MarketFeed during hibernation avoids REST backfill bursts, keeping strategies ready the millisecond gating clears."
                          : (cfg.hibernation_mode || 'adaptive') === 'deep'
                          ? "Deep sleep minimizes CPU, network, and memory by purging non-essential buffers. Resumption runs a fresh warmup."
                          : "Adaptive mode provides a fast light-sleep grace window before transitioning into deep resource savings."}
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </section>
          )}

          {/* Section 8: Scanner & Market Feed Bandwidth */}
          {isSectionVisible('scanner_bandwidth') && (
            <section id="settings-section-scanner_bandwidth" className="bg-surface border border-border/80 rounded-2xl overflow-hidden shadow-xs">
              <button
                type="button"
                onClick={() => toggleSection('scanner_bandwidth')}
                aria-expanded={openSections.has('scanner_bandwidth')}
                aria-controls="scanner_bandwidth-content"
                aria-label={openSections.has('scanner_bandwidth') ? "Collapse Scanner & Market Feed Bandwidth section" : "Expand Scanner & Market Feed Bandwidth section"}
                className="w-full p-4 sm:p-5 flex items-center justify-between text-left cursor-pointer hover:bg-surface-hover/50 transition-colors focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none min-h-[56px]"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <SectionLabel className="mb-0 truncate">Scanner & Market Feed Bandwidth</SectionLabel>
                  <span className={cn("text-[10px] font-mono font-bold uppercase tracking-wider flex items-center gap-1.5 whitespace-nowrap shrink-0", cfg.global_scanner_enabled !== false ? "text-green" : "text-amber")}>
                    <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", cfg.global_scanner_enabled !== false ? "bg-green" : "bg-amber")} />
                    {cfg.global_scanner_enabled !== false ? "Scanner Active" : "Scanner Off"}
                  </span>
                </div>
                <ChevronDown size={16} className={cn("text-dim transition-transform duration-200 shrink-0", openSections.has('scanner_bandwidth') && "rotate-180")} />
              </button>
              {openSections.has('scanner_bandwidth') && (
                <div id="scanner_bandwidth-content" className="p-4 sm:p-5 border-t border-border/50 flex flex-col gap-4 animate-in fade-in duration-200">
                  <div className="flex items-center justify-between p-4 bg-background rounded-xl border border-border/60 hover:border-accent/30 transition-colors">
                    <label htmlFor="global_scanner_enabled" className="cursor-pointer select-none flex-grow mr-4">
                      <div className="text-sm font-bold">Global Market Scanner</div>
                      <div className="text-xs text-dim mt-0.5">Disable if monitoring fixed pairs only to save ~45–60% backend CPU & bandwidth</div>
                    </label>
                    <button
                      id="global_scanner_enabled"
                      type="button"
                      onClick={() => patchConfig({ global_scanner_enabled: cfg.global_scanner_enabled === false ? true : false })}
                      role="switch"
                      aria-checked={cfg.global_scanner_enabled !== false}
                      aria-label="Toggle Global Market Scanner"
                      className={cn(
                        "w-12 h-6 rounded-full transition-colors relative shrink-0 cursor-pointer focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none",
                        (cfg.global_scanner_enabled !== false) ? "bg-green" : "bg-border"
                      )}
                    >
                      <div className={cn(
                        "absolute top-1 w-4 h-4 bg-white rounded-full transition-transform",
                        (cfg.global_scanner_enabled !== false) ? "translate-x-7" : "translate-x-1"
                      )} />
                    </button>
                  </div>
                </div>
              )}
            </section>
          )}

          {/* Section 9: Dashboard, Streaming & Eco-Graphics */}
          {isSectionVisible('streaming') && (
            <section id="settings-section-streaming" className="bg-surface border border-border/80 rounded-2xl overflow-hidden shadow-xs">
              <button
                type="button"
                onClick={() => toggleSection('streaming')}
                aria-expanded={openSections.has('streaming')}
                aria-controls="streaming-content"
                aria-label={openSections.has('streaming') ? "Collapse Dashboard, Streaming & Eco-Graphics section" : "Expand Dashboard, Streaming & Eco-Graphics section"}
                className="w-full p-4 sm:p-5 flex items-center justify-between text-left cursor-pointer hover:bg-surface-hover/50 transition-colors focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none min-h-[56px]"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <SectionLabel className="mb-0 truncate">Dashboard, Streaming & Eco-Graphics</SectionLabel>
                  <span className={cn("text-[10px] font-mono font-bold uppercase tracking-wider whitespace-nowrap shrink-0", uiEcoMode ? "text-amber" : "text-green")}>
                    · {uiEcoMode ? "Eco Graphics" : "Full Graphics"}
                  </span>
                </div>
                <ChevronDown size={16} className={cn("text-dim transition-transform duration-200 shrink-0", openSections.has('streaming') && "rotate-180")} />
              </button>
              {openSections.has('streaming') && (
                <div id="streaming-content" className="p-4 sm:p-5 border-t border-border/50 flex flex-col gap-4 animate-in fade-in duration-200">
                  <div className="flex items-center justify-between p-4 bg-background rounded-xl border border-accent/25 transition-colors">
                    <div className="flex items-center gap-3.5 flex-grow mr-3">
                      <div className="w-10 h-10 rounded-xl bg-amber/10 flex items-center justify-center shrink-0">
                        <Zap size={18} className="text-amber" />
                      </div>
                      <label htmlFor="ui_eco_mode" className="cursor-pointer select-none flex-grow">
                        <h3 className="text-sm font-bold tracking-tight">Master UI Eco-Graphics & Battery Saver</h3>
                        <p className="text-xs text-dim mt-0.5">Disables heavy CSS blurs, glow pulses, canvas animations, and off-screen calculations</p>
                      </label>
                    </div>
                    <button
                      id="ui_eco_mode"
                      type="button"
                      onClick={() => setUiEcoMode(!uiEcoMode)}
                      role="switch"
                      aria-checked={uiEcoMode}
                      aria-label="Toggle Master UI Eco-Graphics & Battery Saver"
                      className={cn(
                        "w-12 h-6 rounded-full transition-colors relative shrink-0 cursor-pointer focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none",
                        uiEcoMode ? "bg-amber" : "bg-border"
                      )}
                    >
                      <div className={cn(
                        "absolute top-1 w-4 h-4 bg-white rounded-full transition-transform",
                        uiEcoMode ? "translate-x-7" : "translate-x-1"
                      )} />
                    </button>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                    <div className="flex items-center justify-between gap-3 p-4 bg-background rounded-xl border border-border/60">
                      <div className="flex items-center gap-3.5 flex-grow min-w-0">
                        <div className="w-9 h-9 rounded-lg bg-accent/10 flex items-center justify-center shrink-0">
                          <Activity size={18} className="text-accent" />
                        </div>
                        <label htmlFor="system_health_bar" className="cursor-pointer select-none flex-grow min-w-0">
                          <h3 className="text-sm font-bold tracking-tight">System Health Bar</h3>
                          <p className="text-xs text-dim mt-0.5">Show CPU, memory & event loop lag</p>
                        </label>
                      </div>
                      <button
                        id="system_health_bar"
                        type="button"
                        onClick={() => setHealthEnabled(!healthEnabled)}
                        role="switch"
                        aria-checked={healthEnabled}
                        aria-label="Toggle System Health Bar"
                        className={cn(
                          "w-12 h-6 rounded-full transition-colors relative shrink-0 cursor-pointer focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none",
                          healthEnabled ? "bg-green" : "bg-border"
                        )}
                      >
                        <div className={cn(
                          "absolute top-1 w-4 h-4 bg-white rounded-full transition-transform",
                          healthEnabled ? "translate-x-7" : "translate-x-1"
                        )} />
                      </button>
                    </div>

                    <div className="flex items-center justify-between gap-3 p-4 bg-background rounded-xl border border-border/60">
                      <div className="flex items-center gap-3.5 flex-grow min-w-0">
                        <div className="w-9 h-9 rounded-lg bg-green/10 flex items-center justify-center shrink-0">
                          <Zap size={18} className="text-green" />
                        </div>
                        <label htmlFor="real_time_streaming" className="cursor-pointer select-none flex-grow min-w-0">
                          <h3 className="text-sm font-bold tracking-tight">Real-time Streaming</h3>
                          <p className="text-xs text-dim mt-0.5">Live incoming WebSocket updates</p>
                        </label>
                      </div>
                      <button
                        id="real_time_streaming"
                        type="button"
                        onClick={() => setStreamingEnabled(!streamingEnabled)}
                        role="switch"
                        aria-checked={streamingEnabled}
                        aria-label="Toggle Real-time Streaming"
                        className={cn(
                          "w-12 h-6 rounded-full transition-colors relative shrink-0 cursor-pointer focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none",
                          streamingEnabled ? "bg-green" : "bg-border"
                        )}
                      >
                        <div className={cn(
                          "absolute top-1 w-4 h-4 bg-white rounded-full transition-transform",
                          streamingEnabled ? "translate-x-7" : "translate-x-1"
                        )} />
                      </button>
                    </div>
                  </div>

                  <div className="pt-3 border-t border-border/50">
                    <div className="mb-3">
                      <h3 className="text-xs font-bold uppercase tracking-wider text-text">Backend Log Feed</h3>
                      <p className="text-xs text-dim mt-0.5">Select which backend log levels stream to this dashboard.</p>
                    </div>
                    <div className="flex flex-wrap gap-2.5">
                      {['info', 'warn', 'error'].map((level) => {
                        const safeLogFilters = logFilters && typeof logFilters === 'object' ? logFilters : { info: true, warn: true, error: true }
                        const enabled = safeLogFilters[level] !== false
                        const label = level === 'info' ? 'Info' : level === 'warn' ? 'Warnings' : 'Errors'
                        return (
                          <Tooltip
                            key={level}
                            content={`Click to ${enabled ? 'disable' : 'enable'} ${label.toLowerCase()} level logs in the live dashboard feed`}
                          >
                            <button
                              type="button"
                              onClick={() => toggleLogFilter(level)}
                              aria-pressed={enabled}
                              aria-label={`Toggle ${label} logs (${enabled ? 'Enabled' : 'Disabled'})`}
                              className={cn(
                                "rounded-xl border px-4 py-2 min-h-[40px] text-xs font-bold tracking-tight transition-all cursor-pointer focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none",
                                enabled ? 'border-accent bg-accent/10 text-text' : 'border-border text-dim bg-transparent hover:text-text'
                              )}
                            >
                              {label}
                            </button>
                          </Tooltip>
                        )
                      })}
                    </div>
                  </div>
                </div>
              )}
            </section>
          )}

          {/* Section 10: Account Maintenance */}
          {isSectionVisible('maintenance') && (
            <section id="settings-section-maintenance" className="bg-surface border border-border/80 rounded-2xl overflow-hidden shadow-xs">
              <button
                type="button"
                onClick={() => toggleSection('maintenance')}
                aria-expanded={openSections.has('maintenance')}
                aria-controls="maintenance-content"
                aria-label={openSections.has('maintenance') ? "Collapse Account Maintenance section" : "Expand Account Maintenance section"}
                className="w-full p-4 sm:p-5 flex items-center justify-between text-left cursor-pointer hover:bg-surface-hover/50 transition-colors focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none min-h-[56px]"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <SectionLabel className="mb-0 text-red truncate">Account Maintenance</SectionLabel>
                  <span className="text-[10px] font-mono font-bold text-dim uppercase tracking-wider whitespace-nowrap shrink-0">
                    · Paper Reset
                  </span>
                </div>
                <ChevronDown size={16} className={cn("text-dim transition-transform duration-200 shrink-0", openSections.has('maintenance') && "rotate-180")} />
              </button>
              {openSections.has('maintenance') && (
                <div id="maintenance-content" className="p-4 sm:p-5 border-t border-border/50 flex flex-col gap-4 animate-in fade-in duration-200">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div className="flex items-center gap-3.5">
                      <div className="w-10 h-10 rounded-xl bg-red/10 flex items-center justify-center shrink-0">
                        <RotateCcw size={18} className="text-red" />
                      </div>
                      <div>
                        <h3 className="text-sm font-bold text-red">Reset Paper Balance</h3>
                        <p className="text-xs text-dim mt-0.5">Reset your global paper trading balance back to $10,000.00</p>
                      </div>
                    </div>
                    <Btn
                      variant="ghost"
                      onClick={() => setResetConfirm(true)}
                      disabled={resetting}
                      className="px-5 py-2.5 min-h-[42px] rounded-xl text-xs font-bold text-red hover:bg-red/5 hover:border-red whitespace-nowrap shrink-0"
                    >
                      Reset Balance
                    </Btn>
                  </div>
                </div>
              )}
            </section>
          )}

          <ConfirmationModal
            isOpen={resetConfirm}
            onClose={() => setResetConfirm(false)}
            onConfirm={() => {
              setResetConfirm(false)
              handleResetBalance()
            }}
            title="Reset Paper Balance?"
            message="This will reset your simulated paper trading balance to $10,000.00. Your trade history will remain intact, but active session metrics might be affected. This action cannot be undone."
            confirmText="Reset Now"
            variant="danger"
            loading={resetting}
          />

          <section className="bg-amber/5 border border-amber/20 rounded-2xl p-4 sm:p-5 flex gap-3.5 items-start">
            <div className="w-9 h-9 rounded-xl bg-amber/10 flex items-center justify-center shrink-0 mt-0.5">
              <ShieldAlert size={18} className="text-amber" />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-xs font-bold text-amber uppercase tracking-wider">Security Protocol & Scope</h3>
              <p className="text-xs text-dim leading-relaxed mt-1">
                API credentials are encrypted at rest on the backend and never exposed after submission. Ensure Binance API keys have <span className="text-text font-semibold">"Withdrawals" disabled</span>.
                Per-strategy parameters (scanner filters, signals, risk limits, SL/TP) live in the <button type="button" onClick={() => { window.location.hash = '#/' }} className="text-accent hover:underline font-semibold cursor-pointer">Cockpit Strategy Config</button>.
              </p>
            </div>
          </section>
        </div>
        <BottomNav />
      </div>
    </div>
  )
}
