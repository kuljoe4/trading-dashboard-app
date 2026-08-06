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

  @Column({ type: 'varchar', nullable: true })
  type: string | null; // e.g., 'TRADE_CLOSE', 'SESSION_STOP', 'RESET'

  @Column({ type: 'varchar', nullable: true })
  sessionId: string | null;

  @Column({ type: 'varchar', nullable: true })
  tradeId: string | null;

  @Column({ type: 'varchar', default: 'paper' })
  @Index()
  tradingMode: 'paper' | 'testnet' | 'live';
}
