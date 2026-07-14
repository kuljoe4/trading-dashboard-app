import { Test, TestingModule } from '@nestjs/testing';
import { AuditLogService } from '../trading/audit-log.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AuditLog as AuditLogEntity } from '../models/entities/AuditLog.entity';
import { sanitize } from '../lib/logger';

describe('Sentinel: Metadata Security', () => {
  let auditLogService: AuditLogService;
  let mockRepo: any;

  beforeEach(async () => {
    mockRepo = {
      create: jest.fn().mockImplementation(dto => dto),
      save: jest.fn().mockResolvedValue({}),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuditLogService,
        {
          provide: getRepositoryToken(AuditLogEntity),
          useValue: mockRepo,
        },
      ],
    }).compile();

    auditLogService = module.get<AuditLogService>(AuditLogService);
  });

  it('should truncate and sanitize audit log metadata', async () => {
    const oversizedUA = 'A'.repeat(2000);
    const malformedActor = 'attacker\n\r\x00<script>';

    await auditLogService.log({
      action: 'TEST',
      actor: malformedActor,
      userAgent: oversizedUA,
      resourceId: 'B'.repeat(200)
    });

    const call = mockRepo.create.mock.calls[0][0];

    // Truncation
    expect(call.userAgent.length).toBe(1024);
    expect(call.resourceId.length).toBe(100);

    // Sanitization (ASCII printables only)
    expect(call.actor).not.toContain('\n');
    expect(call.actor).not.toContain('\r');
    expect(call.actor).not.toContain('\x00');
    expect(call.actor).toBe('attacker<script>');
  });

  it('sanitize utility should truncate long strings', () => {
    const longString = 'C'.repeat(5000);
    const sanitized = sanitize(longString);
    expect(sanitized.length).toBeLessThan(5000);
    expect(sanitized).toContain('... [truncated]');
  });

  it('sanitize utility should truncate long strings in objects', () => {
    const obj = {
      msg: 'D'.repeat(5000),
      nested: {
        val: 'E'.repeat(6000)
      }
    };
    const sanitized = sanitize(obj);
    expect(sanitized.msg.length).toBeLessThan(5000);
    expect(sanitized.nested.val.length).toBeLessThan(6000);
    expect(sanitized.msg).toContain('... [truncated]');
    expect(sanitized.nested.val).toContain('... [truncated]');
  });
});
