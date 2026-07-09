import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn, OneToOne, JoinColumn } from 'typeorm';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  username: string;

  @Column({ nullable: true, select: false })
  password_hash: string;

  @Column({ unique: true, nullable: true })
  email: string;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}

@Entity('user_profiles')
export class UserProfile {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @OneToOne(() => User)
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ name: 'user_id' })
  userId: string;

  @Column({ default: '' })
  display_name: string;

  @Column({ nullable: true })
  avatar_url: string;

  @Column({ default: true })
  is_public: boolean;

  @Column({ default: true })
  show_pnl: boolean;

  @Column({ default: false })
  allow_copy: boolean;

  @Column({ default: 0 })
  level: number;

  @Column({ default: 0 })
  xp: number;

  @Column({ default: 0 })
  streak_days: number;

  @Column({ type: 'timestamp', nullable: true })
  last_active_at: Date;

  @Column({ type: 'jsonb', nullable: true })
  social_links: {
    twitter?: string;
    telegram?: string;
    discord?: string;
  };

  @Column({ type: 'text', nullable: true })
  bio: string;
}
