/**
 * NR-13: `matchQueryFilters({ stale })` must respect each query's effective
 * staleTime instead of treating EVERY query as stale.
 *
 * The old check was `query.state.isInvalidated || Date.now() > dataUpdatedAt`,
 * and `Date.now()` is always after the last write — so `{ stale: true }` matched
 * every cached query. A focus/reconnect `invalidateQueries({ stale: true })`
 * therefore invalidated (and re-fetched) the WHOLE cache every time. The fix
 * stores the writer's staleTime on the entry and compares
 * `now > dataUpdatedAt + staleTime` (0 ⇒ always stale, Infinity ⇒ never).
 */

import { describe, it, expect } from 'vitest';
import { QueryCache } from '../../src/cache/query-cache.js';

const names = (queries: { queryKey: readonly unknown[] }[]) => queries.map((q) => q.queryKey[0] as string).sort();

describe('QueryCache { stale } filter (NR-13)', () => {
  it('classifies queries by their own staleTime, not "everything is stale"', () => {
    const cache = new QueryCache({ gcEnabled: false });

    cache.set(['fresh'], { v: 1 }, 60_000); // 60s staleTime → fresh right now
    cache.set(['immediate'], { v: 2 }, 0); // staleTime 0 → always stale (default)
    cache.set(['forever'], { v: 3 }, Infinity); // never stale

    // Only the staleTime:0 query is stale immediately after writing — pre-NR-13
    // ALL THREE matched { stale: true }.
    expect(names(cache.findAll({ stale: true }))).toEqual(['immediate']);
    expect(names(cache.findAll({ stale: false }))).toEqual(['forever', 'fresh']);
    expect(cache.findAll().length).toBe(3);

    cache.destroy();
  });

  it('treats an invalidated query as stale regardless of staleTime', () => {
    const cache = new QueryCache({ gcEnabled: false });

    cache.set(['a'], { v: 1 }, 60_000);
    cache.set(['b'], { v: 2 }, Infinity);
    expect(cache.findAll({ stale: true }).length).toBe(0); // both fresh

    cache.invalidate(['a']);
    cache.invalidate(['b']);
    expect(names(cache.findAll({ stale: true }))).toEqual(['a', 'b']); // invalidation overrides staleTime

    cache.destroy();
  });
});
