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
import { validate } from "class-validator";
import { SessionService } from "./session.service";
import { BacktestService, RunBacktestDto } from "../engine/backtest.service";
import { SmartOptimizerService, RunOptimizationDto } from "../engine/smart-optimizer.service";
import { ApiKeyGuard } from "../lib/api-key.guard";
import { SessionConfig } from "../models/SessionConfig";
import { StartSessionDto, UpdateSessionDto, UpdateTradeConfigDto, AdoptPositionDto } from "./dto/session.dto";
import { PauseSessionDto } from "./dto/pause-session.dto";
import { extractIp } from "../lib/throttle";
import { formatValidationErrors } from "../lib/logger";

@Controller("session")
@UseGuards(ApiKeyGuard)
export class SessionController {
  constructor(
    private readonly sessionService: SessionService,
    private readonly backtestService: BacktestService,
    private readonly smartOptimizerService: SmartOptimizerService,
  ) {}

  @Post("smart-optimizer/run")
  async runSmartOptimization(@Body() body: RunOptimizationDto) {
    const baseConfig = plainToInstance(SessionConfig, body.baseConfig || {});
    // SEC-SENTINEL: Defense-in-depth whitelist and type validation on strategy configuration instance
    const errors = await validate(baseConfig, { whitelist: true, forbidNonWhitelisted: true });
    if (errors.length > 0) {
      const detailedErrors = formatValidationErrors(errors);
      throw new BadRequestException({
        message: "Invalid base strategy configuration in smart optimizer",
        detail: detailedErrors,
      });
    }
    return this.smartOptimizerService.runOptimization({
      ...body,
      baseConfig,
    });
  }

  @Get("smart-optimizer/recommendations")
  async getSmartRecommendations() {
    return {
      recommendations: this.smartOptimizerService.getTopRecommendations(),
    };
  }

  @Delete("smart-optimizer/recommendations")
  async clearSmartRecommendations() {
    this.smartOptimizerService.clearRecommendations();
    return { success: true };
  }

  @Post("backtest")
  async runBacktest(@Body() body: RunBacktestDto) {
    const config = plainToInstance(SessionConfig, body.config || {});
    // SEC-SENTINEL: Defense-in-depth whitelist and type validation on strategy configuration instance
    const errors = await validate(config, { whitelist: true, forbidNonWhitelisted: true });
    if (errors.length > 0) {
      const detailedErrors = formatValidationErrors(errors);
      throw new BadRequestException({
        message: "Invalid strategy configuration in backtest",
        detail: detailedErrors,
      });
    }
    return this.backtestService.runBacktest({
      ...body,
      config,
    });
  }

  @Post("start")
  async startSession(@Body() body: StartSessionDto, @Req() req: Request) {
    const clientIp =
      req.ip || extractIp(req.headers, req.socket?.remoteAddress || "unknown");
    const userAgent = req.headers["user-agent"];

    const config = plainToInstance(SessionConfig, body.config || {});
    // SEC-SENTINEL: Defense-in-depth whitelist and type validation on strategy configuration instance
    const errors = await validate(config, { whitelist: true, forbidNonWhitelisted: true });
    if (errors.length > 0) {
      const detailedErrors = formatValidationErrors(errors);
      throw new BadRequestException({
        message: "Invalid strategy configuration",
        detail: detailedErrors,
      });
    }
    return this.sessionService.startSession(
      config,
      body.paper_mode ?? true,
      body.sessionId,
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

  @Get("untracked-positions")
  async getUntrackedPositions() {
    return this.sessionService.getUntrackedPositions();
  }

  @Post("adopt-position")
  async adoptPosition(@Body() body: AdoptPositionDto, @Req() req: Request) {
    const clientIp =
      req.ip || extractIp(req.headers, req.socket?.remoteAddress || "unknown");
    const userAgent = req.headers["user-agent"];
    return this.sessionService.adoptPositionManually(
      body.symbol,
      body.strategyLabel,
      body.initialSl,
      body.currentSl,
      clientIp,
      userAgent,
    );
  }

  @Get("status")
  async getStatus() {
    return this.sessionService.getStatus(false);
  }

  @Get("trade/:id")
  async getTrade(@Param("id") id: string) {
    // SENTINEL: Input validation to ensure 'id' is a valid UUID or Binance symbol format.
    // Prevents potential probing attacks or malformed input issues.
    // SENTINEL: Enforce explicit string type assertion and maximum length constraint before any regex evaluation to prevent ReDoS/CPU abuse and HPP type confusion.
    if (!id || typeof id !== "string" || id.length > 50) {
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
    // SENTINEL: Enforce explicit string type assertion and maximum length constraint before any regex evaluation to prevent ReDoS/CPU abuse and HPP type confusion.
    if (!id || typeof id !== "string" || id.length > 50) {
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
      // SENTINEL: Enforce type safety and maximum length constraint before any regex evaluation to prevent ReDoS/CPU abuse and type confusion.
      if (typeof sessionId !== "string" || sessionId.length > 50) {
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
    return this.sessionService.getHistory(sessionId as string);
  }

  @Post("trade/:symbol/close")
  async closeTradeManually(
    @Param("symbol") symbol: string,
    @Req() req: Request,
  ) {
    // Basic input hardening: ensure symbol matches expected Binance format
    // SENTINEL: Enforce explicit string type assertion and maximum length constraint before any regex evaluation to prevent ReDoS/CPU abuse and HPP type confusion.
    if (!symbol || typeof symbol !== "string" || symbol.length > 50 || !/^[A-Z0-9]{3,20}$/.test(symbol)) {
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
    // SENTINEL: Enforce type safety, maximum length constraint, and whitelisting to prevent ReDoS, HPP type confusion, and invalid query parameters.
    if (mode) {
      if (typeof mode !== "string" || mode.length > 20 || !["paper", "testnet", "live"].includes(mode)) {
        throw new BadRequestException(
          "Invalid mode. Must be one of: paper, testnet, live",
        );
      }
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
