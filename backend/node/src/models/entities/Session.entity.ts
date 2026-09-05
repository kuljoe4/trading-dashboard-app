import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, OneToMany } from 'typeorm';
import { TradeEntity } from './Trade.entity';

@Entity()
export class Session {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ default: true })
  running: boolean;

  @Column({ default: true })
  paperMode: boolean;

  @Column({ type: 'varchar', default: 'paper' })
  tradingMode: 'paper' | 'testnet' | 'live' | 'backtest';

  @Column('decimal', { precision: 20, scale: 8, default: 0 })
  balance: number;

  @Column('decimal', { precision: 20, scale: 8, default: 0 })
  totalPnl: number;

  @Column({ type: 'varchar', nullable: true })
  strategyLabel: string | null;

  @CreateDateColumn()
  startTime: Date;

  @Column({ type: 'timestamp', nullable: true })
  endTime: Date | null;

  @Column('jsonb', { nullable: true })
  config: any | null;

  @OneToMany(() => TradeEntity, (trade) => trade.session)
  trades: TradeEntity[];
}
