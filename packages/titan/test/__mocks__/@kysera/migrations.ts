/**
 * Mock for @kysera/migrations
 *
 * Provides mock implementations for testing
 */

export interface Migration {
  name: string;
  up: (db: unknown) => Promise<void>;
  down?: (db: unknown) => Promise<void>;
}

export interface MigrationWithMeta extends Migration {
  timestamp?: number;
  description?: string;
}

export interface MigrationStatus {
  applied: Migration[];
  pending: Migration[];
}

export interface MigrationRunnerOptions {
  tableName?: string;
  dryRun?: boolean;
}

export class MigrationRunner {
  constructor(_db: unknown, _migrations: Migration[], _options?: MigrationRunnerOptions) {}

  async up(): Promise<void> {
    // Mock implementation
  }

  async down(_steps?: number): Promise<void> {
    // Mock implementation
  }

  async status(): Promise<MigrationStatus> {
    return {
      applied: [],
      pending: [],
    };
  }

  async reset(): Promise<void> {
    // Mock implementation
  }

  async upTo(_name: string): Promise<void> {
    // Mock implementation
  }

  async getExecutedMigrations(): Promise<string[]> {
    return [];
  }

  async markAsExecuted(_name: string): Promise<void> {
    // Mock implementation
  }

  async markAsRolledBack(_name: string): Promise<void> {
    // Mock implementation
  }
}

export function createMigration(
  name: string,
  up: (db: unknown) => Promise<void>,
  down?: (db: unknown) => Promise<void>
): Migration {
  return { name, up, down };
}

export function createMigrationRunner(
  db: unknown,
  migrations: Migration[],
  options?: MigrationRunnerOptions
): MigrationRunner {
  return new MigrationRunner(db, migrations, options);
}

export async function setupMigrations(_db: unknown, _options?: { tableName?: string }): Promise<void> {
  // Mock implementation
}

export { MigrationRunner as KyseraMigrationRunner };

// ============================================================================
// Additional types and exports
// ============================================================================

export interface MigrationDefinition<DB = unknown> {
  name: string;
  up: (db: DB) => Promise<void>;
  down?: (db: DB) => Promise<void>;
  description?: string;
  timestamp?: number;
}

export type MigrationDefinitions<DB = unknown> = Record<string, MigrationDefinition<DB>>;

export interface MigrationResult {
  name: string;
  direction: 'up' | 'down';
  status: 'success' | 'error';
  duration?: number;
  error?: Error;
}

export type MigrationErrorCode =
  | 'MIGRATION_UP_FAILED'
  | 'MIGRATION_DOWN_FAILED'
  | 'MIGRATION_VALIDATION_FAILED'
  | 'MIGRATION_NOT_FOUND'
  | 'MIGRATION_DUPLICATE_NAME'
  | 'MIGRATION_LOCK_FAILED'
  | 'MIGRATION_ALREADY_EXECUTED';

export class MigrationError extends Error {
  constructor(
    message: string,
    public code: MigrationErrorCode,
    public detail?: string
  ) {
    super(message);
    this.name = 'MigrationError';
  }
}

export function createMigrationWithMeta<DB = unknown>(
  name: string,
  up: (db: DB) => Promise<void>,
  down?: (db: DB) => Promise<void>,
  meta?: { timestamp?: number; description?: string }
): MigrationWithMeta {
  return { name, up: up as any, down: down as any, ...meta };
}

export function defineMigrations<DB = unknown>(
  definitions: Record<string, { up: (db: DB) => Promise<void>; down?: (db: DB) => Promise<void> }>
): Migration[] {
  return Object.entries(definitions).map(([name, { up, down }]) => ({ name, up: up as any, down: down as any }));
}

export async function runMigrations<DB = unknown>(
  _db: DB,
  _migrations: Migration[],
  _options?: MigrationRunnerOptions
): Promise<MigrationResult[]> {
  return [];
}

export async function rollbackMigrations<DB = unknown>(
  _db: DB,
  _migrations: Migration[],
  _steps?: number,
  _options?: MigrationRunnerOptions
): Promise<MigrationResult[]> {
  return [];
}

export async function getMigrationStatus<DB = unknown>(
  _db: DB,
  _migrations: Migration[],
  _options?: MigrationRunnerOptions
): Promise<MigrationStatus> {
  return { applied: [], pending: [] };
}

export interface MigrationPlugin<DB = unknown> {
  name: string;
  beforeUp?: (migration: Migration) => Promise<void>;
  afterUp?: (migration: Migration, result: MigrationResult) => Promise<void>;
  beforeDown?: (migration: Migration) => Promise<void>;
  afterDown?: (migration: Migration, result: MigrationResult) => Promise<void>;
}

export interface MigrationRunnerWithPluginsOptions<DB = unknown> extends MigrationRunnerOptions {
  plugins?: MigrationPlugin<DB>[];
}

export class MigrationRunnerWithPlugins<DB = unknown> extends MigrationRunner {
  constructor(db: unknown, migrations: Migration[], options?: MigrationRunnerWithPluginsOptions<DB>) {
    super(db, migrations, options);
  }
}

export async function createMigrationRunnerWithPlugins<DB = unknown>(
  db: unknown,
  migrations: Migration[],
  options?: MigrationRunnerWithPluginsOptions<DB>
): Promise<MigrationRunnerWithPlugins<DB>> {
  return new MigrationRunnerWithPlugins(db, migrations, options);
}

export function createLoggingPlugin<DB = unknown>(_logger?: any): MigrationPlugin<DB> {
  return { name: 'logging' };
}

export function createMetricsPlugin<DB = unknown>(): MigrationPlugin<DB> & { getMetrics: () => any } {
  return {
    name: 'metrics',
    getMetrics: () => ({ totalMigrations: 0, totalDuration: 0 }),
  };
}

// Re-exports from @kysera/core
export class DatabaseError extends Error {
  constructor(
    message: string,
    public code: string,
    public detail?: string
  ) {
    super(message);
    this.name = 'DatabaseError';
  }
}

export class NotFoundError extends DatabaseError {
  constructor(entity: string, criteria?: unknown) {
    super(`${entity} not found`, 'NOT_FOUND', criteria ? JSON.stringify(criteria) : undefined);
    this.name = 'NotFoundError';
  }
}

export class BadRequestError extends DatabaseError {
  constructor(message: string) {
    super(message, 'RESOURCE_BAD_REQUEST');
    this.name = 'BadRequestError';
  }
}

export const silentLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
};
