import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditLog as AuditLogEntity } from '../models/entities/AuditLog.entity';
import { sanitize } from '../lib/logger';

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
      // SENTINEL: Sanitize details to prevent accidental credential leakage in audit logs
      const sanitizedParams = {
        ...params,
        details: params.details ? sanitize(params.details) : undefined,
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

  /**
   * SENTINEL: Remove old audit logs to prevent storage exhaustion.
   * Defaults to 90 days of retention.
   */
  async cleanup(days = 90) {
    try {
      const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
      const result = await this.auditLogRepository
        .createQueryBuilder()
        .delete()
        .where("timestamp < :cutoff", { cutoff })
        .execute();

      if (result.affected && result.affected > 0) {
        this.logger.log(`Audit log cleanup: removed ${result.affected} entries older than ${days} days.`);
      }
      return result.affected || 0;
    } catch (err) {
      this.logger.error(`Failed to cleanup audit logs: ${err instanceof Error ? err.message : String(err)}`);
      return 0;
    }
  }
}
