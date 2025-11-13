/**
 * Database Health Indicator Unit Tests
 *
 * Tests for health check functionality including:
 * - Overall database health checks
 * - Individual connection health
 * - Migration status checking
 * - Transaction statistics
 * - Pool monitoring
 * - Health reports and recommendations
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { DatabaseHealthIndicator } from '../../../src/modules/database/database.health.js';
import { Kysely, sql } from 'kysely';
import { Pool } from 'pg';

describe('DatabaseHealthIndicator - Unit Tests', () => {
  let healthIndicator: DatabaseHealthIndicator;
  let mockManager: any;
  let mockMigrationService: any;
  let mockTransactionManager: any;
  let mockDb: any;

  beforeEach(() => {
    mockDb = {
      execute: jest.fn().mockResolvedValue({ rows: [{ result: 1 }] }),
    };

    mockManager = {
      getConnection: jest.fn().mockResolvedValue(mockDb),
      getConnectionNames: jest.fn().mockReturnValue(['default', 'secondary']),
      isConnected: jest.fn().mockReturnValue(true),
      getPool: jest.fn(),
      getMetrics: jest.fn().mockReturnValue({
        default: {
          queryCount: 100,
          errorCount: 2,
          totalQueryTime: 5000,
        },
        secondary: {
          queryCount: 50,
          errorCount: 0,
          totalQueryTime: 2000,
        },
      }),
    };

    mockMigrationService = {
      status: jest.fn().mockResolvedValue({
        applied: [{ version: '001' }, { version: '002' }],
        pending: [],
        currentVersion: '002',
        latestVersion: '002',
        isUpToDate: true,
      }),
    };

    mockTransactionManager = {
      getStatistics: jest.fn().mockReturnValue({
        totalStarted: 50,
        totalCommitted: 45,
        totalRolledBack: 5,
        activeTransactions: 0,
        averageDuration: 120,
        maxDuration: 500,
        deadlockRetries: 2,
        errors: 3,
        nestedTransactions: 10,
      }),
    };

    healthIndicator = new DatabaseHealthIndicator(
      mockManager,
      mockMigrationService,
      mockTransactionManager
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Overall Health Check', () => {
    it('should return healthy status when all connections are healthy', async () => {
      const result = await healthIndicator.check();

      expect(result.status).toBe('healthy');
      expect(result.connections).toBeDefined();
      expect(Object.keys(result.connections)).toContain('default');
      expect(Object.keys(result.connections)).toContain('secondary');
    });

    it('should include metrics in health check', async () => {
      const result = await healthIndicator.check();

      expect(result.metrics).toBeDefined();
      expect(result.metrics.queryCount).toBe(150); // 100 + 50
      expect(result.metrics.errorCount).toBe(2);
      expect(result.metrics.connectionCount).toBe(2);
    });

    it('should include migration status', async () => {
      const result = await healthIndicator.check();

      expect(result.migrations).toBeDefined();
      expect(result.migrations.upToDate).toBe(true);
      expect(result.migrations.appliedCount).toBe(2);
      expect(result.migrations.pendingCount).toBe(0);
    });

    it('should include transaction statistics', async () => {
      const result = await healthIndicator.check();

      expect(result.transactions).toBeDefined();
      expect(result.transactions.total).toBe(50);
      expect(result.transactions.committed).toBe(45);
      expect(result.transactions.rolledBack).toBe(5);
    });

    it('should return degraded status when migrations are pending', async () => {
      mockMigrationService.status.mockResolvedValue({
        applied: [{ version: '001' }],
        pending: [{ version: '002' }, { version: '003' }],
        currentVersion: '001',
        latestVersion: '003',
        isUpToDate: false,
      });

      const result = await healthIndicator.check();

      expect(result.status).toBe('degraded');
      expect(result.migrations.pendingCount).toBe(2);
    });

    it('should return unhealthy status when connection fails', async () => {
      mockManager.isConnected.mockReturnValue(false);

      const result = await healthIndicator.check();

      expect(result.status).toBe('unhealthy');
    });

    it('should work without migration service', async () => {
      const indicatorWithoutMigrations = new DatabaseHealthIndicator(mockManager);

      const result = await indicatorWithoutMigrations.check();

      expect(result.migrations).toBeDefined();
      expect(result.migrations.upToDate).toBe(true);
      expect(result.migrations.pendingCount).toBe(0);
    });

    it('should work without transaction manager', async () => {
      const indicatorWithoutTransactions = new DatabaseHealthIndicator(
        mockManager,
        mockMigrationService
      );

      const result = await indicatorWithoutTransactions.check();

      expect(result.transactions).toBeUndefined();
    });
  });

  describe('Individual Connection Health', () => {
    it('should check healthy connection', async () => {
      const result = await healthIndicator.checkConnection('default');

      expect(result.status).toBe('connected');
      expect(result.name).toBe('default');
      expect(result.latency).toBeDefined();
      expect(result.latency).toBeGreaterThanOrEqual(0);
    });

    it('should detect disconnected connection', async () => {
      mockManager.isConnected.mockReturnValue(false);

      const result = await healthIndicator.checkConnection('default');

      expect(result.status).toBe('disconnected');
      expect(result.error).toBe('Connection not established');
    });

    it('should detect connection errors', async () => {
      mockManager.getConnection.mockRejectedValue(new Error('Connection failed'));

      const result = await healthIndicator.checkConnection('default');

      expect(result.status).toBe('error');
      expect(result.error).toBeDefined();
    });

    it('should measure connection latency', async () => {
      const result = await healthIndicator.checkConnection('default');

      expect(result.latency).toBeDefined();
      expect(typeof result.latency).toBe('number');
      expect(result.latency).toBeGreaterThanOrEqual(0);
    });

    it('should include pool statistics for PostgreSQL', async () => {
      const mockPool = {
        totalCount: 10,
        idleCount: 7,
        waitingCount: 1,
      };

      mockManager.getPool.mockReturnValue(mockPool);

      const result = await healthIndicator.checkConnection('default');

      expect(result.pool).toBeDefined();
      expect(result.pool?.total).toBe(10);
      expect(result.pool?.idle).toBe(7);
      expect(result.pool?.waiting).toBe(1);
    });

    it('should handle connection without pool', async () => {
      mockManager.getPool.mockReturnValue(undefined);

      const result = await healthIndicator.checkConnection('default');

      expect(result.pool).toBeUndefined();
    });

    it('should handle health check timeout', async () => {
      mockDb.execute.mockImplementation(() => new Promise((resolve) => setTimeout(resolve, 10000)));

      const result = await healthIndicator.checkConnection('default');

      expect(result.status).toBe('error');
      expect(result.error).toBeDefined();
    }, 15000);
  });

  describe('Migration Status Check', () => {
    it('should check up-to-date migrations', async () => {
      const result = await healthIndicator.checkMigrations();

      expect(result.upToDate).toBe(true);
      expect(result.pendingCount).toBe(0);
      expect(result.appliedCount).toBe(2);
      expect(result.currentVersion).toBe('002');
      expect(result.latestVersion).toBe('002');
    });

    it('should detect pending migrations', async () => {
      mockMigrationService.status.mockResolvedValue({
        applied: [{ version: '001' }],
        pending: [{ version: '002' }],
        currentVersion: '001',
        latestVersion: '002',
        isUpToDate: false,
      });

      const result = await healthIndicator.checkMigrations();

      expect(result.upToDate).toBe(false);
      expect(result.pendingCount).toBe(1);
    });

    it('should include migration issues', async () => {
      mockMigrationService.status.mockResolvedValue({
        applied: [],
        pending: [],
        isUpToDate: true,
        issues: ['Checksum mismatch for migration 001'],
      });

      const result = await healthIndicator.checkMigrations();

      expect(result.issues).toBeDefined();
      expect(result.issues).toContain('Checksum mismatch for migration 001');
    });

    it('should handle migration check errors', async () => {
      mockMigrationService.status.mockRejectedValue(new Error('Migration check failed'));

      const result = await healthIndicator.checkMigrations();

      expect(result.upToDate).toBe(false);
      expect(result.pendingCount).toBe(-1);
      expect(result.error).toBeDefined();
    });

    it('should return default status without migration service', async () => {
      const indicatorWithoutMigrations = new DatabaseHealthIndicator(mockManager);

      const result = await indicatorWithoutMigrations.checkMigrations();

      expect(result.upToDate).toBe(true);
      expect(result.pendingCount).toBe(0);
    });
  });

  describe('Enhanced Metrics', () => {
    it('should aggregate metrics from all connections', async () => {
      const result = await healthIndicator.check();

      expect(result.metrics.queryCount).toBe(150);
      expect(result.metrics.errorCount).toBe(2);
      expect(result.metrics.averageQueryTime).toBeGreaterThan(0);
    });

    it('should include transaction metrics', async () => {
      const result = await healthIndicator.check();

      expect(result.metrics.transactionCount).toBe(50);
      expect(result.metrics.rollbackCount).toBe(5);
    });

    it('should calculate average query time', async () => {
      const result = await healthIndicator.check();

      expect(result.metrics.averageQueryTime).toBeDefined();
      // (5000 + 2000) / (100 + 50) = 46.67
      expect(result.metrics.averageQueryTime).toBeCloseTo(46.67, 1);
    });

    it('should handle zero queries', async () => {
      mockManager.getMetrics.mockReturnValue({
        default: {
          queryCount: 0,
          errorCount: 0,
          totalQueryTime: 0,
        },
      });

      const result = await healthIndicator.check();

      expect(result.metrics.averageQueryTime).toBe(0);
    });
  });

  describe('Health Report', () => {
    it('should generate detailed health report', async () => {
      const report = await healthIndicator.getHealthReport();

      expect(report.status).toBeDefined();
      expect(report.connections).toBeDefined();
      expect(report.issues).toBeDefined();
      expect(report.recommendations).toBeDefined();
    });

    it('should identify connection errors in report', async () => {
      mockManager.isConnected.mockReturnValueOnce(true).mockReturnValueOnce(false);

      const report = await healthIndicator.getHealthReport();

      expect(report.issues.length).toBeGreaterThan(0);
      expect(report.recommendations.length).toBeGreaterThan(0);
    });

    it('should identify high latency in report', async () => {
      mockDb.execute.mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve({ rows: [{ result: 1 }] }), 150))
      );

      const report = await healthIndicator.getHealthReport();

      expect(report.issues.some((issue) => issue.includes('latency'))).toBe(true);
    });

    it('should identify high pool utilization', async () => {
      const mockPool = {
        totalCount: 10,
        idleCount: 1,
        waitingCount: 0,
      };

      mockManager.getPool.mockReturnValue(mockPool);

      const report = await healthIndicator.getHealthReport();

      // High pool utilization (9/10 = 90%)
      expect(report.issues.some((issue) => issue.includes('pool utilization'))).toBe(true);
    });

    it('should identify waiting connections', async () => {
      const mockPool = {
        totalCount: 10,
        idleCount: 0,
        waitingCount: 5,
      };

      mockManager.getPool.mockReturnValue(mockPool);

      const report = await healthIndicator.getHealthReport();

      expect(report.issues.some((issue) => issue.includes('waiting'))).toBe(true);
    });

    it('should identify query errors', async () => {
      mockManager.getMetrics.mockReturnValue({
        default: {
          queryCount: 100,
          errorCount: 10,
          totalQueryTime: 5000,
        },
      });

      const report = await healthIndicator.getHealthReport();

      expect(report.issues.some((issue) => issue.includes('error'))).toBe(true);
    });

    it('should identify slow queries', async () => {
      mockManager.getMetrics.mockReturnValue({
        default: {
          queryCount: 10,
          errorCount: 0,
          totalQueryTime: 15000, // 1500ms average
        },
      });

      const report = await healthIndicator.getHealthReport();

      expect(report.issues.some((issue) => issue.includes('query time'))).toBe(true);
    });
  });

  describe('Simple Health Check', () => {
    it('should return true when healthy', async () => {
      const isHealthy = await healthIndicator.isHealthy();
      expect(isHealthy).toBe(true);
    });

    it('should return false when unhealthy', async () => {
      mockManager.isConnected.mockReturnValue(false);

      const isHealthy = await healthIndicator.isHealthy();
      expect(isHealthy).toBe(false);
    });

    it('should return false when degraded', async () => {
      mockMigrationService.status.mockResolvedValue({
        applied: [],
        pending: [{ version: '001' }],
        isUpToDate: false,
      });

      const isHealthy = await healthIndicator.isHealthy();
      expect(isHealthy).toBe(false);
    });
  });

  describe('Connection Test', () => {
    it('should test connection successfully', async () => {
      const result = await healthIndicator.testConnection('default');
      expect(result).toBe(true);
    });

    it('should fail connection test on error', async () => {
      mockManager.getConnection.mockRejectedValue(new Error('Connection failed'));

      const result = await healthIndicator.testConnection('default');
      expect(result).toBe(false);
    });

    it('should test default connection', async () => {
      const result = await healthIndicator.testConnection();
      expect(result).toBe(true);
    });

    it('should handle SQL execution errors during test', async () => {
      mockDb.execute.mockRejectedValue(new Error('SQL error'));

      const result = await healthIndicator.testConnection('default');
      expect(result).toBe(false);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty connection names', async () => {
      mockManager.getConnectionNames.mockReturnValue([]);

      const result = await healthIndicator.check();

      expect(result.connections).toEqual({});
      expect(result.metrics.connectionCount).toBe(0);
    });

    it('should handle missing metrics', async () => {
      mockManager.getMetrics.mockReturnValue({});

      const result = await healthIndicator.check();

      expect(result.metrics.queryCount).toBe(0);
    });

    it('should handle concurrent health checks', async () => {
      const promises = Array.from({ length: 5 }, () => healthIndicator.check());

      const results = await Promise.all(promises);

      expect(results.length).toBe(5);
      results.forEach((result) => expect(result.status).toBeDefined());
    });

    it('should handle health check with slow migrations', async () => {
      mockMigrationService.status.mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve({ applied: [], pending: [] }), 100))
      );

      const result = await healthIndicator.check();

      expect(result.migrations).toBeDefined();
    });
  });

  describe('Pool Statistics', () => {
    it('should handle PostgreSQL pool', async () => {
      const pgPool = new Pool({ max: 10 });
      mockManager.getPool.mockReturnValue(pgPool);

      const result = await healthIndicator.checkConnection('default');

      expect(result.pool).toBeDefined();
    });

    it('should handle MySQL pool', async () => {
      const mysqlPool = {
        _allConnections: [1, 2, 3],
      };

      mockManager.getPool.mockReturnValue(mysqlPool);

      const result = await healthIndicator.checkConnection('default');

      expect(result.pool).toBeDefined();
    });

    it('should handle SQLite (no pool)', async () => {
      mockManager.getPool.mockReturnValue(null);

      const result = await healthIndicator.checkConnection('default');

      expect(result.pool).toBeUndefined();
    });

    it('should handle pool statistics errors gracefully', async () => {
      const brokenPool = {
        get totalCount() {
          throw new Error('Pool error');
        },
      };

      mockManager.getPool.mockReturnValue(brokenPool);

      const result = await healthIndicator.checkConnection('default');

      expect(result.pool).toBeUndefined();
    });
  });

  describe('Recommendations', () => {
    it('should provide recommendations for errors', async () => {
      mockManager.isConnected.mockReturnValue(false);

      const report = await healthIndicator.getHealthReport();

      expect(report.recommendations.length).toBeGreaterThan(0);
      expect(report.recommendations.some((rec) => rec.includes('reconnect'))).toBe(true);
    });

    it('should provide recommendations for high latency', async () => {
      mockDb.execute.mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve({ rows: [{ result: 1 }] }), 150))
      );

      const report = await healthIndicator.getHealthReport();

      expect(report.recommendations.some((rec) => rec.includes('network') || rec.includes('performance'))).toBe(
        true
      );
    });

    it('should provide recommendations for pool issues', async () => {
      const mockPool = {
        totalCount: 10,
        idleCount: 0,
        waitingCount: 5,
      };

      mockManager.getPool.mockReturnValue(mockPool);

      const report = await healthIndicator.getHealthReport();

      expect(report.recommendations.some((rec) => rec.includes('pool size') || rec.includes('optimize'))).toBe(true);
    });

    it('should provide recommendations for slow queries', async () => {
      mockManager.getMetrics.mockReturnValue({
        default: {
          queryCount: 10,
          errorCount: 0,
          totalQueryTime: 15000,
        },
      });

      const report = await healthIndicator.getHealthReport();

      expect(report.recommendations.some((rec) => rec.includes('optimize') || rec.includes('indexes'))).toBe(true);
    });
  });
});
