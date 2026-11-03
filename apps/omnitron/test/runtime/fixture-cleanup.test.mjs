import assert from 'node:assert/strict';
import test from 'node:test';
import { cleanupFixture } from './fixture-cleanup.mjs';

test('a failed backend cleanup retains the primary failure and still cleans owner and database', async () => {
  const primary = new Error('candidate rollback failed');
  const backend = new Error('backend remains alive');
  const database = new Error('database drop failed');
  const released = [];
  await assert.rejects(cleanupFixture('/private-fixture', { error: primary }, async attempt => {
    await attempt('backend 1', () => { released.push('backend 1'); throw backend; });
    await attempt('backend 2', () => { released.push('backend 2'); });
    await attempt('owner', () => { released.push('owner'); });
    await attempt('database', async () => { released.push('database'); await Promise.reject(database); });
    await attempt('database pool', () => { released.push('database pool'); });
  }), error => {
    assert(error instanceof AggregateError);
    assert.equal(error.cause, primary);
    assert.equal(error.errors[0], primary);
    assert.equal(error.errors[1].cause, backend);
    assert.match(error.errors[1].message, /backend 1/);
    assert.equal(error.errors[2].cause, database);
    assert.equal(error.errors.length, 3);
    assert.match(error.message, /\/private-fixture/);
    return true;
  });
  assert.deepEqual(released, ['backend 1', 'backend 2', 'owner', 'database', 'database pool']);
});

test('cleanup failure also fails an otherwise successful fixture', async () => {
  const cause = new Error('owner remains alive');
  let closed = false;
  await assert.rejects(cleanupFixture('/private-fixture', undefined, async attempt => {
    await attempt('owner', () => { throw cause; });
    await attempt('database pool', () => { closed = true; });
  }), error => {
    assert.equal(error.errors.length, 1);
    assert.equal(error.cause, error.errors[0]);
    assert.equal(error.errors[0].cause, cause);
    return true;
  });
  assert.equal(closed, true);
});

test('successful cleanup never erases a primary failure, including a thrown non-Error value', async () => {
  for (const primary of [new Error('assertion failed'), undefined]) {
    await assert.rejects(cleanupFixture('/private-fixture', { error: primary }, async attempt => {
      await attempt('owner', () => {});
    }), error => {
      assert.equal(error.cause, primary);
      assert.deepEqual(error.errors, [primary]);
      return true;
    });
  }
});

test('an unexpected cleanup coordinator failure cannot hide the primary assertion', async () => {
  const primary = new Error('primary assertion');
  const cause = new Error('cleanup setup failed');
  await assert.rejects(cleanupFixture('/private-fixture', { error: primary }, () => { throw cause; }), error => {
    assert.equal(error.cause, primary);
    assert.equal(error.errors[1].cause, cause);
    return true;
  });
});

test('a successful fixture completes after all cleanup actions', async () => {
  const released = [];
  await cleanupFixture('/private-fixture', undefined, async attempt => {
    await attempt('backend', async () => { released.push('backend'); });
    await attempt('owner', async () => { released.push('owner'); });
  });
  assert.deepEqual(released, ['backend', 'owner']);
});
