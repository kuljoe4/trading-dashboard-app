import { Controller, Post, Body, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { ApiKeyGuard } from '../lib/api-key.guard';
import { AuditLogService } from './audit-log.service';
import { extractIp } from '../lib/throttle';

@Controller('telemetry')
@UseGuards(ApiKeyGuard)
export class TelemetryController {
  constructor(private readonly auditLog: AuditLogService) {}

  @Post('event')
  async trackEvent(@Body() body: { event: string; details?: any; resourceId?: string }, @Req() req: Request) {
    const clientIp = req.ip || extractIp(req.headers, req.socket?.remoteAddress || 'unknown');
    const userAgent = req.headers['user-agent'];

    // We use the AuditLogService to persist behavioral telemetry
    // This allows us to reuse the existing infrastructure for storage and cleanup
    await this.auditLog.log({
      action: `TELEMETRY_${body.event.toUpperCase()}`,
      actor: clientIp,
      ip: clientIp,
      userAgent,
      resourceId: body.resourceId,
      details: body.details,
      level: 'INFO',
    });

    return { success: true };
  }
}
