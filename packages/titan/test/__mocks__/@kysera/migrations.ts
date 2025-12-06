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
