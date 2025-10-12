/**
 * Database Module Utilities
 *
 * Helper functions for database operations
 */

import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import type { DatabaseDialect, ConnectionConfig } from './database.types.js';

/**
 * Parse database connection URL
 */
export function parseConnectionUrl(url: string): ConnectionConfig {
  const parsed = new URL(url);

  return {
    host: parsed.hostname,
    port: parsed.port ? parseInt(parsed.port) : undefined,
    database: parsed.pathname.slice(1),
    user: parsed.username || undefined,
    password: parsed.password || undefined,
    ssl: parsed.searchParams.get('ssl') === 'true' || parsed.searchParams.get('sslmode') === 'require',
  };
}

/**
 * Build connection URL from config
 */
export function buildConnectionUrl(dialect: DatabaseDialect, config: ConnectionConfig): string {
  const protocol = dialect === 'postgres' ? 'postgresql' : dialect;
  const auth = config.user ? (config.password ? `${config.user}:${config.password}@` : `${config.user}@`) : '';

  const host = config.host || 'localhost';
  const port = config.port || getDefaultPort(dialect);
  const database = config.database;

  let url = `${protocol}://${auth}${host}:${port}/${database}`;

  if (config.ssl) {
    url += '?ssl=true';
  }

  return url;
}

/**
 * Get default port for dialect
 */
export function getDefaultPort(dialect: DatabaseDialect): number | null {
  switch (dialect) {
    case 'postgres':
      return 5432;
    case 'mysql':
      return 3306;
    case 'sqlite':
      return null;
    default:
      return null;
  }
}

/**
 * Check if table exists
 */
export async function tableExists(db: Kysely<any>, tableName: string, dialect: DatabaseDialect): Promise<boolean> {
  try {
    switch (dialect) {
      case 'postgres': {
        const result = await db
          .selectFrom('information_schema.tables')
          .select('table_name')
          .where('table_name', '=', tableName)
          .where('table_schema', '=', 'public')
          .executeTakeFirst();
        return !!result;
      }

      case 'mysql': {
        const result = await db
          .selectFrom('information_schema.tables')
          .select('table_name')
          .where('table_name', '=', tableName)
          .where('table_schema', '=', sql`DATABASE()`)
          .executeTakeFirst();
        return !!result;
      }

      case 'sqlite': {
        const result = await db
          .selectFrom('sqlite_master')
          .select('name')
          .where('type', '=', 'table')
          .where('name', '=', tableName)
          .executeTakeFirst();
        return !!result;
      }

      default:
        return false;
    }
  } catch (error) {
    return false;
  }
}

/**
 * Get table columns
 */
export async function getTableColumns(db: Kysely<any>, tableName: string, dialect: DatabaseDialect): Promise<string[]> {
  try {
    switch (dialect) {
      case 'postgres': {
        const results = await db
          .selectFrom('information_schema.columns')
          .select('column_name')
          .where('table_name', '=', tableName)
          .where('table_schema', '=', 'public')
          .execute();
        return results.map((r) => r.column_name as string);
      }

      case 'mysql': {
        const results = await db
          .selectFrom('information_schema.columns')
          .select('column_name')
          .where('table_name', '=', tableName)
          .where('table_schema', '=', sql`DATABASE()`)
          .execute();
        return results.map((r) => r.column_name as string);
      }

      case 'sqlite': {
        const results = await sql.raw(`PRAGMA table_info(${tableName})`).execute(db);
        return (results.rows as any[]).map((r) => r.name);
      }

      default:
        return [];
    }
  } catch (error) {
    return [];
  }
}

/**
 * Escape identifier for SQL
 */
export function escapeIdentifier(identifier: string, dialect: DatabaseDialect): string {
  switch (dialect) {
    case 'postgres':
      return `"${identifier.replace(/"/g, '""')}"`;
    case 'mysql':
      return `\`${identifier.replace(/`/g, '``')}\``;
    case 'sqlite':
      return `"${identifier.replace(/"/g, '""')}"`;
    default:
      return identifier;
  }
}

/**
 * Get current timestamp SQL
 */
export function getCurrentTimestamp(dialect: DatabaseDialect): string {
  switch (dialect) {
    case 'postgres':
      return 'CURRENT_TIMESTAMP';
    case 'mysql':
      return 'CURRENT_TIMESTAMP';
    case 'sqlite':
      return "datetime('now')";
    default:
      return 'CURRENT_TIMESTAMP';
  }
}

/**
 * Format date for database
 */
export function formatDate(date: Date, dialect: DatabaseDialect): string {
  switch (dialect) {
    case 'postgres':
      return date.toISOString();
    case 'mysql':
      return date.toISOString().slice(0, 19).replace('T', ' ');
    case 'sqlite':
      return date.toISOString();
    default:
      return date.toISOString();
  }
}

/**
 * Check if error is a unique constraint violation
 */
export function isUniqueConstraintError(error: any, dialect: DatabaseDialect): boolean {
  const message = error.message?.toLowerCase() || '';
  const code = error.code || '';

  switch (dialect) {
    case 'postgres':
      return code === '23505' || message.includes('unique constraint');
    case 'mysql':
      return code === 'ER_DUP_ENTRY' || code === '1062' || message.includes('duplicate entry');
    case 'sqlite':
      return message.includes('unique constraint failed');
    default:
      return false;
  }
}

/**
 * Check if error is a foreign key constraint violation
 */
export function isForeignKeyError(error: any, dialect: DatabaseDialect): boolean {
  const message = error.message?.toLowerCase() || '';
  const code = error.code || '';

  switch (dialect) {
    case 'postgres':
      return code === '23503' || message.includes('foreign key constraint');
    case 'mysql':
      return code === 'ER_ROW_IS_REFERENCED' || code === '1451' || code === 'ER_NO_REFERENCED_ROW' || code === '1452';
    case 'sqlite':
      return message.includes('foreign key constraint failed');
    default:
      return false;
  }
}

/**
 * Check if error is a not null constraint violation
 */
export function isNotNullError(error: any, dialect: DatabaseDialect): boolean {
  const message = error.message?.toLowerCase() || '';
  const code = error.code || '';

  switch (dialect) {
    case 'postgres':
      return code === '23502' || message.includes('not-null constraint');
    case 'mysql':
      return code === 'ER_BAD_NULL_ERROR' || code === '1048';
    case 'sqlite':
      return message.includes('not null constraint failed');
    default:
      return false;
  }
}

/**
 * Get database size
 */
export async function getDatabaseSize(
  db: Kysely<any>,
  dialect: DatabaseDialect,
  databaseName?: string
): Promise<number> {
  try {
    switch (dialect) {
      case 'postgres': {
        const result = await sql
          .raw(`SELECT pg_database_size(${databaseName ? `'${databaseName}'` : 'current_database()'}) as size`)
          .execute(db)
          .then((r) => r.rows?.[0]);
        return (result as any)?.size || 0;
      }

      case 'mysql': {
        const dbName =
          databaseName ||
          (await sql
            .raw('SELECT DATABASE() as name')
            .execute(db)
            .then((r) => (r.rows?.[0] as any)?.name));
        const result = await sql
          .raw(
            `
          SELECT SUM(data_length + index_length) as size
          FROM information_schema.tables
          WHERE table_schema = '${dbName}'
        `
          )
          .execute(db)
          .then((r) => r.rows?.[0]);
        return (result as any)?.size || 0;
      }

      case 'sqlite': {
        // SQLite size would require file system access
        return 0;
      }

      default:
        return 0;
    }
  } catch (error) {
    return 0;
  }
}

/**
 * Truncate all tables (useful for testing)
 */
export async function truncateAllTables(
  db: Kysely<any>,
  dialect: DatabaseDialect,
  exclude: string[] = []
): Promise<void> {
  const tables = await getTables(db, dialect);

  for (const table of tables) {
    if (!exclude.includes(table)) {
      await truncateTable(db, table, dialect);
    }
  }
}

/**
 * Get list of tables
 */
async function getTables(db: Kysely<any>, dialect: DatabaseDialect): Promise<string[]> {
  try {
    switch (dialect) {
      case 'postgres': {
        const results = await db
          .selectFrom('information_schema.tables')
          .select('table_name')
          .where('table_schema', '=', 'public')
          .where('table_type', '=', 'BASE TABLE')
          .execute();
        return results.map((r) => r.table_name as string);
      }

      case 'mysql': {
        const results = await db
          .selectFrom('information_schema.tables')
          .select('table_name')
          .where('table_schema', '=', sql`DATABASE()`)
          .where('table_type', '=', 'BASE TABLE')
          .execute();
        return results.map((r) => r.table_name as string);
      }

      case 'sqlite': {
        const results = await db
          .selectFrom('sqlite_master')
          .select('name')
          .where('type', '=', 'table')
          .where('name', 'not like', 'sqlite_%')
          .execute();
        return results.map((r) => r.name as string);
      }

      default:
        return [];
    }
  } catch (error) {
    return [];
  }
}

/**
 * Truncate a single table
 */
async function truncateTable(db: Kysely<any>, tableName: string, dialect: DatabaseDialect): Promise<void> {
  try {
    switch (dialect) {
      case 'postgres':
        await sql.raw(`TRUNCATE TABLE ${escapeIdentifier(tableName, dialect)} RESTART IDENTITY CASCADE`).execute(db);
        break;

      case 'mysql':
        // Temporarily disable foreign key checks
        await sql.raw('SET FOREIGN_KEY_CHECKS = 0').execute(db);
        await sql.raw(`TRUNCATE TABLE ${escapeIdentifier(tableName, dialect)}`).execute(db);
        await sql.raw('SET FOREIGN_KEY_CHECKS = 1').execute(db);
        break;

      case 'sqlite':
        await db.deleteFrom(tableName as any).execute();
        break;
    }
  } catch (error) {
    // Ignore errors for tables that might not exist or have constraints
  }
}
