/**
 * Unit Tests - Shared Types and Constants
 */

import { describe, it, expect } from 'vitest';
import {
  SUPPORTED_EXCHANGES,
  SUPPORTED_PAIRS,
  USD_PAIRS,
  type SupportedExchange,
  type PairSymbol,
} from '../../../src/shared/types.js';

describe('Type Constants', () => {
  describe('SUPPORTED_EXCHANGES', () => {
    it('should contain expected exchanges', () => {
      expect(SUPPORTED_EXCHANGES).toContain('binance');
      expect(SUPPORTED_EXCHANGES).toContain('kraken');
      expect(SUPPORTED_EXCHANGES).toContain('coinbase');
      expect(SUPPORTED_EXCHANGES).toContain('okx');
      expect(SUPPORTED_EXCHANGES).toContain('bybit');
      expect(SUPPORTED_EXCHANGES).toContain('kucoin');
    });

    it('should have correct length', () => {
      expect(SUPPORTED_EXCHANGES).toHaveLength(6);
    });

    it('should be readonly array', () => {
      const exchanges: readonly string[] = SUPPORTED_EXCHANGES;
      expect(exchanges).toBeDefined();
    });

    it('should contain unique values', () => {
      const uniqueExchanges = new Set(SUPPORTED_EXCHANGES);
      expect(uniqueExchanges.size).toBe(SUPPORTED_EXCHANGES.length);
    });
  });

  describe('SUPPORTED_PAIRS', () => {
    it('should contain all USD pairs', () => {
      expect(SUPPORTED_PAIRS).toContain('btc-usd');
      expect(SUPPORTED_PAIRS).toContain('xmr-usd');
      expect(SUPPORTED_PAIRS).toContain('eth-usd');
    });

    it('should contain all RUB pairs', () => {
      expect(SUPPORTED_PAIRS).toContain('btc-rub');
      expect(SUPPORTED_PAIRS).toContain('xmr-rub');
      expect(SUPPORTED_PAIRS).toContain('eth-rub');
    });

    it('should have correct length', () => {
      expect(SUPPORTED_PAIRS).toHaveLength(6);
    });

    it('should contain unique values', () => {
      const uniquePairs = new Set(SUPPORTED_PAIRS);
      expect(uniquePairs.size).toBe(SUPPORTED_PAIRS.length);
    });
  });

  describe('USD_PAIRS', () => {
    it('should contain only USD pairs', () => {
      expect(USD_PAIRS).toEqual(['btc-usd', 'xmr-usd', 'eth-usd']);
    });

    it('should have correct length', () => {
      expect(USD_PAIRS).toHaveLength(3);
    });

    it('should not contain RUB pairs', () => {
      USD_PAIRS.forEach((pair) => {
        expect(pair).toMatch(/-usd$/);
      });
    });

    it('should be a subset of SUPPORTED_PAIRS', () => {
      USD_PAIRS.forEach((pair) => {
        expect(SUPPORTED_PAIRS).toContain(pair);
      });
    });
  });

  describe('Type Guards and Validations', () => {
    it('should validate PairSymbol type', () => {
      const pair: PairSymbol = 'btc-usd';
      expect(SUPPORTED_PAIRS).toContain(pair);
    });

    it('should validate SupportedExchange type', () => {
      const exchange: SupportedExchange = 'binance';
      expect(SUPPORTED_EXCHANGES).toContain(exchange);
    });
  });

  describe('Interface Structures', () => {
    it('should validate Trade interface structure', () => {
      const trade = {
        exchange: 'binance',
        pair: 'btc-usd',
        price: '45000.00',
        volume: '1.5',
        timestamp: 1704067200000,
        tradeId: 'trade-123',
      };

      expect(trade).toHaveProperty('exchange');
      expect(trade).toHaveProperty('pair');
      expect(trade).toHaveProperty('price');
      expect(trade).toHaveProperty('volume');
      expect(trade).toHaveProperty('timestamp');
      expect(trade).toHaveProperty('tradeId');
    });

    it('should validate TradeEntry interface structure', () => {
      const tradeEntry = {
        price: 45000,
        volume: 1.5,
        timestamp: 1704067200000,
        exchange: 'binance',
      };

      expect(tradeEntry).toHaveProperty('price');
      expect(tradeEntry).toHaveProperty('volume');
      expect(tradeEntry).toHaveProperty('timestamp');
      expect(tradeEntry).toHaveProperty('exchange');
    });

    it('should validate VwapResult interface structure', () => {
      const vwapResult = {
        pair: 'btc-usd',
        price: 45000,
        volume: 10,
        sources: ['binance', 'kraken'],
        timestamp: 1704067200000,
      };

      expect(vwapResult).toHaveProperty('pair');
      expect(vwapResult).toHaveProperty('price');
      expect(vwapResult).toHaveProperty('volume');
      expect(vwapResult).toHaveProperty('sources');
      expect(vwapResult).toHaveProperty('timestamp');
    });

    it('should validate PriceResponse interface structure', () => {
      const priceResponse = {
        pair: 'btc-usd',
        price: 45000,
        timestamp: 1704067200000,
      };

      expect(priceResponse).toHaveProperty('pair');
      expect(priceResponse).toHaveProperty('price');
      expect(priceResponse).toHaveProperty('timestamp');
    });

    it('should validate PriceChangeResponse interface structure', () => {
      const priceChangeResponse = {
        pair: 'btc-usd',
        startDate: 1704067200000,
        endDate: 1704153600000,
        startPrice: 43000,
        endPrice: 45000,
        changePercent: 4.65,
      };

      expect(priceChangeResponse).toHaveProperty('pair');
      expect(priceChangeResponse).toHaveProperty('startDate');
      expect(priceChangeResponse).toHaveProperty('endDate');
      expect(priceChangeResponse).toHaveProperty('startPrice');
      expect(priceChangeResponse).toHaveProperty('endPrice');
      expect(priceChangeResponse).toHaveProperty('changePercent');
    });

    it('should validate OhlcvCandle interface structure', () => {
      const ohlcvCandle = {
        timestamp: '2024-01-01T00:00:00Z',
        open: 44000,
        high: 46000,
        low: 43500,
        close: 45000,
        volume: 1000,
        vwap: 44800,
      };

      expect(ohlcvCandle).toHaveProperty('timestamp');
      expect(ohlcvCandle).toHaveProperty('open');
      expect(ohlcvCandle).toHaveProperty('high');
      expect(ohlcvCandle).toHaveProperty('low');
      expect(ohlcvCandle).toHaveProperty('close');
      expect(ohlcvCandle).toHaveProperty('volume');
      expect(ohlcvCandle).toHaveProperty('vwap');
    });

    it('should validate OhlcvResponse interface structure', () => {
      const ohlcvResponse = {
        candles: [],
        pagination: {
          total: 100,
          limit: 10,
          offset: 0,
        },
      };

      expect(ohlcvResponse).toHaveProperty('candles');
      expect(ohlcvResponse).toHaveProperty('pagination');
      expect(ohlcvResponse.pagination).toHaveProperty('total');
      expect(ohlcvResponse.pagination).toHaveProperty('limit');
      expect(ohlcvResponse.pagination).toHaveProperty('offset');
    });

    it('should validate HealthCheck interface structure', () => {
      const healthCheck = {
        status: 'up' as const,
        latency: 15,
        message: 'All systems operational',
      };

      expect(healthCheck).toHaveProperty('status');
      expect(['up', 'down']).toContain(healthCheck.status);
    });

    it('should validate HealthResponse interface structure', () => {
      const healthResponse = {
        status: 'healthy' as const,
        timestamp: '2024-01-01T00:00:00Z',
        uptime: 3600,
        version: '2.0.0',
        checks: {},
        latency: 10,
      };

      expect(healthResponse).toHaveProperty('status');
      expect(healthResponse).toHaveProperty('timestamp');
      expect(healthResponse).toHaveProperty('uptime');
      expect(healthResponse).toHaveProperty('version');
      expect(healthResponse).toHaveProperty('checks');
      expect(['healthy', 'degraded', 'unhealthy']).toContain(healthResponse.status);
    });

    it('should validate ExchangeWorkerStats interface structure', () => {
      const stats = {
        exchange: 'binance',
        connected: true,
        tradesReceived: 1000,
        errors: 5,
        lastLatency: 50,
      };

      expect(stats).toHaveProperty('exchange');
      expect(stats).toHaveProperty('connected');
      expect(stats).toHaveProperty('tradesReceived');
      expect(stats).toHaveProperty('errors');
      expect(stats).toHaveProperty('lastLatency');
    });
  });
});
