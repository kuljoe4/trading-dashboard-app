import { UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ApiKeyGuard } from "./api-key.guard";

describe("ApiKeyGuard", () => {
  let guard: ApiKeyGuard;
  let mockConfigService: jest.Mocked<ConfigService>;
  let mockExecutionContext: any;

  beforeEach(() => {
    mockConfigService = {
      get: jest.fn(),
    } as any;
    guard = new ApiKeyGuard(mockConfigService);
    mockExecutionContext = {
      switchToHttp: jest.fn().mockReturnThis(),
      getRequest: jest.fn(),
    };
  });

  it("should throw UnauthorizedException in production if ADMIN_API_KEY is missing", () => {
    mockConfigService.get.mockImplementation((key: string) => {
      if (key === "NODE_ENV") return "production";
      if (key === "ADMIN_API_KEY") return undefined;
      return null;
    });
    mockExecutionContext.getRequest.mockReturnValue({
      url: "/session/status",
      headers: {},
    });

    expect(() => guard.canActivate(mockExecutionContext)).toThrow(
      new UnauthorizedException("ADMIN_API_KEY must be set in production to protect the dashboard"),
    );
  });

  it("should allow access in non-production if ADMIN_API_KEY is missing", () => {
    mockConfigService.get.mockImplementation((key: string) => {
      if (key === "NODE_ENV") return "development";
      if (key === "ADMIN_API_KEY") return undefined;
      return null;
    });
    mockExecutionContext.getRequest.mockReturnValue({
      url: "/session/status",
      headers: {},
    });

    const result = guard.canActivate(mockExecutionContext);
    expect(result).toBe(true);
  });

  it("should throw UnauthorizedException for monitoring if ADMIN_API_KEY is missing (even in dev)", () => {
    mockConfigService.get.mockImplementation((key: string) => {
      if (key === "NODE_ENV") return "development";
      if (key === "ADMIN_API_KEY") return undefined;
      return null;
    });
    mockExecutionContext.getRequest.mockReturnValue({
      url: "/monitoring/stats",
      headers: {},
    });

    expect(() => guard.canActivate(mockExecutionContext)).toThrow(
      new UnauthorizedException("ADMIN_API_KEY must be set to access monitoring"),
    );
  });

  it("should allow access if correct API key is provided", () => {
    mockConfigService.get.mockImplementation((key: string) => {
      if (key === "NODE_ENV") return "production";
      if (key === "ADMIN_API_KEY") return "secret-key";
      return null;
    });
    mockExecutionContext.getRequest.mockReturnValue({
      url: "/session/status",
      headers: {
        "x-api-key": "secret-key",
      },
    });

    const result = guard.canActivate(mockExecutionContext);
    expect(result).toBe(true);
  });

  it("should throw UnauthorizedException if incorrect API key is provided", () => {
    mockConfigService.get.mockImplementation((key: string) => {
      if (key === "NODE_ENV") return "production";
      if (key === "ADMIN_API_KEY") return "secret-key";
      return null;
    });
    mockExecutionContext.getRequest.mockReturnValue({
      url: "/session/status",
      headers: {
        "x-api-key": "wrong-key",
      },
    });

    expect(() => guard.canActivate(mockExecutionContext)).toThrow(
      new UnauthorizedException("Invalid or missing API Key"),
    );
  });

  it("should handle array version of x-api-key header", () => {
    mockConfigService.get.mockImplementation((key: string) => {
      if (key === "NODE_ENV") return "production";
      if (key === "ADMIN_API_KEY") return "secret-key";
      return null;
    });
    mockExecutionContext.getRequest.mockReturnValue({
      url: "/session/status",
      headers: {
        "x-api-key": ["secret-key"],
      },
    });

    const result = guard.canActivate(mockExecutionContext);
    expect(result).toBe(true);
  });
});
