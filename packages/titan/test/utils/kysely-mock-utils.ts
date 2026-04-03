/**
 * Kysely Mock Utilities
 *
 * Provides mock implementations compatible with Kysely's internal interfaces.
 * These mocks ensure that sql template literals and other Kysely operations
 * work correctly in unit tests.
 */

import { vi } from 'vitest';

/**
 * Creates a Kysely-compatible executor mock
 */
export function createMockExecutor() {
  return {
    executeQuery: vi.fn().mockResolvedValue({ rows: [] }),
    transformQuery: vi.fn().mockImplementation((node: any) => node),
    compileQuery: vi.fn().mockImplementation((node: any) => ({
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
export function createMockDatabase(options?: { executeResult?: any; executeTakeFirstResult?: any }) {
  const mockExecutor = createMockExecutor();

  const mockDb: any = {
    // Query builder methods
    selectFrom: vi.fn().mockReturnThis(),
    insertInto: vi.fn().mockReturnThis(),
    updateTable: vi.fn().mockReturnThis(),
    deleteFrom: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    selectAll: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    offset: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    clearSelect: vi.fn().mockReturnThis(),
    clearOrderBy: vi.fn().mockReturnThis(),

    // Execution methods
    execute: vi.fn().mockResolvedValue(options?.executeResult ?? { rows: [] }),
    executeTakeFirst: vi.fn().mockResolvedValue(options?.executeTakeFirstResult ?? null),
    executeTakeFirstOrThrow: vi.fn().mockResolvedValue({ id: 1 }),

    // Kysely internals
    getExecutor: vi.fn().mockReturnValue(mockExecutor),

    // Schema builder
    schema: {
      createTable: vi.fn().mockReturnThis(),
      addColumn: vi.fn().mockReturnThis(),
      alterTable: vi.fn().mockReturnThis(),
      dropTable: vi.fn().mockReturnThis(),
      execute: vi.fn().mockResolvedValue({}),
    },

    // Transaction support
    transaction: vi.fn().mockReturnValue({
      execute: vi.fn().mockImplementation(async (fn: any) => fn(mockDb)),
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
    getConnection: vi.fn().mockResolvedValue(db),
    getConnectionConfig: vi.fn().mockReturnValue({ dialect: 'sqlite' }),
    getConnectionNames: vi.fn().mockReturnValue(['default']),
    isConnected: vi.fn().mockReturnValue(true),
    getPool: vi.fn(),
    getMetrics: vi.fn().mockReturnValue({
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
    selectFrom: vi.fn().mockReturnThis(),
    insertInto: vi.fn().mockReturnThis(),
    updateTable: vi.fn().mockReturnThis(),
    deleteFrom: vi.fn().mockReturnThis(),
    execute: vi.fn().mockResolvedValue({ rows: [] }),
    getExecutor: vi.fn().mockReturnValue(mockExecutor),
  };
}
