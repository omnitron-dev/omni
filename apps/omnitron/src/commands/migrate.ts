import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createOmnitronDb } from '../database/connection.js';
import { createOmnitronMigrationRunner } from '../database/migration-runner.js';
import type { MigrationConfig } from '../migration/index.js';
import { diagnoseMigrationFailure, executeMigrationOperation, migrationIntegrity, validateMigrationOperation, type MigrationAction, type MigrationOperationOptions } from '../migration/operation.js';
import { emitError, emitJson } from './output.js';

export async function migrateCommand(action: string, options: { config?: string; daemon?: boolean; steps?: string; to?: string; dryRun?: boolean }): Promise<void> {
  try {
    if (options.config && options.daemon) throw new Error('Choose --config or --daemon');
    if (options.steps !== undefined && !/^\d+$/.test(options.steps)) throw new Error('--steps must be a nonnegative integer');
    const operation: MigrationOperationOptions = {
      action: action as MigrationAction,
      ...(options.steps !== undefined ? { steps: Number(options.steps) } : {}),
      ...(options.to !== undefined ? { to: options.to } : {}),
      ...(options.dryRun !== undefined ? { dryRun: options.dryRun } : {}),
    };
    validateMigrationOperation(operation);
    let result;
    if (options.daemon) {
      const db = await createOmnitronDb<unknown>({ max: 1 });
      try {
        const runner = createOmnitronMigrationRunner(db, undefined, { dryRun: operation.dryRun ?? false });
        if (action === 'status' || action === 'verify') {
          const report = await runner.inspect();
          result = { name: 'daemon', operation: action, report, integrity: migrationIntegrity(report) };
        } else {
          const applied = action === 'down' ? await runner.down(operation.steps ?? 1) : operation.to ? await runner.upTo(operation.to) : await runner.up();
          result = { name: 'daemon', operation: action, result: applied };
        }
      } finally { await db.destroy(); }
    } else {
      const file = path.resolve(options.config ?? 'omnitron.migrations.ts');
      const { tsImport } = await import('tsx/esm/api');
      const module = await tsImport(pathToFileURL(file).href, import.meta.url);
      const config = module.default as MigrationConfig;
      if (!config || typeof config !== 'object') throw new Error('Migration config must export default defineMigrationConfig(...)');
      result = await executeMigrationOperation(config, operation);
    }
    if (action === 'verify' && 'integrity' in result && result.integrity !== 'verified') process.exitCode = 2;
    if (!emitJson(result)) process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } catch (error) {
    const diagnostic = diagnoseMigrationFailure(error);
    if (!emitError(diagnostic.title, { diagnostic })) {
      process.stderr.write([...diagnostic.evidence, diagnostic.remedy].filter(Boolean).join('\n') + '\n');
    }
    process.exitCode = diagnostic.outcome === 'not-started' ? 2 : 1;
  }
}
