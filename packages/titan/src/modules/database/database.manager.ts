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
  metrics: {
    queryCount: number;
    errorCount: number;
    totalQueryTime: number;
  };
}

@Injectable()
export class DatabaseManager implements IDatabaseManager {
  private connections: Map<string, ConnectionInfo> = new Map();
  private eventEmitter: EventEmitter = new EventEmitter();
  private logger: Logger;
  private options: DatabaseModuleOptions;
  private shutdownInProgress = false;

  constructor(options: DatabaseModuleOptions = {}, logger?: Logger) {
    this.options = options;
    // Create a console logger if none provided (proper fallback)
    this.logger = logger || createDefaultLogger('DatabaseManager');
  }

  /**
   * Initialize the database manager
   */
  async init(): Promise<void> {
    this.logger.info('Initializing database manager');

    // Setup connections from configuration
    const connections = this.getConnectionConfigs();

    for (const [name, config] of Object.entries(connections)) {
      await this.createConnection(name, config);
    }

    // Register shutdown handlers
    this.registerShutdownHandlers();

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

      // Test connection
      await this.testConnection(instance, config.dialect);

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

        // Add error handler to prevent unhandled promise rejections
        pool.on('error', (err) => {
          // Log the error but don't throw - this handles connection termination errors
          this.logger.error({ error: err }, 'PostgreSQL pool error');
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

        const pool = mysql.createPool({
          ...mysqlConfig,
          ...DEFAULT_POOL_CONFIG,
          ...config.pool,
          waitForConnections: true,
          connectionLimit: config.pool?.max || DEFAULT_POOL_CONFIG.max,
          queueLimit: 0,
        } as mysql.PoolOptions);

        const dialect = new MysqlDialect({ pool });
        const instance = new Kysely<unknown>({
          dialect,
          log: config.debug ? ['query', 'error'] : undefined,
        });

        return { instance, pool };
      }

      case 'sqlite': {
        const database = new BetterSqlite3(connectionConfig.database || ':memory:');
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
    const connConfig = config.connection as Partial<ParsedConnectionConfig>;
    return {
      database: connConfig.database || 'postgres',
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

    const testQuery =
      dialect === 'sqlite'
        ? (db as unknown as Kysely<Record<string, unknown>>).selectFrom('sqlite_master' as unknown as never).select('name' as unknown as never).limit(1).execute()
        : sql`SELECT 1`.execute(db);

    await Promise.race([testQuery, timeoutPromise]);
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
    await this.createConnection(name, info.config);
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
