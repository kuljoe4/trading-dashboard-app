import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Lock, ShieldAlert, Key, ArrowRight, Eye, EyeOff, XCircle } from 'lucide-react';
import { setAdminApiKey } from '../api/client';
import { useTradingStore } from '../store/trading';
import { Tooltip } from './ui/primitives';

export const AuthOverlay = () => {
  const [visible, setVisible] = useState(false);
  const [key, setKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [error, setError] = useState(false);
  const inputRef = useRef(null);
  const { connectWS, disconnectWS } = useTradingStore();

  useEffect(() => {
    const handleAuthRequired = () => setVisible(true);
    window.addEventListener('auth-required', handleAuthRequired);
    return () => window.removeEventListener('auth-required', handleAuthRequired);
  }, []);

  useEffect(() => {
    if (visible) {
      const timer = setTimeout(() => inputRef.current?.focus(), 100);
      return () => clearTimeout(timer);
    }
  }, [visible]);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!key.trim()) return;

    setAdminApiKey(key.trim());
    setError(false);
    setVisible(false);
    setKey('');

    // Reconnect WS with new key
    disconnectWS();
    connectWS();

    // Refresh page to retry failed initial calls
    window.location.reload();
  };

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-background/80 backdrop-blur-md p-4"
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="auth-title"
            aria-describedby="auth-description"
            initial={{ scale: 0.9, y: 20 }}
            animate={{ scale: 1, y: 0 }}
            className="w-full max-w-md bg-surface border border-border rounded-3xl shadow-2xl overflow-hidden"
          >
            <div className="p-8">
              <div className="w-16 h-16 bg-accent/10 border border-accent/20 rounded-2xl flex items-center justify-center mb-6 mx-auto">
                <Lock className="text-accent" size={32} />
              </div>

              <h2 id="auth-title" className="text-2xl font-bold text-center mb-2">Authentication Required</h2>
              <p id="auth-description" className="text-sm text-dim text-center mb-8 uppercase tracking-widest font-bold">Enter Admin API Key to unlock</p>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="relative">
                  <label htmlFor="admin-api-key" className="sr-only">Admin API Key</label>
                  <div className="absolute left-4 top-1/2 -translate-y-1/2 text-dim pointer-events-none">
                    <Key size={18} />
                  </div>
                  <input
                    ref={inputRef}
                    id="admin-api-key"
                    type={showKey ? 'text' : 'password'}
                    value={key}
                    onChange={(e) => setKey(e.target.value)}
                    placeholder="••••••••••••••••"
                    aria-label="Admin API Key"
                    className="w-full bg-background border border-border focus:border-accent focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none rounded-2xl pl-12 pr-20 py-4 text-sm font-mono transition-all"
                  />
                  <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1">
                    {key && (
                      <Tooltip content="Clear input">
                        <button
                          type="button"
                          onClick={() => {
                            setKey('');
                            inputRef.current?.focus();
                          }}
                          className="p-1 text-dim hover:text-text transition-colors rounded-lg focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none cursor-pointer"
                          aria-label="Clear input"
                        >
                          <XCircle size={16} />
                        </button>
                      </Tooltip>
                    )}
                    <Tooltip content={showKey ? "Hide API key" : "Show API key"}>
                      <button
                        type="button"
                        onClick={() => setShowKey(!showKey)}
                        className="p-1 text-dim hover:text-text transition-colors rounded-lg focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none cursor-pointer"
                        aria-label={showKey ? "Hide API key" : "Show API key"}
                      >
                        {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
                      </button>
                    </Tooltip>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={!key.trim()}
                  className="w-full bg-accent hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold py-4 rounded-2xl flex items-center justify-center gap-2 transition-all shadow-lg shadow-accent/20 cursor-pointer group"
                >
                  Unlock Dashboard
                  <ArrowRight size={18} className="group-hover:translate-x-1 transition-transform" />
                </button>
              </form>
            </div>

            <div className="bg-amber/5 border-t border-border p-6 flex gap-4">
              <ShieldAlert className="text-amber shrink-0" size={20} />
              <p className="text-[11px] text-dim font-medium leading-relaxed">
                This key is required to authorize sensitive trading operations.
                It is stored only in your local browser and never sent to third parties.
              </p>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
