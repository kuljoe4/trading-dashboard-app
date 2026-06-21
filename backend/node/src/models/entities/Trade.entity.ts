import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn, Index } from 'typeorm';
import { Session } from './Session.entity';

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
  initial_risk_usdt: number | null;

  @Index()
  @Column()
  status: 'OPEN' | 'CLOSED' | 'CLOSED_SL' | 'CLOSED_TP' | 'CLOSED_SIGNAL' | 'CLOSED_ORPHANED';

  @Index()
  @Column({ type: 'timestamp', nullable: true })
  exit_ts: Date | null;

  @Column('decimal', { precision: 20, scale: 8, nullable: true })
  exit_price: number | null;

  @Column('decimal', { precision: 20, scale: 8, nullable: true })
  mark_price: number | null;

  @Column('decimal', { precision: 20, scale: 8, nullable: true })
  last_price: number | null;

  @Column({ type: 'varchar', nullable: true })
  exit_reason: string | null;

  @Column({ type: 'varchar', nullable: true })
  exit_signal_type: string | null;

  @Column({ type: 'varchar', nullable: true })
  exit_signal_reason: string | null;

  @Column('jsonb', { nullable: true })
  exit_signals_status: any;

  @Column({ type: 'varchar', nullable: true })
  entry_signal_type: string | null;

  @Column('decimal', { precision: 10, scale: 4, default: 0 })
  entry_signal_confidence: number;

  @Column('jsonb', { default: [] })
  sl_adjustments: any[];

  @Column('decimal', { precision: 10, scale: 4, nullable: true })
  pnl_pct: number;

  @Column('decimal', { precision: 10, scale: 4, nullable: true })
  entry_daily_change_pct: number;

  @Column({ type: 'varchar', nullable: true })
  binance_order_id: string | null;

  @Column({ type: 'varchar', nullable: true })
  binance_close_order_id: string | null;

  @Column({ type: 'varchar', nullable: true })
  binance_stop_order_id: string | null;

  @Column({ type: 'varchar', nullable: true })
  binance_stop_order_type: string | null;

  @Column({ default: false })
  is_reconciliation: boolean;

  @Column({ default: 0 })
  close_attempts: number;

  @Column('bigint', { nullable: true, transformer: {
    to: (value: number | null) => value,
    from: (value: string | null) => value ? parseInt(value, 10) : null
  }})
  last_close_attempt_ts: number;

  @Column({ default: false })
  close_blocked: boolean;

  @UpdateDateColumn()
  updated_at: Date;

  @Index()
  @Column({ type: 'varchar', nullable: true })
  sessionId: string | null;

  @Index()
  @Column({ type: 'varchar', nullable: true })
  strategy_label: string | null;

  @Column('jsonb', { nullable: true })
  strategy_config: any;

  @ManyToOne(() => Session)
  @JoinColumn({ name: 'sessionId' })
  session: Session;
}
