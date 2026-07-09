import React, { useState, useEffect } from 'react';
import { useTradingStore } from '../store/trading';
import { Sidebar, BottomNav } from '../components/Navigation';
import { Trophy, TrendingUp, Users, ArrowUpRight, Search } from 'lucide-react';
import { ViewHeader, cn } from '../components/ui/primitives';
import api from '../api/client';

const LeaderboardView = () => {
  const { sidebarCollapsed } = useTradingStore();
  const [profiles, setProfiles] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchLeaderboard() {
      try {
        const res = await api.get('/social/leaderboard');
        setProfiles(res.data);
      } catch (e) {
        console.error('Failed to fetch leaderboard', e);
        // Fallback mock data for UI demo
        setProfiles([
          { id: '1', display_name: 'AlphaTrader', level: 45, xp: 12500, streak_days: 12, pnl: 450 },
          { id: '2', display_name: 'MomentumKing', level: 42, xp: 11200, streak_days: 8, pnl: 380 },
          { id: '3', display_name: 'QuantSage', level: 38, xp: 9500, streak_days: 15, pnl: 310 },
          { id: '4', display_name: 'BollingerBot', level: 35, xp: 8200, streak_days: 5, pnl: 290 },
          { id: '5', display_name: 'CryptoGenius', level: 31, xp: 7100, streak_days: 3, pnl: 150 },
        ]);
      } finally {
        setLoading(false);
      }
    }
    fetchLeaderboard();
  }, []);

  return (
    <div className={cn(
      "min-h-screen transition-all duration-300 relative pb-24",
      sidebarCollapsed ? "lg:pl-[80px]" : "lg:pl-[260px]"
    )}>
      <Sidebar selected="leaderboard" />
      <div className="max-w-5xl mx-auto p-4 md:p-10">
        <ViewHeader
          title="Global Arena"
          subTitle="See how you rank against the world's most elite momentum operators."
        />

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
          <TopCard rank={2} name="MomentumKing" pnl="+380%" xp="11.2k" />
          <TopCard rank={1} name="AlphaTrader" pnl="+450%" xp="12.5k" isMain />
          <TopCard rank={3} name="QuantSage" pnl="+310%" xp="9.5k" />
        </div>

        <div className="bg-surface border border-border rounded-3xl overflow-hidden shadow-xl">
          <div className="p-6 border-b border-border flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-dim" size={16} />
              <input
                type="text"
                placeholder="Search operators..."
                className="w-full pl-12 pr-4 py-3 bg-background border border-border rounded-xl text-sm focus:outline-none focus:border-accent transition-all"
              />
            </div>
            <div className="flex items-center gap-2">
              <FilterBtn label="Profit" active />
              <FilterBtn label="XP" />
              <FilterBtn label="Streak" />
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-border text-[10px] text-dim font-black uppercase tracking-widest bg-surface/50">
                  <th className="px-6 py-4">Rank</th>
                  <th className="px-6 py-4">Operator</th>
                  <th className="px-6 py-4">Level</th>
                  <th className="px-6 py-4">PnL (All-Time)</th>
                  <th className="px-6 py-4">Streak</th>
                  <th className="px-6 py-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {profiles.map((p, i) => (
                  <tr key={p.id} className="border-b border-border/50 hover:bg-white/5 transition-colors group">
                    <td className="px-6 py-6">
                      <span className={cn(
                        "w-8 h-8 rounded-lg flex items-center justify-center font-mono font-bold text-sm",
                        i === 0 ? "bg-accent/20 text-accent" : "bg-background text-dim"
                      )}>
                        #{i + 1}
                      </span>
                    </td>
                    <td className="px-6 py-6">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-accent/10 border border-accent/20 flex items-center justify-center text-accent font-bold">
                          {p.display_name[0]}
                        </div>
                        <div>
                          <div className="font-bold text-sm">{p.display_name}</div>
                          <div className="text-[10px] text-dim font-bold uppercase tracking-tighter">Verified Strategy</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-6">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-mono font-bold">LVL {p.level}</span>
                        <div className="w-12 h-1 bg-background rounded-full overflow-hidden">
                          <div className="h-full bg-accent" style={{ width: '65%' }} />
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-6">
                      <span className="text-emerald-400 font-mono font-bold">+{p.pnl}%</span>
                    </td>
                    <td className="px-6 py-6">
                      <div className="flex items-center gap-1.5 text-xs font-bold text-amber">
                        <TrendingUp size={14} /> {p.streak_days}d
                      </div>
                    </td>
                    <td className="px-6 py-6 text-right">
                      <button className="px-4 py-2 bg-accent/10 text-accent border border-accent/20 rounded-lg text-[10px] font-black uppercase tracking-widest hover:bg-accent hover:text-white transition-all">
                        Follow
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
      <BottomNav selected="leaderboard" />
    </div>
  );
};

const TopCard = ({ rank, name, pnl, xp, isMain }) => (
  <div className={cn(
    "relative p-8 rounded-3xl border flex flex-col items-center text-center transition-all",
    isMain ? "bg-accent border-accent text-white scale-105 shadow-2xl z-10" : "bg-surface border-border text-text"
  )}>
    <div className={cn(
      "w-12 h-12 rounded-2xl flex items-center justify-center mb-6 font-black text-xl",
      isMain ? "bg-white/20" : "bg-accent/10 text-accent"
    )}>
      #{rank}
    </div>
    <div className="text-lg font-black mb-1">{name}</div>
    <div className={cn("text-[10px] font-bold uppercase tracking-widest mb-4", isMain ? "text-white/60" : "text-dim")}>
      Master Operator
    </div>
    <div className="text-3xl font-black font-mono tracking-tighter mb-6">{pnl}</div>
    <div className="flex gap-4 w-full pt-6 border-t border-white/10">
      <div className="flex-1">
        <div className={cn("text-[8px] font-black uppercase tracking-widest", isMain ? "text-white/60" : "text-dim")}>Total XP</div>
        <div className="font-bold">{xp}</div>
      </div>
      <div className="flex-1">
        <div className={cn("text-[8px] font-black uppercase tracking-widest", isMain ? "text-white/60" : "text-dim")}>Win Rate</div>
        <div className="font-bold">68%</div>
      </div>
    </div>
    {isMain && <Trophy className="absolute top-4 right-4 text-white/20" size={32} />}
  </div>
);

const FilterBtn = ({ label, active }) => (
  <button className={cn(
    "px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest transition-all",
    active ? "bg-accent text-white shadow-lg shadow-accent/20" : "bg-background text-dim border border-border hover:border-accent/40 hover:text-accent"
  )}>
    {label}
  </button>
);

export default LeaderboardView;
