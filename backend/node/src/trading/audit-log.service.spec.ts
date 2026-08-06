import { AuditLogService } from './audit-log.service';
import { promises as fs } from 'fs';
import { AuditLog as AuditLogEntity } from '../models/entities/AuditLog.entity';

describe('AuditLogService', () => {
  let service: AuditLogService;
  const mockRepository: any = {
    create: jest.fn((entry) => entry),
    save: jest.fn(),
  };

  const mkdirSpy = jest.spyOn(fs, 'mkdir');
  const appendFileSpy = jest.spyOn(fs, 'appendFile');

  beforeEach(() => {
    jest.clearAllMocks();
    mockRepository.create.mockImplementation((entry: any) => entry);
    service = new AuditLogService(mockRepository as any);
  });

  it('saves audit entry using the repository when DB is connected', async () => {
    mockRepository.save.mockResolvedValue({});

    await service.log({
      action: 'TEST_ACTION',
      actor: 'tester',
      details: { foo: 'bar' },
    });

    expect(mockRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'TEST_ACTION',
        actor: 'tester',
        level: 'INFO',
      }),
    );
    expect(mockRepository.save).toHaveBeenCalledTimes(1);
    expect(mkdirSpy).not.toHaveBeenCalled();
    expect(appendFileSpy).not.toHaveBeenCalled();
  });

  it('writes an audit fallback file when the DB driver is disconnected', async () => {
    mockRepository.save.mockRejectedValue(new Error('Driver not Connected'));
    mkdirSpy.mockResolvedValue(undefined as any);
    appendFileSpy.mockResolvedValue(undefined as any);

    await service.log({
      action: 'FAILOVER_ACTION',
      actor: 'tester',
      details: { secret: 'value' },
      level: 'ERROR',
    });

    expect(mockRepository.save).toHaveBeenCalledTimes(1);
    expect(mkdirSpy).toHaveBeenCalledWith(expect.any(String), { recursive: true });
    expect(appendFileSpy).toHaveBeenCalledWith(
      expect.stringContaining('logs/audit-fallback.log'),
      expect.stringContaining('FAILOVER_ACTION'),
      { encoding: 'utf8' },
    );
  });

  it('returns 0 and logs errors when cleanup cannot run', async () => {
    const queryBuilder: any = {
      delete: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      execute: jest.fn().mockRejectedValue(new Error('Database offline')),
    };

    mockRepository.createQueryBuilder = jest.fn().mockReturnValue(queryBuilder);

    const result = await service.cleanup(30);

    expect(result).toBe(0);
    expect(mockRepository.createQueryBuilder).toHaveBeenCalled();
    expect(queryBuilder.execute).toHaveBeenCalled();
  });

  it('handles array inputs for metadata fields gracefully', async () => {
    mockRepository.save.mockResolvedValue({});

    await service.log({
      action: 'ARRAY_INPUT_TEST',
      userAgent: ['Mozilla/5.0', 'Extra Info'] as any,
      actor: ['actor1', 'actor2'] as any,
    });

    expect(mockRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'ARRAY_INPUT_TEST',
        userAgent: expect.stringContaining('Mozilla/5.0'),
        actor: expect.stringContaining('actor1'),
      }),
    );
  });
});
