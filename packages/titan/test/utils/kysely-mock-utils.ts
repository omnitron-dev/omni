/**
 * Kysely Mock Utilities
 *
 * Provides mock implementations compatible with Kysely's internal interfaces.
 * These mocks ensure that sql template literals and other Kysely operations
 * work correctly in unit tests.
 */

import { jest } from '@jest/globals';

/**
 * Creates a Kysely-compatible executor mock
 */
export function createMockExecutor() {
  return {
    executeQuery: jest.fn().mockResolvedValue({ rows: [] }),
    transformQuery: jest.fn().mockImplementation((node: any) => node),
    compileQuery: jest.fn().mockImplementation((node: any) => ({
      sql: 'SELECT 1',
      parameters: [],
      query: node,
    })),
    adapter: {
      supportsTransactionalDdl: true,
      supportsReturning: true,
    },
  };
}

/**
 * Creates a basic Kysely-compatible database mock
 */
export function createMockDatabase(options?: {
  executeResult?: any;
  executeTakeFirstResult?: any;
}) {
  const mockExecutor = createMockExecutor();

  const mockDb: any = {
    // Query builder methods
    selectFrom: jest.fn().mockReturnThis(),
    insertInto: jest.fn().mockReturnThis(),
    updateTable: jest.fn().mockReturnThis(),
    deleteFrom: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    selectAll: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    offset: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    values: jest.fn().mockReturnThis(),
    clearSelect: jest.fn().mockReturnThis(),
    clearOrderBy: jest.fn().mockReturnThis(),

    // Execution methods
    execute: jest.fn().mockResolvedValue(options?.executeResult ?? { rows: [] }),
    executeTakeFirst: jest.fn().mockResolvedValue(options?.executeTakeFirstResult ?? null),
    executeTakeFirstOrThrow: jest.fn().mockResolvedValue({ id: 1 }),

    // Kysely internals
    getExecutor: jest.fn().mockReturnValue(mockExecutor),

    // Schema builder
    schema: {
      createTable: jest.fn().mockReturnThis(),
      addColumn: jest.fn().mockReturnThis(),
      alterTable: jest.fn().mockReturnThis(),
      dropTable: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue({}),
    },

    // Transaction support
    transaction: jest.fn().mockReturnValue({
      execute: jest.fn().mockImplementation(async (fn: any) => fn(mockDb)),
    }),
  };

  return mockDb;
}

/**
 * Creates a mock database manager
 */
export function createMockDatabaseManager(mockDb?: any) {
  const db = mockDb ?? createMockDatabase();

  return {
    getConnection: jest.fn().mockResolvedValue(db),
    getConnectionConfig: jest.fn().mockReturnValue({ dialect: 'sqlite' }),
    getConnectionNames: jest.fn().mockReturnValue(['default']),
    isConnected: jest.fn().mockReturnValue(true),
    getPool: jest.fn(),
    getMetrics: jest.fn().mockReturnValue({
      default: {
        queryCount: 100,
        errorCount: 2,
        totalQueryTime: 5000,
      },
    }),
  };
}

/**
 * Creates a mock transaction object compatible with Kysely
 */
export function createMockTransaction() {
  const mockExecutor = createMockExecutor();

  return {
    selectFrom: jest.fn().mockReturnThis(),
    insertInto: jest.fn().mockReturnThis(),
    updateTable: jest.fn().mockReturnThis(),
    deleteFrom: jest.fn().mockReturnThis(),
    execute: jest.fn().mockResolvedValue({ rows: [] }),
    getExecutor: jest.fn().mockReturnValue(mockExecutor),
  };
}
