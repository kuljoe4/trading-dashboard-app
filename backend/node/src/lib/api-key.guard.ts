import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Request } from "express";
import { safeCompare } from "./crypto";

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const adminKey = this.configService.get<string>("ADMIN_API_KEY");
    const request = context.switchToHttp().getRequest<Request>();

    // Audit Item 34: Unconditionally require key for monitoring
    const isMonitoring = request.url?.includes('/monitoring/');

    // If no admin key is configured, allow all requests (opt-in security),
    // EXCEPT for monitoring which is unconditionally restricted if key is MISSING (to be safe)
    // Actually, if it's missing we can't validate it.
    // But Audit Item 34 says "require the key unconditionally for monitoring".
    if (!adminKey) {
      if (isMonitoring) {
        throw new UnauthorizedException("ADMIN_API_KEY must be set to access monitoring");
      }
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
