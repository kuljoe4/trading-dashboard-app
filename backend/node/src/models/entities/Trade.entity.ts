import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, ManyToOne, JoinColumn, Index } from 'typeorm';
import { Session } from './Session.entity';

export const TERMINAL_STATUSES = ['CLOSED', 'CLOSED_SL', 'CLOSED_TP', 'CLOSED_SIGNAL', 'CLOSED_ORPHANED'] as const;

@Entity()
export class TradeEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  symbol: string;

  @Column()
  direction: 'LONG' | 'SHORT';

  @Column('decimal', { precision: 20, scale: 8 })
  entry_price: number;

  @Column('decimal', { precision: 20, scale: 8 })
  qty: number;

  @Column('decimal', { precision: 20, scale: 8 })
  initial_sl: number;

  @Column('decimal', { precision: 20, scale: 8 })
  current_sl: number;

  @Column('decimal', { precision: 20, scale: 8, default: 0 })
  max_rr_achieved: number;

  @Column({ default: 0 })
  rr_sequence_index: number;

  @CreateDateColumn()
  entry_ts: Date;

  @Column('decimal', { precision: 20, scale: 8, nullable: true })
  tp: number | null;

  @Column('decimal', { precision: 20, scale: 8, default: 0 })
  pnl: number;

  @Column('decimal', { precision: 20, scale: 8, default: 0 })
  realized_fee: number;

  @Column('decimal', { precision: 20, scale: 8, default: 0 })
  funding_fee: number;

  @Column('decimal', { precision: 20, scale: 8, default: 0 })
  risk_usdt: number;

  @Column('decimal', { precision: 20, scale: 8, nullable: true })
  initial_risk_usdt: number;

  @Index()
  @Column()
  status: 'OPEN' | 'CLOSED' | 'CLOSED_SL' | 'CLOSED_TP' | 'CLOSED_SIGNAL' | 'CLOSED_ORPHANED';

  @Index()
  @Column({ nullable: true })
  exit_ts: Date;

  @Column('decimal', { precision: 20, scale: 8, nullable: true })
  exit_price: number;

  @Column({ nullable: true })
  exit_reason: string;

  @Column({ nullable: true })
  exit_signal_type: string;

  @Column({ nullable: true })
  exit_signal_reason: string;

  @Column('jsonb', { default: [] })
  sl_adjustments: any[];

  @Column('decimal', { precision: 10, scale: 4, nullable: true })
  pnl_pct: number;

  @Column({ nullable: true })
  binance_order_id: string;

  @Column({ nullable: true })
  binance_close_order_id: string;

  @Column({ nullable: true })
  binance_stop_order_id: string;

  @Column({ nullable: true })
  binance_stop_order_type: 'standard' | 'algo';

  @Column('decimal', { precision: 10, scale: 4, nullable: true })
  entry_daily_change_pct: number;

  @Index()
  @Column({ nullable: true })
  sessionId: string;

  @Index()
  @Column({ nullable: true })
  strategy_label: string;

  @Column('jsonb', { nullable: true })
  strategy_config: any;

  @Column({ default: false })
  is_reconciliation: boolean;

  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP', onUpdate: 'CURRENT_TIMESTAMP' })
  updated_at: Date;

  @ManyToOne(() => Session)
  @JoinColumn({ name: 'sessionId' })
  session: Session;
}
