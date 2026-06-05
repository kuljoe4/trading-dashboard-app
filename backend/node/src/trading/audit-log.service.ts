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
    resourceId?: string;
    details?: any;
    level?: 'INFO' | 'WARN' | 'ERROR' | 'CRITICAL';
  }) {
    try {
      const entry = this.auditLogRepository.create({
        ...params,
        level: params.level || 'INFO',
        timestamp: new Date(),
      });
      await this.auditLogRepository.save(entry);
    } catch (err) {
      this.logger.error(`Failed to save audit log: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
