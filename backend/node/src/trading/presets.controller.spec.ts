import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { PresetsController } from './presets.controller';
import { StrategyPreset } from '../models/entities/StrategyPreset.entity';
import { AuditLogService } from './audit-log.service';
import { NotFoundException } from '@nestjs/common';

describe('PresetsController', () => {
  let controller: PresetsController;
  let repo: any;
  let auditLog: any;

  const mockRepo = {
    find: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    remove: jest.fn(),
  };

  const mockAuditLog = {
    log: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [PresetsController],
      providers: [
        {
          provide: getRepositoryToken(StrategyPreset),
          useValue: mockRepo,
        },
        {
          provide: AuditLogService,
          useValue: mockAuditLog,
        },
        {
          provide: ConfigService,
          useValue: { get: jest.fn() },
        },
      ],
    }).compile();

    controller = module.get<PresetsController>(PresetsController);
    repo = module.get(getRepositoryToken(StrategyPreset));
    auditLog = module.get(AuditLogService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('listPresets', () => {
    it('should return an array of presets', async () => {
      const result = [{ name: 'test' }];
      repo.find.mockResolvedValue(result);
      expect(await controller.listPresets()).toBe(result);
      expect(repo.find).toHaveBeenCalledWith({ order: { name: 'ASC' } });
    });
  });

  describe('savePreset', () => {
    it('should update existing preset', async () => {
      const dto = { name: 'test', config: { a: 1 } };
      const existing = { name: 'test', config: {} };
      repo.findOne.mockResolvedValue(existing);

      const req = { ip: '127.0.0.1', headers: {} } as any;
      await controller.savePreset(dto, req);

      expect(existing.config).toEqual(dto.config);
      expect(repo.save).toHaveBeenCalledWith(existing);
    });

    it('should create new preset if not exists', async () => {
      const dto = { name: 'new', config: { a: 1 } };
      repo.findOne.mockResolvedValue(null);
      repo.create.mockReturnValue(dto);

      const req = { ip: '127.0.0.1', headers: {} } as any;
      await controller.savePreset(dto, req);

      expect(repo.create).toHaveBeenCalledWith({ name: dto.name, config: dto.config });
      expect(repo.save).toHaveBeenCalled();
    });
  });

  describe('deletePreset', () => {
    it('should remove preset', async () => {
      const existing = { name: 'test' };
      repo.findOne.mockResolvedValue(existing);

      const req = { ip: '127.0.0.1', headers: {} } as any;
      await controller.deletePreset('test', req);

      expect(repo.remove).toHaveBeenCalledWith(existing);
    });

    it('should throw NotFoundException if preset not found', async () => {
      repo.findOne.mockResolvedValue(null);
      const req = { ip: '127.0.0.1', headers: {} } as any;
      await expect(controller.deletePreset('test', req)).rejects.toThrow(NotFoundException);
    });
  });
});
