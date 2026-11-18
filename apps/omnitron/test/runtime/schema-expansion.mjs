/** Runs from a disposable home outside the package boundary against sealed runtimes. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { cleanupFixture } from './fixture-cleanup.mjs';

// Serialized into a fresh process using the bridge's Node and compiled service.
// A false condition exercises its real writer without executing any command.
async function writeLegacyRows(dist, phase) {
  const mark = stage => process.stderr.write(`legacy-writer ${phase}: ${stage}\n`);
  mark('loading runtime');
  const { pathToFileURL } = await import('node:url');
  const { default: assert } = await import('node:assert/strict');
  const load = file => import(pathToFileURL(`${dist}/${file}`).href);
  const { createOmnitronDb } = await load('database/connection.js');
  const { PipelineService } = await load('services/pipeline.service.js');
  mark('opening private database');
  const db = await createOmnitronDb({ max: 1 });
  let commands = 0;
  const errors = [];
  const logger = { debug() {}, info() {}, warn() {}, error(...args) { errors.push(args); } };
  const service = new PipelineService(db, logger, { execute() { commands++; throw Error('Fixture must not execute commands'); } });
  try {
    mark('creating pipeline');
    const pipeline = await service.createPipeline({ name: `legacy-${phase}`,
      steps: [{ name: 'not-executed', run: 'exit 1', condition: 'params.execute' }] });
    const run = await service.executePipeline(pipeline.id, { execute: false }, 'migration-fixture', pipeline.revision);
    mark('waiting for skipped step');
    const deadline = performance.now() + 10_000;
    while (service.activeRunCount() && performance.now() < deadline)
      await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(service.activeRunCount(), 0, 'Legacy writer did not finish');
    const saved = await service.getRunStatus(run.id);
    assert.equal(saved.status, 'success');
    assert.equal(saved.steps[0].status, 'skipped');
    assert.equal(commands, 0);
    assert.deepEqual(errors, []);
    await db.insertInto('sync_ingested').values({ nodeId: 'test-node', entryId: phase }).execute();
    return { pipelineId: pipeline.id, runId: run.id, entryId: phase };
  } finally {
    mark('closing private writer');
    await service.dispose();
    await db.destroy();
  }
}

const [bridge, candidate] = process.argv.slice(2).map(value => path.resolve(value));
for (const dist of [bridge, candidate]) {
  assert.equal(dist, path.join(path.resolve(dist, '../../..'), 'packages/0/dist'), 'Use sealed runtime artifacts');
}
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'omni-schema-expansion-'));
process.env.OMNITRON_HOME = path.join(root, 'instance');
await fs.mkdir(process.env.OMNITRON_HOME, { mode: 0o700 });
const name = `omni_schema_${randomUUID().replaceAll('-', '')}`;
const testUrl = new URL(process.env.TEST_DATABASE_URL ?? 'postgresql://test:test@127.0.0.1:15432/test');
const testDatabase = testUrl.username === 'test' && testUrl.pathname === '/test';
const ciDatabase = process.env.GITHUB_ACTIONS === 'true' && testUrl.username === 'postgres' && testUrl.pathname === '/postgres';
assert.ok(['127.0.0.1', 'localhost'].includes(testUrl.hostname) && testUrl.port !== '5480' && (testDatabase || ciDatabase),
  'Use the dedicated local test database or the GitHub Actions PostgreSQL service');
const ownUrl = new URL(testUrl); ownUrl.pathname = `/${name}`;
process.env.OMNITRON_DATABASE_URL = ownUrl.href;
const require = createRequire(path.join(bridge, '../package.json'));
const { Pool } = require('pg');
const admin = new Pool({ connectionString: testUrl.href, max: 1, connectionTimeoutMillis: 10_000 });
const load = (dist, file) => import(pathToFileURL(path.join(dist, file)).href);
let db, created = false, primaryFailure;
try {
  await admin.query(`CREATE DATABASE "${name}"`); created = true;
  const { createOmnitronDb } = await load(bridge, 'database/connection.js');
  db = await createOmnitronDb({ max: 2 });
  const old = await load(bridge, 'database/migration-runner.js');
  const next = await load(candidate, 'database/migration-runner.js');
  const policy = await load(bridge, 'database/schema-compatibility.js');
  const { writePrivateRecord } = await load(bridge, 'daemon/execution-journal.js');
  const { createMigrationHistory, sql } = await load(bridge, 'migration/index.js');
  const { planSchemaAdditions, planSchemaContinuation, assertSchemaHistory, historyIdentity } = await load(candidate, 'database/schema-transition-plan.js');
  const execute = promisify(execFile);
  const inspect = async directory => JSON.parse((await execute(path.resolve(candidate, '../../../node'),
    [path.join(candidate, 'database/schema-worker.js'), 'inspect', directory],
    { cwd: root, env: process.env, timeout: 60000, maxBuffer: 2 * 1024 * 1024 })).stdout);
  const legacyWrite = async phase => JSON.parse((await execute(path.resolve(bridge, '../../../node'),
    ['--input-type=module', '--eval', `console.log(JSON.stringify(await (${writeLegacyRows.toString()})(${JSON.stringify(bridge)}, ${JSON.stringify(phase)})))`],
    { cwd: root, env: process.env, timeout: 60000, maxBuffer: 1024 * 1024 })).stdout);
  const snapshot = async () => ({
    tables: (await sql`select tablename from pg_tables where schemaname='public' order by tablename`.execute(db)).rows,
    columns: (await sql`select table_name, column_name, ordinal_position, data_type, udt_schema, udt_name,
      column_default, is_nullable, character_maximum_length, numeric_precision, numeric_scale, datetime_precision,
      is_identity, identity_generation, is_generated, generation_expression
      from information_schema.columns where table_schema='public' order by table_name, ordinal_position`.execute(db)).rows,
    constraints: (await sql`select c.relname as table_name, k.conname as name, pg_get_constraintdef(k.oid) as definition
      from pg_constraint k join pg_class c on c.oid=k.conrelid join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' order by c.relname, k.conname`.execute(db)).rows,
    indexes: (await sql`select tablename, indexname, indexdef from pg_indexes where schemaname='public'
      order by tablename, indexname`.execute(db)).rows,
    journal: (await sql`select * from migrations order by name`.execute(db)).rows,
    pipelines: await db.selectFrom('pipelines').selectAll().orderBy('id').execute(),
    runs: await db.selectFrom('pipeline_runs').selectAll().orderBy('id').execute(),
    receipts: await db.selectFrom('sync_ingested').selectAll().orderBy('entryId').execute(),
  });
  await old.migrateOmnitronDb(db);
  await old.assertOmnitronMigrationsCurrent(db);
  // Exercise a mixed historical journal, without inventing a checksum for it.
  await sql`update migrations set checksum=null where name=(select min(name) from migrations)`.execute(db);
  const before = await old.createOmnitronMigrationRunner(db).inspect();
  const baseFiles = await policy.masterMigrationFiles(bridge), nextFiles = await policy.masterMigrationFiles(candidate);
  const additions = planSchemaAdditions(await inspect(bridge), await inspect(candidate), baseFiles, nextFiles);
  const names = additions.map(entry => entry.name);
  assert.ok(names.length > 0, 'This fixture requires a reviewed schema expansion');
  const bridgeRuntime = JSON.parse(await fs.readFile(path.resolve(bridge, '../../../RUNTIME.json'), 'utf8'));
  const nextRuntime = JSON.parse(await fs.readFile(path.resolve(candidate, '../../../RUNTIME.json'), 'utf8'));
  const id = randomUUID();
  const receipt = { protocol: 1, id, kind: 'master-expand', phase: 'approved', instanceHome: process.env.OMNITRON_HOME,
    fromRuntime: bridgeRuntime.sha256, toRuntime: nextRuntime.sha256, baseFiles, database: await policy.schemaDatabaseIdentity(db),
    additions: additions.map(({ name, checksum, fileHash }) => ({ name, checksum, fileHash })), approvedAt: new Date().toISOString() };
  const file = policy.schemaReceiptFile(receipt.instanceHome, id);
  const initialWriter = await legacyWrite('before-expansion');
  const initialRows = await snapshot();
  // A new-schema journal must not become a general permission to ignore unknown history.
  const forward = await execute(path.resolve(candidate, '../../../node'), [path.join(candidate, 'cli/omnitron.js'), '--json', 'migrate', 'up', '--daemon'],
    { cwd: root, env: process.env, timeout: 60000, maxBuffer: 1024 * 1024 });
  assert.deepEqual(JSON.parse(forward.stdout).data.result.executed, names);
  const expandedRows = await snapshot();
  for (const key of ['pipelines', 'runs', 'receipts']) {
    assert.equal(expandedRows[key].length, initialRows[key].length);
    for (const [index, row] of initialRows[key].entries())
      for (const [column, value] of Object.entries(row))
        assert.deepEqual(expandedRows[key][index][column], value, `Expansion changed ${key}.${column}`);
  }
  assert.equal(expandedRows.runs.find(row => row.id === initialWriter.runId).admission, null);
  assert.equal(expandedRows.receipts.find(row => row.entryId === initialWriter.entryId).outcome, 'unverified');
  assert.deepEqual(expandedRows.columns.filter(row => row.table_name === 'pipeline_runs' && row.column_name === 'admission')
    .map(row => ({ type: row.data_type, nullable: row.is_nullable, default: row.column_default })),
  [{ type: 'jsonb', nullable: 'YES', default: null }]);
  await assert.rejects(old.migrateOmnitronDb(db), /No matching schema expansion receipt/);
  await assert.rejects(old.assertOmnitronMigrationsCurrent(db), new RegExp(`unknown: ${names.join(', ')}`));
  assert.deepEqual(await snapshot(), expandedRows, 'Rejected old startup changed schema, history or data');
  await writePrivateRecord(file, receipt);
  await writePrivateRecord(policy.schemaReceiptIndex(receipt.instanceHome), { protocol: 1, receipts: [id] });
  assert.deepEqual((await old.migrateOmnitronDb(db)).applied, []);
  await old.assertOmnitronMigrationsCurrent(db);
  await next.assertOmnitronMigrationsCurrent(db);
  assert.deepEqual(await snapshot(), expandedRows, 'Compatible old startup changed schema, history or data');

  // The candidate's ordinary service creates a real durable review, not synthetic JSON.
  const { PipelineService } = await load(candidate, 'services/pipeline.service.js');
  const { readAdmission } = await load(candidate, 'services/pipeline-admission.js');
  const service = new PipelineService(db, { debug() {}, info() {}, warn() {}, error() {} },
    { execute() { throw Error('Admission qualification must not execute commands'); } });
  let admitted;
  try {
    const definition = await service.getPipeline(initialWriter.pipelineId);
    admitted = await service.prepareRun({ id: definition.id, runId: randomUUID(), expectedRevision: definition.revision,
      params: { execute: false } }, 'migration-fixture');
    assert.equal(admitted.status, 'awaiting-review');
  } finally { await service.dispose(); }
  const admissionRow = await db.selectFrom('pipeline_runs').selectAll().where('id', '=', admitted.id).executeTakeFirstOrThrow();
  assert.deepEqual(readAdmission(admissionRow.admission).review, admitted.review);
  assert.equal(JSON.parse(readAdmission(admissionRow.admission).definition).id, initialWriter.pipelineId);
  const afterForwardWriter = await legacyWrite('after-expansion');
  const beforeDown = await snapshot();
  assert.deepEqual(beforeDown.runs.find(row => row.id === admitted.id), admissionRow, 'Old writer changed the durable admission');
  assert.equal(beforeDown.runs.find(row => row.id === afterForwardWriter.runId).admission, null);
  assert.equal(beforeDown.receipts.find(row => row.entryId === afterForwardWriter.entryId).outcome, 'unverified');
  for (const steps of new Set([1, names.length + 1])) {
    const unavailable = names.slice(-Math.min(steps, names.length)).reverse().join(', ');
    await assert.rejects(old.createOmnitronMigrationRunner(db).down(steps), new RegExp(`Rollback unavailable for: ${unavailable}\\.`));
    assert.deepEqual(await snapshot(), beforeDown, 'A refused down changed schema, history or control records');
  }
  const cold = await promisify(execFile)(path.resolve(bridge, '../../../node'),
    [path.join(bridge, 'cli/omnitron.js'), 'migrate', 'up', '--daemon', '--json'],
    { cwd: root, env: process.env, timeout: 60000, maxBuffer: 1024 * 1024 });
  assert.equal(cold.stderr, '');
  assert.deepEqual(JSON.parse(cold.stdout).data.result.executed, [], 'A fresh rollback process reapplied migrations');
  assert.deepEqual(await snapshot(), beforeDown, 'Cold rollback changed schema, history or control records');
  const afterColdWriter = await legacyWrite('after-cold-rollback');
  const afterCold = await snapshot();
  for (const key of ['tables', 'columns', 'constraints', 'indexes', 'journal'])
    assert.deepEqual(afterCold[key], beforeDown[key], `Old writer changed ${key}`);
  for (const [key, identity] of [['pipelines', 'id'], ['runs', 'id'], ['receipts', 'entryId']])
    assert.deepEqual(afterCold[key].filter(row => beforeDown[key].some(previous => previous[identity] === row[identity])), beforeDown[key],
      `Old writer changed existing ${key}`);
  assert.equal(afterCold.runs.find(row => row.id === afterColdWriter.runId).admission, null);
  assert.equal(afterCold.receipts.find(row => row.entryId === afterColdWriter.entryId).outcome, 'unverified');
  // A corrected binary after rollback reuses exact applied evidence, not new DDL.
  const previousView = await inspect(bridge), currentView = await inspect(candidate);
  const appliedPlan = { protocol: 1, phase: 'applied', baseline: before.executed,
    receipt: { ...receipt, phase: 'applied', appliedAt: new Date().toISOString() },
    backend: { pid: 123, control: root+'/control.sock', socket: root+'/daemon.sock' },
    owner: { id: 'fixture', pid: 124, inventory: 'a'.repeat(64) }, descriptions: additions.map(entry => entry.summary) };
  const continued = planSchemaContinuation(appliedPlan, previousView, currentView, baseFiles, nextFiles);
  assert.deepEqual(continued.map(entry => entry.name), names);
  assertSchemaHistory(appliedPlan, currentView);
  assert.deepEqual((await next.migrateOmnitronDb(db)).applied, []);
  assert.equal(historyIdentity((await next.createOmnitronMigrationRunner(db).inspect()).executed), historyIdentity(currentView.inspection.executed),
    'Continuation must not change original history or replay migrations');
  assert.deepEqual(await snapshot(), afterCold, 'Returning to the new runtime changed schema, history or control records');
  const returned = new PipelineService(db, { debug() {}, info() {}, warn() {}, error() {} }, {});
  try {
    assert.deepEqual((await returned.getRunStatus(admitted.id)).review, admitted.review);
    for (const writer of [initialWriter, afterForwardWriter, afterColdWriter]) {
      const run = await returned.getRunStatus(writer.runId);
      assert.equal(run.status, 'success');
      assert.equal(run.review, undefined, 'Old nullable admission must not acquire an invented review');
    }
  } finally { await returned.dispose(); }
  await writePrivateRecord(file, { ...receipt, database: '0'.repeat(64) });
  await assert.rejects(old.migrateOmnitronDb(db), /No matching schema expansion receipt/);
  assert.deepEqual(await snapshot(), afterCold, 'A mismatched receipt changed schema, history or data');
  await writePrivateRecord(file, receipt);
  await createMigrationHistory({ checksumColumn: 'checksum' }).insert(db, { name: '999_unreviewed', checksum: 'f'.repeat(64), executedAt: new Date() });
  const unreviewed = await snapshot();
  await assert.rejects(old.migrateOmnitronDb(db), /No matching schema expansion receipt/);
  assert.deepEqual(await snapshot(), unreviewed, 'Unreviewed history refusal changed schema, history or data');
  const after = await next.createOmnitronMigrationRunner(db).inspect();
  assert.deepEqual(after.executed.filter(row => before.executed.some(oldRow => oldRow.name === row.name)), before.executed, 'Existing history or checksums changed');
  console.log(JSON.stringify({ test: 'schema-expansion-cold-rollback', root, database: name, migrations: names,
    previousMigrations: before.executed.length, previousHistoryPreserved: true, coldRollback: true, appliedExpansionContinuation: true,
    historicalNullPreserved: true, oldWriterStages: 3, pipelineAdmissionPreserved: true, nullableAdmissionPreserved: true,
    unreviewedRefused: true, downRefusedWithoutSchemaChange: true, source: bridgeRuntime.sha256, target: nextRuntime.sha256 }));
} catch (error) { primaryFailure = { error }; }
finally {
  await cleanupFixture(root, primaryFailure, async attempt => {
    await attempt('private database connection', () => db?.destroy());
    if (created) await attempt('owned schema database', () => admin.query(`DROP DATABASE "${name}" WITH (FORCE)`));
    await attempt('administrative connection', () => admin.end());
  });
}
await fs.rm(root, { recursive: true, force: true });
