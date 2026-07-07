/**
 * Type definitions for Binance USDS-M Futures API responses (v31.0.0+)
 * Based on Binance API documentation and current project usage.
 */

export interface BinanceResponse<T> {
  data: () => Promise<T>;
  headers: any;
  status: number;
}

export interface BinanceExchangeInfo {
  timezone: string;
  serverTime: number;
  rateLimits: BinanceRateLimit[];
  symbols: BinanceSymbol[];
}

export interface BinanceRateLimit {
  rateLimitType: 'REQUEST_WEIGHT' | 'ORDERS' | 'RAW_REQUESTS';
  interval: 'MINUTE' | 'SECOND' | 'DAY';
  intervalNum: number;
  limit: number;
}

export interface BinanceSymbol {
  symbol: string;
  pair: string;
  contractType: string;
  deliveryDate: number;
  onboardDate: number;
  status: string;
  maintMarginPercent: string;
  requiredMarginPercent: string;
  baseAsset: string;
  quoteAsset: string;
  marginAsset: string;
  pricePrecision: number;
  quantityPrecision: number;
  baseAssetPrecision: number;
  quotePrecision: number;
  underlyingType: string;
  underlyingSubType: string[];
  settlePlan: number;
  triggerProtect: string;
  filters: BinanceFilter[];
  orderTypes: string[];
  timeInForce: string[];
  liquidationFee: string;
  marketTakeBound: string;
}

export interface BinanceFilter {
  filterType: 'PRICE_FILTER' | 'LOT_SIZE' | 'MARKET_LOT_SIZE' | 'MAX_NUM_ORDERS' | 'MAX_NUM_ALGO_ORDERS' | 'MIN_NOTIONAL' | 'PERCENT_PRICE' | 'NOTIONAL';
  tickSize?: string;
  stepSize?: string;
  maxQty?: string;
  minQty?: string;
  notional?: string;
  minNotional?: string; // Some API versions use this
  multiplierUp?: string;
  multiplierDown?: string;
  multiplierDecimal?: number;
}

export interface BinanceOrderReceipt {
  orderId: number;
  symbol: string;
  status: string;
  clientOrderId: string;
  price: string;
  avgPrice: string;
  origQty: string;
  executedQty: string;
  cumQty: string;
  cumQuote: string;
  timeInForce: string;
  type: string;
  reduceOnly: boolean;
  closePosition: boolean;
  side: string;
  positionSide: string;
  stopPrice: string;
  workingType: string;
  priceProtect: boolean;
  origType: string;
  updateTime: number;
  code?: number;
  msg?: string;
  fills?: BinanceOrderFill[];
  // Added for compatibility with some responses
  triggerPrice?: string;
}

export interface BinanceAlgoOrderReceipt {
  algoId: number;
  symbol: string;
  algoStatus: string;
  algoType: string;
  clientOrderId: string;
  side: string;
  positionSide: string;
  stopPrice: string;
  triggerPrice?: string;
  workingType: string;
  priceProtect: boolean;
  origType: string;
  updateTime: number;
  code?: number;
  msg?: string;
  status?: string; // Fallback for some endpoints
  orderId?: number; // Fallback
}

export interface BinanceOrderFill {
  price: string;
  qty: string;
  commission: string;
  commissionAsset: string;
  tradeId: number;
}

export interface BinancePositionV3 {
  symbol: string;
  positionAmt: string;
  entryPrice: string;
  breakEvenPrice: string;
  markPrice: string;
  unRealizedProfit: string;
  liquidationPrice: string;
  leverage: string;
  maxNotionalValue: string;
  marginType: string;
  isolatedMargin: string;
  isAutoAddMargin: string;
  positionSide: string;
  notional: string;
  isolatedWallet: string;
  updateTime: number;
}

export interface BinanceBalanceV3 {
  asset: string;
  balance: string;
  crossWalletBalance: string;
  crossUnPnl: string;
  availableBalance: string;
  maxWithdrawAmount: string;
  marginAvailable: boolean;
  updateTime: number;
}

export interface BinanceUserCommissionRate {
  symbol: string;
  makerCommissionRate: string;
  takerCommissionRate: string;
}

export interface BinanceTrade {
  symbol: string;
  id: number;
  orderId: number;
  side: string;
  price: string;
  qty: string;
  realizedPnl: string;
  marginAsset: string;
  quoteQty: string;
  commission: string;
  commissionAsset: string;
  time: number;
  buyer: boolean;
  maker: boolean;
}

export interface BinanceOrderUpdateEvent {
  e: 'ORDER_TRADE_UPDATE';
  E: number; // Event time
  T: number; // Transaction time
  o: {
    s: string; // Symbol
    c: string; // Client Order Id
    S: string; // Side
    o: string; // Order Type
    f: string; // Time in Force
    q: string; // Original Quantity
    p: string; // Original Price
    ap: string; // Average Price
    sp: string; // Stop Price
    x: string; // Execution Type
    X: string; // Order Status
    i: number; // Order Id
    l: string; // Order Last Filled Quantity
    z: string; // Order Filled Accumulated Quantity
    L: string; // Last Filled Price
    N: string; // Commission Asset
    n: string; // Commission
    T: number; // Order Trade Time
    t: number; // Trade Id
    b: string; // Bids Notional
    a: string; // Ask Notional
    m: boolean; // Is this trade the maker side?
    R: boolean; // Is this reduce only
    wt: string; // Working Type
    ot: string; // Original Order Type
    ps: string; // Position Side
    cp: boolean; // If Close-All
    rp: string; // Realized Profit of the trade
    pP: boolean; // If price protection is turned on
    si: number; // ignore
    ss: number; // ignore
  };
}

export interface BinancePositionMode {
  dualSidePosition: boolean;
}

export interface BinanceStandardResponse {
  code: number;
  msg: string;
}

export interface BinanceListenKeyResponse {
  listenKey: string;
}

export interface BinanceAccountUpdateEvent {
  e: 'ACCOUNT_UPDATE';
  E: number;
  T: number;
  a: {
    m: string; // Event reason type
    B: {
      a: string; // Asset
      wb: string; // Wallet Balance
      cw: string; // Cross Wallet Balance
      bc: string; // Balance Change
    }[];
    P: {
      s: string; // Symbol
      pa: string; // Position Amount
      ep: string; // Entry Price
      cr: string; // (Pre-fee) Accumulated Realized
      up: string; // Unrealized PnL
      mt: string; // Margin Type
      iw: string; // Isolated Wallet (if isolated)
      ps: string; // Position Side
      ma: string; // Margin Asset
    }[];
  };
}
