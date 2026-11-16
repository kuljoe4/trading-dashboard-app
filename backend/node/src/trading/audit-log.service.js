var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
var AuditLogService_1;
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { promises as fs } from 'fs';
import * as path from 'path';
import { AuditLog as AuditLogEntity } from '../models/entities/AuditLog.entity';
import { sanitize } from '../lib/logger';
let AuditLogService = AuditLogService_1 = class AuditLogService {
    auditLogRepository;
    logger = new Logger(AuditLogService_1.name);
    constructor(auditLogRepository) {
        this.auditLogRepository = auditLogRepository;
    }
    async log(params) {
        let sanitizedParams;
        try {
            // SENTINEL: Truncate and sanitize metadata to prevent storage exhaustion and injection.
            // Robustly handles array inputs (e.g. from multi-value headers) by joining them.
            const sanitizeMeta = (val, max) => {
                if (!val)
                    return undefined;
                const str = Array.isArray(val) ? val.join(', ') : String(val);
                return str.replace(/[^\x20-\x7E]/g, '').substring(0, max);
            };
            sanitizedParams = {
                ...params,
                actor: sanitizeMeta(params.actor, 255),
                ip: sanitizeMeta(params.ip, 45),
                userAgent: sanitizeMeta(params.userAgent, 1024),
                resourceId: sanitizeMeta(params.resourceId, 100),
                // SENTINEL: Sanitize details to prevent accidental credential leakage in audit logs
                details: params.details ? sanitize(params.details) : undefined,
            };
            // SENTINEL: Strictly sanitize and validate level to prevent TypeORM database column overflows.
            const sanitizedLevel = params.level && typeof params.level === 'string' && /^[A-Z]{3,20}$/.test(params.level)
                ? params.level
                : 'INFO';
            const entry = this.auditLogRepository.create({
                ...sanitizedParams,
                level: sanitizedLevel,
                timestamp: new Date(),
            });
            await this.auditLogRepository.save(entry);
        }
        catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            // Fallback: If DB driver is disconnected (shutdown path), persist audit logs to disk silently
            const isDriverError = errMsg.includes('Driver not Connected') || errMsg.includes('Not connected');
            if (!isDriverError) {
                this.logger.error(`Failed to save audit log: ${errMsg}`);
            }
            try {
                // SENTINEL: Ensure fallback log is sanitized even if the main try block failed partially.
                // We prioritize sanitizing 'details' to prevent credential leakage.
                const fallbackData = sanitizedParams || {
                    ...params,
                    details: params.details ? sanitize(params.details) : undefined
                };
                if (isDriverError) {
                    let fallbackDir = path.join(process.cwd(), 'logs');
                    let fallbackFile = path.join(fallbackDir, 'audit-fallback.log');
                    try {
                        await fs.mkdir(fallbackDir, { recursive: true });
                    }
                    catch (mkdirErr) {
                        if (mkdirErr.code === 'EACCES') {
                            fallbackDir = path.join('/tmp', 'logs');
                            fallbackFile = path.join(fallbackDir, 'audit-fallback.log');
                            await fs.mkdir(fallbackDir, { recursive: true });
                        }
                        else {
                            throw mkdirErr;
                        }
                    }
                    const line = `${new Date().toISOString()} ${JSON.stringify(fallbackData)}\n`;
                    await fs.appendFile(fallbackFile, line, { encoding: 'utf8' });
                    this.logger.warn(`Audit log written to fallback file: ${fallbackFile}`);
                }
            }
            catch (e2) {
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
        }
        catch (err) {
            this.logger.error(`Failed to cleanup audit logs: ${err instanceof Error ? err.message : String(err)}`);
            return 0;
        }
    }
};
AuditLogService = AuditLogService_1 = __decorate([
    Injectable(),
    __param(0, InjectRepository(AuditLogEntity)),
    __metadata("design:paramtypes", [Repository])
], AuditLogService);
export { AuditLogService };
