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
import { isThrottled, recordFailure, clearFailures, extractIp } from "./throttle";

@Injectable()
export class ApiKeyGuard implements CanActivate {
  private readonly logger = new Logger(ApiKeyGuard.name);
  constructor(private configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const adminKey = this.configService.get<string>("ADMIN_API_KEY");
    const request = context.switchToHttp().getRequest<Request>();
    const isProduction = this.configService.get<string>("NODE_ENV") === "production";
    // Security: request.ip is populated by Express using 'trust proxy' if enabled.
    // We prefer it as it's more reliable than manually parsing headers.
    const clientIp = request.ip || extractIp(request.headers, request.socket?.remoteAddress || "unknown");

    // SENTINEL: Check IP throttle
    if (isThrottled(clientIp)) {
      this.logger.warn(`Auth throttle triggered for IP: ${clientIp}`);
      throw new UnauthorizedException("Too many failed authentication attempts. Please try again later.");
    }

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
    const rawApiKey = request.headers?.["x-api-key"];

    // Handle string or string[] header values
    const apiKey = Array.isArray(rawApiKey) ? rawApiKey[0] : rawApiKey;

    // SENTINEL: Validate API Key length to prevent DoS/Exploits via long headers
    if (apiKey && apiKey.length > 128) {
       this.logger.warn(`Rejected overly long API Key header (${apiKey.length} chars) from IP: ${clientIp}`);
       recordFailure(clientIp);
       throw new UnauthorizedException("Invalid API Key format");
    }

    if (apiKey && safeCompare(apiKey, adminKey)) {
      clearFailures(clientIp);
      return true;
    }

    const count = recordFailure(clientIp);
    this.logger.warn(`Failed auth attempt #${count} from IP: ${clientIp}`);
    throw new UnauthorizedException("Invalid or missing API Key");
  }
}
