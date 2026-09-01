import { BadRequestException } from "@nestjs/common";
import { SessionController } from "../trading/session.controller";

describe("SessionController Query Parameter Validation", () => {
  let controller: SessionController;
  let mockSessionService: any;

  beforeEach(() => {
    mockSessionService = {
      getHistory: jest.fn().mockResolvedValue({ trades: [] }),
      getLifetimeAnalytics: jest.fn().mockResolvedValue({ totalPnl: 0 }),
    };

    const mockBacktestService: any = {
      runBacktest: jest.fn().mockResolvedValue({ totalTrades: 0 }),
    };

    controller = new SessionController(mockSessionService, mockBacktestService);
  });

  describe("getHistory", () => {
    it("should accept valid UUID sessionId", async () => {
      const validUuid = "123e4567-e89b-12d3-a456-426614174000";
      await expect(controller.getHistory(validUuid)).resolves.not.toThrow();
      expect(mockSessionService.getHistory).toHaveBeenCalledWith(validUuid);
    });

    it("should accept 'all' as sessionId", async () => {
      await expect(controller.getHistory("all")).resolves.not.toThrow();
      expect(mockSessionService.getHistory).toHaveBeenCalledWith("all");
    });

    it("should reject non-string array sessionId query parameter", async () => {
      const invalidArray = ["123e4567-e89b-12d3-a456-426614174000", "all"] as any;
      await expect(controller.getHistory(invalidArray)).rejects.toThrow(BadRequestException);
      expect(mockSessionService.getHistory).not.toHaveBeenCalled();
    });

    it("should reject non-UUID string sessionId", async () => {
      await expect(controller.getHistory("not-a-uuid")).rejects.toThrow(BadRequestException);
      expect(mockSessionService.getHistory).not.toHaveBeenCalled();
    });
  });

  describe("getLifetimeAnalytics", () => {
    it("should accept valid mode strings ('paper', 'testnet', 'live')", async () => {
      await expect(controller.getLifetimeAnalytics("paper")).resolves.not.toThrow();
      await expect(controller.getLifetimeAnalytics("testnet")).resolves.not.toThrow();
      await expect(controller.getLifetimeAnalytics("live")).resolves.not.toThrow();
    });

    it("should reject array mode query parameters", async () => {
      const invalidArray = ["paper", "live"] as any;
      await expect(controller.getLifetimeAnalytics(invalidArray)).rejects.toThrow(BadRequestException);
      expect(mockSessionService.getLifetimeAnalytics).not.toHaveBeenCalled();
    });

    it("should reject invalid mode string", async () => {
      await expect(controller.getLifetimeAnalytics("invalid" as any)).rejects.toThrow(BadRequestException);
      expect(mockSessionService.getLifetimeAnalytics).not.toHaveBeenCalled();
    });
  });
});
