import { BadRequestException } from "@nestjs/common";
import { SessionController } from "../trading/session.controller";

describe("SessionController Query Parameter Validation", () => {
  let controller: SessionController;
  let mockSessionService: any;

  beforeEach(() => {
    mockSessionService = {
      getHistory: jest.fn().mockResolvedValue({ trades: [] }),
      getLifetimeAnalytics: jest.fn().mockResolvedValue({ totalPnl: 0 }),
      getTrade: jest.fn().mockResolvedValue({ id: "BTCUSDT" }),
      updateTradeConfig: jest.fn().mockResolvedValue({ status: "updated" }),
      closeTradeManually: jest.fn().mockResolvedValue({ status: "closed" }),
    };

    controller = new SessionController(mockSessionService);
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

  describe("getTrade", () => {
    it("should accept valid UUID or symbol", async () => {
      await expect(controller.getTrade("BTCUSDT")).resolves.not.toThrow();
      expect(mockSessionService.getTrade).toHaveBeenCalledWith("BTCUSDT");
    });

    it("should reject non-string array or object parameter", async () => {
      const invalidArray = ["BTCUSDT", "ETHUSDT"] as any;
      await expect(controller.getTrade(invalidArray)).rejects.toThrow(BadRequestException);
      expect(mockSessionService.getTrade).not.toHaveBeenCalled();
    });
  });

  describe("updateTradeConfig", () => {
    it("should accept valid symbol and config", async () => {
      const mockReq = { ip: "127.0.0.1", headers: {}, socket: {} } as any;
      await expect(controller.updateTradeConfig("BTCUSDT", {}, mockReq)).resolves.not.toThrow();
      expect(mockSessionService.updateTradeConfig).toHaveBeenCalled();
    });

    it("should reject non-string parameter", async () => {
      const mockReq = { ip: "127.0.0.1", headers: {}, socket: {} } as any;
      const invalidArray = ["BTCUSDT"] as any;
      await expect(controller.updateTradeConfig(invalidArray, {}, mockReq)).rejects.toThrow(BadRequestException);
      expect(mockSessionService.updateTradeConfig).not.toHaveBeenCalled();
    });
  });

  describe("closeTradeManually", () => {
    it("should accept valid symbol", async () => {
      const mockReq = { ip: "127.0.0.1", headers: {}, socket: {} } as any;
      await expect(controller.closeTradeManually("BTCUSDT", mockReq)).resolves.not.toThrow();
      expect(mockSessionService.closeTradeManually).toHaveBeenCalledWith("BTCUSDT", "127.0.0.1", undefined);
    });

    it("should reject non-string symbol parameter", async () => {
      const mockReq = { ip: "127.0.0.1", headers: {}, socket: {} } as any;
      const invalidArray = ["BTCUSDT", "ETHUSDT"] as any;
      await expect(controller.closeTradeManually(invalidArray, mockReq)).rejects.toThrow(BadRequestException);
      expect(mockSessionService.closeTradeManually).not.toHaveBeenCalled();
    });
  });
});
