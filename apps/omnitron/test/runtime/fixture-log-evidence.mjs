import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';

/** Compare the producer's complete journal with durable rows, including restarts. */
export async function verifyFixtureLogs({ root, instance, runtime, fixtureId, until }) {
  const address = JSON.parse(await fs.readFile(path.join(root, 'address.json'), 'utf8'));
  const response = await fetch(`http://127.0.0.1:${address.port}/pause`, { signal: AbortSignal.timeout(1500) });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).fixture, fixtureId);
  const expected = (await fs.readFile(path.join(root, 'expected.jsonl'), 'utf8')).trim().split('\n')
    .map(line => JSON.parse(line));
  assert.ok(expected.length > 0, 'The private application produced no log evidence');
  const Database = createRequire(path.join(runtime, 'packages/0/package.json'))('better-sqlite3');
  const actual = await until(async () => {
    const db = new Database(path.join(instance, 'data/slave.db'), { readonly: true, fileMustExist: true });
    try {
      const rows = db.prepare("SELECT payload FROM sync_buffer WHERE category='logs'").all()
        .map(row => JSON.parse(row.payload)).filter(row => row.message?.startsWith(`fixture:${fixtureId}:`));
      return rows.length >= expected.length ? rows : null;
    } finally { db.close(); }
  }, 'Exact multiline logs did not reach the durable outbox');
  assert.equal(actual.length, expected.length, 'Duplicate fixture log deliveries');
  // A restarted producer resets its counter. Include its timestamp when sorting
  // so equal message text cannot hide a missing or duplicated launch's records.
  const ordered = rows => rows.sort((a, b) => `${a.time}\0${a.msg}`.localeCompare(`${b.time}\0${b.msg}`));
  assert.deepEqual(ordered(actual.map(row => ({ time: new Date(row.timestamp).toISOString(), msg: row.message }))),
    ordered(expected.map(({ time, msg }) => ({ time, msg }))));
  return expected.length;
}
