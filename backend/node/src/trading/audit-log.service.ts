import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditLog as AuditLogEntity } from '../models/entities/AuditLog.entity';

@Injectable()
export class AuditLogService {
  private readonly logger = new Logger(AuditLogService.name);

  constructor(
    @InjectRepository(AuditLogEntity)
    private readonly auditLogRepository: Repository<AuditLogEntity>,
  ) {}

  async log(params: {
    action: string;
    actor?: string;
    ip?: string;
    userAgent?: string;
    resourceId?: string;
    details?: any;
    level?: 'INFO' | 'WARN' | 'ERROR' | 'CRITICAL';
  }) {
    try {
      // SENTINEL: Truncate metadata to prevent resource exhaustion attacks via oversized headers/metadata
      const sanitizedParams = {
        ...params,
        userAgent: params.userAgent ? params.userAgent.substring(0, 1000) : params.userAgent,
        actor: params.actor ? params.actor.substring(0, 255) : params.actor,
        ip: params.ip ? params.ip.substring(0, 45) : params.ip,
      };

      const entry = this.auditLogRepository.create({
        ...sanitizedParams,
        level: params.level || 'INFO',
        timestamp: new Date(),
      });
      await this.auditLogRepository.save(entry);
    } catch (err) {
      this.logger.error(`Failed to save audit log: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
