import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/** Derive the allowed first change from the same sealed pair the native CLI admits. */
export async function nodeJournalTransition(previous, candidate, history) {
  const load = relative => import(pathToFileURL(path.join(candidate, relative)).href);
  const { assertBackendMigrationsCompatible } = await load('daemon/backend-candidate.js');
  const compatibility = await assertBackendMigrationsCompatible(previous, candidate, 'node');
  if (compatibility?.kind !== 'node-storage-expansion' || history.some(row => row.name === '002_host_storage_alert')) {
    return { compatibility };
  }
  const { SLAVE_MIGRATIONS } = await load('database/slave-migrations/index.js');
  const additions = SLAVE_MIGRATIONS.filter(migration => !history.some(row => row.name === migration.name));
  assert.deepEqual(additions.map(({ name }) => name), ['002_host_storage_alert']);
  const [addition] = additions;
  assert.match(addition.checksum, /^[a-f0-9]{64}$/);
  return { compatibility, addition };
}

/** Only the first forward activation may append the migration admitted by the sealed pair. */
export function checkNodeJournal(before, after, addition, stage) {
  if (!addition) {
    assert.deepEqual(after, before, `${stage}: node migration history changed`);
    return before;
  }
  assert.ok(!before.some(row => row.name === addition.name), `${stage}: migration already recorded`);
  assert.deepEqual(after.filter(row => row.name !== addition.name), before, `${stage}: prior migration history changed`);
  const appended = after.filter(row => row.name === addition.name);
  assert.equal(appended.length, 1, `${stage}: expected a single admitted node migration`);
  const [row] = appended;
  assert.equal(row.checksum, addition.checksum, `${stage}: wrong checksum for ${addition.name}`);
  assert.equal(row.execution_order, Math.max(0, ...before.map(entry => entry.execution_order)) + 1);
  assert.equal(typeof row.executed_at, 'string');
  assert.ok(Number.isFinite(Date.parse(row.executed_at)), `${stage}: missing execution time`);
  return after;
}
