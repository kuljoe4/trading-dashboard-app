import { Entity, Column, PrimaryColumn } from 'typeorm';

@Entity()
export class Settings {
  @PrimaryColumn({ default: 'default' })
  id: string;

  @Column({ nullable: true })
  binance_api_key: string;

  @Column({ nullable: true })
  binance_api_secret: string;
}
