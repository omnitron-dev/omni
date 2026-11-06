/** Ordinary CLI up/verify on an owned empty database; no historical checksum adoption. */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { cleanupFixture } from './fixture-cleanup.mjs';

const dist = path.resolve(process.argv[2] ?? 'dist');
assert.ok(process.env.TEST_DATABASE_URL, 'TEST_DATABASE_URL is required; never use the working daemon database');
const request = createRequire(path.join(dist, 'index.js'));
const { Pool } = request('pg');
const admin = new Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 1 });
const name = 'omni_migrations_' + randomUUID().replaceAll('-', '');
const url = new URL(process.env.TEST_DATABASE_URL); url.pathname = '/' + name;
const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'omni-migration-cli-'));
const db = new Pool({ connectionString: url.href, max: 1 });
const command = promisify(execFile);
const cli = async (action, expectedCode = 0) => {
  let result;
  try {
    result = { ...await command(process.execPath, [path.join(dist, 'cli/omnitron.js'), '--json', 'migrate', action, '--daemon'], {
      cwd: directory, timeout: 60_000, maxBuffer: 2 * 1024 * 1024,
      env: { PATH: process.env.PATH, OMNITRON_HOME: directory, OMNITRON_DATABASE_URL: url.href, NODE_OPTIONS: '', NODE_PATH: '' },
    }), code: 0 };
  } catch (error) {
    if (typeof error.code !== 'number') throw error;
    result = error;
  }
  assert.equal(result.code, expectedCode, `${action} exited ${result.code}: ${result.stderr}`);
  const envelope = JSON.parse(result.stdout);
  assert.equal(envelope.ok, true);
  return envelope.data;
};
let created = false, primaryFailure;
try {
  await admin.query(`CREATE DATABASE "${name}"`); created = true;
  const applied = await cli('up');
  assert.ok(applied.result.executed.length > 0);
  const fresh = await cli('verify');
  assert.equal(fresh.integrity, 'verified');
  assert.deepEqual(fresh.report.pending, []);
  assert.deepEqual(fresh.report.drift, []);
  assert.deepEqual(fresh.report.unknownChecksums, []);
  assert.equal(fresh.report.executed.length, applied.result.executed.length);
  for (const row of fresh.report.executed) assert.match(row.checksum, /^[a-f0-9]{64}$/);
  assert.deepEqual((await cli('up')).result.executed, []);
  assert.deepEqual((await cli('verify')).report.executed, fresh.report.executed);

  // Simulate an older journal only inside this disposable database. Inspection
  // and another ordinary up must preserve the unknown row and its timestamp.
  const first = fresh.report.executed[0].name;
  await db.query('UPDATE migrations SET checksum = NULL WHERE name = $1', [first]);
  const legacy = await cli('verify', 2);
  assert.equal(legacy.integrity, 'unverified');
  assert.deepEqual(legacy.report.unknownChecksums, [first]);
  assert.deepEqual((await cli('up')).result.executed, []);
  assert.deepEqual((await cli('verify', 2)).report.executed, legacy.report.executed);

  await db.query('UPDATE migrations SET checksum = $1 WHERE name = $2', ['0'.repeat(64), first]);
  const drift = await cli('verify', 2);
  assert.equal(drift.integrity, 'drifted');
  assert.deepEqual(drift.report.drift.map(row => row.name), [first]);
  console.log(JSON.stringify({ test: 'fresh-daemon-migration-cli', node: process.version,
    migrations: fresh.report.executed.length, freshIntegrity: fresh.integrity,
    historicalNullPreserved: true, changedChecksumRefused: true, liveMutation: false }));
} catch (error) { primaryFailure = { error }; }
finally {
  await cleanupFixture(directory, primaryFailure, async attempt => {
    await attempt('private database connections', () => db.end());
    if (created) await attempt('owned database', () => admin.query(`DROP DATABASE "${name}"`));
    await attempt('administrative connection', () => admin.end());
  });
}
await fs.rm(directory, { recursive: true, force: true });
