/**
 * Sealed-runtime worker. Credentials come only from the target backend's private
 * recovery environment. It has no public RPC or HTTP entry point.
 */
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createOmnitronDb } from './connection.js';
import { schemaDatabaseIdentity } from './schema-compatibility.js';
import { MASTER_SCHEMA_EXPANSIONS } from './schema-expansion-policy.js';
import { assertSchemaHistory, readSchemaPlan, type SchemaSnapshot } from './schema-transition-plan.js';
import { createOmnitronMigrationRunner } from './migration-runner.js';
import { OMNITRON_MIGRATIONS } from './migrations/index.js';
import type { Kysely } from 'kysely';

const ownDist = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const [mode, argument] = process.argv.slice(2);
const db = await createOmnitronDb<unknown>({
  max: 1, connectionTimeoutMillis: 5000,
  options: '-c lock_timeout=5000 -c statement_timeout=60000',
});
async function snapshot(connection: Kysely<unknown>, dist = ownDist): Promise<SchemaSnapshot> {
  const source = dist === ownDist ? { createOmnitronMigrationRunner } :
    await import(pathToFileURL(path.join(dist, 'database/migration-runner.js')).href) as { createOmnitronMigrationRunner: typeof createOmnitronMigrationRunner };
  const registry = dist === ownDist ? OMNITRON_MIGRATIONS :
    (await import(pathToFileURL(path.join(dist, 'database/migrations/index.js')).href) as { OMNITRON_MIGRATIONS: typeof OMNITRON_MIGRATIONS }).OMNITRON_MIGRATIONS;
  return { database: await schemaDatabaseIdentity(connection), registry: registry.map(m => ({ name: m.name, checksum: m.checksum ?? null })),
    expansions: dist === ownDist ? MASTER_SCHEMA_EXPANSIONS : [], inspection: await source.createOmnitronMigrationRunner(connection).inspect() };
}
try {
  if (mode === 'inspect' && argument && path.isAbsolute(argument)) {
    process.stdout.write(JSON.stringify(await snapshot(db, argument)) + '\n');
  } else if (mode === 'apply' && argument) {
    const plan = await readSchemaPlan(argument);
    if (plan.phase === 'prepared') throw new Error('Schema expansion has not been approved for execution');
    const { verifyRuntimeArtifact } = await import('../shared/runtime-artifact.js');
    const runtime = await verifyRuntimeArtifact(path.resolve(ownDist, '../../..'), plan.receipt.toRuntime);
    if (runtime.sha256 !== plan.receipt.toRuntime || process.env['OMNITRON_HOME'] !== plan.receipt.instanceHome) throw new Error('Schema worker belongs to another runtime or instance');
    const result = await createOmnitronMigrationRunner(db, undefined, {
      beforeSetup: async connection => assertSchemaHistory(plan, await snapshot(connection)),
    }).up();
    const after = await snapshot(db);
    assertSchemaHistory(plan, after);
    if (after.inspection.pending.length) throw new Error('Schema expansion did not finish');
    process.stdout.write(JSON.stringify({ applied: result.executed, snapshot: after }) + '\n');
  } else {
    throw new Error('Use the private schema transition coordinator');
  }
} finally { await db.destroy(); }
