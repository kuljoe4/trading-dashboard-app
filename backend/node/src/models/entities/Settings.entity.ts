import { Entity, Column, PrimaryColumn } from 'typeorm';

@Entity()
export class Settings {
  @PrimaryColumn({ default: 'default' })
  id: string;

  @Column({ nullable: true, select: false })
  binance_api_key: string;

  @Column({ nullable: true, select: false })
  binance_api_secret: string;

  @Column({ nullable: true, select: false })
  binance_testnet_api_key: string;

  @Column({ nullable: true, select: false })
  binance_testnet_api_secret: string;

  @Column('decimal', { precision: 20, scale: 8, default: 10000.0 })
  paper_balance: number;

  @Column('decimal', { precision: 20, scale: 8, default: 0 })
  testnet_balance: number;

  @Column('decimal', { precision: 20, scale: 8, default: 0 })
  live_balance: number;
}
