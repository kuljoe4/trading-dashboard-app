import { Entity, Column, PrimaryColumn, Index } from 'typeorm';

@Entity('klines')
@Index(['symbol', 'interval', 'time'], { unique: true })
export class Kline {
  @PrimaryColumn()
  id: string; // symbol_interval_time

  @Column()
  @Index()
  symbol: string;

  @Column()
  @Index()
  interval: string;

  @Column({ type: 'bigint' })
  @Index()
  time: number;

  @Column({ type: 'numeric', precision: 20, scale: 8 })
  open: number;

  @Column({ type: 'numeric', precision: 20, scale: 8 })
  high: number;

  @Column({ type: 'numeric', precision: 20, scale: 8 })
  low: number;

  @Column({ type: 'numeric', precision: 20, scale: 8 })
  close: number;

  @Column({ type: 'numeric', precision: 20, scale: 8 })
  volume: number;
}
