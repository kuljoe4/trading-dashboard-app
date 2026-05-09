import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn } from 'typeorm';

@Entity()
export class Session {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ default: true })
  running: boolean;

  @Column({ default: true })
  paperMode: boolean;

  @Column('decimal', { precision: 20, scale: 8, default: 0 })
  balance: number;

  @Column('decimal', { precision: 20, scale: 8, default: 0 })
  totalPnl: number;

  @CreateDateColumn()
  startTime: Date;

  @Column('jsonb', { nullable: true })
  config: any;

  @Column('jsonb', { default: [] })
  logLines: any[];
}
