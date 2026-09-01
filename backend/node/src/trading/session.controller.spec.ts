import { Test, TestingModule } from "@nestjs/testing";
import { SessionController } from "./session.controller";
import { SessionService } from "./session.service";
import { BacktestService } from "../engine/backtest.service";
import { ConfigService } from "@nestjs/config";
import { BadRequestException } from "@nestjs/common";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { UpdateSessionDto } from "./dto/session.dto";

describe("SessionController", () => {
  let controller: SessionController;
  let sessionService: SessionService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [SessionController],
      providers: [
        {
          provide: SessionService,
          useValue: {
            startSession: jest.fn().mockResolvedValue({ id: 'test-session-id' }),
            getTrade: jest.fn(),
            getHistory: jest.fn(),
            getLifetimeAnalytics: jest.fn(),
          },
        },
        {
          provide: BacktestService,
          useValue: {
            runBacktest: jest.fn().mockResolvedValue({ totalTrades: 0 }),
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockReturnValue("test-key"),
          },
        },
        {
          provide: "AuditLogService",
          useValue: {},
        },
      ],
    }).compile();

    controller = module.get<SessionController>(SessionController);
    sessionService = module.get<SessionService>(SessionService);
    jest.clearAllMocks();
  });

  describe("startSession", () => {
    it("should instantiate SessionConfig with plainToInstance when sessionId is provided", async () => {
      const mockReq = { ip: "127.0.0.1", headers: {} } as any;
      const rawConfig = { strategy_label: "Custom Strategy", scan_interval: "15m" };
      const sessionId = "550e8400-e29b-41d4-a716-446655440000";

      await controller.startSession(
        { config: rawConfig as any, paper_mode: true, sessionId },
        mockReq,
      );

      expect(sessionService.startSession).toHaveBeenCalledTimes(1);
      const [passedConfig, passedPaperMode, passedSessionId, passedIp] = (
        sessionService.startSession as jest.Mock
      ).mock.calls[0];

      expect(passedConfig.constructor.name).toBe("SessionConfig");
      expect(passedConfig.strategy_label).toBe("Custom Strategy");
      expect(passedConfig.scan_interval).toBe("15m");
      expect(passedPaperMode).toBe(true);
      expect(passedSessionId).toBe(sessionId);
      expect(passedIp).toBe("127.0.0.1");
    });

    it("should instantiate SessionConfig with plainToInstance when sessionId is not provided", async () => {
      const mockReq = { ip: "127.0.0.1", headers: {} } as any;
      const rawConfig = { strategy_label: "Default Strategy" };

      await controller.startSession(
        { config: rawConfig as any, paper_mode: false },
        mockReq,
      );

      expect(sessionService.startSession).toHaveBeenCalledTimes(1);
      const [passedConfig, passedPaperMode, passedSessionId] = (
        sessionService.startSession as jest.Mock
      ).mock.calls[0];

      expect(passedConfig.constructor.name).toBe("SessionConfig");
      expect(passedConfig.strategy_label).toBe("Default Strategy");
      expect(passedPaperMode).toBe(false);
      expect(passedSessionId).toBeUndefined();
    });
  });

  describe("getHistory", () => {
    it("should allow undefined/no sessionId", async () => {
      await controller.getHistory(undefined);
      expect(sessionService.getHistory).toHaveBeenCalledWith(undefined);
    });

    it('should allow "all"', async () => {
      await controller.getHistory("all");
      expect(sessionService.getHistory).toHaveBeenCalledWith("all");
    });

    it("should allow valid UUID", async () => {
      const uuid = "550e8400-e29b-41d4-a716-446655440000";
      await controller.getHistory(uuid);
      expect(sessionService.getHistory).toHaveBeenCalledWith(uuid);
    });

    it("should reject invalid sessionId format", async () => {
      await expect(controller.getHistory("invalid_session_id")).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe("getLifetimeAnalytics", () => {
    it("should allow valid modes", async () => {
      await controller.getLifetimeAnalytics("paper");
      expect(sessionService.getLifetimeAnalytics).toHaveBeenCalledWith("paper");

      await controller.getLifetimeAnalytics("testnet");
      expect(sessionService.getLifetimeAnalytics).toHaveBeenCalledWith(
        "testnet",
      );

      await controller.getLifetimeAnalytics("live");
      expect(sessionService.getLifetimeAnalytics).toHaveBeenCalledWith("live");
    });

    it("should allow undefined mode and fallback to paper", async () => {
      await controller.getLifetimeAnalytics(undefined as any);
      expect(sessionService.getLifetimeAnalytics).toHaveBeenCalledWith("paper");
    });

    it("should reject invalid mode", async () => {
      await expect(
        controller.getLifetimeAnalytics("invalid_mode" as any),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe("getTrade", () => {
    it("should allow valid UUID", async () => {
      const uuid = "550e8400-e29b-41d4-a716-446655440000";
      await controller.getTrade(uuid);
      expect(sessionService.getTrade).toHaveBeenCalledWith(uuid);
    });

    it("should allow UUID v7", async () => {
      const uuidV7 = "018f4a0a-6e3e-72c3-8e1a-56789abcdef0";
      await controller.getTrade(uuidV7);
      expect(sessionService.getTrade).toHaveBeenCalledWith(uuidV7);
    });

    it("should allow valid Binance symbol", async () => {
      const symbol = "BTCUSDT";
      await controller.getTrade(symbol);
      expect(sessionService.getTrade).toHaveBeenCalledWith(symbol);
    });

    it("should throw BadRequestException for invalid format", async () => {
      const invalid = "invalid_format!";
      await expect(controller.getTrade(invalid)).rejects.toThrow(
        BadRequestException,
      );
    });

    it("should throw BadRequestException for overly long input", async () => {
      const longInput = "A".repeat(50);
      await expect(controller.getTrade(longInput)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe("UpdateSessionDto Validation", () => {
    it("should pass validation for valid nested config", async () => {
      const dto = plainToInstance(UpdateSessionDto, {
        config: {
          strategy_label: "Safe Strategy",
          scan_interval: "5m",
        },
      });
      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    });

    it("should reject nested config containing XSS in strategy_label", async () => {
      const dto = plainToInstance(UpdateSessionDto, {
        config: {
          strategy_label: "<script>alert('xss')</script>",
        },
      });
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      expect(JSON.stringify(errors)).toContain("Strategy label");
    });

    it("should reject nested config containing invalid scan_interval", async () => {
      const dto = plainToInstance(UpdateSessionDto, {
        config: {
          scan_interval: "invalid_interval",
        },
      });
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      expect(JSON.stringify(errors)).toContain("scan_interval must be a valid Binance kline interval");
    });
  });
});
