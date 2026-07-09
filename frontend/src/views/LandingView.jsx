import React from 'react';
import { motion } from 'framer-motion';
import { ArrowRight, Zap, Shield, TrendingUp, Users, Trophy } from 'lucide-react';

export const LandingView = () => {
  return (
    <div className="min-h-screen bg-background text-text overflow-x-hidden">
      {/* SEO Tags (Simulated for this React component) */}
      <head>
        <title>Momentum Engine | Elite Algorithmic Trading</title>
        <meta name="description" content="Master the markets with institutional-grade momentum algorithms and social copy-trading." />
        <meta property="og:title" content="Momentum Engine - The Future of Trading" />
      </head>

      {/* Hero Section */}
      <section className="relative pt-32 pb-20 px-6 max-w-7xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center"
        >
          <span className="inline-block px-4 py-1.5 rounded-full bg-accent/10 text-accent text-[11px] font-bold uppercase tracking-widest mb-6">
            Institutional Momentum Trading
          </span>
          <h1 className="text-5xl md:text-7xl font-bold tracking-tight mb-8 bg-gradient-to-b from-text to-text/50 bg-clip-text text-transparent">
            Automate Your Edge.<br />Scale Your Success.
          </h1>
          <p className="text-dim text-lg md:text-xl max-w-2xl mx-auto mb-10 leading-relaxed">
            A high-performance trading engine for Binance USDⓈ-M Futures. Built for speed, precision, and social dominance.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <button
              onClick={() => window.location.hash = '#/dashboard'}
              className="px-8 py-4 bg-accent text-white rounded-xl font-bold flex items-center gap-3 hover:bg-accent-light transition-all shadow-lg shadow-accent/20"
            >
              Launch Dashboard <ArrowRight size={18} />
            </button>
            <button className="px-8 py-4 bg-surface border border-border rounded-xl font-bold hover:bg-surface-light transition-all">
              View Leaderboard
            </button>
          </div>
        </motion.div>
      </section>

      {/* Features Grid */}
      <section className="py-24 px-6 bg-surface/30 border-y border-border">
        <div className="max-w-7xl mx-auto">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-12">
            <FeatureCard
              icon={<Zap className="text-accent" />}
              title="Ultra-Low Latency"
              description="WebSocket-first architecture ensures you see market moves before the retail crowd."
            />
            <FeatureCard
              icon={<Shield className="text-emerald-400" />}
              title="Risk-First Engine"
              description="Hard-coded safety gates and dynamic position sizing protect your capital automatically."
            />
            <FeatureCard
              icon={<Users className="text-blue-400" />}
              title="Social Dominance"
              description="Follow the pros, copy their trades, and climb the global leaderboard."
            />
          </div>
        </div>
      </section>

      {/* Social Proof Section */}
      <section className="py-24 px-6 max-w-7xl mx-auto text-center">
        <h2 className="text-3xl font-bold mb-16">Trusted by 10,000+ Algorithmic Traders</h2>
        <div className="flex flex-wrap justify-center gap-12 opacity-50 grayscale">
          {/* Logo placeholders */}
          <div className="text-2xl font-bold">BINANCE</div>
          <div className="text-2xl font-bold">TRADINGVIEW</div>
          <div className="text-2xl font-bold">COINBASE</div>
        </div>
      </section>

      {/* Gamification Teaser */}
      <section className="py-24 px-6 bg-accent/5">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center gap-16">
          <div className="flex-1">
            <Trophy className="w-16 h-16 text-accent mb-6" />
            <h2 className="text-4xl font-bold mb-6">Trade. Level Up. Conquer.</h2>
            <p className="text-dim text-lg mb-8">
              Earn XP for every profitable trade, unlock exclusive badges, and compete for weekly rewards in our global arena.
            </p>
            <ul className="space-y-4">
              <li className="flex items-center gap-3 text-text/80"><TrendingUp size={16} className="text-accent" /> Continuous Profit Streaks</li>
              <li className="flex items-center gap-3 text-text/80"><Users size={16} className="text-accent" /> Social Reputation Score</li>
              <li className="flex items-center gap-3 text-text/80"><Trophy size={16} className="text-accent" /> Exclusive Tournament Access</li>
            </ul>
          </div>
          <div className="flex-1 bg-surface border border-border rounded-3xl p-8 shadow-2xl">
            {/* Mock Leaderboard */}
            <div className="space-y-6">
              {[1, 2, 3].map(i => (
                <div key={i} className="flex items-center justify-between p-4 bg-background/50 rounded-xl border border-border/50">
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-full bg-accent/20 flex items-center justify-center text-accent font-bold">#{i}</div>
                    <div>
                      <div className="font-bold">Trader_{i*42}</div>
                      <div className="text-[10px] text-dim uppercase">Level {20-i*2}</div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-emerald-400 font-mono font-bold">+{120-i*15}%</div>
                    <div className="text-[10px] text-dim uppercase">Weekly PnL</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};

const FeatureCard = ({ icon, title, description }) => (
  <div className="group p-8 rounded-3xl bg-surface border border-border hover:border-accent/50 transition-all duration-300">
    <div className="w-12 h-12 rounded-2xl bg-background flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
      {icon}
    </div>
    <h3 className="text-xl font-bold mb-4">{title}</h3>
    <p className="text-dim leading-relaxed">{description}</p>
  </div>
);

export default LandingView;
