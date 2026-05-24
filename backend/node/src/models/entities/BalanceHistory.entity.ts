import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, Index } from 'typeorm';

@Entity()
export class BalanceHistory {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @CreateDateColumn()
  @Index()
  timestamp: Date;

  @Column('decimal', { precision: 20, scale: 8 })
  balance: number;

  @Column('decimal', { precision: 20, scale: 8, default: 0 })
  pnl: number;

  @Column({ nullable: true })
  type: string; // e.g., 'TRADE_CLOSE', 'SESSION_STOP', 'RESET'

  @Column({ nullable: true })
  sessionId: string;

  @Column({ nullable: true })
  tradeId: string;

  @Column({ type: 'varchar', default: 'paper' })
  @Index()
  tradingMode: 'paper' | 'testnet' | 'live';
}
