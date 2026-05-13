import React, { useState, useEffect } from 'react'
import { settingsAPI } from '../api/client'
import { SectionLabel, Btn, StatCard, cn } from '../components/ui/primitives'
import { Settings as SettingsIcon, ShieldAlert, Key, Lock, CheckCircle2, AlertCircle, Eye, EyeOff } from 'lucide-react'
import { motion } from 'framer-motion'

export function SettingsView() {
  const [apiKey, setApiKey] = useState('')
  const [apiSecret, setApiSecret] = useState('')
  const [showSecret, setShowSecret] = useState(false)
  const [maskedKey, setMaskedKey] = useState('')
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState(null)

  useEffect(() => {
    loadKeys()
  }, [])

  async function loadKeys() {
    try {
      const res = await settingsAPI.getKeys()
      setMaskedKey(res.data.api_key)
    } catch (e) {
      console.error('Failed to load keys', e)
    }
  }

  async function handleSave() {
    setLoading(true)
    setStatus(null)
    try {
      await settingsAPI.updateKeys({ api_key: apiKey, api_secret: apiSecret })
      setStatus({ type: 'success', msg: 'Credentials updated successfully!' })
      setApiKey('')
      setApiSecret('')
      loadKeys()
    } catch (e) {
      setStatus({ type: 'error', msg: 'Update failed. Check backend logs.' })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="max-w-[800px] mx-auto p-4 md:p-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center gap-4 mb-10">
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
          <SectionLabel className="mb-6">Exchange Integration</SectionLabel>
          <div className="bg-surface border border-border rounded-2xl p-6 md:p-8 shadow-sm">
            <div className="grid grid-cols-1 gap-8">

              <div className="flex flex-col gap-2">
                <div className="text-[10px] text-dim font-bold tracking-widest uppercase mb-1">Active Credentials</div>
                <div className="flex items-center gap-3 p-4 bg-background/50 border border-border rounded-xl">
                  <div className="w-8 h-8 rounded-lg bg-green/10 flex items-center justify-center">
                    <Key size={16} className="text-green" />
                  </div>
                  <div className="text-xs font-mono text-dim tracking-tight truncate">
                    {maskedKey || 'No API key configured'}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="flex flex-col gap-2">
                  <label htmlFor="apiKey" className="text-[10px] text-dim font-bold tracking-widest uppercase">Update API Key</label>
                  <div className="relative">
                    <input
                      id="apiKey"
                      type="text"
                      value={apiKey}
                      onChange={e => setApiKey(e.target.value)}
                      className="w-full bg-background border border-border focus:border-accent focus:outline-none rounded-xl px-4 py-3 text-sm font-mono text-text transition-all"
                      placeholder="8080...2025"
                    />
                  </div>
                </div>

                <div className="flex flex-col gap-2">
                  <label htmlFor="apiSecret" className="text-[10px] text-dim font-bold tracking-widest uppercase">Update API Secret</label>
                  <div className="relative">
                    <input
                      id="apiSecret"
                      type={showSecret ? 'text' : 'password'}
                      value={apiSecret}
                      onChange={e => setApiSecret(e.target.value)}
                      className="w-full bg-background border border-border focus:border-accent focus:outline-none rounded-xl pl-4 pr-12 py-3 text-sm font-mono text-text transition-all"
                      placeholder="••••••••••••••••"
                    />
                    <button
                      type="button"
                      onClick={() => setShowSecret(!showSecret)}
                      className="absolute right-4 top-1/2 -translate-y-1/2 text-dim hover:text-accent transition-colors"
                      aria-label={showSecret ? "Hide API Secret" : "Show API Secret"}
                    >
                      {showSecret ? <EyeOff size={16} /> : <Eye size={16} />}
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
                  disabled={loading || (!apiKey && !apiSecret)}
                  loading={loading}
                  className="w-full md:w-auto min-w-[160px]"
                >
                  Apply Credentials
                </Btn>
              </div>
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
    </div>
  )
}
