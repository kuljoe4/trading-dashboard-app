import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, Index } from 'typeorm';

@Entity('audit_logs')
export class AuditLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @CreateDateColumn()
  @Index()
  timestamp: Date;

  @Column({ type: 'varchar', length: 50 })
  @Index()
  action: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  actor: string | null; // e.g., IP address or 'SYSTEM'

  @Column({ type: 'varchar', length: 45, nullable: true })
  ip: string | null;

  @Column({ type: 'text', nullable: true })
  userAgent: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  @Index()
  resourceId: string | null; // e.g., Trade ID, Session ID

  @Column({ type: 'jsonb', nullable: true })
  details: any | null;

  @Column({ type: 'varchar', length: 20, default: 'INFO' })
  level: string; // INFO, WARN, ERROR, CRITICAL
}
