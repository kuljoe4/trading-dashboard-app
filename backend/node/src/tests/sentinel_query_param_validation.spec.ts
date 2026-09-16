import { BadRequestException } from "@nestjs/common";
import { SessionController } from "../trading/session.controller";

describe("SessionController Query Parameter Validation", () => {
  let controller: SessionController;
  let mockSessionService: any;

  beforeEach(() => {
    mockSessionService = {
      getHistory: jest.fn().mockResolvedValue({ trades: [] }),
      getLogs: jest.fn().mockResolvedValue([]),
      getLifetimeAnalytics: jest.fn().mockResolvedValue({ totalPnl: 0 }),
    };

    const mockBacktestService: any = {
      runBacktest: jest.fn().mockResolvedValue({ totalTrades: 0 }),
    };

    const mockSmartOptimizerService: any = {
      getTopRecommendations: jest.fn().mockReturnValue([]),
      clearRecommendations: jest.fn(),
      runOptimization: jest.fn(),
    };

    controller = new SessionController(mockSessionService, mockBacktestService, mockSmartOptimizerService);
  });

  describe("getHistory", () => {
    it("should accept valid UUID sessionId", async () => {
      const validUuid = "123e4567-e89b-12d3-a456-426614174000";
      await expect(controller.getHistory(validUuid)).resolves.not.toThrow();
      expect(mockSessionService.getHistory).toHaveBeenCalledWith(validUuid, undefined);
    });

    it("should accept 'all' as sessionId", async () => {
      await expect(controller.getHistory("all")).resolves.not.toThrow();
      expect(mockSessionService.getHistory).toHaveBeenCalledWith("all", undefined);
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

    it("should reject mode string exceeding maximum length constraint (> 20 chars)", async () => {
      const longMode = "paper_long_invalid_string_exceeding_twenty_chars" as any;
      await expect(controller.getLifetimeAnalytics(longMode)).rejects.toThrow(BadRequestException);
      expect(mockSessionService.getLifetimeAnalytics).not.toHaveBeenCalled();
    });
  });

  describe("getLogs", () => {
    it("should accept undefined/omitted limit and default to 50", async () => {
      await expect(controller.getLogs()).resolves.not.toThrow();
      expect(mockSessionService.getLogs).toHaveBeenCalledWith(50);
    });

    it("should accept valid numeric limit string between 1 and 1000", async () => {
      await expect(controller.getLogs("100")).resolves.not.toThrow();
      expect(mockSessionService.getLogs).toHaveBeenCalledWith(100);
    });

    it("should reject non-string array limit query parameter to prevent HPP type confusion", async () => {
      const invalidArray = ["50", "100"] as any;
      await expect(controller.getLogs(invalidArray)).rejects.toThrow(BadRequestException);
      expect(mockSessionService.getLogs).not.toHaveBeenCalled();
    });

    it("should reject non-digit strings in limit query parameter", async () => {
      await expect(controller.getLogs("50abc")).rejects.toThrow(BadRequestException);
      await expect(controller.getLogs("abc")).rejects.toThrow(BadRequestException);
      expect(mockSessionService.getLogs).not.toHaveBeenCalled();
    });

    it("should reject limit string exceeding 10 characters", async () => {
      await expect(controller.getLogs("100000000000")).rejects.toThrow(BadRequestException);
      expect(mockSessionService.getLogs).not.toHaveBeenCalled();
    });

    it("should reject limit out of bounds (< 1 or > 1000)", async () => {
      await expect(controller.getLogs("0")).rejects.toThrow(BadRequestException);
      await expect(controller.getLogs("1001")).rejects.toThrow(BadRequestException);
      expect(mockSessionService.getLogs).not.toHaveBeenCalled();
    });
  });
});
