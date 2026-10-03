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
  PipeTransform,
  Injectable,
  ArgumentMetadata,
} from "@nestjs/common";
import { Request } from "express";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { SessionService } from "./session.service";
import { BacktestService, RunBacktestDto } from "../engine/backtest.service";
import { SmartOptimizerService, RunOptimizationDto } from "../engine/smart-optimizer.service";
import { ApiKeyGuard } from "../lib/api-key.guard";
import { SessionConfig } from "../models/SessionConfig";
import { StartSessionDto, UpdateSessionDto, UpdateTradeConfigDto, AdoptPositionDto, BackfillKlinesDto } from "./dto/session.dto";
import { PauseSessionDto } from "./dto/pause-session.dto";
import { extractIp } from "../lib/throttle";
import { formatValidationErrors } from "../lib/logger";

@Injectable()
export class LimitPipe implements PipeTransform<any, number | undefined> {
  constructor(private readonly maxLimit: number = 1000) {}
  transform(value: any, metadata: ArgumentMetadata): number | undefined {
    if (value === undefined || value === null || value === "") return undefined;

    // NestJS ValidationPipe with transform: true might convert query params to numbers BEFORE our custom pipe runs.
    const strValue = String(value);

    if (strValue.length > 10 || !/^\d+$/.test(strValue)) {
      throw new BadRequestException("Invalid limit format. Must be a positive integer.");
    }
    const parsed = parseInt(strValue, 10);
    if (isNaN(parsed) || parsed < 1 || parsed > this.maxLimit) {
      throw new BadRequestException(`Limit must be between 1 and ${this.maxLimit}`);
    }
    return parsed;
  }
}

@Injectable()
export class SessionIdPipe implements PipeTransform<any, string | undefined> {
  transform(value: any, metadata: ArgumentMetadata): string | undefined {
    if (value === undefined || value === null || value === "") return undefined;
    if (value === "all") return value;
    if (typeof value !== "string" || value.length > 50) {
      throw new BadRequestException("Invalid sessionId format");
    }
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
    if (!isUuid) {
      throw new BadRequestException("Invalid sessionId format");
    }
    return value;
  }
}

@Injectable()
export class ModePipe implements PipeTransform<any, string> {
  transform(value: any, metadata: ArgumentMetadata): string {
    const mode = value || "paper";
    if (typeof mode !== "string" || mode.length > 20 || !["paper", "testnet", "live"].includes(mode)) {
      throw new BadRequestException("Invalid mode. Must be one of: paper, testnet, live");
    }
    return mode;
  }
}

@Controller("session")
@UseGuards(ApiKeyGuard)
export class SessionController {
  constructor(
    private readonly sessionService: SessionService,
    private readonly backtestService: BacktestService,
    private readonly smartOptimizerService: SmartOptimizerService,
  ) {}

  @Post("backfill-klines")
  async backfillKlines(@Body() body: BackfillKlinesDto) {
    const dto = plainToInstance(BackfillKlinesDto, body || {});
    const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
    if (errors.length > 0) {
      const detailedErrors = formatValidationErrors(errors);
      throw new BadRequestException({
        message: "Invalid backfill parameters",
        detail: detailedErrors,
      });
    }

    try {
      return await this.sessionService.forceBackfillKlines(dto.symbol, dto.interval);
    } catch (err: any) {
      throw new BadRequestException(err.message || "Failed to backfill candles");
    }
  }

  @Post("smart-optimizer/run")
  async runSmartOptimization(@Body() body: RunOptimizationDto) {
    // SEC-SENTINEL: Defense-in-depth validation of outer RunOptimizationDto payload
    const optDto = plainToInstance(RunOptimizationDto, body || {});
    const dtoErrors = await validate(optDto, { whitelist: true, forbidNonWhitelisted: true });
    if (dtoErrors.length > 0) {
      const detailedErrors = formatValidationErrors(dtoErrors);
      throw new BadRequestException({
        message: "Invalid smart optimizer parameters",
        detail: detailedErrors,
      });
    }

    const baseConfig = plainToInstance(SessionConfig, optDto.baseConfig || {});
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
      ...optDto,
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
    // SEC-SENTINEL: Defense-in-depth validation of outer RunBacktestDto payload
    const backtestDto = plainToInstance(RunBacktestDto, body || {});
    const dtoErrors = await validate(backtestDto, { whitelist: true, forbidNonWhitelisted: true });
    if (dtoErrors.length > 0) {
      const detailedErrors = formatValidationErrors(dtoErrors);
      throw new BadRequestException({
        message: "Invalid backtest parameters",
        detail: detailedErrors,
      });
    }

    const config = plainToInstance(SessionConfig, backtestDto.config || {});
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
      ...backtestDto,
      config,
    });
  }

  @Post("start")
  async startSession(@Body() body: StartSessionDto, @Req() req: Request) {
    // SEC-SENTINEL: Defense-in-depth validation of outer StartSessionDto payload
    const startDto = plainToInstance(StartSessionDto, body || {});
    const dtoErrors = await validate(startDto, { whitelist: true, forbidNonWhitelisted: true });
    if (dtoErrors.length > 0) {
      const detailedErrors = formatValidationErrors(dtoErrors);
      throw new BadRequestException({
        message: "Invalid start session parameters",
        detail: detailedErrors,
      });
    }

    const clientIp =
      req.ip || extractIp(req.headers, req.socket?.remoteAddress || "unknown");
    const userAgent = req.headers["user-agent"];

    const config = plainToInstance(SessionConfig, startDto.config || {});
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
      startDto.paper_mode ?? true,
      startDto.sessionId,
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
    // SEC-SENTINEL: Defense-in-depth validation of UpdateSessionDto outer payload
    const sessionDto = plainToInstance(UpdateSessionDto, body || {});
    const dtoErrors = await validate(sessionDto, { whitelist: true, forbidNonWhitelisted: true });
    if (dtoErrors.length > 0) {
      const detailedErrors = formatValidationErrors(dtoErrors);
      throw new BadRequestException({
        message: "Invalid update session parameters",
        detail: detailedErrors,
      });
    }

    const clientIp =
      req.ip || extractIp(req.headers, req.socket?.remoteAddress || "unknown");
    const userAgent = req.headers["user-agent"];

    const configInstance = plainToInstance(SessionConfig, sessionDto.config || {});
    // SEC-SENTINEL: Defense-in-depth whitelist and type validation on partial session configuration instance
    const errors = await validate(configInstance, { whitelist: true, forbidNonWhitelisted: true, skipMissingProperties: true });
    if (errors.length > 0) {
      const detailedErrors = formatValidationErrors(errors);
      throw new BadRequestException({
        message: "Invalid configuration parameters in update session",
        detail: detailedErrors,
      });
    }

    return this.sessionService.updateSession(
      id,
      configInstance,
      clientIp,
      userAgent,
    );
  }

  @Post("pause")
  async pauseSession(@Body() body: PauseSessionDto, @Req() req: Request) {
    // SEC-SENTINEL: Defense-in-depth validation of PauseSessionDto payload
    const pauseDto = plainToInstance(PauseSessionDto, body || {});
    const dtoErrors = await validate(pauseDto, { whitelist: true, forbidNonWhitelisted: true });
    if (dtoErrors.length > 0) {
      const detailedErrors = formatValidationErrors(dtoErrors);
      throw new BadRequestException({
        message: "Invalid pause session parameters",
        detail: detailedErrors,
      });
    }

    const clientIp =
      req.ip || extractIp(req.headers, req.socket?.remoteAddress || "unknown");
    const userAgent = req.headers["user-agent"];
    return this.sessionService.pauseSession(pauseDto.paused, pauseDto.strategyLabel, clientIp, userAgent);
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
    // SEC-SENTINEL: Defense-in-depth validation of AdoptPositionDto payload
    const adoptDto = plainToInstance(AdoptPositionDto, body || {});
    const dtoErrors = await validate(adoptDto, { whitelist: true, forbidNonWhitelisted: true });
    if (dtoErrors.length > 0) {
      const detailedErrors = formatValidationErrors(dtoErrors);
      throw new BadRequestException({
        message: "Invalid adopt position parameters",
        detail: detailedErrors,
      });
    }

    const clientIp =
      req.ip || extractIp(req.headers, req.socket?.remoteAddress || "unknown");
    const userAgent = req.headers["user-agent"];
    return this.sessionService.adoptPositionManually(
      adoptDto.symbol,
      adoptDto.strategyLabel,
      adoptDto.initialSl,
      adoptDto.currentSl,
      clientIp,
      userAgent,
    );
  }

  @Get("status")
  async getStatus() {
    return this.sessionService.getStatus(false);
  }

  @Get("logs")
  async getLogs(@Query("limit", new LimitPipe(1000)) limit?: number) {
    return this.sessionService.getLogs(limit ?? 50);
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

    // SEC-SENTINEL: Defense-in-depth validation of UpdateTradeConfigDto outer payload
    const tradeConfigDto = plainToInstance(UpdateTradeConfigDto, body || {});
    const dtoErrors = await validate(tradeConfigDto, { whitelist: true, forbidNonWhitelisted: true });
    if (dtoErrors.length > 0) {
      const detailedErrors = formatValidationErrors(dtoErrors);
      throw new BadRequestException({
        message: "Invalid update trade config parameters",
        detail: detailedErrors,
      });
    }

    if (tradeConfigDto.strategy_config) {
      const configInstance = plainToInstance(SessionConfig, tradeConfigDto.strategy_config);
      // SEC-SENTINEL: Defense-in-depth whitelist and type validation on trade strategy configuration overrides
      const errors = await validate(configInstance, { whitelist: true, forbidNonWhitelisted: true, skipMissingProperties: true });
      if (errors.length > 0) {
        const detailedErrors = formatValidationErrors(errors);
        throw new BadRequestException({
          message: "Invalid strategy_config parameters in update trade config",
          detail: detailedErrors,
        });
      }
    }

    const clientIp =
      req.ip || extractIp(req.headers, req.socket?.remoteAddress || "unknown");
    const userAgent = req.headers["user-agent"];

    return this.sessionService.updateTradeConfig(
      id,
      tradeConfigDto,
      clientIp,
      userAgent,
    );
  }

  @Get("binance/rate-limit")
  async getBinanceRateLimit() {
    return this.sessionService.getBinanceRateLimit();
  }

  @Get("history")
  async getHistory(
    @Query("sessionId", new SessionIdPipe()) sessionId?: string,
    @Query("limit", new LimitPipe(5000)) limit?: number,
  ) {
    return this.sessionService.getHistory(sessionId as string, limit);
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
    @Query("mode", new ModePipe()) mode: "paper" | "testnet" | "live",
  ) {
    return this.sessionService.getLifetimeAnalytics(mode);
  }

  @Post("reset-paper-balance")
  async resetPaperBalance(@Req() req: Request) {
    const clientIp =
      req.ip || extractIp(req.headers, req.socket?.remoteAddress || "unknown");
    const userAgent = req.headers["user-agent"];
    return this.sessionService.resetPaperBalance(clientIp, userAgent);
  }
}
