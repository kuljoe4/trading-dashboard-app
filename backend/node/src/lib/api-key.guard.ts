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

    // If no admin key is configured, allow all requests (opt-in security)
    if (!adminKey) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
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
