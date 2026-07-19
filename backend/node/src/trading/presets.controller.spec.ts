import { Test, TestingModule } from "@nestjs/testing";
import { getRepositoryToken } from "@nestjs/typeorm";
import { ConfigService } from "@nestjs/config";
import { PresetsController } from "./presets.controller";
import { StrategyPreset } from "../models/entities/StrategyPreset.entity";
import { AuditLogService } from "./audit-log.service";
import { NotFoundException, BadRequestException } from "@nestjs/common";
import { SessionConfig } from "../models/SessionConfig";

describe("PresetsController", () => {
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

  it("should be defined", () => {
    expect(controller).toBeDefined();
  });

  describe("listPresets", () => {
    it("should return an array of presets", async () => {
      const result = [{ name: "test" }];
      repo.find.mockResolvedValue(result);
      expect(await controller.listPresets()).toBe(result);
      expect(repo.find).toHaveBeenCalledWith({ order: { name: "ASC" } });
    });
  });

  describe("savePreset", () => {
    it("should update existing preset", async () => {
      const dto = { name: "test", config: new SessionConfig() };
      const existing = { name: "test", config: {} };
      repo.findOne.mockResolvedValue(existing);

      const req = { ip: "127.0.0.1", headers: {} } as any;
      await controller.savePreset(dto as any, req);

      expect(existing.config).toEqual(dto.config);
      expect(repo.save).toHaveBeenCalledWith(existing);
    });

    it("should create new preset if not exists", async () => {
      const dto = { name: "new", config: new SessionConfig() };
      repo.findOne.mockResolvedValue(null);
      repo.create.mockReturnValue(dto);

      const req = { ip: "127.0.0.1", headers: {} } as any;
      await controller.savePreset(dto as any, req);

      expect(repo.create).toHaveBeenCalledWith({
        name: dto.name,
        config: dto.config,
      });
      expect(repo.save).toHaveBeenCalled();
    });

    it("should throw BadRequestException if config is invalid", async () => {
      const dto = { name: "invalid", config: { scan_pct_threshold: -10 } }; // Violated Min(0)
      repo.findOne.mockResolvedValue(null);

      const req = { ip: "127.0.0.1", headers: {} } as any;
      await expect(controller.savePreset(dto as any, req)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe("deletePreset", () => {
    it("should remove preset", async () => {
      const existing = { name: "test" };
      repo.findOne.mockResolvedValue(existing);

      const req = { ip: "127.0.0.1", headers: {} } as any;
      await controller.deletePreset("test", req);

      expect(repo.remove).toHaveBeenCalledWith(existing);
    });

    it("should throw NotFoundException if preset not found", async () => {
      repo.findOne.mockResolvedValue(null);
      const req = { ip: "127.0.0.1", headers: {} } as any;
      await expect(controller.deletePreset("test", req)).rejects.toThrow(
        NotFoundException,
      );
    });

    it("should throw BadRequestException if preset name is too long", async () => {
      const tooLongName = "A".repeat(101);
      const req = { ip: "127.0.0.1", headers: {} } as any;
      await expect(controller.deletePreset(tooLongName, req)).rejects.toThrow(
        BadRequestException,
      );
    });

    it("should throw BadRequestException if preset name is empty", async () => {
      const req = { ip: "127.0.0.1", headers: {} } as any;
      await expect(controller.deletePreset("", req)).rejects.toThrow(
        BadRequestException,
      );
      await expect(controller.deletePreset("   ", req)).rejects.toThrow(
        BadRequestException,
      );
    });

    it("should throw BadRequestException if preset name contains invalid characters", async () => {
      const req = { ip: "127.0.0.1", headers: {} } as any;
      const maliciousNames = [
        "../test",
        "test; DROP TABLE StrategyPreset;",
        "test<script>alert(1)</script>",
        "test\0",
        "test/../../"
      ];
      for (const name of maliciousNames) {
        await expect(controller.deletePreset(name, req)).rejects.toThrow(
          BadRequestException,
        );
      }
    });
  });

  describe("CreateStrategyPresetDto Validation", () => {
    const { validate } = require("class-validator");
    const { CreateStrategyPresetDto } = require("./dto/strategy-preset.dto");

    it("should fail validation if preset name has invalid characters", async () => {
      const dto = new CreateStrategyPresetDto();
      dto.name = "malicious<script>";
      dto.config = new SessionConfig();

      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].constraints).toHaveProperty("matches");
    });

    it("should pass validation if preset name is valid", async () => {
      const dto = new CreateStrategyPresetDto();
      dto.name = "Valid Preset Name - 1.2";
      dto.config = new SessionConfig();

      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    });
  });
});
