import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { promises as fs } from 'fs';
import * as path from 'path';
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
    let sanitizedParams: any;
    try {
      // SENTINEL: Truncate and sanitize metadata to prevent storage exhaustion and injection
      const sanitizeMeta = (str: string | undefined, max: number) =>
        str ? str.replace(/[^\x20-\x7E]/g, '').substring(0, max) : undefined;

      sanitizedParams = {
        ...params,
        actor: sanitizeMeta(params.actor, 255),
        ip: sanitizeMeta(params.ip, 45),
        userAgent: sanitizeMeta(params.userAgent, 1024),
        resourceId: sanitizeMeta(params.resourceId, 100),
        // SENTINEL: Sanitize details to prevent accidental credential leakage in audit logs
        details: params.details ? sanitize(params.details) : undefined,
      };

      const entry = this.auditLogRepository.create({
        ...sanitizedParams,
        level: params.level || 'INFO',
        timestamp: new Date(),
      });
      await this.auditLogRepository.save(entry);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Failed to save audit log: ${errMsg}`);

      // Fallback: If DB driver is disconnected (shutdown path), persist audit logs to disk
      try {
        const isDriverError = errMsg.includes('Driver not Connected') || errMsg.includes('Not connected');
        if (isDriverError) {
          const fallbackDir = path.join(process.cwd(), 'logs');
          const fallbackFile = path.join(fallbackDir, 'audit-fallback.log');
          await fs.mkdir(fallbackDir, { recursive: true });
          const line = `${new Date().toISOString()} ${JSON.stringify(sanitizedParams || params)}\n`;
          await fs.appendFile(fallbackFile, line, { encoding: 'utf8' });
          this.logger.warn(`Audit log written to fallback file: ${fallbackFile}`);
        }
      } catch (e2) {
        this.logger.error(`Failed to write audit fallback: ${e2 instanceof Error ? e2.message : String(e2)}`);
      }
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
