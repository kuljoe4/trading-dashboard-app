import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { User } from './User.entity';

@Entity('follows')
export class Follow {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'follower_id' })
  follower: User;

  @Column({ name: 'follower_id' })
  followerId: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'following_id' })
  following: User;

  @Column({ name: 'following_id' })
  followingId: string;

  @Column({ default: false })
  is_copying: boolean;

  @Column('decimal', { precision: 5, scale: 2, default: 1.0 })
  copy_multiplier: number;

  @CreateDateColumn()
  created_at: Date;
}
