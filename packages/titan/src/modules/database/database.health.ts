/**
 * Database Health Indicator
 *
 * Provides health check functionality for database connections
 */

import { Injectable, Inject } from '../../decorators/index.js';
import { Pool } from 'pg';
import * as mysql from 'mysql2';
import { sql } from 'kysely';
import { Logger } from '../logger/index.js';
import { DatabaseManager } from './database.manager.js';
import { MigrationService } from './migration/migration.service.js';
import { TransactionManager } from './transaction/transaction.manager.js';
import {
  DATABASE_MANAGER,
  DATABASE_MIGRATION_SERVICE,
  DATABASE_TRANSACTION_MANAGER,
  DEFAULT_TIMEOUTS,
} from './database.constants.js';
import type {
  DatabaseHealthCheckResult,
  ConnectionHealthStatus,
  MigrationHealthStatus,
  DatabaseMetrics,
} from './database.types.js';

@Injectable()
export class DatabaseHealthIndicator {
  private logger: any;
  private queryPerformanceMetrics: Map<string, {
    count: number;
    totalTime: number;
    slowQueries: number;
    errors: number;
  }> = new Map();

  constructor(
    @Inject(DATABASE_MANAGER) private manager: DatabaseManager,
    @Inject(DATABASE_MIGRATION_SERVICE) private migrationService?: MigrationService,
    @Inject(DATABASE_TRANSACTION_MANAGER) private transactionManager?: TransactionManager
  ) {
    // Create a noop logger
    this.logger = {
      info: () => {},
      error: () => {},
      warn: () => {},
      debug: () => {},
      trace: () => {},
      fatal: () => {},
    };
    this.initializeMetricsCollection();
  }

  /**
   * Initialize metrics collection
   */
  private initializeMetricsCollection(): void {
    // Subscribe to query events from manager if available
    // Note: This would require the manager to emit events, which is not currently implemented
    // For now, metrics are collected from the manager's getMetrics() method
  }

  /**
   * Record query performance metrics
   */
  private recordQueryMetrics(event: {
    connection: string;
    duration: number;
    error?: any;
  }): void {
    const metrics = this.queryPerformanceMetrics.get(event.connection) || {
      count: 0,
      totalTime: 0,
      slowQueries: 0,
      errors: 0,
    };

    metrics.count++;
    metrics.totalTime += event.duration;

    if (event.duration > 1000) { // Queries slower than 1 second
      metrics.slowQueries++;
    }

    if (event.error) {
      metrics.errors++;
    }

    this.queryPerformanceMetrics.set(event.connection, metrics);
  }

  /**
   * Check overall database health
   */
  async check(): Promise<DatabaseHealthCheckResult> {
    const connections: Record<string, ConnectionHealthStatus> = {};
    const connectionNames = this.manager.getConnectionNames();

    // Check each connection
    for (const name of connectionNames) {
      connections[name] = await this.checkConnection(name);
    }

    // Check migration status
    const migrationStatus = await this.checkMigrations();

    // Get transaction statistics
    const transactionStats = this.getTransactionStatistics();

    // Determine overall status
    const statuses = Object.values(connections).map(c => c.status);
    const hasError = statuses.some(s => s === 'error' || s === 'disconnected');
    const allHealthy = statuses.every(s => s === 'connected');
    const migrationPending = migrationStatus.pendingCount > 0;

    const status = hasError ? 'unhealthy' :
      (allHealthy && !migrationPending) ? 'healthy' : 'degraded';

    // Get enhanced metrics
    const metrics = this.getEnhancedMetrics();

    return {
      status,
      connections,
      metrics,
      migrations: migrationStatus,
      transactions: transactionStats,
    };
  }

  /**
   * Check specific connection health
   */
  async checkConnection(name: string): Promise<ConnectionHealthStatus> {
    const startTime = Date.now();

    try {
      // Check if connection exists
      if (!this.manager.isConnected(name)) {
        return {
          name,
          status: 'disconnected',
          error: 'Connection not established',
        };
      }

      // Get connection and test it
      const db = await this.manager.getConnection(name);
      const timeout = DEFAULT_TIMEOUTS.health;

      // Execute health check query with timeout
      await Promise.race([
        sql`SELECT 1`.execute(db),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Health check timeout')), timeout)
        ),
      ]);

      const latency = Date.now() - startTime;

      // Get pool statistics if available
      const pool = this.manager.getPool(name);
      const poolStats = await this.getPoolStatistics(pool);

      return {
        name,
        status: 'connected',
        latency,
        pool: poolStats,
      };
    } catch (error) {
      const latency = Date.now() - startTime;

      this.logger.warn(
        { name, error, latency },
        'Database health check failed'
      );

      return {
        name,
        status: 'error',
        latency,
        error: (error as Error).message,
      };
    }
  }

  /**
   * Get pool statistics
   */
  private async getPoolStatistics(
    pool: any
  ): Promise<ConnectionHealthStatus['pool'] | undefined> {
    if (!pool) {
      return undefined;
    }

    try {
      // PostgreSQL pool
      if (pool instanceof Pool) {
        // Get pool statistics from pg Pool
        const poolStats = {
          total: pool.totalCount,
          idle: pool.idleCount,
          waiting: pool.waitingCount,
        };
        return {
          total: poolStats.total,
          active: poolStats.total - poolStats.idle,
          idle: poolStats.idle,
          waiting: poolStats.waiting,
        };
      }

      // MySQL pool
      if (pool && typeof pool._allConnections !== 'undefined') {
        const mysqlPool = pool as mysql.Pool;
        // MySQL pool statistics are not directly accessible
        // This is a simplified version
        return {
          total: (mysqlPool as any)._allConnections?.length || 0,
          active: 0, // Would need custom tracking
          idle: 0,
          waiting: 0,
        };
      }

      // SQLite doesn't have a pool
      return undefined;
    } catch (error) {
      this.logger.debug({ error }, 'Failed to get pool statistics');
      return undefined;
    }
  }

  /**
   * Check migration status
   */
  async checkMigrations(): Promise<MigrationHealthStatus> {
    if (!this.migrationService) {
      return {
        upToDate: true,
        pendingCount: 0,
      };
    }

    try {
      const status = await this.migrationService.status();
      return {
        upToDate: status.pending.length === 0,
        pendingCount: status.pending.length,
        appliedCount: status.applied.length,
        currentVersion: status.currentVersion,
        latestVersion: status.latestVersion,
        issues: status.issues,
      };
    } catch (error) {
      this.logger.error({ error }, 'Failed to check migration status');
      return {
        upToDate: false,
        pendingCount: -1,
        error: (error as Error).message,
      };
    }
  }

  /**
   * Get transaction statistics
   */
  private getTransactionStatistics(): any {
    if (!this.transactionManager) {
      return null;
    }

    try {
      const stats = this.transactionManager.getStatistics();
      return {
        total: stats.totalStarted,
        committed: stats.totalCommitted,
        rolledBack: stats.totalRolledBack,
        active: stats.activeTransactions,
        averageDuration: stats.averageDuration,
        maxDuration: stats.maxDuration,
        deadlockRetries: stats.deadlockRetries,
        errors: stats.errors,
        nested: stats.nestedTransactions,
      };
    } catch (error) {
      return null;
    }
  }

  /**
   * Get enhanced metrics from all connections
   */
  private getEnhancedMetrics(): DatabaseMetrics {
    const allMetrics = this.manager.getMetrics();

    const aggregated: DatabaseMetrics = {
      queryCount: 0,
      slowQueryCount: 0,
      errorCount: 0,
      averageQueryTime: 0,
      connectionCount: this.manager.getConnectionNames().length,
      transactionCount: 0,
      rollbackCount: 0,
    };

    let totalQueryTime = 0;

    // Aggregate base metrics from manager
    for (const metrics of Object.values(allMetrics)) {
      aggregated.queryCount += metrics.queryCount || 0;
      aggregated.errorCount += metrics.errorCount || 0;
      totalQueryTime += metrics.totalQueryTime || 0;
    }

    // Add performance metrics collected locally
    for (const [, metrics] of this.queryPerformanceMetrics) {
      aggregated.slowQueryCount += metrics.slowQueries;
    }

    // Add transaction metrics if available
    if (this.transactionManager) {
      const txStats = this.transactionManager.getStatistics();
      aggregated.transactionCount = txStats.totalStarted;
      aggregated.rollbackCount = txStats.totalRolledBack;
    }

    if (aggregated.queryCount > 0) {
      aggregated.averageQueryTime = totalQueryTime / aggregated.queryCount;
    }

    return aggregated;
  }

  /**
   * Get aggregated metrics from all connections (deprecated - kept for compatibility)
   */
  private getAggregatedMetrics(): DatabaseMetrics {
    return this.getEnhancedMetrics();
  }

  /**
   * Check if database is healthy (simple boolean check)
   */
  async isHealthy(): Promise<boolean> {
    const result = await this.check();
    return result.status === 'healthy';
  }

  /**
   * Get detailed health report
   */
  async getHealthReport(): Promise<{
    status: string;
    connections: ConnectionHealthStatus[];
    issues: string[];
    recommendations: string[];
  }> {
    const health = await this.check();
    const issues: string[] = [];
    const recommendations: string[] = [];

    // Analyze connections
    for (const [name, connection] of Object.entries(health.connections)) {
      if (connection.status === 'error') {
        issues.push(`Connection "${name}" is in error state: ${connection.error}`);
        recommendations.push(`Check database server for "${name}" and verify credentials`);
      } else if (connection.status === 'disconnected') {
        issues.push(`Connection "${name}" is disconnected`);
        recommendations.push(`Attempt to reconnect to "${name}"`);
      }

      // Check latency
      if (connection.latency && connection.latency > 100) {
        issues.push(`High latency on connection "${name}": ${connection.latency}ms`);
        recommendations.push(`Investigate network issues or database performance for "${name}"`);
      }

      // Check pool health
      if (connection.pool) {
        const poolUtilization = connection.pool.active / connection.pool.total;
        if (poolUtilization > 0.8) {
          issues.push(`High pool utilization on "${name}": ${(poolUtilization * 100).toFixed(1)}%`);
          recommendations.push(`Consider increasing pool size for "${name}"`);
        }

        if (connection.pool.waiting > 0) {
          issues.push(`${connection.pool.waiting} connections waiting in queue for "${name}"`);
          recommendations.push(`Increase pool size or optimize queries for "${name}"`);
        }
      }
    }

    // Check metrics
    if (health.metrics) {
      if (health.metrics.errorCount > 0) {
        issues.push(`${health.metrics.errorCount} query errors detected`);
        recommendations.push('Review error logs and fix failing queries');
      }

      if (health.metrics.averageQueryTime > 1000) {
        issues.push(`High average query time: ${health.metrics.averageQueryTime.toFixed(0)}ms`);
        recommendations.push('Optimize slow queries and add appropriate indexes');
      }
    }

    return {
      status: health.status,
      connections: Object.values(health.connections),
      issues,
      recommendations,
    };
  }

  /**
   * Perform connection test
   */
  async testConnection(name?: string): Promise<boolean> {
    try {
      const db = await this.manager.getConnection(name);
      await sql`SELECT 1`.execute(db);
      return true;
    } catch (error) {
      this.logger.error({ name, error }, 'Connection test failed');
      return false;
    }
  }
}