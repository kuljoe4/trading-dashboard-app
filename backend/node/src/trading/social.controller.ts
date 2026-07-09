import { Controller, Get, Query, Param } from '@nestjs/common';
import { GamificationService } from './gamification.service';

@Controller('social')
export class SocialController {
  constructor(private gamificationService: GamificationService) {}

  @Get('leaderboard')
  async getLeaderboard(@Query('limit') limit?: number) {
    return this.gamificationService.getLeaderboard(limit);
  }

  @Get('profile/:userId')
  async getProfile(@Param('userId') userId: string) {
    // In a real app, we'd check privacy settings here
    return this.gamificationService.addXP(userId, 0); // Just fetches for now
  }
}
