import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn } from 'typeorm';

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

  @Column()
  status: 'OPEN' | 'CLOSED' | 'CLOSED_SL' | 'CLOSED_TP' | 'CLOSED_SIGNAL';

  @Column({ nullable: true })
  exit_ts: Date;

  @Column('decimal', { precision: 20, scale: 8, nullable: true })
  exit_price: number;

  @Column({ nullable: true })
  exit_reason: string;

  @Column('jsonb', { default: [] })
  sl_adjustments: any[];

  @Column('decimal', { precision: 10, scale: 4, nullable: true })
  pnl_pct: number;
}
