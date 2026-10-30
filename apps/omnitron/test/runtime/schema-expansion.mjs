import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const [bridge, candidate] = process.argv.slice(2).map(value => path.resolve(value));
for (const dist of [bridge, candidate]) assert.ok(dist.includes('omnitron-handoff-'), 'Use isolated sealed artifacts');
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'omni-schema-expansion-'));
process.env.OMNITRON_HOME = path.join(root, 'instance');
await fs.mkdir(process.env.OMNITRON_HOME, { mode: 0o700 });
const name = `omni_schema_${randomUUID().replaceAll('-', '')}`;
const testUrl = new URL(process.env.TEST_DATABASE_URL ?? 'postgresql://test:test@127.0.0.1:15432/test');
assert.ok(['127.0.0.1', 'localhost'].includes(testUrl.hostname) && testUrl.username === 'test' && testUrl.pathname === '/test' && testUrl.port !== '5480');
const ownUrl = new URL(testUrl); ownUrl.pathname = `/${name}`;
process.env.OMNITRON_DATABASE_URL = ownUrl.href;
const require = createRequire(path.join(bridge, '../package.json'));
const { Pool } = require('pg');
const admin = new Pool({ connectionString: testUrl.href, max: 1 });
const load = (dist, file) => import(pathToFileURL(path.join(dist, file)).href);
let db;
try {
  await admin.query(`CREATE DATABASE "${name}"`);
  const { createOmnitronDb } = await load(bridge, 'database/connection.js');
  db = await createOmnitronDb({ max: 2 });
  const old = await load(bridge, 'database/migration-runner.js');
  const next = await load(candidate, 'database/migration-runner.js');
  const { OMNITRON_MIGRATIONS } = await load(candidate, 'database/migrations/index.js');
  const policy = await load(bridge, 'database/schema-compatibility.js');
  const { writePrivateRecord } = await load(bridge, 'daemon/execution-journal.js');
  const { createMigrationHistory, sql } = await load(bridge, 'migration/index.js');
  await old.migrateOmnitronDb(db);
  await old.assertOmnitronMigrationsCurrent(db);
  const before = await old.createOmnitronMigrationRunner(db).inspect();
  const addition = OMNITRON_MIGRATIONS.find(m => !before.executed.some(row => row.name === m.name));
  assert.match(addition.checksum, /^[a-f0-9]{64}$/);
  assert.deepEqual((await next.createOmnitronMigrationRunner(db).inspect()).pending, [addition.name]);
  const bridgeRuntime = JSON.parse(await fs.readFile(path.resolve(bridge, '../../../RUNTIME.json'), 'utf8'));
  const nextRuntime = JSON.parse(await fs.readFile(path.resolve(candidate, '../../../RUNTIME.json'), 'utf8'));
  const id = randomUUID();
  const receipt = { protocol: 1, id, kind: 'master-expand', phase: 'approved', instanceHome: process.env.OMNITRON_HOME,
    fromRuntime: bridgeRuntime.sha256, toRuntime: nextRuntime.sha256, baseFiles: await policy.masterMigrationFiles(bridge),
    database: await policy.schemaDatabaseIdentity(db), additions: [{ name: addition.name, checksum: addition.checksum,
      fileHash: (await policy.masterMigrationFiles(candidate))[addition.name] }], approvedAt: new Date().toISOString() };
  const file = policy.schemaReceiptFile(receipt.instanceHome, id);
  // A new-schema journal must not become a general permission to ignore unknown history.
  await next.migrateOmnitronDb(db);
  await assert.rejects(old.migrateOmnitronDb(db), /No matching schema expansion receipt/);
  await assert.rejects(old.assertOmnitronMigrationsCurrent(db), new RegExp(`unknown: ${addition.name}`));
  await writePrivateRecord(file, receipt);
  await writePrivateRecord(policy.schemaReceiptIndex(receipt.instanceHome), { protocol: 1, receipts: [id] });
  assert.deepEqual((await old.migrateOmnitronDb(db)).applied, []);
  await old.assertOmnitronMigrationsCurrent(db);
  await next.assertOmnitronMigrationsCurrent(db);
  const tables = async () => (await sql`select tablename from pg_tables where schemaname='public' order by tablename`.execute(db)).rows;
  const tablesBefore = await tables();
  await assert.rejects(old.createOmnitronMigrationRunner(db).down(1), new RegExp(`Rollback unavailable for: ${addition.name}`));
  assert.deepEqual(await tables(), tablesBefore, 'A refused down migration changed schema');
  await db.insertInto('sync_ingested').values({ nodeId: 'test-node', entryId: 'old-writer' }).execute();
  assert.equal((await db.selectFrom('sync_ingested').selectAll().where('entryId', '=', 'old-writer').executeTakeFirst()).outcome, 'unverified');
  const cold = await promisify(execFile)(path.resolve(bridge, '../../../node'),
    [path.join(bridge, 'cli/omnitron.js'), 'migrate', 'up', '--daemon', '--json'],
    { cwd: root, env: process.env, timeout: 60000, maxBuffer: 1024 * 1024 });
  assert.equal(cold.stderr, '');
  assert.deepEqual(JSON.parse(cold.stdout).data.result.executed, [], 'A fresh rollback process reapplied migrations');
  await writePrivateRecord(file, { ...receipt, database: '0'.repeat(64) });
  await assert.rejects(old.migrateOmnitronDb(db), /No matching schema expansion receipt/);
  await writePrivateRecord(file, receipt);
  await createMigrationHistory({ checksumColumn: 'checksum' }).insert(db, { name: '999_unreviewed', checksum: 'f'.repeat(64), executedAt: new Date() });
  await assert.rejects(old.migrateOmnitronDb(db), /No matching schema expansion receipt/);
  const after = await next.createOmnitronMigrationRunner(db).inspect();
  assert.deepEqual(after.executed.filter(row => before.executed.some(oldRow => oldRow.name === row.name)), before.executed, 'Existing history or checksums changed');
  console.log(JSON.stringify({ test: 'schema-expansion-cold-rollback', root, database: name, migration: addition.name,
    previousMigrations: before.executed.length, previousHistoryPreserved: true, coldRollback: true,
    unreviewedRefused: true, downRefusedWithoutSchemaChange: true, source: bridgeRuntime.sha256, target: nextRuntime.sha256 }));
} finally {
  await db?.destroy();
  await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  await admin.end();
}
