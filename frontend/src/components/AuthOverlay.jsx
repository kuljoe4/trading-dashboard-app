import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Lock, ShieldAlert, Key, ArrowRight, AlertCircle } from 'lucide-react';
import { setAdminApiKey } from '../api/client';
import { useTradingStore } from '../store/trading';

export const AuthOverlay = () => {
  const [visible, setVisible] = useState(false);
  const [key, setKey] = useState('');
  const [error, setError] = useState(false);
  const { connectWS, disconnectWS } = useTradingStore();

  useEffect(() => {
    const handleAuthRequired = () => setVisible(true);
    window.addEventListener('auth-required', handleAuthRequired);
    return () => window.removeEventListener('auth-required', handleAuthRequired);
  }, []);

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
            initial={{ scale: 0.9, y: 20 }}
            animate={{ scale: 1, y: 0 }}
            className="w-full max-w-md bg-surface border border-border rounded-3xl shadow-2xl overflow-hidden"
          >
            <div className="p-8">
              <div className="w-16 h-16 bg-accent/10 border border-accent/20 rounded-2xl flex items-center justify-center mb-6 mx-auto">
                <Lock className="text-accent" size={32} />
              </div>

              <h2 className="text-2xl font-bold text-center mb-2">Authentication Required</h2>
              <p className="text-sm text-dim text-center mb-8 uppercase tracking-widest font-bold">Enter Admin API Key to unlock</p>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="relative">
                  <div className="absolute left-4 top-1/2 -translate-y-1/2 text-dim">
                    <Key size={18} />
                  </div>
                  <input
                    autoFocus
                    type="password"
                    value={key}
                    onChange={(e) => setKey(e.target.value)}
                    placeholder="••••••••••••••••"
                    className="w-full bg-background border border-border focus:border-accent focus:outline-none rounded-2xl pl-12 pr-4 py-4 text-sm font-mono transition-all"
                  />
                </div>

                <button
                  type="submit"
                  className="w-full bg-accent hover:bg-accent-hover text-white font-bold py-4 rounded-2xl flex items-center justify-center gap-2 transition-all shadow-lg shadow-accent/20 group"
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
