/**
 * A prune that would have removed what test runs.
 *
 * `omnitron release prune --yes` kept the newest five and removed the rest
 * without knowing which release a stack was running: `pruneReleases` takes
 * a `protect` list, the console passes the releases its stacks last took,
 * and the command passed nothing. Measured 2026-09-23: seven releases built
 * and five deployed in one day, test on daos-202609230810. Five more builds
 * without a deployment and 0810 is sixth, where `--yes` removed it — the
 * release a stack runs, and the one production would be promoted from.
 *
 * The court holds:
 *   - the release a stack runs survives any `--keep`, and the command says so;
 *   - a daemon that cannot say what runs — down, answering from no audit
 *     trail, or naming a stack whose last release has no name — turns `--yes`
 *     into a refusal that removes nothing and exits 1;
 *   - `--allow-unprotected` is the one way past that refusal, and a dry run
 *     still shows the plan.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const HOME = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'release-prune-court-')));
const ROOT = path.join(HOME, 'releases');
afterAll(() => fs.rmSync(HOME, { recursive: true, force: true }));

vi.mock('../../src/config/defaults.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/config/defaults.js')>();
  return { ...actual, OMNITRON_HOME: HOME };
});

const daemon = {
  state: 'up' as 'up' | 'down' | 'no-trail',
  deployments: [] as unknown[],
};

vi.mock('../../src/daemon/daemon-client.js', () => ({
  LONG_REQUEST_TIMEOUT: 600_000,
  createDaemonClient: () => ({
    whyUnreachable: async () => (daemon.state === 'down' ? { kind: 'stopped' } : null),
    service: async (name: string) => {
      if (name === 'OmnitronAudit') {
        if (daemon.state === 'no-trail') throw new Error("Service 'OmnitronAudit' is not exposed");
        return { available: async () => ({ available: true }) };
      }
      if (name === 'OmnitronRelease') return { deployments: async () => (daemon.state === 'up' ? daemon.deployments : []) };
      throw new Error(`Service '${name}' is not exposed`);
    },
    disconnect: async () => {},
  }),
}));

const said: Array<{ level: string; text: string }> = [];
vi.mock('@xec-sh/kit', () => ({
  log: Object.fromEntries(
    ['info', 'success', 'warn', 'error', 'step', 'message'].map((level) => [level, (m: unknown) => said.push({ level, text: String(m) })]),
  ),
  table: () => undefined,
  prism: new Proxy({}, { get: () => (s: string) => s }),
}));

const { releasePruneCommand } = await import('../../src/commands/release.js');

/** Seven builds of one day, newest first; test took the OLDEST of them. */
const IDS = ['2345', '2210', '2035', '1900', '1715', '1540', '0810'].map((hhmm, i) => `daos-20260923${hhmm}-${String(i).repeat(8)}-5a3315fc`);
const DEPLOYED = IDS[6]!;
const NEXT_OLDEST = IDS[5]!;

function writeRelease(id: string): void {
  const dir = path.join(ROOT, id);
  fs.mkdirSync(dir, { recursive: true });
  const stamp = id.split('-')[1]!;
  fs.writeFileSync(
    path.join(dir, 'manifest.json'),
    JSON.stringify({
      id,
      project: { repo: 'gitlab', commit: 'a'.repeat(40) },
      omni: { repo: 'github', commit: 'b'.repeat(40) },
      artifacts: [],
      gates: [{ name: 'build', status: 'passed' }],
      builtWith: { omnitron: '0.2.0', packages: [] },
      builtAt: `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}T${stamp.slice(8, 10)}:${stamp.slice(10, 12)}:00.000Z`,
      builtBy: 'court',
    }),
  );
}

const testRuns = (release: string | null, releaseUnnamed = false) => [
  { project: 'daos', stack: 'test', at: '2026-09-23T08:38:44.297Z', actorId: null, source: 'operator', release, releaseUnnamed, projectCommit: null, omniCommit: null },
];

const exitCodeBefore = process.exitCode;
beforeEach(() => {
  fs.rmSync(ROOT, { recursive: true, force: true });
  for (const id of IDS) writeRelease(id);
  daemon.state = 'up';
  daemon.deployments = testRuns(DEPLOYED);
  said.length = 0;
  process.exitCode = undefined;
});
afterEach(() => {
  process.exitCode = exitCodeBefore;
});

const onDisk = (id: string) => fs.existsSync(path.join(ROOT, id));

describe('what a stack runs', () => {
  it('is kept however old it is, and the command says why', async () => {
    await releasePruneCommand({ keep: 5, yes: true });
    expect(onDisk(DEPLOYED)).toBe(true);
    expect(onDisk(NEXT_OLDEST)).toBe(false);
    expect(said.some((s) => s.text.includes(`keeping ${DEPLOYED}`) && s.text.includes('daos/test runs it'))).toBe(true);
    expect(process.exitCode).toBeUndefined();
  });
});

describe('a daemon that cannot say what runs', () => {
  it('turns --yes into a refusal that removes nothing, when it is down', async () => {
    daemon.state = 'down';
    await releasePruneCommand({ keep: 5, yes: true });
    expect(onDisk(DEPLOYED)).toBe(true);
    expect(onDisk(NEXT_OLDEST)).toBe(true);
    expect(process.exitCode).toBe(1);
    const refusal = said.find((s) => s.level === 'error')?.text ?? '';
    expect(refusal).toContain('Nothing was removed');
    expect(refusal).toContain('Daemon is not running');
    expect(refusal).toContain('--allow-unprotected');
  });

  it('refuses the same when it answers from no audit trail — its `[]` is not «nothing deployed»', async () => {
    daemon.state = 'no-trail';
    await releasePruneCommand({ keep: 5, yes: true });
    expect(onDisk(DEPLOYED)).toBe(true);
    expect(process.exitCode).toBe(1);
    expect(said.find((s) => s.level === 'error')?.text).toContain('no audit trail');
  });

  it('refuses when a stack took a release whose name the trail did not record', async () => {
    daemon.deployments = testRuns(null, true);
    await releasePruneCommand({ keep: 5, yes: true });
    expect(onDisk(DEPLOYED)).toBe(true);
    expect(onDisk(NEXT_OLDEST)).toBe(true);
    expect(process.exitCode).toBe(1);
    expect(said.find((s) => s.level === 'error')?.text).toContain('daos/test');
  });

  it('removes without protection only when told to with --allow-unprotected', async () => {
    daemon.state = 'down';
    await releasePruneCommand({ keep: 5, yes: true, allowUnprotected: true });
    expect(onDisk(DEPLOYED)).toBe(false);
    expect(onDisk(NEXT_OLDEST)).toBe(false);
    expect(process.exitCode).toBeUndefined();
    expect(said.some((s) => s.level === 'warn' && s.text.includes('--allow-unprotected'))).toBe(true);
  });

  it('still shows the plan on a dry run, and says --yes will refuse', async () => {
    daemon.state = 'down';
    await releasePruneCommand({ keep: 5 });
    expect(onDisk(DEPLOYED)).toBe(true);
    expect(said.some((s) => s.text.includes(`would remove ${DEPLOYED}`))).toBe(true);
    expect(said.some((s) => s.level === 'warn' && s.text.includes('--yes refuses'))).toBe(true);
    expect(process.exitCode).toBeUndefined();
  });
});
