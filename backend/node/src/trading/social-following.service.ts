import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Follow } from '../models/entities/Follow.entity';
import { User } from '../models/entities/User.entity';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';

@Injectable()
export class SocialFollowingService {
  constructor(
    @InjectRepository(Follow)
    private followRepo: Repository<Follow>,
    private eventEmitter: EventEmitter2,
  ) {}

  async follow(followerId: string, followingId: string) {
    let follow = await this.followRepo.findOneBy({ followerId, followingId });
    if (!follow) {
      follow = this.followRepo.create({ followerId, followingId });
    }
    await this.followRepo.save(follow);
    return follow;
  }

  async unfollow(followerId: string, followingId: string) {
    await this.followRepo.delete({ followerId, followingId });
  }

  async enableCopyTrading(followerId: string, followingId: string, multiplier: number = 1.0) {
    const follow = await this.followRepo.findOneBy({ followerId, followingId });
    if (!follow) throw new Error('Must follow before copy trading');

    follow.is_copying = true;
    follow.copy_multiplier = multiplier;
    await this.followRepo.save(follow);
  }

  @OnEvent('trade.opened')
  async handleTradeOpened(event: { userId: string, trade: any }) {
    const followers = await this.followRepo.find({
      where: { followingId: event.userId, is_copying: true },
    });

    for (const follower of followers) {
      this.eventEmitter.emit('copytrade.execute', {
        followerId: follower.followerId,
        sourceTrade: event.trade,
        multiplier: follower.copy_multiplier,
      });
    }
  }
}
