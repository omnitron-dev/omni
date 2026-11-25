import assert from 'node:assert/strict';

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
