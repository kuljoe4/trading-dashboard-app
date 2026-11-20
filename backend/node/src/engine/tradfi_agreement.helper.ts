import { createHmac } from 'crypto';
import { ENGINE_CONSTANTS } from '../models/constants';
import { sanitize } from '../lib/logger';

export interface TradFiAgreementCredentials {
  apiKey: string;
  apiSecret: string;
  proxyUrl?: string;
}

export interface TradFiAgreementStatusResult {
  signed: boolean | null;
  status: 'signed' | 'unsigned' | 'unconfigured' | 'error';
  symbol: string | null;
  code: number | null;
  message: string;
  detail?: string;
  checkedAt: string;
}

export interface BinanceProxyClientLike {
  genericRequest<T>(
    requestFn: () => Promise<T>,
    methodName?: string,
    isOrderEndpoint?: boolean,
    options?: { estimatedWeight?: number },
  ): Promise<T>;
  proxyFetch(url: string, init: RequestInit, proxyUrl?: string): Promise<any>;
}

export function signBinanceQuery(params: Record<string, string | number>, apiSecret: string): string {
  const query = Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&');
  const signature = createHmac('sha256', apiSecret).update(query).digest('hex');
  return `${query}&signature=${signature}`;
}

export async function parseResponsePayload(response: any): Promise<any> {
  const rawText = typeof response?.text === 'function' ? await response.text().catch(() => '') : '';
  if (rawText) {
    try {
      return JSON.parse(rawText);
    } catch (_) {
      return { msg: rawText };
    }
  }
  if (typeof response?.json === 'function') {
    return response.json().catch(() => ({}));
  }
  return {};
}

export function pickTradFiProbeSymbolFromCatalog(
  catalog: Array<{ symbol: string; assetClass?: string }>,
): string {
  const tradFiSymbols = (catalog || []).filter((s) => s.assetClass === 'tradfi');
  const preferred = ['TSLAUSDT', 'XAUUSDT', 'MVLLUSDT', 'NVDAUSDT', 'AAPLUSDT', 'SQQQUSDT'];
  for (const sym of preferred) {
    if (tradFiSymbols.some((s) => s.symbol === sym)) return sym;
  }
  if (tradFiSymbols.length > 0) return tradFiSymbols[0].symbol;
  return 'XAUUSDT';
}

/**
 * Verifies whether Binance's TradFi-Perps agreement is signed on the configured live account
 * using Binance's zero-execution POST /fapi/v1/order/test dry-run endpoint.
 * Error -4411 ("Please sign TradFi-Perps agreement contract fapi.") definitively confirms unsigned.
 */
export async function checkTradFiAgreementWithBinance(params: {
  creds: TradFiAgreementCredentials | null;
  probeSymbol: string;
  binanceClientFactory: BinanceProxyClientLike;
  onStatusResolved?: (required: boolean) => void;
  restBase?: string;
}): Promise<TradFiAgreementStatusResult> {
  const checkedAt = new Date().toISOString();
  const { creds, probeSymbol, binanceClientFactory, onStatusResolved } = params;

  if (!creds) {
    return {
      signed: null,
      status: 'unconfigured',
      symbol: null,
      code: null,
      message:
        'No live Binance API key/secret configured. Add live credentials in Settings to verify TradFi-Perps agreement status.',
      checkedAt,
    };
  }

  const restBase = (
    params.restBase ||
    process.env.BINANCE_REST_BASE ||
    ENGINE_CONSTANTS.BINANCE_REST_BASE
  ).replace(/\/$/, '');

  const signedQuery = signBinanceQuery(
    {
      symbol: probeSymbol,
      side: 'BUY',
      type: 'MARKET',
      quantity: '1',
      recvWindow: 5000,
      timestamp: Date.now(),
    },
    creds.apiSecret,
  );
  const url = `${restBase}/fapi/v1/order/test?${signedQuery}`;

  try {
    const response = await binanceClientFactory.genericRequest(
      () =>
        binanceClientFactory.proxyFetch(
          url,
          {
            method: 'POST',
            headers: {
              'X-MBX-APIKEY': creds.apiKey,
              Accept: 'application/json',
            },
            signal: AbortSignal.timeout(10000),
          },
          creds.proxyUrl,
        ),
      'testOrderTradFiAgreement',
      false,
      { estimatedWeight: 1 },
    );

    const payload = await parseResponsePayload(response);
    const code = typeof payload?.code === 'number' ? payload.code : response.status;
    const rawMsg = String(payload?.msg || '');
    const safeMsg = sanitize(rawMsg);

    // Definitively unsigned: Binance returns -4411 ("Please sign TradFi-Perps agreement contract fapi.")
    if (code === -4411 || /TradFi-Perps|agreement|stock.*contract/i.test(rawMsg)) {
      onStatusResolved?.(true);
      return {
        signed: false,
        status: 'unsigned',
        symbol: probeSymbol,
        code,
        message: `TradFi-Perps agreement is NOT signed on this Binance account (checked via ${probeSymbol}).`,
        detail: safeMsg || 'Binance returned error -4411 (TradFi-Perps agreement required).',
        checkedAt,
      };
    }

    // Auth / geo / network failures cannot confirm agreement status either way
    if (
      response.status === 451 ||
      response.status === 403 ||
      code === -2015 ||
      code === -2014 ||
      code === -1022 ||
      code === -1021 ||
      code === -1003
    ) {
      return {
        signed: null,
        status: 'error',
        symbol: probeSymbol,
        code,
        message: safeMsg || `Unable to verify agreement status (HTTP ${response.status}).`,
        checkedAt,
      };
    }

    // 200 OK or post-agreement order filter codes (-1111 precision, -4164 min notional, -2019 margin, -4003 qty, etc.)
    // prove the account passed Binance's -4411 TradFi-Perps agreement gate.
    if (response.ok || (typeof payload?.code === 'number' && payload.code !== -1121)) {
      onStatusResolved?.(false);
      return {
        signed: true,
        status: 'signed',
        symbol: probeSymbol,
        code: response.ok ? 200 : code,
        message: `Confirmed: TradFi-Perps agreement is SIGNED on this Binance account (verified via ${probeSymbol} dry-run).`,
        detail: response.ok ? 'Binance /fapi/v1/order/test accepted.' : safeMsg,
        checkedAt,
      };
    }

    return {
      signed: null,
      status: 'error',
      symbol: probeSymbol,
      code,
      message: safeMsg || `Could not confirm agreement status for ${probeSymbol}.`,
      checkedAt,
    };
  } catch (err: any) {
    return {
      signed: null,
      status: 'error',
      symbol: probeSymbol,
      code: null,
      message: sanitize(err?.message || 'Failed to contact Binance to verify TradFi-Perps agreement.'),
      checkedAt,
    };
  }
}

/**
 * Explicitly signs Binance's TradFi-Perps agreement contract via POST /fapi/v1/stock/contract.
 */
export async function signTradFiAgreementWithBinance(params: {
  creds: TradFiAgreementCredentials;
  binanceClientFactory: BinanceProxyClientLike;
  restBase?: string;
}): Promise<{ ok: boolean; status: number; errorMessage?: string }> {
  const { creds, binanceClientFactory } = params;
  const restBase = (
    params.restBase ||
    process.env.BINANCE_REST_BASE ||
    ENGINE_CONSTANTS.BINANCE_REST_BASE
  ).replace(/\/$/, '');

  const signedQuery = signBinanceQuery(
    {
      recvWindow: 5000,
      timestamp: Date.now(),
    },
    creds.apiSecret,
  );
  const url = `${restBase}/fapi/v1/stock/contract?${signedQuery}`;

  const response = await binanceClientFactory.genericRequest(
    () =>
      binanceClientFactory.proxyFetch(
        url,
        {
          method: 'POST',
          headers: {
            'X-MBX-APIKEY': creds.apiKey,
            Accept: 'application/json',
          },
          signal: AbortSignal.timeout(10000),
        },
        creds.proxyUrl,
      ),
    'signTradFiAgreement',
    false,
    { estimatedWeight: 50 },
  );

  const payload = await parseResponsePayload(response);
  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      errorMessage: sanitize(String(payload?.msg || `HTTP ${response.status}`)),
    };
  }
  return { ok: true, status: response.status };
}
