/**
 * Database Manager
 *
 * Central service for managing database connections and lifecycle
 */

import { Kysely, PostgresDialect, MysqlDialect, SqliteDialect, sql } from 'kysely';
import { Pool } from 'pg';
import * as mysql from 'mysql2';
import BetterSqlite3 from 'better-sqlite3';
type Database = BetterSqlite3.Database;
import { Injectable } from '../../decorators/index.js';
import { Errors, TitanError, ErrorCode } from '../../errors/index.js';
import type {
  DatabaseConnection,
  DatabaseDialect,
  DatabaseModuleOptions,
  IDatabaseManager,
  DatabaseEvent,
  DatabaseEventType,
} from './database.types.js';
import type { Logger, ParsedConnectionConfig } from './database.internal-types.js';
import {
  DATABASE_DEFAULT_CONNECTION,
  DEFAULT_POOL_CONFIG,
  DEFAULT_TIMEOUTS,
  ERROR_MESSAGES,
  DIALECT_SETTINGS,
  DATABASE_EVENTS,
} from './database.constants.js';
import { createDefaultLogger } from './utils/logger.factory.js';
import { EventEmitter } from 'events';

interface ConnectionInfo {
  name: string;
  config: DatabaseConnection;
  instance: Kysely<unknown>;
  pool?: Pool | mysql.Pool | Database;
  connected: boolean;
  connecting: boolean;
  lastError?: Error;
  retryCount: number;
  metrics: {
    queryCount: number;
    errorCount: number;
    totalQueryTime: number;
  };
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
  private eventEmitter: EventEmitter = new EventEmitter();
  private logger: Logger;
  private options: DatabaseModuleOptions;
  private shutdownInProgress = false;
  private initialized = false;
  private readonly defaultRetryConfig: RetryConfig = {
    maxRetries: 5,
    baseDelayMs: 1000,
    maxDelayMs: 16000,
    timeoutMs: 30000,
  };

  constructor(options: DatabaseModuleOptions = {}, logger?: Logger) {
    this.options = options;
    // Create a console logger if none provided (proper fallback)
    this.logger = logger || createDefaultLogger('DatabaseManager');
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

    // Register shutdown handlers
    this.registerShutdownHandlers();

    this.initialized = true;
    this.logger.info({ connectionCount: this.connections.size }, 'Database manager initialized');
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
        this.logger.debug(
          { name, attempt, maxRetries: retryConfig.maxRetries },
          'Attempting database connection'
        );

        const info = await this.createConnection(name, config);

        if (attempt > 0) {
          this.logger.info(
            { name, attempt, totalRetries: attempt },
            'Database connection established after retries'
          );
        }

        return info;
      } catch (error) {
        lastError = error as Error;
        const isLastAttempt = attempt === retryConfig.maxRetries;

        if (isLastAttempt) {
          this.logger.error(
            { name, attempt, error: lastError },
            'Database connection failed after all retries'
          );
          break;
        }

        // Calculate exponential backoff delay: 1s, 2s, 4s, 8s, 16s
        const delayMs = Math.min(
          retryConfig.baseDelayMs * Math.pow(2, attempt),
          retryConfig.maxDelayMs
        );

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

    const info: ConnectionInfo = {
      name,
      config,
      instance: null as unknown as Kysely<unknown>,
      pool: undefined,
      connected: false,
      connecting: true,
      retryCount: 0,
      metrics: {
        queryCount: 0,
        errorCount: 0,
        totalQueryTime: 0,
      },
    };

    try {
      // Create Kysely instance based on dialect
      const { instance, pool } = await this.createKyselyInstance(config);
      info.instance = instance;
      info.pool = pool;

      // Test connection with health check
      await this.testConnection(instance, config.dialect);

      // Validate connection health before marking as connected
      const isHealthy = await this.validateConnectionHealth(instance, config.dialect);
      if (!isHealthy) {
        throw new Error('Connection health check failed');
      }

      info.connected = true;
      info.connecting = false;

      this.connections.set(name, info);

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

        // Add comprehensive error handlers
        pool.on('error', (err, client) => {
          // Log the error but don't throw - this handles connection termination errors
          this.logger.error({ error: err, client: client ? 'present' : 'none' }, 'PostgreSQL pool error');

          // Emit error event for monitoring
          this.emitEvent({
            type: DATABASE_EVENTS.ERROR as DatabaseEventType,
            connection: config.name || DATABASE_DEFAULT_CONNECTION,
            timestamp: new Date(),
            error: err,
          });
        });

        pool.on('connect', (client) => {
          this.logger.debug('PostgreSQL pool client connected');
        });

        pool.on('acquire', (client) => {
          this.logger.debug('PostgreSQL pool client acquired');
        });

        pool.on('remove', (client) => {
          this.logger.debug('PostgreSQL pool client removed');
        });

        const dialect = new PostgresDialect({ pool });
        const instance = new Kysely<unknown>({
          dialect,
          log: config.debug ? ['query', 'error'] : undefined,
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
          connectTimeout: DEFAULT_POOL_CONFIG.createTimeoutMillis,
        };

        const pool = mysql.createPool({
          ...mysqlConfig,
          ...mysqlPoolConfig,
        } as mysql.PoolOptions);

        // Add error handlers for MySQL pool
        pool.on('error', (err) => {
          this.logger.error({ error: err }, 'MySQL pool error');

          // Emit error event for monitoring
          this.emitEvent({
            type: DATABASE_EVENTS.ERROR as DatabaseEventType,
            connection: config.name || DATABASE_DEFAULT_CONNECTION,
            timestamp: new Date(),
            error: err,
          });
        });

        pool.on('connection', (connection) => {
          this.logger.debug('MySQL pool connection established');
        });

        pool.on('acquire', (connection) => {
          this.logger.debug('MySQL pool connection acquired');
        });

        pool.on('release', (connection) => {
          this.logger.debug('MySQL pool connection released');
        });

        const dialect = new MysqlDialect({ pool });
        const instance = new Kysely<unknown>({
          dialect,
          log: config.debug ? ['query', 'error'] : undefined,
        });

        return { instance, pool };
      }

      case 'sqlite': {
        const database = new BetterSqlite3(connectionConfig.database || ':memory:', {
          // Enable verbose mode for debugging if requested
          verbose: config.debug ? console.log : undefined,
          // Set busy timeout to handle concurrent access (especially for shared in-memory databases)
          // This prevents "database is locked" errors by waiting up to 5 seconds
          timeout: 5000,
        });

        // Configure pragmas for better performance and concurrency
        // Use WAL mode for better concurrency (doesn't work for in-memory databases)
        // For shared in-memory databases, we rely on the busy timeout
        const isInMemory = !connectionConfig.database ||
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
        const instance = new Kysely<unknown>({
          dialect,
          log: config.debug ? ['query', 'error'] : undefined,
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
      throw new Error('Database connection configuration is required');
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
        port: parseInt(url.port) || DIALECT_SETTINGS[config.dialect].defaultPort,
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
      throw new Error(
        `Connection configuration is required for ${config.dialect || 'undefined'}.\n` +
          `Received config keys: [${configKeys}]\n` +
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
   * Test database connection
   */
  private async testConnection(db: Kysely<unknown>, dialect: DatabaseDialect): Promise<void> {
    const timeout = this.options.queryTimeout || DEFAULT_TIMEOUTS.query;
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(Errors.timeout('database connection test', timeout)), timeout)
    );

    // Use SELECT 1 for all databases - it's simpler and doesn't depend on schema
    const testQuery = sql`SELECT 1`.execute(db);

    await Promise.race([testQuery, timeoutPromise]);
  }

  /**
   * Validate connection health
   */
  private async validateConnectionHealth(db: Kysely<unknown>, dialect: DatabaseDialect): Promise<boolean> {
    try {
      // Use a longer timeout for SQLite in-memory databases as they may need initialization
      const timeout = dialect === 'sqlite' ? 10000 : 5000;
      const timeoutPromise = new Promise<boolean>((_, reject) =>
        setTimeout(() => reject(new Error('Health check timeout')), timeout)
      );

      const healthCheckPromise = (async () => {
        // For SQLite, use a simpler query that doesn't depend on schema
        // For other databases, use SELECT 1
        const testQuery =
          dialect === 'sqlite'
            ? sql`SELECT 1 AS health_check`.execute(db)
            : sql`SELECT 1 AS health_check`.execute(db);

        await testQuery;
        return true;
      })();

      return await Promise.race([healthCheckPromise, timeoutPromise]);
    } catch (error) {
      this.logger.error({ error }, 'Connection health check failed');
      return false;
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

    return info.instance;
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

    // Increment retry count
    info.retryCount++;

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

    this.logger.info({ name }, 'Closing database connection');

    try {
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
    this.logger.info('Closing all database connections');

    const closePromises = Array.from(this.connections.keys()).map((name) =>
      this.close(name).catch((error) => this.logger.error({ name, error }, 'Error closing connection'))
    );

    await Promise.all(closePromises);
    this.connections.clear();

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
    for (const [name, info] of this.connections) {
      metrics[name] = info.metrics;
    }
    return metrics;
  }

  /**
   * Register shutdown handlers
   */
  private registerShutdownHandlers(): void {
    const shutdownHandler = async () => {
      if (this.shutdownInProgress) return;
      this.shutdownInProgress = true;

      this.logger.info('Database manager shutdown initiated');

      const timeout = this.options.shutdownTimeout || DEFAULT_TIMEOUTS.shutdown;
      const timeoutPromise = new Promise((resolve) => setTimeout(resolve, timeout));

      await Promise.race([this.closeAll(), timeoutPromise]);
    };

    process.on('SIGINT', shutdownHandler);
    process.on('SIGTERM', shutdownHandler);
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
   * Module destroy hook
   */
  /**
   * Get connection configuration
   */
  getConnectionConfig(name?: string): DatabaseConnection | undefined {
    const connectionName = name || DATABASE_DEFAULT_CONNECTION;
    const info = this.connections.get(connectionName);
    return info?.config;
  }

  async onModuleDestroy(): Promise<void> {
    await this.closeAll();
  }
}
