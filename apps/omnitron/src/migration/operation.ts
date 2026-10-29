import { describeError, type DiagnosticFinding } from '@omnitron-dev/titan/diagnostics';
import { createMigrationRunner, type MigrationConfig, type MigrationInspection } from './index.js';

export type MigrationAction = 'status' | 'verify' | 'up' | 'down';
export interface MigrationOperationOptions { action: MigrationAction; steps?: number; to?: string; dryRun?: boolean }

export function validateMigrationOperation(options: MigrationOperationOptions): void {
  if (!['status', 'verify', 'up', 'down'].includes(options.action)) throw new Error('Use status, verify, up or down');
  if (options.steps !== undefined && (options.action !== 'down' || !Number.isSafeInteger(options.steps) || options.steps < 0)) throw new Error('--steps requires down and a nonnegative safe integer');
  if (options.to !== undefined && options.action !== 'up') throw new Error('--to is only valid with up');
  if (options.dryRun && !['up', 'down'].includes(options.action)) throw new Error('--dry-run is only valid with up or down');
}

export function migrationIntegrity(report: MigrationInspection): 'verified' | 'unverified' | 'drifted' {
  if (report.drift.length || report.missingFiles.length) return 'drifted';
  return report.unknownChecksums.length ? 'unverified' : 'verified';
}

/** Reusable by CLI and other management clients; no daemon or terminal dependency. */
export async function executeMigrationOperation<DB>(config: MigrationConfig<DB>, options: MigrationOperationOptions) {
  validateMigrationOperation(options);
  if (typeof config.connect !== 'function') throw new Error('Migration configuration must provide connect()');
  const migrations = typeof config.migrations === 'function' ? await config.migrations() : config.migrations;
  if (!Array.isArray(migrations)) throw new Error('Migration configuration must provide a migration array');
  const connection = await config.connect();
  if (typeof connection.close !== 'function') throw new Error('Migration connection must provide close()');
  let failure: unknown;
  let failed = false;
  try {
    const runner = createMigrationRunner(connection.db, migrations, { ...config.options, dryRun: options.dryRun ?? false });
    const startedAt = performance.now();
    if (options.action === 'status' || options.action === 'verify') {
      const report = await runner.inspect();
      return { name: config.name ?? 'application', operation: options.action, integrity: migrationIntegrity(report), report, durationMs: performance.now() - startedAt };
    }
    const result = options.action === 'down' ? await runner.down(options.steps ?? 1)
      : options.to ? await runner.upTo(options.to) : await runner.up();
    return { name: config.name ?? 'application', operation: options.action, result, durationMs: performance.now() - startedAt };
  } catch (error) {
    failed = true;
    failure = error;
    throw error;
  } finally {
    try { await connection.close(); }
    catch (error) {
      if (failed) throw new AggregateError([failure, error], 'Migration operation and connection cleanup failed');
      throw new Error('Migration operation completed, but connection cleanup failed; inspect history before retrying', { cause: error });
    }
  }
}

export function diagnoseMigrationFailure(error: unknown): DiagnosticFinding & { outcome: 'not-started' | 'committed' | 'unknown' } {
  const name = error instanceof Error ? error.name : '';
  const locked = name === 'MigrationLockError';
  const drift = name === 'MigrationChecksumError';
  const committed = name === 'MigrationHookError';
  return {
    id: locked ? 'database.migration.locked' : drift ? 'database.migration.drift' : committed ? 'database.migration.after-commit' : 'database.migration.failed',
    severity: 'error',
    title: locked ? 'Another migration runner holds the lock' : drift ? 'Applied migration content has changed' : committed ? 'The migration committed, but a completion hook failed' : 'Migration operation failed',
    evidence: [describeError(error)],
    remedy: locked ? 'Wait for the active runner or investigate its connection; do not disable locking.'
      : drift ? 'Restore the applied definition and add a new migration. Do not overwrite recorded checksums.'
      : 'Run status and verify against the same database, inspect the original cause, and reconcile history before retrying.',
    outcome: locked || drift ? 'not-started' : committed ? 'committed' : 'unknown',
  };
}
