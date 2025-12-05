/**
 * Priceverse 2.0 - Shared Types
 */

// Supported trading pairs
export type PairSymbol =
  | 'btc-usd'
  | 'xmr-usd'
  | 'btc-rub'
  | 'xmr-rub'
  | 'eth-usd'
  | 'eth-rub';

// Aggregation methods
export type AggregationMethod = 'vwap' | 'median' | 'mean';

// Chart intervals
export type ChartInterval = '5min' | '1hour' | '1day';

// Time periods
export type TimePeriod = '24hours' | '7days' | '30days' | 'custom';

// Trade from exchange
export interface Trade {
  exchange: string;
  pair: string;
  price: string;
  volume: string;
  timestamp: number;
  tradeId: string;
}

// Trade entry for aggregation buffer
export interface TradeEntry {
  price: number;
  volume: number;
  timestamp: number;
  exchange: string;
}

// VWAP calculation result
export interface VwapResult {
  pair: string;
  price: number;
  volume: number;
  sources: string[];
  timestamp: number;
}

// Price response
export interface PriceResponse {
  pair: string;
  price: number;
  timestamp: number;
}

// Price change response
export interface PriceChangeResponse {
  pair: string;
  startDate: number;
  endDate: number;
  startPrice: number;
  endPrice: number;
  changePercent: number;
}

// Chart response
export interface ChartResponse {
  dates: string[];
  series: number[];
  ohlcv?: {
    open: number[];
    high: number[];
    low: number[];
    close: number[];
    volume: number[];
  };
}

// OHLCV candle
export interface OhlcvCandle {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  vwap: number | null;
}

// OHLCV response with pagination
export interface OhlcvResponse {
  candles: OhlcvCandle[];
  pagination: {
    total: number;
    limit: number;
    offset: number;
  };
}

// Health check result
export interface HealthCheck {
  status: 'up' | 'down';
  latency?: number;
  message?: string;
}

// Health response
export interface HealthResponse {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  uptime: number;
  version: string;
  checks: Record<string, HealthCheck>;
  latency?: number;
}

// Exchange worker stats
export interface ExchangeWorkerStats {
  exchange: string;
  connected: boolean;
  tradesReceived: number;
  errors: number;
  lastLatency?: number;
}

// Supported exchanges
export const SUPPORTED_EXCHANGES = [
  'binance',
  'kraken',
  'coinbase',
  'okx',
  'bybit',
  'kucoin',
] as const;

export type SupportedExchange = (typeof SUPPORTED_EXCHANGES)[number];

// Supported pairs
export const SUPPORTED_PAIRS: PairSymbol[] = [
  'btc-usd',
  'xmr-usd',
  'eth-usd',
  'btc-rub',
  'xmr-rub',
  'eth-rub',
];

// USD pairs (base pairs for aggregation)
export const USD_PAIRS: PairSymbol[] = ['btc-usd', 'xmr-usd', 'eth-usd'];
