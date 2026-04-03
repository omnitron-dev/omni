/**
 * Mock for @kysera/dialects package
 * Provides dialect-specific utilities for testing
 */

import type { Kysely } from 'kysely';

// Types
export type DatabaseDialect = 'postgres' | 'mysql' | 'sqlite';

export interface ConnectionConfig {
  host?: string;
  port?: number;
  database?: string;
  user?: string;
  password?: string;
  ssl?: boolean;
  filename?: string; // SQLite
}

export interface DatabaseErrorLike {
  code?: string;
  message?: string;
  constraint?: string;
  table?: string;
  column?: string;
  detail?: string;
}

export interface DialectAdapter {
  getDefaultPort(): number | null;
  parseConnectionUrl(url: string): ConnectionConfig;
  buildConnectionUrl(config: ConnectionConfig): string;
  tableExists(db: Kysely<any>, tableName: string): Promise<boolean>;
  getTableColumns(db: Kysely<any>, tableName: string): Promise<string[]>;
  getTables(db: Kysely<any>): Promise<string[]>;
  escapeIdentifier(identifier: string): string;
  getCurrentTimestamp(): string;
  formatDate(date: Date): string;
  isUniqueConstraintError(error: DatabaseErrorLike): boolean;
  isForeignKeyError(error: DatabaseErrorLike): boolean;
  isNotNullError(error: DatabaseErrorLike): boolean;
  getDatabaseSize(db: Kysely<any>): Promise<number>;
  truncateAllTables(db: Kysely<any>, tables?: string[]): Promise<void>;
}

// Factory
export function getAdapter(dialect: DatabaseDialect): DialectAdapter {
  return createDialectAdapter(dialect);
}

export function createDialectAdapter(dialect: DatabaseDialect): DialectAdapter {
  const adapters: Record<DatabaseDialect, DialectAdapter> = {
    postgres: postgresAdapter,
    mysql: mysqlAdapter,
    sqlite: sqliteAdapter,
  };
  return adapters[dialect];
}

export function registerAdapter(_dialect: DatabaseDialect, _adapter: DialectAdapter): void {
  // Mock implementation - does nothing
}

// PostgreSQL adapter
export const PostgresAdapter = class implements DialectAdapter {
  getDefaultPort() {
    return 5432;
  }

  parseConnectionUrl(url: string): ConnectionConfig {
    const parsed = new URL(url);
    return {
      host: parsed.hostname,
      port: parsed.port ? parseInt(parsed.port, 10) : (this.getDefaultPort() ?? undefined),
      database: parsed.pathname.slice(1),
      user: parsed.username,
      password: parsed.password,
    };
  }

  buildConnectionUrl(config: ConnectionConfig): string {
    const { host = 'localhost', port = 5432, database, user, password } = config;
    const auth = user && password ? `${user}:${password}@` : user ? `${user}@` : '';
    return `postgresql://${auth}${host}:${port}/${database}`;
  }

  async tableExists(_db: Kysely<any>, _tableName: string): Promise<boolean> {
    return true;
  }

  async getTableColumns(_db: Kysely<any>, _tableName: string): Promise<string[]> {
    return ['id', 'name', 'created_at'];
  }

  async getTables(_db: Kysely<any>): Promise<string[]> {
    return ['users', 'posts'];
  }

  escapeIdentifier(identifier: string): string {
    return `"${identifier.replace(/"/g, '""')}"`;
  }

  getCurrentTimestamp(): string {
    return 'CURRENT_TIMESTAMP';
  }

  formatDate(date: Date): string {
    return date.toISOString();
  }

  isUniqueConstraintError(error: DatabaseErrorLike): boolean {
    return error.code === '23505';
  }

  isForeignKeyError(error: DatabaseErrorLike): boolean {
    return error.code === '23503';
  }

  isNotNullError(error: DatabaseErrorLike): boolean {
    return error.code === '23502';
  }

  async getDatabaseSize(_db: Kysely<any>): Promise<number> {
    return 1024 * 1024; // 1MB mock
  }

  async truncateAllTables(_db: Kysely<any>, _tables?: string[]): Promise<void> {
    // Mock implementation
  }
};

export const postgresAdapter: DialectAdapter = new PostgresAdapter();

// MySQL adapter
export const MySQLAdapter = class implements DialectAdapter {
  getDefaultPort() {
    return 3306;
  }

  parseConnectionUrl(url: string): ConnectionConfig {
    const parsed = new URL(url);
    return {
      host: parsed.hostname,
      port: parsed.port ? parseInt(parsed.port, 10) : (this.getDefaultPort() ?? undefined),
      database: parsed.pathname.slice(1),
      user: parsed.username,
      password: parsed.password,
    };
  }

  buildConnectionUrl(config: ConnectionConfig): string {
    const { host = 'localhost', port = 3306, database, user, password } = config;
    const auth = user && password ? `${user}:${password}@` : user ? `${user}@` : '';
    return `mysql://${auth}${host}:${port}/${database}`;
  }

  async tableExists(_db: Kysely<any>, _tableName: string): Promise<boolean> {
    return true;
  }

  async getTableColumns(_db: Kysely<any>, _tableName: string): Promise<string[]> {
    return ['id', 'name', 'created_at'];
  }

  async getTables(_db: Kysely<any>): Promise<string[]> {
    return ['users', 'posts'];
  }

  escapeIdentifier(identifier: string): string {
    return `\`${identifier.replace(/`/g, '``')}\``;
  }

  getCurrentTimestamp(): string {
    return 'CURRENT_TIMESTAMP';
  }

  formatDate(date: Date): string {
    return date.toISOString().slice(0, 19).replace('T', ' ');
  }

  isUniqueConstraintError(error: DatabaseErrorLike): boolean {
    return error.code === 'ER_DUP_ENTRY';
  }

  isForeignKeyError(error: DatabaseErrorLike): boolean {
    return error.code === 'ER_NO_REFERENCED_ROW_2' || error.code === 'ER_ROW_IS_REFERENCED_2';
  }

  isNotNullError(error: DatabaseErrorLike): boolean {
    return error.code === 'ER_BAD_NULL_ERROR';
  }

  async getDatabaseSize(_db: Kysely<any>): Promise<number> {
    return 1024 * 1024; // 1MB mock
  }

  async truncateAllTables(_db: Kysely<any>, _tables?: string[]): Promise<void> {
    // Mock implementation
  }
};

export const mysqlAdapter: DialectAdapter = new MySQLAdapter();

// SQLite adapter
export const SQLiteAdapter = class implements DialectAdapter {
  getDefaultPort() {
    return null; // SQLite doesn't use ports
  }

  parseConnectionUrl(url: string): ConnectionConfig {
    const parsed = new URL(url);
    return {
      filename: parsed.pathname,
    };
  }

  buildConnectionUrl(config: ConnectionConfig): string {
    return `sqlite://${config.filename}`;
  }

  async tableExists(_db: Kysely<any>, _tableName: string): Promise<boolean> {
    return true;
  }

  async getTableColumns(_db: Kysely<any>, _tableName: string): Promise<string[]> {
    return ['id', 'name', 'created_at'];
  }

  async getTables(_db: Kysely<any>): Promise<string[]> {
    return ['users', 'posts'];
  }

  escapeIdentifier(identifier: string): string {
    return `"${identifier.replace(/"/g, '""')}"`;
  }

  getCurrentTimestamp(): string {
    return "datetime('now')";
  }

  formatDate(date: Date): string {
    return date.toISOString();
  }

  isUniqueConstraintError(error: DatabaseErrorLike): boolean {
    return error.message?.includes('UNIQUE constraint') ?? false;
  }

  isForeignKeyError(error: DatabaseErrorLike): boolean {
    return error.message?.includes('FOREIGN KEY constraint') ?? false;
  }

  isNotNullError(error: DatabaseErrorLike): boolean {
    return error.message?.includes('NOT NULL constraint') ?? false;
  }

  async getDatabaseSize(_db: Kysely<any>): Promise<number> {
    return 1024 * 1024; // 1MB mock
  }

  async truncateAllTables(_db: Kysely<any>, _tables?: string[]): Promise<void> {
    // Mock implementation
  }
};

export const sqliteAdapter: DialectAdapter = new SQLiteAdapter();

// Connection utilities
export function parseConnectionUrl(url: string, dialect?: DatabaseDialect): ConnectionConfig {
  const detectedDialect = dialect || detectDialect(url);
  const adapter = getAdapter(detectedDialect);
  return adapter.parseConnectionUrl(url);
}

export function buildConnectionUrl(dialect: DatabaseDialect, config: ConnectionConfig): string {
  const adapter = getAdapter(dialect);
  return adapter.buildConnectionUrl(config);
}

export function getDefaultPort(dialect: DatabaseDialect): number | null {
  const adapter = getAdapter(dialect);
  return adapter.getDefaultPort();
}

function detectDialect(url: string): DatabaseDialect {
  if (url.startsWith('postgres://') || url.startsWith('postgresql://')) {
    return 'postgres';
  }
  if (url.startsWith('mysql://')) {
    return 'mysql';
  }
  if (url.startsWith('sqlite://')) {
    return 'sqlite';
  }
  return 'postgres'; // default
}

// Helper functions (standalone, backward compatible)
export async function tableExists<DB>(
  db: Kysely<DB>,
  tableName: string,
  dialect: DatabaseDialect = 'postgres'
): Promise<boolean> {
  const adapter = getAdapter(dialect);
  return adapter.tableExists(db, tableName);
}

export async function getTableColumns<DB>(
  db: Kysely<DB>,
  tableName: string,
  dialect: DatabaseDialect = 'postgres'
): Promise<string[]> {
  const adapter = getAdapter(dialect);
  return adapter.getTableColumns(db, tableName);
}

export async function getTables<DB>(db: Kysely<DB>, dialect: DatabaseDialect = 'postgres'): Promise<string[]> {
  const adapter = getAdapter(dialect);
  return adapter.getTables(db);
}

export function escapeIdentifier(identifier: string, dialect: DatabaseDialect = 'postgres'): string {
  const adapter = getAdapter(dialect);
  return adapter.escapeIdentifier(identifier);
}

export function getCurrentTimestamp(dialect: DatabaseDialect = 'postgres'): string {
  const adapter = getAdapter(dialect);
  return adapter.getCurrentTimestamp();
}

export function formatDate(date: Date, dialect: DatabaseDialect = 'postgres'): string {
  const adapter = getAdapter(dialect);
  return adapter.formatDate(date);
}

export function isUniqueConstraintError(error: DatabaseErrorLike, dialect: DatabaseDialect = 'postgres'): boolean {
  const adapter = getAdapter(dialect);
  return adapter.isUniqueConstraintError(error);
}

export function isForeignKeyError(error: DatabaseErrorLike, dialect: DatabaseDialect = 'postgres'): boolean {
  const adapter = getAdapter(dialect);
  return adapter.isForeignKeyError(error);
}

export function isNotNullError(error: DatabaseErrorLike, dialect: DatabaseDialect = 'postgres'): boolean {
  const adapter = getAdapter(dialect);
  return adapter.isNotNullError(error);
}

export async function getDatabaseSize<DB>(db: Kysely<DB>, dialect: DatabaseDialect = 'postgres'): Promise<number> {
  const adapter = getAdapter(dialect);
  return adapter.getDatabaseSize(db);
}

export async function truncateAllTables<DB>(
  db: Kysely<DB>,
  tables?: string[],
  dialect: DatabaseDialect = 'postgres'
): Promise<void> {
  const adapter = getAdapter(dialect);
  return adapter.truncateAllTables(db, tables);
}

// ============================================================================
// Identifier Helpers
// ============================================================================

export function validateIdentifier(name: string): boolean {
  return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name);
}

export function assertValidIdentifier(name: string, context = 'identifier'): void {
  if (!validateIdentifier(name)) {
    throw new Error(`Invalid ${context}: ${name}`);
  }
}

// ============================================================================
// Schema / Tenant Helpers
// ============================================================================

export interface SchemaOptions {
  schema?: string;
}

export interface TenantSchemaConfig {
  prefix?: string;
  separator?: string;
}

export function resolveSchema(defaultSchema: string, options?: SchemaOptions): string {
  return options?.schema || defaultSchema;
}

export function getTenantSchemaName(tenantId: string, config?: TenantSchemaConfig): string {
  const prefix = config?.prefix || 'tenant';
  const separator = config?.separator || '_';
  return `${prefix}${separator}${tenantId}`;
}

export function parseTenantSchemaName(schemaName: string, config?: TenantSchemaConfig): string | null {
  const prefix = config?.prefix || 'tenant';
  const separator = config?.separator || '_';
  const expectedPrefix = `${prefix}${separator}`;
  if (schemaName.startsWith(expectedPrefix)) {
    return schemaName.slice(expectedPrefix.length);
  }
  return null;
}

export function isTenantSchema(schemaName: string, config?: TenantSchemaConfig): boolean {
  return parseTenantSchemaName(schemaName, config) !== null;
}

export function filterTenantSchemas(schemas: string[], config?: TenantSchemaConfig): string[] {
  return schemas.filter((s) => isTenantSchema(s, config));
}

export function extractTenantIds(schemas: string[], config?: TenantSchemaConfig): string[] {
  return schemas.map((s) => parseTenantSchemaName(s, config)).filter((id): id is string => id !== null);
}

export function qualifyTableName(tableName: string, schema?: string, _dialect?: DatabaseDialect): string {
  return schema ? `${schema}.${tableName}` : tableName;
}

// ============================================================================
// Error Extraction Helpers
// ============================================================================

export interface ExtractedErrorInfo {
  code?: string;
  message?: string;
  constraint?: string;
  table?: string;
  column?: string;
  detail?: string;
}

export function extractErrorInfo(error: unknown): ExtractedErrorInfo {
  if (!error || typeof error !== 'object') return {};
  const err = error as Record<string, unknown>;
  return {
    code: err.code as string | undefined,
    message: err.message as string | undefined,
    constraint: err.constraint as string | undefined,
    table: err.table as string | undefined,
    column: err.column as string | undefined,
    detail: err.detail as string | undefined,
  };
}

export function createErrorMatcher(dialect: DatabaseDialect): (error: unknown) => ExtractedErrorInfo {
  return (error) => extractErrorInfo(error);
}

export const errorMatchers = {
  postgres: createErrorMatcher('postgres'),
  mysql: createErrorMatcher('mysql'),
  sqlite: createErrorMatcher('sqlite'),
};
