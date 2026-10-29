/**
 * Compatibility facade for Titan's original migration API.
 * Kysera owns execution, locking, transactions, journals and integrity checks.
 * Existing journals, checksum encoding and lock identity are preserved.
 */
import { createHash } from 'node:crypto';
import type { Kysely } from 'kysely';
import {
  MigrationRunner,
  MigrationLockError as KyseraLockError,
  MigrationChecksumError as KyseraChecksumError,
  createMigrationHistory,
  type Migration,
} from '@kysera/migrations';

export type HardenedMigration<DB = unknown> = Migration<DB>;
export interface HardenedLogger {
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
}
export interface AdvisoryLockProvider {
  acquire: (key: bigint) => Promise<boolean>;
  release: (key: bigint) => Promise<void>;
}
export interface HardenedRunnerOptions {
  /** Stable legacy key by default. null disables locking explicitly. */
  advisoryLockKey?: bigint | number | null;
  /** Default true; DDL atomicity depends on the database dialect. */
  useTransactions?: boolean;
  enforceChecksums?: boolean;
  /** Legacy trust-on-first-use policy. New applications should use explicit adoption. */
  backfillMissingChecksums?: boolean;
  dialect?: 'postgres' | 'other';
  logger?: HardenedLogger;
  lockProvider?: AdvisoryLockProvider;
  /** Wait for overlapping deployments without application retry loops. */
  lockTimeoutMs?: number;
}
export interface HardenedUpResult { executed: string[]; skipped: string[]; failed: string[] }
export interface HardenedDownResult { rolledBack: string[]; failed: string[] }
export interface HardenedStatus {
  executed: { name: string; checksum: string | null }[];
  pending: string[];
  drift: { name: string; recorded: string; current: string }[];
  missingFiles: string[];
  unknownChecksums: string[];
}
export class MigrationLockError extends Error {
  readonly code = 'MIGRATION_LOCKED';
  constructor(message: string, options?: ErrorOptions) { super(message, options); this.name = 'MigrationLockError'; }
}
export class MigrationChecksumError extends Error {
  readonly code = 'MIGRATION_CHECKSUM_MISMATCH';
  constructor(message: string, readonly drift: ReadonlyArray<HardenedStatus['drift'][number]>, options?: ErrorOptions) {
    super(message, options);
    this.name = 'MigrationChecksumError';
  }
}

const LEGACY_LOCK_KEY = 3657816581n;
const silent = { info: (_: string) => {}, warn: (_: string) => {}, error: (_: string) => {} };

export class HardenedMigrationRunner<DB = unknown> {
  private readonly runner: MigrationRunner<DB>;
  private readonly logger: HardenedLogger;
  private readonly enforceChecksums: boolean;

  constructor(db: Kysely<DB>, migrations: HardenedMigration<DB>[], options: HardenedRunnerOptions = {}) {
    const key = options.advisoryLockKey === null ? null : BigInt(options.advisoryLockKey ?? LEGACY_LOCK_KEY);
    const locking = options.dialect !== 'other' && key !== null;
    this.logger = options.logger ?? silent;
    this.enforceChecksums = options.enforceChecksums ?? true;
    const provider = options.lockProvider;
    this.runner = new MigrationRunner(db, [...migrations]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(migration => ({ ...migration, checksum: migration.checksum ?? HardenedMigrationRunner.computeChecksum(migration) })), {
      history: createMigrationHistory({ checksumTable: 'migration_checksums' }),
      advisoryLock: locking,
      ...(key !== null ? { advisoryLockKey: key } : {}),
      ...(locking && provider ? { lockProvider: { acquire: () => provider.acquire(key!), release: () => provider.release(key!) } } : {}),
      lockTimeoutMs: options.lockTimeoutMs ?? 1,
      useTransactions: options.useTransactions ?? true,
      enforceChecksums: this.enforceChecksums,
      backfillMissingChecksums: options.backfillMissingChecksums ?? true,
      // Preserve the legacy emergency rollback policy; the modern API fails closed.
      rollbackChecksumPolicy: 'warn',
      logger: { ...this.logger, trace: () => {}, debug: () => {}, fatal: this.logger.error },
    });
  }

  /** Legacy digest only. New definitions should supply a stable content checksum. */
  static computeChecksum<D>(migration: HardenedMigration<D>): string {
    return createHash('sha256').update(migration.up.toString() + (migration.down?.toString() ?? '')).digest('hex');
  }

  private rethrow(error: unknown): never {
    if (error instanceof KyseraLockError) throw new MigrationLockError(error.message, { cause: error });
    if (error instanceof KyseraChecksumError) throw new MigrationChecksumError(error.message, error.drift, { cause: error });
    throw error;
  }

  async up(): Promise<HardenedUpResult> {
    try {
      return await this.runner.up();
    } catch (error) {
      if (error instanceof Error && /already exists/i.test(error.message)) {
        // A diagnostic must never replace the original failure.
        try {
          const { missingFiles } = await this.runner.inspect();
          if (missingFiles.length) this.logger.error(`The database records ${missingFiles.join(', ')}, which this build does not ship. A retry will fail identically if these created the same objects; reconcile the bookkeeping first.`);
        } catch { /* The original failure is retained below. */ }
      }
      return this.rethrow(error);
    }
  }

  async down(steps = 1): Promise<HardenedDownResult> {
    try {
      const result = await this.runner.down(steps);
      return { rolledBack: result.executed, failed: result.failed };
    } catch (error) { return this.rethrow(error); }
  }

  async verifyChecksums(): Promise<HardenedStatus['drift']> {
    return this.enforceChecksums ? (await this.runner.inspect()).drift : [];
  }

  async status(): Promise<HardenedStatus> {
    const report = await this.runner.inspect();
    return { ...report, drift: this.enforceChecksums ? report.drift : [] };
  }
}

export function createHardenedRunner<DB = unknown>(db: Kysely<DB>, migrations: HardenedMigration<DB>[], options?: HardenedRunnerOptions): HardenedMigrationRunner<DB> {
  return new HardenedMigrationRunner(db, migrations, options);
}
