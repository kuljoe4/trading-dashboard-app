import React from 'react';
import { useTradingStore } from '../store/trading';
import { Trophy, TrendingUp, Users } from 'lucide-react';

export const UserStatsHeader = () => {
  const { balance, entryCount, hitCount } = useTradingStore();

  // Mock level/XP for UI demonstration until backend sync is fully wired
  const level = 12;
  const xp = 1250;
  const nextLevelXp = 2000;
  const progress = (xp / nextLevelXp) * 100;
  const streak = 5;

  return (
    <div className="flex items-center gap-6 px-4 py-2 bg-surface/50 border border-border rounded-2xl">
      <div className="flex items-center gap-3">
        <div className="relative">
          <div className="w-10 h-10 rounded-full bg-accent/20 flex items-center justify-center border border-accent/30 shadow-inner">
            <Trophy size={18} className="text-accent" />
          </div>
          <div className="absolute -bottom-1 -right-1 w-5 h-5 bg-accent text-white text-[10px] font-bold rounded-full flex items-center justify-center border-2 border-background">
            {level}
          </div>
        </div>
        <div className="hidden sm:block">
          <div className="text-[10px] text-dim font-bold uppercase tracking-wider mb-1">Elite Operator</div>
          <div className="w-24 h-1.5 bg-background rounded-full overflow-hidden">
            <div
              className="h-full bg-accent transition-all duration-500"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      </div>

      <div className="h-8 w-px bg-border mx-2" />

      <div className="flex items-center gap-4">
        <StatItem
          icon={<TrendingUp size={14} className="text-emerald-400" />}
          label="Streak"
          value={`${streak}d`}
        />
        <StatItem
          icon={<Users size={14} className="text-blue-400" />}
          label="Followers"
          value="1.2k"
        />
      </div>
    </div>
  );
};

const StatItem = ({ icon, label, value }) => (
  <div>
    <div className="flex items-center gap-1.5 text-[10px] text-dim font-bold uppercase tracking-wider mb-0.5">
      {icon} {label}
    </div>
    <div className="text-sm font-mono font-bold leading-none">{value}</div>
  </div>
);
