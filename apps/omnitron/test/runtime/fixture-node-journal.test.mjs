import assert from 'node:assert/strict';
import test from 'node:test';
import { checkNodeJournal } from './fixture-node-journal.mjs';

const previous = [{ name: 'first', checksum: 'a'.repeat(64), execution_order: 1, executed_at: '2026-01-01 00:00:00' }];
const migration = { name: 'second', checksum: 'b'.repeat(64) };
const added = { ...migration, execution_order: 2, executed_at: '2026-01-02 00:00:00' };

test('the exact forward row, including its original time, survives rollback and restart', () => {
  const expanded = checkNodeJournal(previous, [...previous, added], migration, 'forward');
  assert.deepEqual(checkNodeJournal(expanded, structuredClone(expanded), undefined, 'rollback'), expanded);
  assert.throws(() => checkNodeJournal(expanded, previous, undefined, 'restart'));
  assert.throws(() => checkNodeJournal(expanded, [...previous, { ...added, executed_at: '2026-01-03 00:00:00' }], undefined, 'restart'));
});

test('adding the expected migration cannot replace earlier rows or admit different records', () => {
  for (const rows of [
    previous, [added], [...previous, added, added], [...previous, added, { ...added, name: 'unknown' }],
    [{ ...previous[0], checksum: null }, added], [...previous, { ...added, checksum: 'c'.repeat(64) }],
    [...previous, { ...added, execution_order: 4 }], [...previous, { ...added, executed_at: 'invalid' }],
  ]) assert.throws(() => checkNodeJournal(previous, rows, migration, 'forward'));
  assert.throws(() => checkNodeJournal(previous, [...previous, added], undefined, 'guardian'));
});
