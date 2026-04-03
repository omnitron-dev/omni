/**
 * Dialect-specific Utilities
 *
 * @module @omnitron-dev/titan/module/database/dialects
 */

export {
  type ConnectionConfig,
  type DialectAdapter,
  type DatabaseErrorLike,
  getAdapter,
  createDialectAdapter,
  registerAdapter,
  PostgresAdapter,
  MySQLAdapter,
  SQLiteAdapter,
  postgresAdapter,
  mysqlAdapter,
  sqliteAdapter,
  parseConnectionUrl,
  buildConnectionUrl,
  getDefaultPort,
  tableExists,
  getTableColumns,
  getTables,
  escapeIdentifier,
  getCurrentTimestamp,
  formatDate,
  isUniqueConstraintError,
  isForeignKeyError,
  isNotNullError,
  getDatabaseSize,
  truncateAllTables,
} from '@kysera/dialects';
