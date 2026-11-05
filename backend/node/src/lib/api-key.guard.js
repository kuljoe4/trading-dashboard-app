var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
var ApiKeyGuard_1;
import { Injectable, Logger, UnauthorizedException, Optional, } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { safeCompare } from "./crypto";
import { isThrottled, recordFailure, clearFailures, extractIp } from "./throttle";
import { AuditLogService } from "../trading/audit-log.service";
let ApiKeyGuard = ApiKeyGuard_1 = class ApiKeyGuard {
    configService;
    auditLog;
    logger = new Logger(ApiKeyGuard_1.name);
    constructor(configService, auditLog) {
        this.configService = configService;
        this.auditLog = auditLog;
    }
    canActivate(context) {
        const adminKey = this.configService.get("ADMIN_API_KEY");
        const request = context.switchToHttp().getRequest();
        const isProduction = this.configService.get("NODE_ENV") === "production";
        const userAgent = request.headers["user-agent"];
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
                throw new UnauthorizedException("ADMIN_API_KEY must be set in production to protect the dashboard");
            }
            if (isMonitoring) {
                throw new UnauthorizedException("ADMIN_API_KEY must be set to access monitoring");
            }
            this.logger.warn("⚠️  Security Warning: ADMIN_API_KEY is not set. The dashboard is UNPROTECTED in non-production environment.");
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
        // PERSISTENT AUDIT: Log auth failure for forensic analysis
        if (this.auditLog) {
            this.auditLog.log({
                action: 'AUTH_FAILURE',
                actor: clientIp,
                ip: clientIp,
                userAgent,
                details: { count, url: request.url },
                level: 'WARN'
            }).catch(err => this.logger.error(`Failed to log auth failure: ${err.message}`));
        }
        throw new UnauthorizedException("Invalid or missing API Key");
    }
};
ApiKeyGuard = ApiKeyGuard_1 = __decorate([
    Injectable(),
    __param(1, Optional()),
    __metadata("design:paramtypes", [ConfigService,
        AuditLogService])
], ApiKeyGuard);
export { ApiKeyGuard };
