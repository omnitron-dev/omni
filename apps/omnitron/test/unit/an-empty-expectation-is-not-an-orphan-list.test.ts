/**
 * Not knowing what is expected is not the same as knowing nothing is.
 *
 * `reconcileOrphanContainers` removes every `omnitron.managed` container whose
 * name does not start with a prefix built from the registered projects'
 * stacks. It built that set with `projectService.listStacks(...)`, which reads
 * the LOADED-CONFIG cache and answers `[]` for a project whose config has not
 * been read — and it ran before the per-project load loop, whose own comment
 * says loading "populates internal cache used by listStacks".
 *
 * So on every boot where projects come from the registry rather than CWD
 * auto-detection — the normal case — the expected set was empty and every
 * container looked like an orphan. From this daemon's own log, 2026-09-12
 * 12:46, ten RUNNING containers removed in fourteen seconds:
 *
 *     acme-dev-nominatim, acme-dev-monero-daemon, acme-dev-bitcoin,
 *     acme-dev-tor, acme-dev-tiles, acme-dev-postgres, acme-dev-minio,
 *     acme-dev-monero-wallet-rpc, acme-dev-redis, acme-dev-gateway
 *
 * each logged "not part of any registered stack" while being part of the
 * registered stack. Named volumes survived only because `docker rm -f` does
 * not take `-v` — that is luck, not design.
 *
 * Third instance of one shape in a day: the process janitor reaping a foreign
 * parent as if it were a dead one, `daemon kill` treating a live pid as its
 * own, and this. In each, a destructive path read absence as permission.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';

const raw = readFileSync(new URL('../../src/daemon/daemon.ts', import.meta.url), 'utf8');

/**
 * Comments explain the rule; they are not the rule. The first version of this
 * file asserted on the source WITH comments, and the long note above the
 * method — which names `listStacks` and `removeContainer` in prose — made
 * every ordering assertion answer about the prose instead of the code.
 */
const source = raw
  .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
  .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1 + ' '.repeat(Math.max(0, m.length - p1.length)));

const fn = (() => {
  const at = source.indexOf('private async reconcileOrphanContainers');
  const end = source.indexOf('\n  private ', at + 10);
  return source.slice(at, end === -1 ? source.length : end);
})();

describe('reconcileOrphanContainers', () => {
  it('loads each project config before asking for its stacks', () => {
    const loadAt = fn.indexOf('loadProjectConfig');
    const listAt = fn.indexOf('listStacks');

    expect(loadAt, 'the config must be read at all').toBeGreaterThan(0);
    expect(listAt).toBeGreaterThan(0);
    expect(loadAt, '`listStacks` answers [] for a config nobody loaded').toBeLessThan(listAt);
  });

  it('refuses to act on an incomplete expectation', () => {
    // A project that contributes no stacks, or whose config will not load,
    // means we do not know what to expect — which is not the same as
    // expecting nothing.
    expect(fn).toContain('expectationsComplete');
    const guardAt = fn.indexOf('if (!expectationsComplete)');
    // The CALL, not the identifier: `removeContainer` is also in the import
    // destructure at the top of the method, which sits before everything.
    const removeAt = fn.indexOf('await removeContainer(');
    expect(guardAt, 'the guard must exist').toBeGreaterThan(0);
    expect(removeAt, 'and something must actually be removed below it').toBeGreaterThan(0);
    expect(guardAt, 'the guard must come before anything is removed').toBeLessThan(removeAt);
    expect(fn.slice(guardAt, removeAt)).toContain('return');
  });

  it('still protects the internal containers by name', () => {
    expect(fn).toContain("'omnitron-pg'");
    expect(fn).toContain("'omnitron-nginx'");
  });
});

describe('the rule it encodes', () => {
  /** The predicate, lifted out so it can be exercised directly. */
  const isOrphan = (name: string, expected: Set<string>, internal: Set<string>) =>
    !internal.has(name) && ![...expected].some((p) => name.startsWith(p));

  it('spares a container of a known stack', () => {
    const expected = new Set(['acme-dev-']);
    expect(isOrphan('acme-dev-postgres', expected, new Set())).toBe(false);
  });

  it('spares the internal ones whatever the expectation says', () => {
    expect(isOrphan('omnitron-pg', new Set(), new Set(['omnitron-pg', 'omnitron-nginx']))).toBe(false);
  });

  it('would have called every container an orphan with an empty expectation', () => {
    // The measured failure, as a property: this is precisely why the caller
    // must not reach the predicate when it does not know what to expect.
    const internal = new Set(['omnitron-pg', 'omnitron-nginx']);
    for (const name of ['acme-dev-postgres', 'acme-dev-redis', 'acme-dev-bitcoin']) {
      expect(isOrphan(name, new Set(), internal), name).toBe(true);
    }
  });
});
