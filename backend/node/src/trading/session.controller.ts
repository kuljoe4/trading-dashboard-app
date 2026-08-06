import {
  Controller,
  Post,
  Get,
  Body,
  Patch,
  Delete,
  Param,
  ParseUUIDPipe,
  Query,
  BadRequestException,
  UseGuards,
  Req,
} from "@nestjs/common";
import { Request } from "express";
import { plainToInstance } from "class-transformer";
import { SessionService } from "./session.service";
import { ApiKeyGuard } from "../lib/api-key.guard";
import { SessionConfig } from "../models/SessionConfig";
import { StartSessionDto, UpdateSessionDto, UpdateTradeConfigDto } from "./dto/session.dto";
import { PauseSessionDto } from "./dto/pause-session.dto";
import { extractIp } from "../lib/throttle";

@Controller("session")
@UseGuards(ApiKeyGuard)
export class SessionController {
  constructor(private readonly sessionService: SessionService) {}

  @Post("start")
  async startSession(@Body() body: StartSessionDto, @Req() req: Request) {
    const clientIp =
      req.ip || extractIp(req.headers, req.socket?.remoteAddress || "unknown");
    const userAgent = req.headers["user-agent"];

    if (body.sessionId) {
      return this.sessionService.startSession(
        body.config || ({} as any),
        body.paper_mode ?? true,
        body.sessionId,
        clientIp,
        userAgent,
      );
    }
    const config = plainToInstance(SessionConfig, body.config || {});
    return this.sessionService.startSession(
      config,
      body.paper_mode ?? true,
      undefined,
      clientIp,
      userAgent,
    );
  }

  @Get("list")
  async listSessions() {
    return this.sessionService.listSessions();
  }

  @Post("stop")
  async stopSession(@Req() req: Request) {
    const clientIp =
      req.ip || extractIp(req.headers, req.socket?.remoteAddress || "unknown");
    const userAgent = req.headers["user-agent"];
    return this.sessionService.stopSession(clientIp, userAgent);
  }

  @Patch(":id")
  async updateSession(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: UpdateSessionDto,
    @Req() req: Request,
  ) {
    const clientIp =
      req.ip || extractIp(req.headers, req.socket?.remoteAddress || "unknown");
    const userAgent = req.headers["user-agent"];

    // Body validation allows partial config for PATCH
    const partialConfig = body.config;

    return this.sessionService.updateSession(
      id,
      partialConfig,
      clientIp,
      userAgent,
    );
  }

  @Post("pause")
  async pauseSession(@Body() body: PauseSessionDto, @Req() req: Request) {
    const clientIp =
      req.ip || extractIp(req.headers, req.socket?.remoteAddress || "unknown");
    const userAgent = req.headers["user-agent"];
    return this.sessionService.pauseSession(body.paused, body.strategyLabel, clientIp, userAgent);
  }

  @Delete("trades/orphans")
  async deleteOrphanedTrades(@Req() req: Request) {
    const clientIp =
      req.ip || extractIp(req.headers, req.socket?.remoteAddress || "unknown");
    const userAgent = req.headers["user-agent"];
    return this.sessionService.deleteOrphanedTrades(clientIp, userAgent);
  }

  @Delete(":id")
  async deleteSession(
    @Param("id", ParseUUIDPipe) id: string,
    @Req() req: Request,
  ) {
    const clientIp =
      req.ip || extractIp(req.headers, req.socket?.remoteAddress || "unknown");
    const userAgent = req.headers["user-agent"];
    return this.sessionService.deleteSession(id, clientIp, userAgent);
  }

  @Get("status")
  async getStatus() {
    return this.sessionService.getStatus(false);
  }

  @Get("trade/:id")
  async getTrade(@Param("id") id: string) {
    // SENTINEL: Input validation to ensure 'id' is a valid UUID or Binance symbol format.
    // Prevents potential probing attacks or malformed input issues.
    // SENTINEL: Enforce maximum length constraint before any regex evaluation to prevent ReDoS/CPU abuse.
    if (!id || id.length > 50) {
      throw new BadRequestException("Invalid trade ID or symbol format");
    }
    const isUuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        id,
      );
    const isSymbol = /^[A-Z0-9]{3,20}$/.test(id);

    if (!isUuid && !isSymbol) {
      throw new BadRequestException("Invalid trade ID or symbol format");
    }
    return this.sessionService.getTrade(id);
  }

  @Patch("trade/:id/config")
  async updateTradeConfig(
    @Param("id") id: string,
    @Body() body: UpdateTradeConfigDto,
    @Req() req: Request,
  ) {
    // SENTINEL: Enforce maximum length constraint before any regex evaluation to prevent ReDoS/CPU abuse.
    if (!id || id.length > 50) {
      throw new BadRequestException("Invalid trade ID or symbol format");
    }
    const isUuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        id,
      );
    const isSymbol = /^[A-Z0-9]{3,20}$/.test(id);

    if (!isUuid && !isSymbol) {
      throw new BadRequestException("Invalid trade ID or symbol format");
    }

    const clientIp =
      req.ip || extractIp(req.headers, req.socket?.remoteAddress || "unknown");
    const userAgent = req.headers["user-agent"];

    return this.sessionService.updateTradeConfig(
      id,
      body,
      clientIp,
      userAgent,
    );
  }

  @Get("binance/rate-limit")
  async getBinanceRateLimit() {
    return this.sessionService.getBinanceRateLimit();
  }

  @Get("history")
  async getHistory(@Query("sessionId") sessionId?: string) {
    if (sessionId && sessionId !== "all") {
      // SENTINEL: Enforce maximum length constraint before any regex evaluation to prevent ReDoS/CPU abuse.
      if (sessionId.length > 50) {
        throw new BadRequestException("Invalid sessionId format");
      }
      const isUuid =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          sessionId,
        );
      if (!isUuid) {
        throw new BadRequestException("Invalid sessionId format");
      }
    }
    return this.sessionService.getHistory(sessionId);
  }

  @Post("trade/:symbol/close")
  async closeTradeManually(
    @Param("symbol") symbol: string,
    @Req() req: Request,
  ) {
    // Basic input hardening: ensure symbol matches expected Binance format
    // SENTINEL: Enforce maximum length constraint before any regex evaluation to prevent ReDoS/CPU abuse.
    if (!symbol || symbol.length > 50 || !/^[A-Z0-9]{3,20}$/.test(symbol)) {
      throw new BadRequestException("Invalid symbol format");
    }
    const clientIp =
      req.ip || extractIp(req.headers, req.socket?.remoteAddress || "unknown");
    const userAgent = req.headers["user-agent"];
    return this.sessionService.closeTradeManually(symbol, clientIp, userAgent);
  }

  @Get("analytics")
  async getAnalytics() {
    return this.sessionService.getAnalytics();
  }

  @Get("lifetime-analytics")
  async getLifetimeAnalytics(
    @Query("mode") mode: "paper" | "testnet" | "live",
  ) {
    if (mode && !["paper", "testnet", "live"].includes(mode)) {
      throw new BadRequestException(
        "Invalid mode. Must be one of: paper, testnet, live",
      );
    }
    return this.sessionService.getLifetimeAnalytics(mode || "paper");
  }

  @Post("reset-paper-balance")
  async resetPaperBalance(@Req() req: Request) {
    const clientIp =
      req.ip || extractIp(req.headers, req.socket?.remoteAddress || "unknown");
    const userAgent = req.headers["user-agent"];
    return this.sessionService.resetPaperBalance(clientIp, userAgent);
  }
}
