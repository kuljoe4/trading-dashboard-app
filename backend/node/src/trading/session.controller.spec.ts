import { Test, TestingModule } from "@nestjs/testing";
import { SessionController } from "./session.controller";
import { SessionService } from "./session.service";
import { ConfigService } from "@nestjs/config";
import { BadRequestException } from "@nestjs/common";

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
            getTrade: jest.fn(),
            getHistory: jest.fn(),
            getLifetimeAnalytics: jest.fn(),
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
});
