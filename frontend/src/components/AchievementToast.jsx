import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Trophy, Star, Zap } from 'lucide-react';

export const AchievementToast = ({ achievement, onClose }) => {
  if (!achievement) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 50, scale: 0.9 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9 }}
      className="fixed bottom-24 left-1/2 -translate-x-1/2 z-[300] bg-gradient-to-r from-accent to-purple-600 p-[1px] rounded-2xl shadow-2xl shadow-accent/40"
    >
      <div className="bg-background/95 backdrop-blur-xl px-6 py-4 rounded-[15px] flex items-center gap-4">
        <div className="w-12 h-12 rounded-full bg-accent/20 flex items-center justify-center border border-accent/30">
          <Trophy className="text-accent" size={24} />
        </div>
        <div>
          <div className="text-[10px] text-accent font-black uppercase tracking-[0.2em] mb-0.5">Achievement Unlocked</div>
          <div className="text-lg font-black text-text uppercase tracking-tight">{achievement.title}</div>
          <div className="text-xs text-dim font-bold">{achievement.description}</div>
        </div>
        <div className="ml-4 pl-4 border-l border-border flex flex-col items-center">
          <div className="text-[10px] text-dim font-black uppercase tracking-widest">Rewards</div>
          <div className="text-accent font-mono font-black">+{achievement.xp} XP</div>
        </div>
      </div>
    </motion.div>
  );
};
