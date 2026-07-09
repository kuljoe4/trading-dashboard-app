import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User, UserProfile } from '../models/entities/User.entity';

@Injectable()
export class GamificationService {
  constructor(
    @InjectRepository(UserProfile)
    private profileRepo: Repository<UserProfile>,
  ) {}

  async addXP(userId: string, amount: number) {
    const profile = await this.profileRepo.findOneBy({ userId });
    if (!profile) return;

    profile.xp += amount;

    // Simple level logic: Level = floor(sqrt(XP / 100))
    const newLevel = Math.floor(Math.sqrt(profile.xp / 100));
    if (newLevel > profile.level) {
      profile.level = newLevel;
      // Trigger level up event/notification
    }

    await this.profileRepo.save(profile);
    return profile;
  }

  async updateStreak(userId: string) {
    const profile = await this.profileRepo.findOneBy({ userId });
    if (!profile) return;

    const now = new Date();
    const lastActive = profile.last_active_at ? new Date(profile.last_active_at) : null;

    if (!lastActive) {
      profile.streak_days = 1;
    } else {
      const diffDays = Math.floor((now.getTime() - lastActive.getTime()) / (1000 * 3600 * 24));
      if (diffDays === 1) {
        profile.streak_days += 1;
      } else if (diffDays > 1) {
        profile.streak_days = 1;
      }
    }

    profile.last_active_at = now;
    await this.profileRepo.save(profile);
  }

  async getLeaderboard(limit = 10) {
    return this.profileRepo.find({
      where: { is_public: true },
      order: { xp: 'DESC' },
      take: limit,
      relations: ['user'],
    });
  }
}
