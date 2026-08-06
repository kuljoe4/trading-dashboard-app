import { Entity, Column, PrimaryColumn } from 'typeorm';

@Entity()
export class Settings {
  @PrimaryColumn({ default: 'default' })
  id: string;

  @Column({ type: 'varchar', nullable: true, select: false })
  binance_api_key: string | null;

  @Column({ type: 'varchar', nullable: true, select: false })
  binance_api_secret: string | null;

  @Column({ type: 'varchar', nullable: true, select: false })
  binance_testnet_api_key: string | null;

  @Column({ type: 'varchar', nullable: true, select: false })
  binance_testnet_api_secret: string | null;

  @Column('decimal', { precision: 20, scale: 8, default: 10000.0 })
  paper_balance: number;

  @Column('decimal', { precision: 20, scale: 8, default: 0 })
  testnet_balance: number;

  @Column('decimal', { precision: 20, scale: 8, default: 0 })
  live_balance: number;

  @Column({ type: 'jsonb', nullable: true })
  exchange_info_cache: any;

  @Column({ type: 'bigint', nullable: true })
  exchange_info_ts: number;

  @Column('decimal', { precision: 10, scale: 8, default: 0.0004 })
  taker_fee_rate: number;

  @Column({ type: 'bigint', nullable: true })
  taker_fee_ts: number;

  @Column({ type: 'bigint', nullable: true })
  api_ban_until: number | null;

  @Column({ type: 'varchar', nullable: true })
  api_ban_reason: string | null;

  @Column({ type: 'boolean', nullable: true })
  is_one_way_mode: boolean;

  @Column({ type: 'bigint', nullable: true })
  last_mode_sync: number;

  @Column({ type: 'integer', nullable: true })
  exchange_rate_limit: number;
}
