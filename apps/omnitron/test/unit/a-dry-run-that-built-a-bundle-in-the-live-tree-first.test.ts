/**
 * `fleet upgrade --dry-run` built a bundle before it printed the plan.
 *
 * Documented as «print the plan and ship nothing», the command called
 * `buildOwnBundle` first — the plan names the target version, and the
 * version came from the build — and `bundle-builder` rebuilds every stale
 * workspace package in the WORKING TREE (`pnpm --dir <pkg> run build`). On
 * 2026-09-23 at 08:53Z two of fourteen packages were stale: a dry run from
 * the live tree would have rebuilt them there. On a dirty tree it refused
 * before printing any plan.
 *
 * The daemon's planner answers without building (`planUpgrade` with
 * `build: false`, 36 ms): everything but «already on it», which each row
 * says it did not compare.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const said: Array<{ level: string; text: string }> = [];
vi.mock('@xec-sh/kit', () => ({
  log: {
    info: (t: string) => said.push({ level: 'info', text: t }),
    warn: (t: string) => said.push({ level: 'warn', text: t }),
    error: (t: string) => said.push({ level: 'error', text: t }),
    success: (t: string) => said.push({ level: 'success', text: t }),
    step: (t: string) => said.push({ level: 'step', text: t }),
  },
  table: () => {},
  prism: new Proxy({}, { get: () => (s: string) => s }),
  spinner: () => ({ start() {}, stop() {}, message() {} }),
}));

let dirty = false;
const cleanup = vi.fn(async () => {});
const buildOwnBundle = vi.fn(async () => ({
  version: '0.2.0+build.abc',
  dirty: false,
  pack: async () => '/tmp/never.tar.gz',
  cleanup,
}));
vi.mock('../../src/services/bundle-builder.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  buildOwnBundle,
  findWorkspaceRoot: () => '/work/omni',
  readWorkspace: () => new Map([['@omnitron-dev/omnitron', {}]]),
  describeTree: async () => ({ commit: 'abc', dirty }),
}));

const plan = {
  targetVersion: null,
  compared: false,
  refusal: null as string | null,
  rows: [
    { nodeId: 'local', label: 'Local Machine', host: '127.0.0.1:22', currentVersion: '0.2.0', targetVersion: null, action: 'skip', because: 'this is the local daemon' },
    { nodeId: '16f3dd5a', label: 'daos-test', host: '37.27.130.185:22', currentVersion: '0.2.0+build.old', targetVersion: null, action: 'upgrade', because: 'not compared — no bundle has been built' },
  ],
};
const nodes = {
  listNodes: vi.fn(async () => [
    { id: 'local', name: 'Local Machine', host: '127.0.0.1', sshPort: 22, isLocal: true, status: { omnitronVersion: '0.2.0', sshConnected: true } },
    { id: '16f3dd5a', name: 'daos-test', host: '37.27.130.185', sshPort: 22, isLocal: false, status: { omnitronVersion: '0.2.0+build.abc', sshConnected: true } },
  ]),
  planUpgrade: vi.fn(async () => plan),
  installBundleOnNode: vi.fn(),
  activateBundleOnNode: vi.fn(),
};

vi.mock('../../src/daemon/daemon-client.js', () => ({
  LONG_REQUEST_TIMEOUT: 600_000,
  createDaemonClient: () => ({
    whyUnreachable: async () => null,
    service: async () => nodes,
    disconnect: async () => {},
  }),
}));

const { fleetUpgradeCommand } = await import('../../src/commands/fleet.js');

const text = () => said.map((s) => s.text).join('\n');

beforeEach(() => {
  said.length = 0;
  dirty = false;
  plan.refusal = null;
  buildOwnBundle.mockClear();
  cleanup.mockClear();
  for (const fn of Object.values(nodes)) fn.mockClear();
});

afterEach(() => {
  process.exitCode = undefined;
});

describe('fleet upgrade --dry-run', () => {
  it('prints the plan and builds nothing', async () => {
    await fleetUpgradeCommand([], { dryRun: true });

    expect(buildOwnBundle).not.toHaveBeenCalled();
    expect(nodes.planUpgrade).toHaveBeenCalledWith({ build: false });
    expect(text()).toContain('upgrade  daos-test — from 0.2.0+build.old (not compared — no bundle has been built)');
    expect(text()).toContain('skip  Local Machine — this is the local daemon');
    expect(text()).toContain('Dry run — nothing was built or shipped.');
    expect(process.exitCode).not.toBe(1);
  });

  it('prints the plan on a dirty tree, and says what a real run would refuse', async () => {
    dirty = true;

    await fleetUpgradeCommand([], { dryRun: true });

    expect(text()).toContain('daos-test');
    expect(text()).toMatch(/A real run would refuse: The omnitron working tree at \/work\/omni has uncommitted changes/);
    expect(buildOwnBundle).not.toHaveBeenCalled();
  });

  it('asks about the named nodes only', async () => {
    await fleetUpgradeCommand(['daos-test'], { dryRun: true });

    expect(nodes.planUpgrade).toHaveBeenCalledWith({ nodeIds: ['daos-test'], build: false });
  });

  it('fails with the planner\'s refusal', async () => {
    plan.refusal = 'This daemon cannot list its fleet, so it cannot plan a rollout';

    await fleetUpgradeCommand([], { dryRun: true });

    expect(text()).toContain('cannot plan a rollout');
    expect(process.exitCode).toBe(1);
  });
});

describe('fleet upgrade, not dry', () => {
  it('still builds to learn the version, and stops at nothing to do', async () => {
    await fleetUpgradeCommand([], {});

    expect(buildOwnBundle).toHaveBeenCalledTimes(1);
    expect(text()).toContain('already running 0.2.0+build.abc');
    expect(text()).toContain('Nothing to do.');
    expect(cleanup).toHaveBeenCalled();
    expect(nodes.installBundleOnNode).not.toHaveBeenCalled();
  });
});
