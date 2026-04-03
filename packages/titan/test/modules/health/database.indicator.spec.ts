/**
 * Database Health Indicator Tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { DatabaseHealthIndicator } from '../../../src/modules/health/indicators/database.indicator.js';
import type { IDatabaseConnection } from '../../../src/modules/health/indicators/database.indicator.js';

// Mock database connection
const createMockConnection = (
  options: {
    latency?: number;
    shouldFail?: boolean;
    error?: Error;
    pattern?: 'execute' | 'raw' | 'query';
  } = {}
): IDatabaseConnection => {
  const { latency = 10, shouldFail = false, error, pattern = 'execute' } = options;

  const executeQuery = async () => {
    await new Promise((resolve) => setTimeout(resolve, latency));
    if (shouldFail) {
      throw error || new Error('Database query failed');
    }
    return { rows: [{ result: 1 }] };
  };

  switch (pattern) {
    case 'raw':
      return {
        raw: () => ({
          execute: executeQuery,
        }),
      };
    case 'query':
      return {
        query: executeQuery,
      };
    case 'execute':
    default:
      return {
        execute: executeQuery,
      };
  }
};

describe('DatabaseHealthIndicator', () => {
  let indicator: DatabaseHealthIndicator;

  beforeEach(() => {
    indicator = new DatabaseHealthIndicator();
  });

  describe('constructor', () => {
    it('should create with default options', () => {
      const ind = new DatabaseHealthIndicator();
      expect(ind.name).toBe('database');
    });

    it('should create with connection', () => {
      const conn = createMockConnection();
      const ind = new DatabaseHealthIndicator(conn);
      expect(ind.name).toBe('database');
    });

    it('should create with custom options', () => {
      const ind = new DatabaseHealthIndicator(undefined, {
        latencyDegradedThreshold: 50,
        latencyUnhealthyThreshold: 200,
        healthQuery: 'SELECT NOW()',
        timeout: 3000,
      });
      expect(ind.name).toBe('database');
    });
  });

  describe('setConnection', () => {
    it('should set connection for lazy initialization', async () => {
      indicator.setConnection(createMockConnection());
      const result = await indicator.check();
      expect(result.status).toBe('healthy');
    });
  });

  describe('check', () => {
    it('should return unhealthy when connection not configured', async () => {
      const result = await indicator.check();
      expect(result.status).toBe('unhealthy');
      expect(result.message).toContain('not configured');
    });

    it('should return healthy for fast response', async () => {
      indicator.setConnection(createMockConnection({ latency: 5 }));
      const result = await indicator.check();
      expect(result.status).toBe('healthy');
      expect(result.details?.latency).toBeDefined();
    });

    it('should return degraded for slow response', async () => {
      indicator = new DatabaseHealthIndicator(createMockConnection({ latency: 150 }), {
        latencyDegradedThreshold: 100,
        latencyUnhealthyThreshold: 1000,
      });

      const result = await indicator.check();
      expect(result.status).toBe('degraded');
      expect(result.message).toContain('slow');
    });

    it('should return unhealthy for very slow response', async () => {
      indicator = new DatabaseHealthIndicator(createMockConnection({ latency: 200 }), {
        latencyDegradedThreshold: 50,
        latencyUnhealthyThreshold: 100,
      });

      const result = await indicator.check();
      expect(result.status).toBe('unhealthy');
      expect(result.message).toContain('too slow');
    });

    it('should return unhealthy on connection error', async () => {
      indicator.setConnection(
        createMockConnection({
          shouldFail: true,
          error: new Error('Connection refused'),
        })
      );

      const result = await indicator.check();
      expect(result.status).toBe('unhealthy');
      expect(result.message).toContain('Connection refused');
    });

    it('should handle timeout', async () => {
      indicator = new DatabaseHealthIndicator(createMockConnection({ latency: 200 }), {
        timeout: 50,
      });

      const result = await indicator.check();
      expect(result.status).toBe('unhealthy');
      expect(result.message).toContain('timed out');
    });

    it('should include threshold info in details', async () => {
      indicator = new DatabaseHealthIndicator(createMockConnection(), {
        latencyDegradedThreshold: 50,
        latencyUnhealthyThreshold: 100,
      });

      const result = await indicator.check();
      expect(result.details?.threshold).toEqual({
        degraded: 50,
        unhealthy: 100,
      });
    });
  });

  describe('database patterns', () => {
    it('should work with execute pattern', async () => {
      indicator.setConnection(createMockConnection({ pattern: 'execute' }));
      const result = await indicator.check();
      expect(result.status).toBe('healthy');
    });

    it('should work with raw pattern (Kysely)', async () => {
      indicator.setConnection(createMockConnection({ pattern: 'raw' }));
      const result = await indicator.check();
      expect(result.status).toBe('healthy');
    });

    it('should work with query pattern (pg)', async () => {
      indicator.setConnection(createMockConnection({ pattern: 'query' }));
      const result = await indicator.check();
      expect(result.status).toBe('healthy');
    });

    it('should fail for unsupported connection', async () => {
      indicator.setConnection({} as any);
      const result = await indicator.check();
      expect(result.status).toBe('unhealthy');
      expect(result.message).toContain('does not support any known query method');
    });
  });
});
