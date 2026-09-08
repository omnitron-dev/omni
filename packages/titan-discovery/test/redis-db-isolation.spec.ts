/**
 * Concurrent spec files must not share a logical Redis database.
 *
 * This suite is not database-agnostic: `cleanupRedis` deletes every key under
 * `titan:discovery:*` — which is every node any spec file registered, not just
 * its own. Three files asked for db 15, and vitest runs them in separate
 * workers at the same time, so one file's cleanup deleted another file's node
 * between its register and its read:
 *
 *     FAIL discovery.comprehensive.spec.ts > should register node on start
 *     AssertionError: expected undefined to be '192.168.1.144:3000'
 *
 * `isRegistered()` was true and `hgetall` returned `{}` — the service had
 * written the node and something else had removed it. Note that the line above
 * the failing one, `expect(nodeData).toBeTruthy()`, passed: `hgetall` on a
 * missing key returns `{}`, which is truthy, so the assertion meant to check
 * "the node is there" could not fail.
 *
 * The number each file asked for is ignored on purpose. Honouring it is what
 * let two files pick the same database, and every call site passed a literal
 * chosen for no reason beyond "some database".
 */
import { describe, it, expect } from 'vitest';

import { toTestDb, getTestRedisConfig } from './test-utils.js';

const withWorker = <T>(id: string | undefined, fn: () => T): T => {
  const previous = process.env['VITEST_POOL_ID'];
  if (id === undefined) delete process.env['VITEST_POOL_ID'];
  else process.env['VITEST_POOL_ID'] = id;
  try {
    return fn();
  } finally {
    if (previous === undefined) delete process.env['VITEST_POOL_ID'];
    else process.env['VITEST_POOL_ID'] = previous;
  }
};

describe('test Redis database isolation', () => {
  it('gives each worker its own database', () => {
    const seen = new Set<number>();
    for (let worker = 1; worker <= 8; worker++) {
      seen.add(withWorker(String(worker), () => toTestDb(15)));
    }

    expect(seen.size, `workers 1-8 mapped onto ${[...seen].join(',')}`).toBe(8);
  });

  it('ignores the database a caller asks for', () => {
    // Two files asking for 15 and 11 from the same worker must still land in
    // the same place, and two files asking for 15 from different workers must
    // not.
    withWorker('3', () => {
      expect(toTestDb(15)).toBe(toTestDb(11));
    });

    const fromWorker3 = withWorker('3', () => toTestDb(15));
    const fromWorker4 = withWorker('4', () => toTestDb(15));
    expect(fromWorker3).not.toBe(fromWorker4);
  });

  it('stays inside the range this workspace owns', () => {
    // 0-4 belong to another workspace on this machine.
    for (let worker = 1; worker <= 32; worker++) {
      const db = withWorker(String(worker), () => toTestDb());
      expect(db, `worker ${worker}`).toBeGreaterThanOrEqual(5);
      expect(db, `worker ${worker}`).toBeLessThanOrEqual(15);
    }
  });

  it('routes the clients through the partition, not around it', () => {
    // The mapping is worthless unless the factory every spec file calls
    // actually uses it. Reverting `getTestRedisConfig` to honour its argument
    // passed every other test in this file — the mutation changed real
    // behaviour and nothing here noticed, because nothing here went through
    // the factory with two different workers.
    const fromWorker2 = withWorker('2', () => getTestRedisConfig(15));
    const fromWorker5 = withWorker('5', () => getTestRedisConfig(15));

    expect(fromWorker2.db).toBe(withWorker('2', () => toTestDb()));
    expect(fromWorker2.db, 'two workers asking for db 15 got the same database').not.toBe(
      fromWorker5.db
    );
  });

  it('reports the same database in the URL and the field', () => {
    // A config whose `db` and `url` disagree would send two clients built from
    // the same call to different databases.
    withWorker('2', () => {
      const config = getTestRedisConfig(15);
      expect(config.url.endsWith(`/${config.db}`), config.url).toBe(true);
    });
  });

  it('falls back to a database of this workspace when no worker id is set', () => {
    const db = withWorker(undefined, () => toTestDb(15));

    expect(db).toBeGreaterThanOrEqual(5);
    expect(db).toBeLessThanOrEqual(15);
  });
});
