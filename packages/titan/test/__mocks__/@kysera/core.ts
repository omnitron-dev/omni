/**
 * Mock for @kysera/core package
 * Provides simple implementations for testing
 */

export class DatabaseError extends Error {
  constructor(
    message: string,
    public code: string,
    public detail?: string
  ) {
    super(message);
    this.name = 'DatabaseError';
  }

  toJSON() {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      detail: this.detail,
    };
  }
}

export class UniqueConstraintError extends DatabaseError {
  constructor(
    public constraint: string,
    public table: string,
    public columns?: string[]
  ) {
    super(`UNIQUE constraint violation on ${table}`, 'UNIQUE_VIOLATION');
    this.name = 'UniqueConstraintError';
  }
}

export class ForeignKeyError extends DatabaseError {
  constructor(
    public constraint: string,
    public table: string,
    public referencedTable?: string
  ) {
    super('FOREIGN KEY constraint violation', 'FOREIGN_KEY_VIOLATION');
    this.name = 'ForeignKeyError';
  }
}

export class NotFoundError extends DatabaseError {
  constructor(entity: string, criteria?: unknown) {
    const message = `${entity} not found`;
    const detail = criteria ? JSON.stringify(criteria) : undefined;
    super(message, 'NOT_FOUND', detail);
    this.name = 'NotFoundError';
  }
}

export function parseDatabaseError(error: any, dialect: string = 'sqlite'): DatabaseError {
  if (!error || typeof error !== 'object') {
    return new DatabaseError('Unknown database error', 'UNKNOWN');
  }

  // Simple implementation - just wrap the error
  if (error.message?.includes('UNIQUE constraint')) {
    return new UniqueConstraintError('unique', 'unknown', []);
  }

  if (error.message?.includes('FOREIGN KEY constraint')) {
    return new ForeignKeyError('foreign_key', 'unknown');
  }

  return new DatabaseError(error.message || 'Database error', error.code || 'UNKNOWN');
}

// Pagination mock with proper total count
export async function paginate(qb: any, options: any) {
  const { page = 1, limit = 10 } = options;
  const offset = (page - 1) * limit;

  // Execute paginated query
  const query = qb.limit(limit).offset(offset);
  const data = await query.execute();

  // Try to get total count using Kysely's query builder methods
  let total = data.length;
  try {
    // Clone the query builder and execute a count query
    // Kysely query builders are immutable, so calling methods returns a new builder
    const countQuery = qb
      .clearLimit()
      .clearOffset()
      .clearSelect()
      .clearOrderBy()
      .select((eb: any) => eb.fn.countAll().as('count'));
    const countResult = await countQuery.executeTakeFirst();
    total = Number(countResult?.count ?? data.length);
  } catch {
    // If count fails, estimate based on data and pagination
    // If we got a full page and this isn't page 1, there are likely more rows
    if (data.length === limit && page > 1) {
      total = offset + data.length;
    }
  }

  // Recalculate hasNext based on total
  const totalPages = Math.ceil(total / limit);
  const hasNext = page < totalPages;

  return {
    data,
    pagination: {
      total,
      page,
      limit,
      totalPages,
      hasNext,
    },
  };
}

export async function paginateCursor(qb: any, options: any) {
  const { cursor, limit = 10 } = options;

  const data = await qb.limit(limit + 1).execute();
  const hasNext = data.length > limit;

  if (hasNext) {
    data.pop();
  }

  return {
    data,
    pagination: {
      limit,
      hasNext,
      hasPrev: !!cursor,
      nextCursor: hasNext ? String(data[data.length - 1]?.id) : undefined,
      prevCursor: cursor ? String(data[0]?.id) : undefined,
    },
  };
}

export type PaginationOptions = {
  page?: number;
  limit?: number;
};

export type PaginatedResult<T> = {
  data: T[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
};

export type CursorOptions<T = unknown> = {
  cursor?: string;
  limit?: number;
  orderBy?: Array<{ column: keyof T & string; direction: 'asc' | 'desc' }>;
};

// Retry utilities
export interface RetryOptions {
  maxAttempts?: number;
  delayMs?: number;
  backoff?: boolean;
  shouldRetry?: (error: unknown) => boolean;
  onRetry?: (attempt: number, error: unknown) => void;
}

export function isTransientError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const err = error as { code?: string };
  const transientCodes = ['ECONNREFUSED', 'ETIMEDOUT', 'ECONNRESET', 'EPIPE'];
  return transientCodes.includes(err.code || '');
}

export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const { maxAttempts = 3, delayMs = 1000, backoff = true, shouldRetry = isTransientError, onRetry } = options;

  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt < maxAttempts && shouldRetry(error)) {
        onRetry?.(attempt, error);
        const delay = backoff ? delayMs * Math.pow(2, attempt - 1) : delayMs;
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }
      throw error;
    }
  }
  throw lastError;
}

export function createRetryWrapper<T extends (...args: any[]) => Promise<any>>(fn: T, options?: RetryOptions): T {
  return ((...args: any[]) => withRetry(() => fn(...args), options)) as T;
}

// Circuit Breaker
export class CircuitBreaker {
  private state: 'closed' | 'open' | 'half-open' = 'closed';
  private failures = 0;
  private lastFailureTime?: number;

  constructor(
    private threshold: number = 5,
    private resetTimeMs: number = 60000
  ) {}

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === 'open') {
      if (Date.now() - (this.lastFailureTime || 0) > this.resetTimeMs) {
        this.state = 'half-open';
      } else {
        throw new Error('Circuit breaker is open');
      }
    }

    try {
      const result = await fn();
      if (this.state === 'half-open') {
        this.state = 'closed';
        this.failures = 0;
      }
      return result;
    } catch (error) {
      this.failures++;
      this.lastFailureTime = Date.now();
      if (this.failures >= this.threshold) {
        this.state = 'open';
      }
      throw error;
    }
  }

  reset(): void {
    this.state = 'closed';
    this.failures = 0;
    this.lastFailureTime = undefined;
  }

  getState(): { state: string; failures: number; lastFailureTime?: number } {
    return { state: this.state, failures: this.failures, lastFailureTime: this.lastFailureTime };
  }
}

// Debug utilities
export interface DebugOptions {
  logQuery?: boolean;
  logParams?: boolean;
  slowQueryThreshold?: number;
  onSlowQuery?: (sql: string, duration: number) => void;
  logger?: (message: string) => void;
  maxMetrics?: number;
}

export interface QueryMetrics {
  sql: string;
  params?: unknown[];
  duration: number;
  timestamp: number;
}

export function withDebug<DB>(
  db: DB,
  _options?: DebugOptions
): DB & { getMetrics: () => QueryMetrics[]; clearMetrics: () => void } {
  const metrics: QueryMetrics[] = [];
  return Object.assign(db as object, {
    getMetrics: () => metrics,
    clearMetrics: () => {
      metrics.length = 0;
    },
  }) as DB & { getMetrics: () => QueryMetrics[]; clearMetrics: () => void };
}

export function formatSQL(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim();
}

export class QueryProfiler {
  private metrics: QueryMetrics[] = [];

  record(metric: QueryMetrics): void {
    this.metrics.push(metric);
  }

  getSummary(): { totalQueries: number; totalDuration: number; averageDuration: number } {
    const totalDuration = this.metrics.reduce((sum, m) => sum + m.duration, 0);
    return {
      totalQueries: this.metrics.length,
      totalDuration,
      averageDuration: this.metrics.length > 0 ? totalDuration / this.metrics.length : 0,
    };
  }

  clear(): void {
    this.metrics.length = 0;
  }
}

// Health check utilities
export interface HealthCheckResult {
  status: 'healthy' | 'degraded' | 'unhealthy';
  checks: Array<{ name: string; status: string; message?: string }>;
  timestamp: Date;
}

export interface PoolMetrics {
  total: number;
  idle: number;
  active: number;
  waiting: number;
}

export interface MetricsPool {
  end(): Promise<void> | void;
  getMetrics(): PoolMetrics;
}

export interface DatabasePool {
  end(): Promise<void> | void;
}

export function createMetricsPool(pool: DatabasePool): MetricsPool {
  return {
    ...pool,
    getMetrics: () => ({ total: 10, idle: 5, active: 5, waiting: 0 }),
  };
}

export async function checkDatabaseHealth<DB>(_db: DB, _pool?: MetricsPool): Promise<HealthCheckResult> {
  return {
    status: 'healthy',
    checks: [{ name: 'database', status: 'healthy' }],
    timestamp: new Date(),
  };
}

export async function performHealthCheck<DB>(
  db: DB,
  _options?: { verbose?: boolean; pool?: MetricsPool }
): Promise<HealthCheckResult> {
  return checkDatabaseHealth(db);
}

export async function getMetrics<DB>(_db: DB, _options?: { period?: string; pool?: MetricsPool }): Promise<unknown> {
  return {};
}

export class HealthMonitor {
  private lastCheck?: HealthCheckResult;

  constructor(_db: unknown, _pool?: MetricsPool, _intervalMs?: number) {}

  start(_onCheck?: (result: HealthCheckResult) => void): void {}
  stop(): void {}
  getLastCheck(): HealthCheckResult | undefined {
    return this.lastCheck;
  }
}

// Shutdown utilities
export interface ShutdownOptions {
  timeout?: number;
  onShutdown?: () => void | Promise<void>;
  logger?: (message: string) => void;
}

export async function createGracefulShutdown<DB>(_db: DB, _options?: ShutdownOptions): Promise<void> {}
export async function shutdownDatabase<DB>(_db: DB): Promise<void> {}

// Testing utilities
export type CleanupStrategy = 'truncate' | 'transaction' | 'delete';
export type IsolationLevel = 'read uncommitted' | 'read committed' | 'repeatable read' | 'serializable';

class RollbackError extends Error {
  constructor() {
    super('Rollback');
    this.name = 'RollbackError';
  }
}

export async function testInTransaction<DB, T>(_db: DB, fn: (trx: unknown) => Promise<T>): Promise<void> {
  try {
    // @ts-ignore - mock implementation
    await _db.transaction().execute(async (trx: unknown) => {
      await fn(trx);
      throw new RollbackError();
    });
  } catch (error) {
    if (!(error instanceof RollbackError)) {
      throw error;
    }
  }
}

export async function testWithSavepoints<DB, T>(db: DB, fn: (trx: unknown) => Promise<T>): Promise<void> {
  return testInTransaction(db, fn);
}

export async function testWithIsolation<DB, T>(
  db: DB,
  _isolationLevel: IsolationLevel,
  fn: (trx: unknown) => Promise<T>
): Promise<void> {
  return testInTransaction(db, fn);
}

export async function cleanDatabase<DB>(_db: DB, _strategy?: CleanupStrategy, _tables?: string[]): Promise<void> {}

export async function seedDatabase<DB, T>(db: DB, fn: (trx: unknown) => Promise<T>): Promise<void> {
  // @ts-ignore - mock implementation
  await db.transaction().execute(fn);
}

export async function snapshotTable<DB>(_db: DB, _table: string): Promise<unknown[]> {
  return [];
}

export async function countRows<DB>(_db: DB, _table: string): Promise<number> {
  return 0;
}

export async function waitFor(
  condition: () => Promise<boolean> | boolean,
  options?: { timeout?: number; interval?: number }
): Promise<void> {
  const timeout = options?.timeout || 5000;
  const interval = options?.interval || 100;
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    if (await condition()) return;
    await new Promise((resolve) => setTimeout(resolve, interval));
  }

  throw new Error('waitFor timeout');
}

export function createFactory<T extends Record<string, unknown>>(defaults: { [K in keyof T]: T[K] | (() => T[K]) }): (
  overrides?: Partial<T>
) => T {
  return (overrides?: Partial<T>): T => {
    const result: Partial<T> = {};
    for (const key of Object.keys(defaults) as (keyof T)[]) {
      const defaultValue = defaults[key];
      result[key] = (
        overrides?.[key] !== undefined
          ? overrides[key]
          : typeof defaultValue === 'function'
            ? (defaultValue as () => T[keyof T])()
            : defaultValue
      ) as T[keyof T];
    }
    return result as T;
  };
}

// Type utilities
export type Executor<DB> = DB;

export interface Timestamps {
  created_at: Date;
  updated_at?: Date;
}

export interface SoftDelete {
  deleted_at: Date | null;
}

export interface AuditFields {
  created_by?: number;
  updated_by?: number;
}

export class BadRequestError extends DatabaseError {
  constructor(message: string) {
    super(message, 'RESOURCE_BAD_REQUEST');
    this.name = 'BadRequestError';
  }
}

export class NotNullError extends DatabaseError {
  constructor(
    public column: string,
    public table?: string
  ) {
    const tableInfo = table ? ` on table ${table}` : '';
    super(`NOT NULL constraint violation on column ${column}${tableInfo}`, 'VALIDATION_NOT_NULL_VIOLATION', column);
    this.name = 'NotNullError';
  }

  toJSON() {
    return {
      ...super.toJSON(),
      column: this.column,
      table: this.table,
    };
  }
}

export class CheckConstraintError extends DatabaseError {
  constructor(
    public constraint: string,
    public table?: string
  ) {
    const tableInfo = table ? ` on table ${table}` : '';
    super(`CHECK constraint violation: ${constraint}${tableInfo}`, 'VALIDATION_CHECK_VIOLATION');
    this.name = 'CheckConstraintError';
  }

  toJSON() {
    return {
      ...super.toJSON(),
      constraint: this.constraint,
      table: this.table,
    };
  }
}

// Error Codes - Unified system
export const DatabaseErrorCodes = {
  DB_CONNECTION_FAILED: 'DB_CONNECTION_FAILED',
  DB_QUERY_FAILED: 'DB_QUERY_FAILED',
  DB_TRANSACTION_FAILED: 'DB_TRANSACTION_FAILED',
  DB_TIMEOUT: 'DB_TIMEOUT',
  DB_POOL_EXHAUSTED: 'DB_POOL_EXHAUSTED',
  DB_UNKNOWN: 'DB_UNKNOWN',
} as const;

export const ValidationErrorCodes = {
  VALIDATION_UNIQUE_VIOLATION: 'VALIDATION_UNIQUE_VIOLATION',
  VALIDATION_FOREIGN_KEY_VIOLATION: 'VALIDATION_FOREIGN_KEY_VIOLATION',
  VALIDATION_NOT_NULL_VIOLATION: 'VALIDATION_NOT_NULL_VIOLATION',
  VALIDATION_CHECK_VIOLATION: 'VALIDATION_CHECK_VIOLATION',
  VALIDATION_INVALID_INPUT: 'VALIDATION_INVALID_INPUT',
  VALIDATION_REQUIRED_FIELD: 'VALIDATION_REQUIRED_FIELD',
  VALIDATION_INVALID_TYPE: 'VALIDATION_INVALID_TYPE',
} as const;

export const ResourceErrorCodes = {
  RESOURCE_NOT_FOUND: 'RESOURCE_NOT_FOUND',
  RESOURCE_ALREADY_EXISTS: 'RESOURCE_ALREADY_EXISTS',
  RESOURCE_CONFLICT: 'RESOURCE_CONFLICT',
  RESOURCE_BAD_REQUEST: 'RESOURCE_BAD_REQUEST',
} as const;

export const MigrationErrorCodes = {
  MIGRATION_UP_FAILED: 'MIGRATION_UP_FAILED',
  MIGRATION_DOWN_FAILED: 'MIGRATION_DOWN_FAILED',
  MIGRATION_VALIDATION_FAILED: 'MIGRATION_VALIDATION_FAILED',
  MIGRATION_NOT_FOUND: 'MIGRATION_NOT_FOUND',
  MIGRATION_DUPLICATE_NAME: 'MIGRATION_DUPLICATE_NAME',
  MIGRATION_LOCK_FAILED: 'MIGRATION_LOCK_FAILED',
  MIGRATION_ALREADY_EXECUTED: 'MIGRATION_ALREADY_EXECUTED',
} as const;

export const PluginErrorCodes = {
  PLUGIN_VALIDATION_FAILED: 'PLUGIN_VALIDATION_FAILED',
  PLUGIN_INIT_FAILED: 'PLUGIN_INIT_FAILED',
  PLUGIN_CONFLICT: 'PLUGIN_CONFLICT',
  PLUGIN_DEPENDENCY_MISSING: 'PLUGIN_DEPENDENCY_MISSING',
  PLUGIN_DUPLICATE: 'PLUGIN_DUPLICATE',
  PLUGIN_NOT_FOUND: 'PLUGIN_NOT_FOUND',
} as const;

export const AuditErrorCodes = {
  AUDIT_LOG_NOT_FOUND: 'AUDIT_LOG_NOT_FOUND',
  AUDIT_RESTORE_NOT_SUPPORTED: 'AUDIT_RESTORE_NOT_SUPPORTED',
  AUDIT_OLD_VALUES_MISSING: 'AUDIT_OLD_VALUES_MISSING',
  AUDIT_TABLE_CREATION_FAILED: 'AUDIT_TABLE_CREATION_FAILED',
} as const;

export const ConfigErrorCodes = {
  CONFIG_NOT_FOUND: 'CONFIG_NOT_FOUND',
  CONFIG_VALIDATION_FAILED: 'CONFIG_VALIDATION_FAILED',
  CONFIG_PARSE_ERROR: 'CONFIG_PARSE_ERROR',
  CONFIG_REQUIRED_MISSING: 'CONFIG_REQUIRED_MISSING',
  CONFIG_INVALID_VALUE: 'CONFIG_INVALID_VALUE',
} as const;

export const FileSystemErrorCodes = {
  FS_FILE_NOT_FOUND: 'FS_FILE_NOT_FOUND',
  FS_PERMISSION_DENIED: 'FS_PERMISSION_DENIED',
  FS_DIRECTORY_NOT_FOUND: 'FS_DIRECTORY_NOT_FOUND',
  FS_FILE_EXISTS: 'FS_FILE_EXISTS',
  FS_WRITE_FAILED: 'FS_WRITE_FAILED',
  FS_READ_FAILED: 'FS_READ_FAILED',
} as const;

export const NetworkErrorCodes = {
  NETWORK_CONNECTION_REFUSED: 'NETWORK_CONNECTION_REFUSED',
  NETWORK_TIMEOUT: 'NETWORK_TIMEOUT',
  NETWORK_DNS_FAILED: 'NETWORK_DNS_FAILED',
  NETWORK_SSL_ERROR: 'NETWORK_SSL_ERROR',
} as const;

export const ErrorCodes = {
  ...DatabaseErrorCodes,
  ...ValidationErrorCodes,
  ...ResourceErrorCodes,
  ...MigrationErrorCodes,
  ...PluginErrorCodes,
  ...AuditErrorCodes,
  ...ConfigErrorCodes,
  ...FileSystemErrorCodes,
  ...NetworkErrorCodes,
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

export function isValidErrorCode(code: string): code is ErrorCode {
  return Object.values(ErrorCodes).includes(code as ErrorCode);
}

export function getErrorCategory(code: string): string {
  const match = code.match(/^([A-Z]+)_/);
  return match ? match[1] : 'UNKNOWN';
}

export const LegacyCodeMapping: Record<string, ErrorCode> = {
  UNIQUE_VIOLATION: ErrorCodes.VALIDATION_UNIQUE_VIOLATION,
  FOREIGN_KEY_VIOLATION: ErrorCodes.VALIDATION_FOREIGN_KEY_VIOLATION,
  NOT_FOUND: ErrorCodes.RESOURCE_NOT_FOUND,
  BAD_REQUEST: ErrorCodes.RESOURCE_BAD_REQUEST,
};

export function mapLegacyCode(legacyCode: string): ErrorCode | string {
  return LegacyCodeMapping[legacyCode] ?? legacyCode;
}

export function paginateCursorSimple<_DB, _TB, O>(
  query: unknown,
  options?: PaginationOptions
): Promise<PaginatedResult<O>> {
  return paginateCursor(query, { ...options, orderBy: [{ column: 'id' as any, direction: 'asc' }] }) as Promise<
    PaginatedResult<O>
  >;
}

// Helper functions from @kysera/core
export interface OffsetOptions {
  limit?: number;
  offset?: number;
}

export interface DateRangeOptions {
  from?: Date;
  to?: Date;
}

export function applyOffset<_DB, _TB extends keyof _DB, _O>(query: any, options?: OffsetOptions): any {
  let q = query;

  if (options?.limit !== undefined) {
    const boundedLimit = Math.min(100, Math.max(1, options.limit));
    q = q.limit(boundedLimit);
  }

  if (options?.offset !== undefined) {
    const boundedOffset = Math.max(0, options.offset);
    if (options?.limit === undefined) {
      q = q.limit(2147483647);
    }
    q = q.offset(boundedOffset);
  }

  return q;
}

export function applyDateRange<_DB, _TB extends keyof _DB, _O>(
  query: any,
  column: string,
  options?: DateRangeOptions
): any {
  let q = query;

  if (options?.from) {
    const fromValue = options.from instanceof Date ? options.from.toISOString() : options.from;
    q = q.where(column, '>=', fromValue);
  }

  if (options?.to) {
    const toValue = options.to instanceof Date ? options.to.toISOString() : options.to;
    q = q.where(column, '<=', toValue);
  }

  return q;
}

export async function executeCount<_DB, _TB extends keyof _DB, _O>(query: any): Promise<number> {
  const result = await query
    .clearSelect()
    .select((eb: any) => eb.fn.countAll().as('count'))
    .executeTakeFirst();

  return Number(result?.count ?? 0);
}

export async function executeGroupedCount<_DB, _TB extends keyof _DB, _O>(
  query: any,
  groupColumn: string
): Promise<Record<string, number>> {
  const results = await query
    .clearSelect()
    .select([groupColumn])
    .select((eb: any) => eb.fn.countAll().as('count'))
    .groupBy(groupColumn)
    .execute();

  return results.reduce(
    (acc: Record<string, number>, row: any) => {
      const key = String(row[groupColumn]);
      acc[key] = Number(row.count);
      return acc;
    },
    {} as Record<string, number>
  );
}

// ============================================================================
// Additional Error Classes
// ============================================================================

export class SoftDeleteError extends DatabaseError {
  constructor(message: string) {
    super(message, 'SOFT_DELETE_ERROR');
    this.name = 'SoftDeleteError';
  }
}

export class RecordNotDeletedError extends SoftDeleteError {
  constructor(entity: string, id?: unknown) {
    super(`${entity} with id ${id} is not soft-deleted`);
    this.name = 'RecordNotDeletedError';
  }
}

export class AuditError extends DatabaseError {
  constructor(message: string, code: string = 'AUDIT_ERROR') {
    super(message, code);
    this.name = 'AuditError';
  }
}

export class AuditRestoreError extends AuditError {
  constructor(message: string = 'Audit restore not supported') {
    super(message, 'AUDIT_RESTORE_NOT_SUPPORTED');
    this.name = 'AuditRestoreError';
  }
}

export class AuditMissingValuesError extends AuditError {
  constructor(message: string = 'Audit old values missing') {
    super(message, 'AUDIT_OLD_VALUES_MISSING');
    this.name = 'AuditMissingValuesError';
  }
}

export class TimestampsError extends DatabaseError {
  constructor(message: string) {
    super(message, 'TIMESTAMPS_ERROR');
    this.name = 'TimestampsError';
  }
}

export class TimestampColumnMissingError extends TimestampsError {
  constructor(column: string, table?: string) {
    const tableInfo = table ? ` on table ${table}` : '';
    super(`Timestamp column ${column} missing${tableInfo}`);
    this.name = 'TimestampColumnMissingError';
  }
}

// ============================================================================
// Logger
// ============================================================================

export interface KyseraLogger {
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
  debug: (message: string) => void;
}

export const consoleLogger: KyseraLogger = {
  info: (msg: string) => console.info(msg),
  warn: (msg: string) => console.warn(msg),
  error: (msg: string) => console.error(msg),
  debug: (msg: string) => console.debug(msg),
};

export const silentLogger: KyseraLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
};

export function createPrefixedLogger(logger: KyseraLogger, prefix: string): KyseraLogger {
  return {
    info: (msg: string) => logger.info(`[${prefix}] ${msg}`),
    warn: (msg: string) => logger.warn(`[${prefix}] ${msg}`),
    error: (msg: string) => logger.error(`[${prefix}] ${msg}`),
    debug: (msg: string) => logger.debug(`[${prefix}] ${msg}`),
  };
}

// ============================================================================
// Helpers
// ============================================================================

export function getEnv(key: string): string | undefined {
  return process.env[key];
}

export type Dialect = 'postgres' | 'mysql' | 'sqlite';

export function formatTimestampForDb(date?: Date, dialect?: Dialect): string {
  const d = date || new Date();
  return d.toISOString();
}

export interface TableFilterConfig {
  tables?: string[];
  excludeTables?: string[];
}

export function shouldApplyToTable(tableName: string, config: TableFilterConfig): boolean {
  if (config.excludeTables?.includes(tableName)) return false;
  if (config.tables && config.tables.length > 0) return config.tables.includes(tableName);
  return true;
}

export function detectDialect<DB>(_executor: any): Dialect {
  return 'postgres';
}

// ============================================================================
// Plugin Base
// ============================================================================

export function createPluginConfig(options: Record<string, unknown> = {}): Record<string, unknown> {
  return { ...options };
}

export function createPluginMetadata(name: string, version: string = '1.0.0'): Record<string, unknown> {
  return { name, version };
}

export const PLUGIN_PRIORITIES = {
  HIGH: 100,
  NORMAL: 50,
  LOW: 10,
} as const;

// ============================================================================
// Version
// ============================================================================

export function getPackageVersion(): string {
  return '0.0.0-dev';
}

export function formatVersionString(prefix = ''): string {
  return `${prefix}${getPackageVersion()}`;
}

export function isDevelopmentVersion(): boolean {
  return true;
}

export const VERSION = getPackageVersion();

// ============================================================================
// Cursor Crypto
// ============================================================================

export interface CursorSecurityOptions {
  secret?: string;
  encrypt?: boolean;
}

export function signCursor(cursor: string, _secret: string): string {
  return cursor;
}

export function verifyCursor(signedCursor: string, _secret: string): string {
  return signedCursor;
}

export function encryptCursor(cursor: string, _secret: string): string {
  return cursor;
}

export function decryptCursor(encryptedCursor: string, _secret: string): string {
  return encryptedCursor;
}
