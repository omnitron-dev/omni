/**
 * Priceverse 2.0 - Database Schema (Kysely)
 */

import type { Generated, ColumnType } from 'kysely';
import type { PairSymbol, AggregationMethod } from '../shared/types.js';

// Price history - raw aggregated prices
export interface PriceHistoryTable {
  id: Generated<number>;
  pair: PairSymbol;
  price: ColumnType<string, string, string>; // Decimal as string
  timestamp: ColumnType<Date, Date | string, Date | string>;
  method: AggregationMethod;
  sources: ColumnType<string[], string[], string[]>; // JSON array
  volume: ColumnType<string | null, string | null, string | null>;
  created_at: ColumnType<Date, never, never>;
}

// 5-minute OHLCV candles
export interface PriceHistory5MinTable {
  id: Generated<number>;
  pair: PairSymbol;
  timestamp: ColumnType<Date, Date | string, Date | string>;
  open: ColumnType<string, string, string>;
  high: ColumnType<string, string, string>;
  low: ColumnType<string, string, string>;
  close: ColumnType<string, string, string>;
  volume: ColumnType<string, string, string>;
  vwap: ColumnType<string | null, string | null, string | null>;
  trade_count: number;
  created_at: ColumnType<Date, never, never>;
}

// 1-hour OHLCV candles
export interface PriceHistory1HourTable {
  id: Generated<number>;
  pair: PairSymbol;
  timestamp: ColumnType<Date, Date | string, Date | string>;
  open: ColumnType<string, string, string>;
  high: ColumnType<string, string, string>;
  low: ColumnType<string, string, string>;
  close: ColumnType<string, string, string>;
  volume: ColumnType<string, string, string>;
  vwap: ColumnType<string | null, string | null, string | null>;
  trade_count: number;
  created_at: ColumnType<Date, never, never>;
}

// 1-day OHLCV candles
export interface PriceHistory1DayTable {
  id: Generated<number>;
  pair: PairSymbol;
  timestamp: ColumnType<Date, Date | string, Date | string>;
  open: ColumnType<string, string, string>;
  high: ColumnType<string, string, string>;
  low: ColumnType<string, string, string>;
  close: ColumnType<string, string, string>;
  volume: ColumnType<string, string, string>;
  vwap: ColumnType<string | null, string | null, string | null>;
  trade_count: number;
  created_at: ColumnType<Date, never, never>;
}

// Complete database interface
export interface Database {
  price_history: PriceHistoryTable;
  price_history_5min: PriceHistory5MinTable;
  price_history_1hour: PriceHistory1HourTable;
  price_history_1day: PriceHistory1DayTable;
}
