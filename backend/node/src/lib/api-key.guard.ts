import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Request } from "express";
import { safeCompare } from "./crypto";

@Injectable()
export class ApiKeyGuard implements CanActivate {
  private readonly logger = new Logger(ApiKeyGuard.name);
  constructor(private configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const adminKey = this.configService.get<string>("ADMIN_API_KEY");
    const request = context.switchToHttp().getRequest<Request>();
    const isProduction = this.configService.get<string>("NODE_ENV") === "production";

    // Audit Item 34: Unconditionally require key for monitoring
    const isMonitoring = request.url?.includes("/monitoring/");

    // SENTINEL: Enforce ADMIN_API_KEY in production
    if (!adminKey) {
      if (isProduction) {
        throw new UnauthorizedException(
          "ADMIN_API_KEY must be set in production to protect the dashboard",
        );
      }
      if (isMonitoring) {
        throw new UnauthorizedException(
          "ADMIN_API_KEY must be set to access monitoring",
        );
      }
      this.logger.warn(
        "⚠️  Security Warning: ADMIN_API_KEY is not set. The dashboard is UNPROTECTED in non-production environment.",
      );
      return true;
    }

    // Case-insensitive header check
    const rawApiKey = request.headers["x-api-key"];

    // Handle string or string[] header values
    const apiKey = Array.isArray(rawApiKey) ? rawApiKey[0] : rawApiKey;

    if (apiKey && safeCompare(apiKey, adminKey)) {
      return true;
    }

    throw new UnauthorizedException("Invalid or missing API Key");
  }
}
