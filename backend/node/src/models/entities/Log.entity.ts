import { Entity, Column, PrimaryGeneratedColumn, Index } from 'typeorm';

@Entity()
export class Log {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  sessionId: string;

  @Index()
  @Column()
  ts: string;

  @Column()
  level: string;

  @Column('text')
  msg: string;
}
