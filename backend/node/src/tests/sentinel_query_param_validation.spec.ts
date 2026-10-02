import { BadRequestException } from "@nestjs/common";
import { SessionController, LimitPipe, SessionIdPipe, ModePipe } from "../trading/session.controller";

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
      await expect(controller.getHistory(new SessionIdPipe().transform(validUuid, { type: 'query' } as any))).resolves.not.toThrow();
      expect(mockSessionService.getHistory).toHaveBeenCalledWith(validUuid, undefined);
    });

    it("should accept 'all' as sessionId", async () => {
      await expect(controller.getHistory(new SessionIdPipe().transform("all", { type: 'query' } as any))).resolves.not.toThrow();
      expect(mockSessionService.getHistory).toHaveBeenCalledWith("all", undefined);
    });

    it("should reject non-string array sessionId query parameter", async () => {
      const invalidArray = ["123e4567-e89b-12d3-a456-426614174000", "all"] as any;
      expect(() => new SessionIdPipe().transform(invalidArray, { type: 'query' } as any)).toThrow(BadRequestException);
    });

    it("should reject non-UUID string sessionId", async () => {
      expect(() => new SessionIdPipe().transform("not-a-uuid", { type: 'query' } as any)).toThrow(BadRequestException);
    });
  });

  describe("getLifetimeAnalytics", () => {
    it("should accept valid mode strings ('paper', 'testnet', 'live')", async () => {
      await expect(controller.getLifetimeAnalytics(new ModePipe().transform("paper", { type: 'query' } as any) as any)).resolves.not.toThrow();
      await expect(controller.getLifetimeAnalytics(new ModePipe().transform("testnet", { type: 'query' } as any) as any)).resolves.not.toThrow();
      await expect(controller.getLifetimeAnalytics(new ModePipe().transform("live", { type: 'query' } as any) as any)).resolves.not.toThrow();
    });

    it("should reject array mode query parameters", async () => {
      const invalidArray = ["paper", "live"] as any;
      expect(() => new ModePipe().transform(invalidArray, { type: 'query' } as any)).toThrow(BadRequestException);
    });

    it("should reject invalid mode string", async () => {
      expect(() => new ModePipe().transform("invalid", { type: 'query' } as any)).toThrow(BadRequestException);
    });

    it("should reject mode string exceeding maximum length constraint (> 20 chars)", async () => {
      const longMode = "paper_long_invalid_string_exceeding_twenty_chars" as any;
      expect(() => new ModePipe().transform(longMode, { type: 'query' } as any)).toThrow(BadRequestException);
    });
  });

  describe("getLogs", () => {
    it("should accept undefined/omitted limit and default to 50", async () => {
      await expect(controller.getLogs(new LimitPipe(1000).transform(undefined, { type: 'query' } as any) as any)).resolves.not.toThrow();
      expect(mockSessionService.getLogs).toHaveBeenCalledWith(50);
    });

    it("should accept valid numeric limit string between 1 and 1000", async () => {
      await expect(controller.getLogs(new LimitPipe(1000).transform("100", { type: 'query' } as any) as any)).resolves.not.toThrow();
      expect(mockSessionService.getLogs).toHaveBeenCalledWith(100);
    });

    it("should reject non-string array limit query parameter to prevent HPP type confusion", async () => {
      const invalidArray = ["50", "100"] as any;
      expect(() => new LimitPipe(1000).transform(invalidArray, { type: 'query' } as any)).toThrow(BadRequestException);
    });

    it("should reject non-digit strings in limit query parameter", async () => {
      expect(() => new LimitPipe(1000).transform("50abc", { type: 'query' } as any)).toThrow(BadRequestException);
      expect(() => new LimitPipe(1000).transform("abc", { type: 'query' } as any)).toThrow(BadRequestException);
    });

    it("should reject limit string exceeding 10 characters", async () => {
      expect(() => new LimitPipe(1000).transform("100000000000", { type: 'query' } as any)).toThrow(BadRequestException);
    });

    it("should reject limit out of bounds (< 1 or > 1000)", async () => {
      expect(() => new LimitPipe(1000).transform("0", { type: 'query' } as any)).toThrow(BadRequestException);
      expect(() => new LimitPipe(1000).transform("1001", { type: 'query' } as any)).toThrow(BadRequestException);
    });
  });
});
