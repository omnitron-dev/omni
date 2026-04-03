/**
 * Database Health Indicator
 *
 * Provides health check functionality for database connections.
 */

import { Injectable, Inject } from '@omnitron-dev/titan/decorators';
import { Pool } from 'pg';
import { sql } from 'kysely';
import { Errors } from '@omnitron-dev/titan/errors';
import { DatabaseManager } from './database.manager.js';
import {
  DATABASE_MANAGER,
  DEFAULT_TIMEOUTS,
} from './database.constants.js';
import type {
  DatabaseHealthCheckResult,
  ConnectionHealthStatus,
  DatabaseMetrics,
} from './database.types.js';
import { createNullLogger, type ILogger } from '@omnitron-dev/titan/module/logger';
import { checkDatabaseHealth, type HealthCheckResult } from '@kysera/infra';

@Injectable()
export class DatabaseHealthIndicator {
  private logger: ILogger;

  constructor(
    @Inject(DATABASE_MANAGER) private manager: DatabaseManager,
    logger?: ILogger
  ) {
    this.logger = logger ? logger.child({ module: 'DatabaseHealthIndicator' }) : createNullLogger();
  }

  async check(): Promise<DatabaseHealthCheckResult> {
    const connections: Record<string, ConnectionHealthStatus> = {};
    const connectionNames = this.manager.getConnectionNames();

    for (const name of connectionNames) {
      connections[name] = await this.checkConnection(name);
    }

    const statuses = Object.values(connections).map((c) => c.status);
    const hasError = statuses.some((s) => s === 'error' || s === 'disconnected');
    const allHealthy = statuses.every((s) => s === 'connected');
    const status = hasError ? 'unhealthy' : allHealthy ? 'healthy' : 'degraded';

    const metrics = this.getMetrics();

    return { status, connections, metrics };
  }

  async checkConnection(name: string): Promise<ConnectionHealthStatus> {
    const startTime = Date.now();

    try {
      if (!this.manager.isConnected(name)) {
        return { name, status: 'disconnected', error: 'Connection not established' };
      }

      const db = await this.manager.getConnection(name);
      const timeout = DEFAULT_TIMEOUTS.health;

      await Promise.race([
        sql`SELECT 1`.execute(db),
        new Promise((_, reject) => setTimeout(() => reject(Errors.timeout('database health check', timeout)), timeout)),
      ]);

      const latency = Date.now() - startTime;
      const pool = this.manager.getPool(name);
      const poolStats = this.getPoolStatistics(pool);

      return { name, status: 'connected', latency, pool: poolStats };
    } catch (error) {
      const latency = Date.now() - startTime;
      this.logger.warn({ name, error, latency }, 'Database health check failed');
      return { name, status: 'error', latency, error: (error as Error).message };
    }
  }

  private getPoolStatistics(pool: unknown): ConnectionHealthStatus['pool'] | undefined {
    if (!pool) return undefined;

    try {
      if (pool instanceof Pool) {
        return {
          total: pool.totalCount,
          active: pool.totalCount - pool.idleCount,
          idle: pool.idleCount,
          waiting: pool.waitingCount,
        };
      }

      if (pool && typeof (pool as { _allConnections?: unknown })._allConnections !== 'undefined') {
        const allConnections = (pool as unknown as { _allConnections?: unknown[] })._allConnections;
        return { total: allConnections?.length || 0, active: 0, idle: 0, waiting: 0 };
      }

      return undefined;
    } catch {
      return undefined;
    }
  }

  private getMetrics(): DatabaseMetrics {
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
    for (const metrics of Object.values(allMetrics)) {
      const m = metrics as unknown as Record<string, unknown>;
      aggregated.queryCount += (m['queryCount'] as number) || 0;
      aggregated.errorCount += (m['errorCount'] as number) || 0;
      totalQueryTime += (m['totalQueryTime'] as number) || 0;
    }

    if (aggregated.queryCount > 0) {
      aggregated.averageQueryTime = totalQueryTime / aggregated.queryCount;
    }

    return aggregated;
  }

  async isHealthy(): Promise<boolean> {
    const result = await this.check();
    return result.status === 'healthy';
  }

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

  async kyseraHealthCheck(name?: string): Promise<HealthCheckResult> {
    const db = await this.manager.getConnection(name);
    return checkDatabaseHealth(db);
  }

  async getCircuitBreakerState(name?: string): Promise<
    | { state: string; failures: number; isOpen: boolean }
    | undefined
  > {
    const breaker = this.manager.getCircuitBreaker(name);
    if (!breaker) return undefined;

    const state = await breaker.getState();
    return { state: state.state, failures: state.failures, isOpen: state.state === 'open' };
  }
}
