import { Controller, Get, UseGuards, HttpException, HttpStatus, Req, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MonitoringService } from '../engine/monitoring.service';
import { SessionStateService } from '../engine/session_state.service';
import { Settings as SettingsEntity } from '../models/entities/Settings.entity';
import { ApiKeyGuard } from '../lib/api-key.guard';
import { Request } from 'express';
import { extractIp, isGeneralRateLimited } from '../lib/throttle';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { ENGINE_CONSTANTS } from '../models/constants';
import https from 'https';

export interface BinanceProbeResult {
  url: string;
  accessible: boolean;
  status_code: number | null;
  latency_ms: number;
  geo_restricted: boolean;
  ip_banned: boolean;
  rate_limited: boolean;
  error: string | null;
}

export interface BinanceHealthStatus {
  status: 'ok' | 'degraded' | 'restricted' | 'error';
  timestamp: string;
  geo_restricted: boolean;
  live: BinanceProbeResult;
  testnet: BinanceProbeResult;
  uds_status: 'CONNECTED' | 'DISCONNECTED' | 'LAGGING';
  ip_status: {
    is_banned: boolean;
    is_rate_limited: boolean;
    ban_until: number | null;
    last_error_message: string | null;
  };
  proxy: {
    configured: boolean;
    proxy_url: string | null;
    routing: 'proxy' | 'direct';
  };
  rate_limit: {
    used_1m: number;
    weight_limit: number;
  };
  diagnostics: string[];
  cached?: boolean;
}

@Controller()
export class MonitoringController {
  private cachedBinanceHealth: { result: BinanceHealthStatus; ts: number } | null = null;
  private static readonly CACHE_TTL_MS = 10000; // 10s TTL to prevent rate limit spikes

  constructor(
    private readonly monitoringService: MonitoringService,
    private readonly sessionState: SessionStateService,
    @Optional()
    @InjectRepository(SettingsEntity)
    private readonly settingsRepository?: Repository<SettingsEntity>,
  ) {}

  /**
   * Root API status endpoint
   * Avoids 404 when visiting the backend service root domain directly
   */
  @Get()
  async getRoot(@Req() req: Request) {
    const binance = await this.getBinanceHealth(req).catch(() => null);
    return {
      name: 'Momentum Trading Engine API',
      status: 'online',
      version: '1.0.0',
      timestamp: new Date().toISOString(),
      service: 'backend',
      binance: binance || { status: 'unknown' },
      endpoints: {
        health: '/health',
        binance_health: '/healthz/binance',
        binance_health_alias: '/health/binance',
        readiness: '/healthz/readiness',
        liveness: '/healthz/liveness',
        session_status: '/session/status',
        websocket: '/session/ws',
      },
      message: 'Backend API is operational. Access the frontend dashboard via your frontend service domain.',
    };
  }

  @Get('monitoring/stats')
  @UseGuards(ApiKeyGuard)
  getStats() {
    return this.monitoringService.getMetrics();
  }

  /**
   * SRE: Health check endpoint (Railway & orchestrators)
   * Returns full system health including live Binance connectivity status.
   */
  @Get('health')
  async getHealth(@Req() req: Request) {
    const binance = await this.getBinanceHealth(req);
    return {
      status: binance.status === 'error' ? 'degraded' : 'ok',
      service: 'online',
      timestamp: new Date().toISOString(),
      binance,
      endpoints: {
        binance_details: '/healthz/binance',
        binance_health_alias: '/health/binance',
        liveness: '/healthz/liveness',
        session_status: '/session/status',
        websocket: '/session/ws',
      },
    };
  }

  @Get('healthz')
  async getHealthz(@Req() req: Request) {
    return this.getHealth(req);
  }

  /**
   * SRE: /healthz/liveness probe
   * Returns 200 OK as long as the NestJS application loop isn't deadlocked.
   */
  @Get('healthz/liveness')
  getLiveness(@Req() req: Request) {
    const clientIp = req.ip || extractIp(req.headers, req.socket?.remoteAddress || 'unknown');
    if (isGeneralRateLimited(clientIp)) {
      throw new HttpException('Too Many Requests', HttpStatus.TOO_MANY_REQUESTS);
    }
    return { status: 'OK', timestamp: new Date().toISOString() };
  }

  /**
   * SRE: /healthz/readiness probe
   * Evaluates active pipeline dependencies: UDS status and Rate Limit utilization.
   */
  @Get('healthz/readiness')
  getReadiness(@Req() req: Request) {
    const clientIp = req.ip || extractIp(req.headers, req.socket?.remoteAddress || 'unknown');
    if (isGeneralRateLimited(clientIp)) {
      throw new HttpException('Too Many Requests', HttpStatus.TOO_MANY_REQUESTS);
    }

    const metrics = this.monitoringService.getMetrics();
    const rateLimit = this.sessionState.getBinanceRateLimit();

    const hasActiveSession = !!this.sessionState.config;
    const isUdsHealthy = !hasActiveSession || metrics.application.exchange_uds_status === 'CONNECTED';
    const isWeightHealthy = (rateLimit.used_weight_1m / (rateLimit.weight_limit || 2400)) < 0.9;

    if (!isUdsHealthy) {
       throw new HttpException({
         status: 'UNREADY',
         reason: 'UDS_STALL',
         lastPing: metrics.application.last_uds_ping_sec
       }, HttpStatus.SERVICE_UNAVAILABLE);
    }

    if (!isWeightHealthy) {
       throw new HttpException({
         status: 'UNREADY',
         reason: 'RATE_LIMIT_EXCEEDED',
         usage: rateLimit.used_weight_1m
       }, HttpStatus.SERVICE_UNAVAILABLE);
    }

    return { status: 'READY', uds: hasActiveSession ? 'CONNECTED' : 'INACTIVE', weight: rateLimit.used_weight_1m };
  }

  /**
   * SRE: Lightweight Binance API Health Check
   * Returns current connectivity to Live & Testnet Binance APIs,
   * specifically detecting geo-restriction blocks (HTTP 451/403) and providing
   * actionable fallback diagnostics.
   */
  @Get(['healthz/binance', 'health/binance', 'binance/health'])
  async getBinanceHealth(@Req() req: Request): Promise<BinanceHealthStatus> {
    const clientIp = req.ip || extractIp(req.headers, req.socket?.remoteAddress || 'unknown');
    if (isGeneralRateLimited(clientIp)) {
      throw new HttpException('Too Many Requests', HttpStatus.TOO_MANY_REQUESTS);
    }

    const query = (req as any)?.query;
    let isFresh = query?.fresh === 'true' || query?.fresh === '1';

    // SRE: Fresh probes hit external exchange networks and consume rate limit weight.
    // Require API key authorization to bypass the cache.
    if (isFresh) {
      const authHeader = (req.headers['x-api-key'] || req.headers['authorization']) as string | undefined;
      const token = authHeader?.replace(/^Bearer\s+/i, '');
      const expectedKey = process.env.ADMIN_API_KEY || process.env.API_KEY;
      if (!token || !expectedKey || token !== expectedKey) {
        throw new HttpException('Unauthorized: Valid API key required for live network check (fresh=1)', HttpStatus.UNAUTHORIZED);
      }
    }

    // Serve cached result if within TTL to protect IP weight & keep endpoint lightweight
    if (!isFresh && this.cachedBinanceHealth && (Date.now() - this.cachedBinanceHealth.ts < MonitoringController.CACHE_TTL_MS)) {
      return { ...this.cachedBinanceHealth.result, cached: true };
    }

    // Determine proxy configuration
    let proxyUrl: string | null = null;
    if (this.settingsRepository) {
      try {
        const settings = await this.settingsRepository.findOne({ where: { id: 'default' } });
        if (settings?.proxy_url) {
          proxyUrl = settings.proxy_url.trim();
        }
      } catch (_) {}
    }
    if (!proxyUrl && process.env.PROXY_URL) {
      proxyUrl = process.env.PROXY_URL.trim();
    } else if (!proxyUrl && process.env.HTTPS_PROXY) {
      proxyUrl = process.env.HTTPS_PROXY.trim();
    }

    // Probe both Live and Testnet endpoints concurrently using standardized constants
    const [liveProbe, testnetProbe] = await Promise.all([
      this.probeBinanceEndpoint(`${ENGINE_CONSTANTS.BINANCE_REST_BASE}/fapi/v1/ping`, proxyUrl),
      this.probeBinanceEndpoint(`${ENGINE_CONSTANTS.BINANCE_TESTNET_REST_URL}/fapi/v1/ping`, null),
    ]);

    const isGeoRestricted = liveProbe.geo_restricted || testnetProbe.geo_restricted;
    const ipBanned = typeof this.sessionState.isBanned === 'function'
      ? this.sessionState.isBanned()
      : !!this.sessionState.apiStatus?.isBanned;
    const rateLimited = !!this.sessionState.apiStatus?.isRateLimited;

    let overallStatus: 'ok' | 'degraded' | 'restricted' | 'error' = 'ok';
    if (isGeoRestricted) {
      overallStatus = 'restricted';
    } else if (!liveProbe.accessible && !testnetProbe.accessible) {
      overallStatus = 'error';
    } else if (!liveProbe.accessible || !testnetProbe.accessible || ipBanned || rateLimited) {
      overallStatus = 'degraded';
    } else {
      overallStatus = 'ok';
    }

    const maskedProxy = proxyUrl ? this.maskProxyUrl(proxyUrl) : null;
    const diagnostics: string[] = [];

    if (liveProbe.geo_restricted) {
      diagnostics.push(
        `CRITICAL: Geo-restriction detected on Binance Live Futures API (HTTP ${liveProbe.status_code}). Host IP is located in a restricted jurisdiction.`
      );
      if (proxyUrl) {
        diagnostics.push(
          `Proxy is configured (${maskedProxy}), but live traffic is still restricted. Verify proxy exit node location.`
        );
      } else {
        diagnostics.push(
          'Fallback remedy: Configure a Proxy URL in Settings (or set PROXY_URL environment variable) to route requests via an allowed region.'
        );
      }
    } else if (liveProbe.accessible) {
      diagnostics.push(
        `Binance Live Futures API is reachable (latency: ${liveProbe.latency_ms}ms).`
      );
    } else {
      diagnostics.push(
        `Binance Live Futures API connection failed: ${liveProbe.error || 'Connection failed'}.`
      );
    }

    if (testnetProbe.geo_restricted) {
      diagnostics.push(
        `Binance Testnet is also geo-restricted (HTTP ${testnetProbe.status_code}).`
      );
    } else if (testnetProbe.accessible) {
      diagnostics.push(
        `Binance Testnet Futures API is reachable (latency: ${testnetProbe.latency_ms}ms).`
      );
      if (liveProbe.geo_restricted) {
        diagnostics.push(
          'Fallback option: Testnet API is reachable. You can switch session trading_mode to "testnet" or "paper" while resolving live connectivity.'
        );
      }
    } else {
      diagnostics.push(
        `Binance Testnet Futures API unreachable: ${testnetProbe.error || 'Connection failed'}.`
      );
    }

    if (ipBanned) {
      diagnostics.push('CRITICAL: Host IP is currently marked BANNED by Binance (HTTP 418).');
    }
    if (rateLimited) {
      diagnostics.push('WARNING: Host is currently rate limited by Binance (HTTP 429).');
    }

    const rateLimitInfo = this.sessionState.getBinanceRateLimit();
    const metrics = this.monitoringService.getMetrics();

    const response: BinanceHealthStatus = {
      status: overallStatus,
      timestamp: new Date().toISOString(),
      geo_restricted: isGeoRestricted,
      live: liveProbe,
      testnet: testnetProbe,
      uds_status: (metrics.application.exchange_uds_status || 'DISCONNECTED') as 'CONNECTED' | 'DISCONNECTED' | 'LAGGING',
      ip_status: {
        is_banned: ipBanned,
        is_rate_limited: rateLimited,
        ban_until: this.sessionState.apiStatus?.banUntil || null,
        last_error_message: this.sessionState.apiStatus?.lastErrorMessage || null,
      },
      proxy: {
        configured: !!proxyUrl,
        proxy_url: maskedProxy,
        routing: proxyUrl ? 'proxy' : 'direct',
      },
      rate_limit: {
        used_1m: rateLimitInfo.used_weight_1m || 0,
        weight_limit: rateLimitInfo.weight_limit || 2400,
      },
      diagnostics,
      cached: false,
    };

    this.cachedBinanceHealth = { result: response, ts: Date.now() };
    return response;
  }

  @Get('health/binance')
  getBinanceHealthAlias(@Req() req: Request): Promise<BinanceHealthStatus> {
    return this.getBinanceHealth(req);
  }

  /**
   * Helper to ping a Binance REST endpoint with timeout and geo-restriction analysis
   */
  private async probeBinanceEndpoint(
    url: string,
    proxyUrl?: string | null,
    timeoutMs = 4000
  ): Promise<BinanceProbeResult> {
    const start = Date.now();
    try {
      if (proxyUrl) {
        return await new Promise<BinanceProbeResult>((resolve) => {
          let agent: any;
          try {
            agent = new HttpsProxyAgent(proxyUrl);
          } catch (agentErr: any) {
            return resolve({
              url,
              accessible: false,
              status_code: null,
              latency_ms: Date.now() - start,
              geo_restricted: false,
              ip_banned: false,
              rate_limited: false,
              error: `Invalid proxy configuration: ${agentErr.message}`,
            });
          }

          const req = https.get(
            url,
            {
              agent,
              timeout: timeoutMs,
              headers: {
                'User-Agent': 'MomentumEngine/1.0',
                Accept: 'application/json, text/plain, */*',
              },
            },
            (res) => {
              let body = '';
              res.on('data', (chunk) => {
                if (body.length < 1024) body += chunk.toString();
              });
              res.on('end', () => {
                const latency_ms = Date.now() - start;
                const status_code = res.statusCode || 0;
                const lowerBody = body.toLowerCase();
                const geo_restricted =
                  status_code === 451 ||
                  (status_code === 403 &&
                    (lowerBody.includes('restricted') ||
                      lowerBody.includes('location') ||
                      lowerBody.includes('country') ||
                      lowerBody.includes('jurisdiction') ||
                      lowerBody.includes('geoblock') ||
                      lowerBody.includes('cloudflare')));
                const ip_banned = status_code === 418;
                const rate_limited = status_code === 429;
                const accessible = status_code >= 200 && status_code < 300;

                resolve({
                  url,
                  accessible,
                  status_code,
                  latency_ms,
                  geo_restricted,
                  ip_banned,
                  rate_limited,
                  error: accessible ? null : `HTTP ${status_code}${body ? ': ' + body.slice(0, 150).trim() : ''}`,
                });
              });
            }
          );

          req.on('timeout', () => {
            req.destroy(new Error('Connection timed out'));
          });

          req.on('error', (err: any) => {
            resolve({
              url,
              accessible: false,
              status_code: null,
              latency_ms: Date.now() - start,
              geo_restricted: false,
              ip_banned: false,
              rate_limited: false,
              error: err.message || String(err),
            });
          });
        });
      }

      // Direct fetch (no proxy)
      const response = await fetch(url, {
        signal: AbortSignal.timeout(timeoutMs),
        headers: {
          'User-Agent': 'MomentumEngine/1.0',
          Accept: 'application/json, text/plain, */*',
        },
      });

      const latency_ms = Date.now() - start;
      const status_code = response.status;
      let body = '';
      try {
        body = await response.text();
      } catch (_) {}

      const lowerBody = body.toLowerCase();
      const geo_restricted =
        status_code === 451 ||
        (status_code === 403 &&
          (lowerBody.includes('restricted') ||
            lowerBody.includes('location') ||
            lowerBody.includes('country') ||
            lowerBody.includes('jurisdiction') ||
            lowerBody.includes('geoblock') ||
            lowerBody.includes('cloudflare')));
      const ip_banned = status_code === 418;
      const rate_limited = status_code === 429;
      const accessible = status_code >= 200 && status_code < 300;

      return {
        url,
        accessible,
        status_code,
        latency_ms,
        geo_restricted,
        ip_banned,
        rate_limited,
        error: accessible ? null : `HTTP ${status_code}${body ? ': ' + body.slice(0, 150).trim() : ''}`,
      };
    } catch (err: any) {
      return {
        url,
        accessible: false,
        status_code: null,
        latency_ms: Date.now() - start,
        geo_restricted: false,
        ip_banned: false,
        rate_limited: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  private maskProxyUrl(proxyUrl: string): string {
    try {
      const parsed = new URL(proxyUrl);
      if (parsed.password) {
        parsed.password = '***';
      }
      return parsed.toString();
    } catch (_) {
      return proxyUrl.replace(/:\/\/([^:]+):([^@]+)@/, '://$1:***@');
    }
  }
}
