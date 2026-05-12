import React, { useState, useEffect } from 'react'
import { C } from '../lib/theme'
import { settingsAPI } from '../api/client'
import { SectionLabel, Btn } from '../components/ui/primitives'

export function SettingsView() {
  const [apiKey, setApiKey] = useState('')
  const [apiSecret, setApiSecret] = useState('')
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
    try {
      await settingsAPI.updateKeys({ api_key: apiKey, api_secret: apiSecret })
      setStatus({ type: 'success', msg: 'Keys saved successfully!' })
      setApiKey('')
      setApiSecret('')
      loadKeys()
    } catch (e) {
      setStatus({ type: 'error', msg: 'Failed to save keys' })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div>
        <SectionLabel>Binance API Settings</SectionLabel>
        <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
          
          <div>
            <div style={{ fontSize: 12, color: C.dim, marginBottom: 4 }}>Current API Key (Masked)</div>
            <div style={{ color: C.text, fontFamily: 'monospace' }}>{maskedKey || 'None'}</div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <label htmlFor="apiKey" style={{ fontSize: 12, color: C.dim }}>Update API Key</label>
            <input 
              id="apiKey"
              type="text" 
              value={apiKey} 
              onChange={e => setApiKey(e.target.value)}
              style={{ background: '#000', border: `1px solid ${C.border}`, color: 'white', padding: '8px 12px', borderRadius: 6 }}
              placeholder="Enter new API key"
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <label htmlFor="apiSecret" style={{ fontSize: 12, color: C.dim }}>Update API Secret</label>
            <input 
              id="apiSecret"
              type="password" 
              value={apiSecret} 
              onChange={e => setApiSecret(e.target.value)}
              style={{ background: '#000', border: `1px solid ${C.border}`, color: 'white', padding: '8px 12px', borderRadius: 6 }}
              placeholder="Enter new API secret"
            />
          </div>

          <Btn
            onClick={handleSave}
            disabled={loading || (!apiKey && !apiSecret)}
            title={(!apiKey && !apiSecret) ? "Enter API key or secret to save" : ""}
          >
            {loading ? 'Saving...' : 'Save Keys'}
          </Btn>

          {status && (
            <div style={{ fontSize: 13, color: status.type === 'success' ? C.green : C.red }}>
              {status.msg}
            </div>
          )}
        </div>
      </div>
      
      <div style={{ fontSize: 12, color: C.dim, background: '#332b00', padding: 12, borderRadius: 6, border: '1px solid #665500' }}>
        <strong>Security Best Practice:</strong> API keys are sent securely to the backend and never stored in the browser. 
        Ensure your API keys have "Withdrawals" disabled on Binance.
      </div>
    </div>
  )
}
