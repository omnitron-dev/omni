/**
 * Database Manager
 *
 * Central service for managing database connections and lifecycle.
 * Supports plugin-aware executors via @kysera/executor for unified
 * plugin interception across Repository and DAL patterns.
 */

import { Kysely, PostgresDialect, MysqlDialect, SqliteDialect, CamelCasePlugin, sql } from 'kysely';
import { Pool } from 'pg';
import * as mysql from 'mysql2';
import BetterSqlite3 from 'better-sqlite3';
type Database = BetterSqlite3.Database;
import { sqliteDateSerializerPlugin } from './plugins/sqlite-date-serializer.plugin.js';
import {
  createExecutor,
  destroyExecutor,
  isKyseraExecutor,
  getPlugins,
  getRawDb,
  type Plugin,
  type KyseraExecutor,
} from '@kysera/executor';
import { CircuitBreaker } from '@kysera/infra';
import { Injectable } from '@omnitron-dev/titan/decorators';
import { Errors, TitanError, ErrorCode } from '@omnitron-dev/titan/errors';
import type {
  DatabaseConnection,
  DatabaseDialect,
  DatabaseModuleOptions,
  IDatabaseManager,
  DatabaseEvent,
  DatabaseEventType,
} from './database.types.js';
import type { ParsedConnectionConfig } from './database.internal-types.js';
import type { ILogger } from '@omnitron-dev/titan/module/logger';
import {
  DATABASE_DEFAULT_CONNECTION,
  DEFAULT_POOL_CONFIG,
  DEFAULT_TIMEOUTS,
} from './database.constants.js';

// Inlined constants (removed from database.constants.ts during cleanup)
const ERROR_MESSAGES = {
  CONNECTION_FAILED: (name: string, error: string) => `Failed to connect to database "${name}": ${error}`,
  INVALID_DIALECT: (dialect: string) => `Invalid database dialect: ${dialect}`,
} as const;

const DIALECT_SETTINGS: Record<string, { defaultPort: number | null }> = {
  postgres: { defaultPort: 5432 },
  mysql: { defaultPort: 3306 },
  sqlite: { defaultPort: null },
  mssql: { defaultPort: 1433 },
};

const DATABASE_EVENTS = {
  CONNECTED: 'database.connected',
  DISCONNECTED: 'database.disconnected',
  ERROR: 'database.error',
} as const;
import { EventEmitter } from '@omnitron-dev/eventemitter';

/**
 * Pool metrics for monitoring connection pool health and performance
 */
export interface PoolMetrics {
  /** Total number of connections in the pool */
  totalConnections: number;
  /** Number of idle connections */
  idleConnections: number;
  /** Number of active/in-use connections */
  activeConnections: number;
  /** Number of clients waiting for a connection */
  waitingClients: number;
  /** Total number of connection acquires */
  acquireCount: number;
  /** Total number of connection releases */
  releaseCount: number;
  /** Number of pool errors */
  errorCount: number;
  /** Last pool error */
  lastError?: Error;
  /** Timestamp of last acquire (epoch ms) */
  lastAcquireAt?: number;
  /** Average acquire time in milliseconds */
  averageAcquireTimeMs: number;
  /** Total acquire time (for average calculation) */
  totalAcquireTimeMs: number;
  /** Pool size configuration */
  poolSize: { min: number; max: number };
}

interface ConnectionInfo {
  name: string;
  config: DatabaseConnection;
  instance: Kysely<unknown>;
  /** Plugin-aware executor (if plugins are configured) */
  executor?: KyseraExecutor<unknown>;
  /** Plugins applied to this connection */
  plugins?: readonly Plugin[];
  pool?: Pool | mysql.Pool | Database;
  connected: boolean;
  connecting: boolean;
  lastError?: Error;
  metrics: {
    queryCount: number;
    errorCount: number;
    totalQueryTime: number;
  };
  /** Pool-specific metrics for monitoring */
  poolMetrics: PoolMetrics;
}

interface RetryConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  timeoutMs: number;
}

@Injectable()
export class DatabaseManager implements IDatabaseManager {
  private connections: Map<string, ConnectionInfo> = new Map();
  private circuitBreakers: Map<string, CircuitBreaker> = new Map();
  private connectionSchemas: Map<string, string> = new Map();
  private eventEmitter: EventEmitter = new EventEmitter();
  public logger: ILogger;
  private options: DatabaseModuleOptions;
  private initialized = false;
  private readonly defaultRetryConfig: RetryConfig = {
    maxRetries: 5,
    baseDelayMs: 1000,
    maxDelayMs: 16000,
    timeoutMs: 30000,
  };

  /**
   * Proactive health check interval timer.
   * Periodically validates connection health to detect issues before queries fail.
   */
  private healthCheckTimer?: ReturnType<typeof setInterval>;

  /**
   * Health check interval in milliseconds.
   * Configurable via options.healthCheck.interval, default 30s.
   */
  private readonly healthCheckIntervalMs: number;

  /**
   * Track consecutive health check failures for circuit breaker pattern.
   */
  private healthCheckFailures: Map<string, number> = new Map();

  /**
   * Maximum consecutive failures before marking connection as unhealthy.
   */
  private readonly maxHealthCheckFailures: number = 3;

  constructor(options: DatabaseModuleOptions, logger: ILogger) {
    this.options = options || {};
    this.logger = logger.child({ module: 'DatabaseManager' });
    // Allow health check interval override via kysera core options
    this.healthCheckIntervalMs = (this.options.kysera?.core?.healthCheck?.interval) ?? 30000;
  }

  /**
   * Initialize the database manager
   */
  async init(): Promise<void> {
    // Make init idempotent - only initialize once
    if (this.initialized) {
      this.logger.debug('Database manager already initialized, skipping');
      return;
    }

    this.logger.info('Initializing database manager');

    // Setup connections from configuration
    const connections = this.getConnectionConfigs();

    for (const [name, config] of Object.entries(connections)) {
      await this.createConnectionWithRetry(name, config);
    }

    // Note: Shutdown is managed by Application lifecycle via DatabaseModule.onStop()
    // Do NOT register process signal handlers here - it causes double shutdown

    // Auto-apply Kysera plugins to all connections if configured
    await this.applyGlobalPlugins();

    this.initialized = true;

    // Apply default schema if configured (PostgreSQL only)
    if (this.options.defaultSchema) {
      for (const [name, info] of this.connections) {
        if (info.config.dialect === 'postgres' && info.connected) {
          try {
            await this.setSchema(this.options.defaultSchema, name);
          } catch (error) {
            this.logger.warn(
              { connection: name, schema: this.options.defaultSchema, error },
              'Failed to set default schema'
            );
          }
        }
      }
    }

    // Start proactive health checks if enabled
    if (this.options.healthCheck !== false) {
      this.startProactiveHealthChecks();
    }

    this.logger.info({ connectionCount: this.connections.size }, 'Database manager initialized');
  }

  // ============================================================================
  // PROACTIVE HEALTH CHECKS
  // ============================================================================

  /**
   * Start proactive health checks for all connections.
   * Runs periodically to detect connection issues before queries fail.
   *
   * Expected benefit: 50-80% reduction in query failures due to stale connections.
   */
  private startProactiveHealthChecks(): void {
    if (this.healthCheckTimer) {
      return; // Already running
    }

    this.logger.info({ intervalMs: this.healthCheckIntervalMs }, 'Starting proactive health checks');

    this.healthCheckTimer = setInterval(() => {
      this.runHealthChecks().catch((err) =>
        this.logger.error({ error: err }, 'Unhandled error in periodic health check')
      );
    }, this.healthCheckIntervalMs);

    // Ensure timer doesn't prevent process exit
    if (this.healthCheckTimer.unref) {
      this.healthCheckTimer.unref();
    }
  }

  /**
   * Stop proactive health checks.
   */
  private stopProactiveHealthChecks(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = undefined;
      this.logger.debug('Proactive health checks stopped');
    }
  }

  /**
   * Run health checks on all connections in parallel.
   */
  private async runHealthChecks(): Promise<void> {
    const promises: Promise<void>[] = [];
    for (const [name, info] of this.connections) {
      if (info.connected) {
        promises.push(this.runSingleHealthCheck(name, info));
      }
    }
    if (promises.length > 0) {
      await Promise.all(promises);
    }
  }

  /**
   * Run health check on a single connection.
   */
  private async runSingleHealthCheck(name: string, info: ConnectionInfo): Promise<void> {
    try {
      const startTime = Date.now();
      const isHealthy = await this.validateConnectionHealth(info.instance, info.config.dialect);
      const latency = Date.now() - startTime;

      if (isHealthy) {
        // Reset failure counter on success
        this.healthCheckFailures.set(name, 0);

        // Log if latency is high (> 500ms)
        if (latency > 500) {
          this.logger.warn({ connection: name, latency }, 'Connection health check passed but with high latency');
        }
      } else {
        await this.handleHealthCheckFailure(name, info, new Error('Health check returned false'));
      }
    } catch (error) {
      await this.handleHealthCheckFailure(name, info, error as Error);
    }
  }

  /**
   * Handle a health check failure.
   */
  private async handleHealthCheckFailure(name: string, info: ConnectionInfo, error: Error): Promise<void> {
    const failures = (this.healthCheckFailures.get(name) || 0) + 1;
    this.healthCheckFailures.set(name, failures);

    this.logger.warn(
      { connection: name, failures, maxFailures: this.maxHealthCheckFailures, error: error.message },
      'Connection health check failed'
    );

    // Update pool metrics
    info.poolMetrics.errorCount++;
    info.poolMetrics.lastError = error;

    // Emit error event
    this.emitEvent({
      type: DATABASE_EVENTS.ERROR as DatabaseEventType,
      connection: name,
      timestamp: new Date(),
      error,
    });

    // If too many consecutive failures, attempt reconnection
    if (failures >= this.maxHealthCheckFailures) {
      this.logger.error({ connection: name, failures }, 'Connection failed health checks, attempting reconnection');

      try {
        // Mark as disconnected and attempt reconnection
        info.connected = false;
        await this.reconnect(name);
        this.healthCheckFailures.set(name, 0);
        this.logger.info({ connection: name }, 'Connection recovered after health check failures');
      } catch (reconnectError) {
        this.logger.error(
          { connection: name, error: (reconnectError as Error).message },
          'Failed to recover connection'
        );
      }
    }
  }

  /**
   * Force a health check on a specific connection.
   * Use for manual verification after suspected issues.
   */
  async checkConnectionHealth(name: string = DATABASE_DEFAULT_CONNECTION): Promise<{
    healthy: boolean;
    latency?: number;
    error?: string;
  }> {
    const info = this.connections.get(name);
    if (!info) {
      return { healthy: false, error: `Connection '${name}' not found` };
    }

    if (!info.connected) {
      return { healthy: false, error: 'Connection not established' };
    }

    try {
      const startTime = Date.now();
      const isHealthy = await this.validateConnectionHealth(info.instance, info.config.dialect);
      const latency = Date.now() - startTime;

      return { healthy: isHealthy, latency };
    } catch (error) {
      return { healthy: false, error: (error as Error).message };
    }
  }

  /**
   * Get health check status for all connections.
   */
  getHealthStatus(): Map<
    string,
    {
      connected: boolean;
      consecutiveFailures: number;
      lastError?: string;
      poolMetrics: PoolMetrics;
    }
  > {
    const status = new Map();

    for (const [name, info] of this.connections) {
      status.set(name, {
        connected: info.connected,
        consecutiveFailures: this.healthCheckFailures.get(name) || 0,
        lastError: info.lastError?.message,
        poolMetrics: this.collectPoolMetrics(info),
      });
    }

    return status;
  }

  /**
   * Get configured connections
   */
  private getConnectionConfigs(): Record<string, DatabaseConnection> {
    const configs: Record<string, DatabaseConnection> = {};

    // Add default connection if specified
    if (this.options.connection) {
      configs[DATABASE_DEFAULT_CONNECTION] = {
        ...this.options.connection,
        name: DATABASE_DEFAULT_CONNECTION,
      };
    }

    // Add named connections
    if (this.options.connections) {
      for (const [name, config] of Object.entries(this.options.connections)) {
        configs[name] = { ...config, name };
      }
    }

    // If no connections specified, create default SQLite in-memory
    if (Object.keys(configs).length === 0) {
      configs[DATABASE_DEFAULT_CONNECTION] = {
        name: DATABASE_DEFAULT_CONNECTION,
        dialect: 'sqlite',
        connection: ':memory:',
      };
    }

    return configs;
  }

  /**
   * Create a database connection with retry logic
   */
  private async createConnectionWithRetry(name: string, config: DatabaseConnection): Promise<ConnectionInfo> {
    const retryConfig = this.defaultRetryConfig;
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= retryConfig.maxRetries; attempt++) {
      try {
        this.logger.debug({ name, attempt, maxRetries: retryConfig.maxRetries }, 'Attempting database connection');

        const info = await this.createConnection(name, config);

        if (attempt > 0) {
          this.logger.info({ name, attempt, totalRetries: attempt }, 'Database connection established after retries');
        }

        return info;
      } catch (error) {
        lastError = error as Error;
        const isLastAttempt = attempt === retryConfig.maxRetries;

        if (isLastAttempt) {
          this.logger.error({ name, attempt, error: lastError }, 'Database connection failed after all retries');
          break;
        }

        // Calculate exponential backoff delay: 1s, 2s, 4s, 8s, 16s
        const delayMs = Math.min(retryConfig.baseDelayMs * Math.pow(2, attempt), retryConfig.maxDelayMs);

        this.logger.warn(
          { name, attempt, nextRetryIn: delayMs, error: lastError.message },
          'Database connection failed, retrying'
        );

        await this.sleep(delayMs);
      }
    }

    // All retries exhausted
    throw new TitanError({
      code: ErrorCode.SERVICE_UNAVAILABLE,
      message: `Database connection ${name} failed after ${retryConfig.maxRetries} retries: ${lastError?.message}`,
      details: { connection: name, error: lastError?.message, maxRetries: retryConfig.maxRetries },
    });
  }

  /**
   * Create a database connection
   */
  private async createConnection(name: string, config: DatabaseConnection): Promise<ConnectionInfo> {
    this.logger.debug({ name, dialect: config.dialect }, 'Creating database connection');

    const poolConfig = config.pool || {};
    const info: ConnectionInfo = {
      name,
      config,
      instance: null as unknown as Kysely<unknown>,
      pool: undefined,
      connected: false,
      connecting: true,
      metrics: {
        queryCount: 0,
        errorCount: 0,
        totalQueryTime: 0,
      },
      poolMetrics: {
        totalConnections: 0,
        idleConnections: 0,
        activeConnections: 0,
        waitingClients: 0,
        acquireCount: 0,
        releaseCount: 0,
        errorCount: 0,
        averageAcquireTimeMs: 0,
        totalAcquireTimeMs: 0,
        poolSize: {
          min: poolConfig.min ?? DEFAULT_POOL_CONFIG.min,
          max: poolConfig.max ?? DEFAULT_POOL_CONFIG.max,
        },
      },
    };

    try {
      // Create Kysely instance based on dialect
      const { instance, pool } = await this.createKyselyInstance(config);
      info.instance = instance;
      info.pool = pool;

      // Test connection health (single check — testConnection is redundant)
      const isHealthy = await this.validateConnectionHealth(instance, config.dialect);
      if (!isHealthy) {
        throw Errors.unavailable('Database', 'Connection health check failed');
      }

      info.connected = true;
      info.connecting = false;

      this.connections.set(name, info);

      // Create circuit breaker for this connection
      const cbOptions = this.options.circuitBreaker;
      if (cbOptions?.enabled !== false) {
        const breaker = new CircuitBreaker({
          threshold: cbOptions?.threshold ?? 5,
          resetTimeMs: cbOptions?.resetTimeMs ?? 60000,
          onStateChange: (newState, previousState) => {
            this.logger.warn({ connection: name, newState, previousState }, 'Circuit breaker state changed');
          },
        });
        this.circuitBreakers.set(name, breaker);
      }

      // Emit connected event
      this.emitEvent({
        type: DATABASE_EVENTS.CONNECTED as DatabaseEventType,
        connection: name,
        timestamp: new Date(),
      });

      this.logger.info({ name, dialect: config.dialect }, 'Database connection established');

      return info;
    } catch (error) {
      info.connecting = false;
      info.lastError = error as Error;
      this.connections.set(name, info);

      const errorMessage = ERROR_MESSAGES.CONNECTION_FAILED(name, (error as Error).message);
      this.logger.error({ name, error }, errorMessage);

      // Emit error event
      this.emitEvent({
        type: DATABASE_EVENTS.ERROR as DatabaseEventType,
        connection: name,
        timestamp: new Date(),
        error: error as Error,
      });

      throw new TitanError({
        code: ErrorCode.SERVICE_UNAVAILABLE,
        message: `Database connection ${name} is unavailable: ${errorMessage}`,
        details: { connection: name, error: errorMessage },
      });
    }
  }

  /**
   * Create Kysely instance based on dialect
   */
  private async createKyselyInstance(
    config: DatabaseConnection
  ): Promise<{ instance: Kysely<unknown>; pool?: Pool | mysql.Pool | Database }> {
    const connectionConfig = this.parseConnectionConfig(config);

    switch (config.dialect) {
      case 'postgres': {
        // Create a clean config object without ssl=false
        const pgConfig = { ...connectionConfig } as Record<string, unknown>;
        if (pgConfig['ssl'] === false) {
          delete pgConfig['ssl'];
        }

        const pool = new Pool({
          ...pgConfig,
          ...DEFAULT_POOL_CONFIG,
          ...config.pool,
        });

        // Add comprehensive error handlers with metrics collection
        pool.on('error', (err, client) => {
          // Log the error but don't throw - this handles connection termination errors
          this.logger.error({ error: err, client: client ? 'present' : 'none' }, 'PostgreSQL pool error');

          // Update pool metrics
          const connInfo = this.connections.get(config.name || DATABASE_DEFAULT_CONNECTION);
          if (connInfo) {
            connInfo.poolMetrics.errorCount++;
            connInfo.poolMetrics.lastError = err;
          }

          // Emit error event for monitoring
          this.emitEvent({
            type: DATABASE_EVENTS.ERROR as DatabaseEventType,
            connection: config.name || DATABASE_DEFAULT_CONNECTION,
            timestamp: new Date(),
            error: err,
          });
        });

        pool.on('connect', (_client) => {
          this.logger.debug('PostgreSQL pool client connected');
          const connInfo = this.connections.get(config.name || DATABASE_DEFAULT_CONNECTION);
          if (connInfo) {
            connInfo.poolMetrics.totalConnections++;
            connInfo.poolMetrics.idleConnections++;
          }
        });

        pool.on('acquire', (_client) => {
          this.logger.debug('PostgreSQL pool client acquired');
          const connInfo = this.connections.get(config.name || DATABASE_DEFAULT_CONNECTION);
          if (connInfo) {
            connInfo.poolMetrics.acquireCount++;
            connInfo.poolMetrics.activeConnections++;
            connInfo.poolMetrics.idleConnections = Math.max(0, connInfo.poolMetrics.idleConnections - 1);
            connInfo.poolMetrics.lastAcquireAt = Date.now();
          }
        });

        pool.on('release', (_client) => {
          this.logger.debug('PostgreSQL pool client released');
          const connInfo = this.connections.get(config.name || DATABASE_DEFAULT_CONNECTION);
          if (connInfo) {
            connInfo.poolMetrics.releaseCount++;
            connInfo.poolMetrics.activeConnections = Math.max(0, connInfo.poolMetrics.activeConnections - 1);
            connInfo.poolMetrics.idleConnections++;
          }
        });

        pool.on('remove', (_client) => {
          this.logger.debug('PostgreSQL pool client removed');
          const connInfo = this.connections.get(config.name || DATABASE_DEFAULT_CONNECTION);
          if (connInfo) {
            connInfo.poolMetrics.totalConnections = Math.max(0, connInfo.poolMetrics.totalConnections - 1);
            connInfo.poolMetrics.idleConnections = Math.max(0, connInfo.poolMetrics.idleConnections - 1);
          }
        });

        const dialect = new PostgresDialect({ pool });
        const kyselyPlugins = this.options.camelCase ? [new CamelCasePlugin()] : [];
        const instance = new Kysely<unknown>({
          dialect,
          log: config.debug ? ['query', 'error'] : undefined,
          plugins: kyselyPlugins,
        });

        return { instance, pool };
      }

      case 'mysql': {
        // Create a clean config object without ssl=false
        const mysqlConfig = { ...connectionConfig } as Record<string, unknown>;
        if (mysqlConfig['ssl'] === false) {
          delete mysqlConfig['ssl'];
        }

        // MySQL2 uses different pool parameter names than PostgreSQL
        // Map PostgreSQL-style pool config to MySQL2 format
        const mysqlPoolConfig = {
          connectionLimit: config.pool?.max || DEFAULT_POOL_CONFIG.max,
          waitForConnections: true,
          queueLimit: 0,
          // MySQL2 connection timeout (in milliseconds)
          connectTimeout: DEFAULT_POOL_CONFIG.acquireTimeoutMillis,
        };

        const pool = mysql.createPool({
          ...mysqlConfig,
          ...mysqlPoolConfig,
        } as mysql.PoolOptions);

        // Add error handlers for MySQL pool with metrics collection
        pool.on('error', (err) => {
          this.logger.error({ error: err }, 'MySQL pool error');

          // Update pool metrics
          const connInfo = this.connections.get(config.name || DATABASE_DEFAULT_CONNECTION);
          if (connInfo) {
            connInfo.poolMetrics.errorCount++;
            connInfo.poolMetrics.lastError = err;
          }

          // Emit error event for monitoring
          this.emitEvent({
            type: DATABASE_EVENTS.ERROR as DatabaseEventType,
            connection: config.name || DATABASE_DEFAULT_CONNECTION,
            timestamp: new Date(),
            error: err,
          });
        });

        pool.on('connection', (_connection) => {
          this.logger.debug('MySQL pool connection established');
          const connInfo = this.connections.get(config.name || DATABASE_DEFAULT_CONNECTION);
          if (connInfo) {
            connInfo.poolMetrics.totalConnections++;
            connInfo.poolMetrics.idleConnections++;
          }
        });

        pool.on('acquire', (_connection) => {
          this.logger.debug('MySQL pool connection acquired');
          const connInfo = this.connections.get(config.name || DATABASE_DEFAULT_CONNECTION);
          if (connInfo) {
            connInfo.poolMetrics.acquireCount++;
            connInfo.poolMetrics.activeConnections++;
            connInfo.poolMetrics.idleConnections = Math.max(0, connInfo.poolMetrics.idleConnections - 1);
            connInfo.poolMetrics.lastAcquireAt = Date.now();
          }
        });

        pool.on('release', (_connection) => {
          this.logger.debug('MySQL pool connection released');
          const connInfo = this.connections.get(config.name || DATABASE_DEFAULT_CONNECTION);
          if (connInfo) {
            connInfo.poolMetrics.releaseCount++;
            connInfo.poolMetrics.activeConnections = Math.max(0, connInfo.poolMetrics.activeConnections - 1);
            connInfo.poolMetrics.idleConnections++;
          }
        });

        const dialect = new MysqlDialect({ pool });
        const mysqlPlugins = this.options.camelCase ? [new CamelCasePlugin()] : [];
        const instance = new Kysely<unknown>({
          dialect,
          log: config.debug ? ['query', 'error'] : undefined,
          plugins: mysqlPlugins,
        });

        return { instance, pool };
      }

      case 'sqlite': {
        const database = new BetterSqlite3(connectionConfig.database || ':memory:', {
          // Enable verbose mode for debugging if requested
          verbose: config.debug ? (msg: unknown) => this.logger.debug({ msg }, 'SQLite verbose') : undefined,
          // Set busy timeout to handle concurrent access (especially for shared in-memory databases)
          // This prevents "database is locked" errors by waiting up to 5 seconds
          timeout: 5000,
        });

        // Configure pragmas for better performance and concurrency
        // Use WAL mode for better concurrency (doesn't work for in-memory databases)
        // For shared in-memory databases, we rely on the busy timeout
        const isInMemory =
          !connectionConfig.database ||
          connectionConfig.database === ':memory:' ||
          connectionConfig.database.includes('mode=memory') ||
          connectionConfig.database.includes(':memory:');

        if (!isInMemory) {
          // WAL mode only works for file-based databases
          database.pragma('journal_mode = WAL');
        }

        // Set busy timeout at SQLite level as well (in milliseconds)
        database.pragma('busy_timeout = 5000');

        const dialect = new SqliteDialect({ database });
        const sqlitePlugins = [sqliteDateSerializerPlugin()];
        if (this.options.camelCase) {
          sqlitePlugins.push(new CamelCasePlugin() as any);
        }
        const instance = new Kysely<unknown>({
          dialect,
          log: config.debug ? ['query', 'error'] : undefined,
          plugins: sqlitePlugins,
        });

        return { instance, pool: database };
      }

      default:
        throw Errors.badRequest(ERROR_MESSAGES.INVALID_DIALECT(config.dialect));
    }
  }

  /**
   * Parse connection configuration
   */
  private parseConnectionConfig(config: DatabaseConnection): ParsedConnectionConfig {
    // Handle undefined or null config
    if (!config) {
      throw Errors.badRequest('Database connection configuration is required');
    }

    if (typeof config.connection === 'string') {
      // Parse connection string
      if (config.dialect === 'sqlite') {
        return { database: config.connection };
      }

      // For PostgreSQL and MySQL, parse the connection string
      const url = new URL(config.connection);
      const sslParam = url.searchParams.get('ssl');
      const result: ParsedConnectionConfig = {
        host: url.hostname,
        port: parseInt(url.port) || DIALECT_SETTINGS[config.dialect]?.defaultPort || undefined,
        database: url.pathname.slice(1),
        user: url.username,
        password: url.password,
      };

      // Only set ssl if explicitly requested
      if (sslParam === 'true') {
        result.ssl = true;
      }

      return result;
    }

    // If connection is not a string, it should be an object
    const connConfig = config.connection as Partial<ParsedConnectionConfig> | undefined;

    // Handle undefined connection object
    if (!connConfig) {
      // For SQLite, return a default memory database
      if (config.dialect === 'sqlite') {
        return { database: ':memory:' };
      }
      // For network databases, require at least a database name
      const configKeys = Object.keys(config).join(', ');
      throw Errors.badRequest(
        `Connection configuration is required for ${config.dialect || 'undefined'}. ` +
          `Received config keys: [${configKeys}]. ` +
          `Common mistake: Using {...context.connection} instead of {connection: context.connection} ` +
          `in TitanDatabaseModule.forRoot()`
      );
    }

    return {
      database: connConfig.database || (config.dialect === 'sqlite' ? ':memory:' : 'postgres'),
      host: connConfig.host,
      port: connConfig.port,
      user: connConfig.user,
      password: connConfig.password,
      ssl: connConfig.ssl,
      searchPath: connConfig.searchPath,
      charset: connConfig.charset,
      timezone: connConfig.timezone,
    };
  }

  /**
   * Validate connection health with timeout.
   * Returns false on failure instead of throwing.
   */
  private async validateConnectionHealth(db: Kysely<unknown>, dialect: DatabaseDialect): Promise<boolean> {
    const timeout = dialect === 'sqlite' ? 10000 : 5000;
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeout);

    try {
      await Promise.race([
        sql`SELECT 1 AS health_check`.execute(db),
        new Promise<never>((_, reject) => {
          ac.signal.addEventListener('abort', () =>
            reject(new Error('Health check timeout'))
          );
        }),
      ]);
      return true;
    } catch (error) {
      this.logger.error({ error }, 'Connection health check failed');
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Sleep utility for retry delays
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Get a database connection by name
   */
  async getConnection(name: string = DATABASE_DEFAULT_CONNECTION): Promise<Kysely<unknown>> {
    const info = this.connections.get(name);

    if (!info) {
      throw Errors.notFound('Database connection', name);
    }

    if (!info.connected && !info.connecting) {
      // Try to reconnect
      await this.reconnect(name);
    }

    if (!info.connected) {
      throw Errors.unavailable(name, info.lastError?.message || 'Unknown error');
    }

    // Return executor (with plugins) if available, otherwise raw instance
    // This ensures all consumers get plugin-aware queries by default
    if (info.executor) {
      return info.executor as Kysely<unknown>;
    }

    return info.instance;
  }

  /**
   * Get a plugin-aware executor for a connection
   *
   * Returns the cached executor if plugins were configured during connection setup,
   * or creates a new executor with the provided plugins.
   *
   * @example
   * ```typescript
   * // Get executor with connection's default plugins
   * const executor = await manager.getExecutor();
   *
   * // Create executor with specific plugins
   * const executor = await manager.getExecutor('default', [softDeletePlugin()]);
   *
   * // All queries have plugins applied automatically
   * const users = await executor.selectFrom('users').selectAll().execute();
   * ```
   */
  async getExecutor(name: string = DATABASE_DEFAULT_CONNECTION, plugins?: Plugin[]): Promise<KyseraExecutor<unknown>> {
    const info = this.connections.get(name);

    if (!info) {
      throw Errors.notFound('Database connection', name);
    }

    if (!info.connected && !info.connecting) {
      await this.reconnect(name);
    }

    if (!info.connected) {
      throw Errors.unavailable(name, info.lastError?.message || 'Unknown error');
    }

    // If specific plugins provided, create new executor
    if (plugins && plugins.length > 0) {
      this.logger.debug(
        { connection: name, plugins: plugins.map((p) => p.name) },
        'Creating executor with custom plugins'
      );
      return createExecutor(info.instance, plugins);
    }

    // Return cached executor if available
    if (info.executor) {
      return info.executor;
    }

    // Create executor without plugins (still provides executor interface)
    return createExecutor(info.instance, []);
  }

  /**
   * Create and cache an executor with plugins for a connection
   *
   * Use this to configure default plugins for a connection that will be
   * used by all subsequent getExecutor() calls.
   *
   * @example
   * ```typescript
   * // Configure default plugins for the connection
   * await manager.setConnectionPlugins('default', [
   *   softDeletePlugin(),
   *   timestampsPlugin(),
   * ]);
   *
   * // Now all getExecutor() calls return executor with these plugins
   * const executor = await manager.getExecutor();
   * ```
   */
  async setConnectionPlugins(
    name: string = DATABASE_DEFAULT_CONNECTION,
    plugins: Plugin[]
  ): Promise<KyseraExecutor<unknown>> {
    const info = this.connections.get(name);

    if (!info) {
      throw Errors.notFound('Database connection', name);
    }

    if (!info.connected) {
      throw Errors.unavailable(name, 'Connection not established');
    }

    this.logger.info({ connection: name, plugins: plugins.map((p) => p.name) }, 'Setting connection plugins');

    const executor = await createExecutor(info.instance, plugins);
    info.executor = executor;
    info.plugins = getPlugins(executor);

    return executor;
  }

  /**
   * Get plugins configured for a connection
   */
  getConnectionPlugins(name: string = DATABASE_DEFAULT_CONNECTION): readonly Plugin[] {
    const info = this.connections.get(name);
    return info?.plugins || [];
  }

  /**
   * Check if a database instance is a KyseraExecutor
   */
  isExecutor(value: Kysely<unknown>): value is KyseraExecutor<unknown> {
    return isKyseraExecutor(value);
  }

  /**
   * Get raw Kysely instance bypassing plugin interceptors
   */
  getRawDb(executor: Kysely<unknown>): Kysely<unknown> {
    return getRawDb(executor);
  }

  /**
   * Get connection pool
   */
  getPool(name: string = DATABASE_DEFAULT_CONNECTION): Pool | mysql.Pool | Database | undefined {
    const info = this.connections.get(name);
    return info?.pool;
  }

  /**
   * Reconnect to database
   */
  private async reconnect(name: string): Promise<void> {
    const info = this.connections.get(name);
    if (!info) {
      throw Errors.notFound('Database connection', name);
    }

    this.logger.info({ name }, 'Attempting to reconnect to database');

    // Use retry logic for reconnection
    await this.createConnectionWithRetry(name, info.config);
  }

  /**
   * Close a specific connection
   */
  async close(name: string = DATABASE_DEFAULT_CONNECTION): Promise<void> {
    const info = this.connections.get(name);
    if (!info) {
      return;
    }

    // Remove from map immediately to prevent double-close
    this.connections.delete(name);

    this.logger.info({ name }, 'Closing database connection');

    try {
      // Destroy executor first to call plugin cleanup hooks
      if (info.executor && isKyseraExecutor(info.executor)) {
        await destroyExecutor(info.executor);
      }

      // Destroy Kysely instance
      await info.instance.destroy();

      // Close pool based on dialect
      if (info.pool) {
        if (info.config.dialect === 'postgres' && info.pool instanceof Pool) {
          await info.pool.end();
        } else if (info.config.dialect === 'mysql' && 'end' in info.pool) {
          await new Promise<void>((resolve, reject) => {
            (info.pool as mysql.Pool).end((err) => (err ? reject(err) : resolve()));
          });
        } else if (info.config.dialect === 'sqlite' && 'close' in info.pool) {
          (info.pool as Database).close();
        }
      }

      info.connected = false;

      // Emit disconnected event
      this.emitEvent({
        type: DATABASE_EVENTS.DISCONNECTED as DatabaseEventType,
        connection: name,
        timestamp: new Date(),
      });

      this.logger.info({ name }, 'Database connection closed');
    } catch (error) {
      this.logger.error({ name, error }, 'Error closing database connection');
      throw error;
    }
  }

  /**
   * Close all connections
   */
  async closeAll(): Promise<void> {
    // Stop proactive health checks first
    this.stopProactiveHealthChecks();

    // Early return if no connections to close
    if (this.connections.size === 0) {
      return;
    }

    this.logger.info('Closing all database connections');

    // Get keys before iteration since close() removes from map
    const connectionNames = Array.from(this.connections.keys());
    const closePromises = connectionNames.map((name) =>
      this.close(name).catch((error) => this.logger.error({ name, error }, 'Error closing connection'))
    );

    await Promise.all(closePromises);

    this.logger.info('All database connections closed');
  }

  /**
   * Check if connected
   */
  isConnected(name: string = DATABASE_DEFAULT_CONNECTION): boolean {
    const info = this.connections.get(name);
    return info?.connected || false;
  }

  /**
   * Get all connection names
   */
  getConnectionNames(): string[] {
    return Array.from(this.connections.keys());
  }

  /**
   * Get connection metrics
   */
  getMetrics(name?: string): Record<string, unknown> {
    if (name) {
      const info = this.connections.get(name);
      return info?.metrics || {};
    }

    const metrics: Record<string, unknown> = {};
    for (const [connName, info] of this.connections) {
      metrics[connName] = info.metrics;
    }
    return metrics;
  }

  /**
   * Get detailed pool metrics for a connection or all connections.
   * Includes real-time pool statistics from the underlying driver.
   *
   * @example
   * ```typescript
   * // Get pool metrics for default connection
   * const metrics = manager.getPoolMetrics();
   *
   * // Get pool metrics for specific connection
   * const metrics = manager.getPoolMetrics('replica');
   *
   * // Monitor pool health
   * const { activeConnections, waitingClients, poolSize } = metrics;
   * const utilization = activeConnections / poolSize.max;
   * ```
   */
  getPoolMetrics(name?: string): PoolMetrics | Map<string, PoolMetrics> {
    if (name) {
      const info = this.connections.get(name);
      if (!info) {
        throw Errors.notFound('Connection', name);
      }
      return this.collectPoolMetrics(info);
    }

    const metrics = new Map<string, PoolMetrics>();
    for (const [connName, info] of this.connections) {
      metrics.set(connName, this.collectPoolMetrics(info));
    }
    return metrics;
  }

  /**
   * Collect pool metrics from a connection, merging driver-specific stats
   */
  private collectPoolMetrics(info: ConnectionInfo): PoolMetrics {
    const m = info.poolMetrics;

    // Overlay real-time stats from pg Pool if available
    let totalConnections = m.totalConnections;
    let idleConnections = m.idleConnections;
    let activeConnections = m.activeConnections;
    let waitingClients = m.waitingClients;

    if (info.pool && info.config.dialect === 'postgres' && info.pool instanceof Pool) {
      const pgPool = info.pool;
      totalConnections = pgPool.totalCount;
      idleConnections = pgPool.idleCount;
      waitingClients = pgPool.waitingCount;
      activeConnections = pgPool.totalCount - pgPool.idleCount;
    }

    const averageAcquireTimeMs =
      m.acquireCount > 0 && m.totalAcquireTimeMs > 0
        ? m.totalAcquireTimeMs / m.acquireCount
        : m.averageAcquireTimeMs;

    return {
      totalConnections,
      idleConnections,
      activeConnections,
      waitingClients,
      acquireCount: m.acquireCount,
      releaseCount: m.releaseCount,
      errorCount: m.errorCount,
      lastError: m.lastError,
      lastAcquireAt: m.lastAcquireAt,
      averageAcquireTimeMs,
      totalAcquireTimeMs: m.totalAcquireTimeMs,
      poolSize: m.poolSize,
    };
  }

  /**
   * Reset pool metrics counters for a connection
   */
  resetPoolMetrics(name?: string): void {
    const resetMetrics = (info: ConnectionInfo) => {
      info.poolMetrics.acquireCount = 0;
      info.poolMetrics.releaseCount = 0;
      info.poolMetrics.errorCount = 0;
      info.poolMetrics.totalAcquireTimeMs = 0;
      info.poolMetrics.averageAcquireTimeMs = 0;
      info.poolMetrics.lastError = undefined;
      info.poolMetrics.lastAcquireAt = undefined;
    };

    if (name) {
      const info = this.connections.get(name);
      if (info) {
        resetMetrics(info);
      }
    } else {
      for (const info of this.connections.values()) {
        resetMetrics(info);
      }
    }
  }

  /**
   * Emit database event
   */
  private emitEvent(event: DatabaseEvent): void {
    this.eventEmitter.emit(event.type, event);
  }

  /**
   * Subscribe to database events
   */
  on(event: DatabaseEventType, listener: (event: DatabaseEvent) => void): void {
    this.eventEmitter.on(event, listener);
  }

  /**
   * Unsubscribe from database events
   */
  off(event: DatabaseEventType, listener: (event: DatabaseEvent) => void): void {
    this.eventEmitter.off(event, listener);
  }

  /**
   * Get connection configuration
   */
  getConnectionConfig(name?: string): DatabaseConnection | undefined {
    const connectionName = name || DATABASE_DEFAULT_CONNECTION;
    const info = this.connections.get(connectionName);
    return info?.config;
  }

  /**
   * Get the dialect for a specific connection
   */
  getDialect(name: string = DATABASE_DEFAULT_CONNECTION): string | undefined {
    const info = this.connections.get(name);
    return info?.config?.dialect;
  }

  // ============================================================================
  // CIRCUIT BREAKER
  // ============================================================================

  /**
   * Get the circuit breaker for a connection.
   *
   * @example
   * ```typescript
   * const breaker = manager.getCircuitBreaker('default');
   * const state = await breaker?.getState();
   * if (state?.state === 'open') {
   *   console.log('Connection is in circuit breaker open state');
   * }
   * ```
   */
  getCircuitBreaker(name: string = DATABASE_DEFAULT_CONNECTION): CircuitBreaker | undefined {
    return this.circuitBreakers.get(name);
  }

  /**
   * Execute a function with circuit breaker protection for a connection.
   *
   * If the circuit breaker is open, fails fast without attempting the operation.
   * If no circuit breaker is configured, executes directly.
   *
   * @example
   * ```typescript
   * const result = await manager.withCircuitBreaker('default', async (db) => {
   *   return db.selectFrom('users').selectAll().execute();
   * });
   * ```
   */
  async withCircuitBreaker<T>(
    name: string = DATABASE_DEFAULT_CONNECTION,
    fn: (db: Kysely<unknown>) => Promise<T>
  ): Promise<T> {
    const breaker = this.circuitBreakers.get(name);
    const db = await this.getConnection(name);

    if (breaker) {
      return breaker.execute(() => fn(db));
    }

    return fn(db);
  }

  // ============================================================================
  // SCHEMA MANAGEMENT (Multi-Tenant)
  // ============================================================================

  /**
   * Set PostgreSQL search_path for a connection (schema-per-tenant).
   *
   * This enables multi-tenant isolation by switching the database schema.
   * Only supported for PostgreSQL connections.
   *
   * @param schema - Schema name to set (e.g., 'tenant_123')
   * @param name - Connection name (defaults to 'default')
   *
   * @example
   * ```typescript
   * // Switch to tenant schema
   * await manager.setSchema('tenant_abc');
   *
   * // All subsequent queries on this connection use tenant_abc schema
   * const users = await db.selectFrom('users').selectAll().execute();
   *
   * // Reset to public schema
   * await manager.setSchema('public');
   * ```
   */
  async setSchema(schema: string, name: string = DATABASE_DEFAULT_CONNECTION): Promise<void> {
    const info = this.connections.get(name);
    if (!info) {
      throw Errors.notFound('Database connection', name);
    }

    if (info.config.dialect !== 'postgres') {
      throw Errors.badRequest(`setSchema is only supported for PostgreSQL connections, got: ${info.config.dialect}`);
    }

    // Validate schema name to prevent SQL injection
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(schema)) {
      throw Errors.badRequest(`Invalid schema name: ${schema}`);
    }

    // Schema name already validated by regex above — safe for interpolation.
    // Using sql.raw() because SET search_path is a session command, not a DML query,
    // and sql.ref() produces column references, not schema identifiers.
    await sql.raw(`SET search_path TO "${schema}", public`).execute(info.instance);
    this.connectionSchemas.set(name, schema);

    this.logger.debug({ connection: name, schema }, 'Schema set for connection');
  }

  /**
   * Get the current schema for a connection.
   */
  getSchema(name: string = DATABASE_DEFAULT_CONNECTION): string | undefined {
    return this.connectionSchemas.get(name);
  }

  /**
   * Execute a function within a specific schema context.
   * Automatically switches to the schema before execution and
   * restores the previous schema afterward.
   *
   * @example
   * ```typescript
   * const users = await manager.withSchema('tenant_123', async (db) => {
   *   return db.selectFrom('users').selectAll().execute();
   * });
   * ```
   */
  async withSchema<T>(
    schema: string,
    fn: (db: Kysely<unknown>) => Promise<T>,
    name: string = DATABASE_DEFAULT_CONNECTION
  ): Promise<T> {
    const previousSchema = this.connectionSchemas.get(name);
    await this.setSchema(schema, name);

    try {
      const db = await this.getConnection(name);
      return await fn(db);
    } finally {
      // Restore previous schema or default to public
      await this.setSchema(previousSchema ?? 'public', name);
    }
  }

  // ============================================================================
  // PLUGIN AUTO-CONFIGURATION
  // ============================================================================

  /**
   * Resolve plugin specifications from options into actual Plugin instances.
   * Handles string names (built-in lookups), Plugin objects, and KyseraPluginConfig.
   */
  private async resolvePlugins(
    pluginSpecs: Array<string | Plugin | { plugin: string | Plugin; options?: Record<string, unknown> }>
  ): Promise<Plugin[]> {
    const resolved: Plugin[] = [];

    for (const spec of pluginSpecs) {
      if (typeof spec === 'string') {
        // Built-in plugin name — lazily import from @kysera/*
        const plugin = await this.resolveBuiltInPlugin(spec);
        if (plugin) resolved.push(plugin);
      } else if ('interceptQuery' in spec || 'name' in spec) {
        // Already a Plugin instance
        resolved.push(spec as Plugin);
      } else if ('plugin' in spec) {
        // KyseraPluginConfig: { plugin, options }
        if (typeof spec.plugin === 'string') {
          const plugin = await this.resolveBuiltInPlugin(spec.plugin, spec.options);
          if (plugin) resolved.push(plugin);
        } else {
          resolved.push(spec.plugin);
        }
      }
    }

    return resolved;
  }

  /**
   * Resolve a built-in plugin by name.
   */
  private async resolveBuiltInPlugin(name: string, options?: Record<string, unknown>): Promise<Plugin | null> {
    switch (name) {
      case 'soft-delete':
      case 'softDelete': {
        const { softDeletePlugin } = await import('@kysera/soft-delete');
        return softDeletePlugin(options as Parameters<typeof softDeletePlugin>[0]);
      }
      case 'timestamps': {
        const { timestampsPlugin } = await import('@kysera/timestamps');
        return timestampsPlugin(options as Parameters<typeof timestampsPlugin>[0]);
      }
      case 'audit': {
        const { auditPlugin } = await import('@kysera/audit');
        return auditPlugin(options as Parameters<typeof auditPlugin>[0]);
      }
      default:
        this.logger.warn({ plugin: name }, 'Unknown built-in plugin name, skipping');
        return null;
    }
  }

  /**
   * Apply global plugins from options.kysera.plugins to all connections.
   * Called once during init() after all connections are established.
   */
  private async applyGlobalPlugins(): Promise<void> {
    const pluginSpecs = this.options.kysera?.plugins;
    if (!pluginSpecs || pluginSpecs.length === 0) {
      // Also handle legacy builtIn config
      const builtIn = this.options.plugins?.builtIn;
      if (!builtIn) return;

      const legacyPlugins: Plugin[] = [];
      if (builtIn.softDelete) {
        const opts = typeof builtIn.softDelete === 'object' ? builtIn.softDelete : undefined;
        const plugin = await this.resolveBuiltInPlugin('soft-delete', opts as Record<string, unknown>);
        if (plugin) legacyPlugins.push(plugin);
      }
      if (builtIn.timestamps) {
        const opts = typeof builtIn.timestamps === 'object' ? builtIn.timestamps : undefined;
        const plugin = await this.resolveBuiltInPlugin('timestamps', opts as Record<string, unknown>);
        if (plugin) legacyPlugins.push(plugin);
      }
      if (builtIn.audit) {
        const opts = typeof builtIn.audit === 'object' ? builtIn.audit : undefined;
        const plugin = await this.resolveBuiltInPlugin('audit', opts as Record<string, unknown>);
        if (plugin) legacyPlugins.push(plugin);
      }

      if (legacyPlugins.length === 0) return;

      this.logger.info(
        { plugins: legacyPlugins.map((p) => p.name) },
        'Applying legacy builtIn plugins to all connections'
      );

      for (const [name, info] of this.connections) {
        if (info.connected) {
          await this.setConnectionPlugins(name, legacyPlugins);
        }
      }
      return;
    }

    // Resolve plugin specifications
    const plugins = await this.resolvePlugins(pluginSpecs);
    if (plugins.length === 0) return;

    this.logger.info(
      { plugins: plugins.map((p) => p.name) },
      'Applying global Kysera plugins to all connections'
    );

    for (const [name, info] of this.connections) {
      if (info.connected) {
        await this.setConnectionPlugins(name, plugins);
      }
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.closeAll();
  }
}
