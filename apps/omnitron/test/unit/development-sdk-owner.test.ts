import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { assertExecutionCapabilities } from '../../src/daemon/execution-capabilities.js';

const rpc = vi.hoisted(() => ({
  projects: vi.fn(), stacks: vi.fn(), stack: vi.fn(), status: vi.fn(), disconnect: vi.fn(),
}));
vi.mock('@omnitron-dev/omnitron/operations', async () => ({
  assertExecutionCapabilities: (await import('../../src/daemon/execution-capabilities.js')).assertExecutionCapabilities,
  LONG_REQUEST_TIMEOUT: 1000,
  createDaemonClient: () => ({
    service: async () => ({ listProjects: rpc.projects, listStacks: rpc.stacks, getStack: rpc.stack }),
    status: rpc.status, disconnect: rpc.disconnect,
  }),
}));
// Exercise the shipped CLI path. Refusal must precede deleting the installation
// selection or invoking pnpm against a project's working dependencies.
const { sdkCommand, watchSdk } = await import('../../bin/sdk.js');
let root: string, state: string, profile: string;
beforeEach(async () => {
  vi.clearAllMocks();
  root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'sdk-owner-')));
  state = path.join(root, '.omnitron/dev-sdk');
  await fs.mkdir(state, { recursive: true });
  profile = JSON.stringify({ schema: 1, root, source: '/separate-sdk', links: {} });
  await fs.writeFile(path.join(state, 'active.json'), profile);
  await fs.writeFile(path.join(state, 'install.json'), profile);
  await fs.writeFile(path.join(root, 'pnpm-lock.yaml'), 'lockfileVersion: 9.0\n');
  rpc.projects.mockResolvedValue([{ name: 'project', path: root }]);
  rpc.stacks.mockResolvedValue([{ name: 'dev', type: 'local', apps: [] }]);
  rpc.stack.mockResolvedValue({ name: 'dev', type: 'local', apps: [], config: { watch: true } });
  rpc.status.mockResolvedValue({ execution: { ownerCapabilities: { stackControl: 1 } } });
  rpc.disconnect.mockResolvedValue(undefined);
});
afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });

it.each([undefined, {}, { applicationRuntimeResolution: 2 }])(
  'preserves installed dependencies when the owner cannot resolve the new SDK: %j', async capabilities => {
    rpc.status.mockResolvedValue({ execution: { ownerCapabilities: capabilities } });
    await expect(sdkCommand(['registry', '--project-dir', root, '--stack', 'dev']))
      .rejects.toThrow(/applicationRuntimeResolution@1.*Development SDK activation.*owner transition/);
    expect(await fs.readFile(path.join(state, 'install.json'), 'utf8')).toBe(profile);
    expect(await fs.readFile(path.join(state, 'active.json'), 'utf8')).toBe(profile);
    expect(rpc.disconnect).toHaveBeenCalledOnce();
  },
);

it('does not assume compatibility when the owner status request fails', async () => {
  rpc.status.mockRejectedValue(new Error('Owner connection unavailable'));
  await expect(sdkCommand(['registry', '--project-dir', root, '--stack', 'dev']))
    .rejects.toThrow('Owner connection unavailable');
  expect(await fs.readFile(path.join(state, 'install.json'), 'utf8')).toBe(profile);
  expect(rpc.disconnect).toHaveBeenCalledOnce();
});

it('refuses to resume the SDK watcher on an incompatible owner before building', async () => {
  await expect(watchSdk(JSON.parse(profile), 'dev', new AbortController().signal))
    .rejects.toThrow('applicationRuntimeResolution@1');
  expect(await fs.readFile(path.join(state, 'install.json'), 'utf8')).toBe(profile);
  expect(rpc.disconnect).toHaveBeenCalledOnce();
});

const runtime = { node: process.version, abi: process.versions.modules, platform: process.platform, arch: process.arch };
it.each([
  [undefined, /did not report its Node runtime/],
  [{ ...runtime, abi: '' }, /did not report its Node runtime/],
  [{ ...runtime, abi: 'wrong-abi' }, /is incompatible with owner Node/],
  [{ ...runtime, platform: 'another-platform' }, /is incompatible with owner Node/],
  [{ ...runtime, arch: 'another-architecture' }, /is incompatible with owner Node/],
] as const)('refuses an unknown or incompatible owner runtime before changing dependencies: %j', async (ownerRuntime, reason) => {
  rpc.status.mockResolvedValue({ execution: {
    ownerCapabilities: { applicationRuntimeResolution: 1 }, connection: { status: 'connected' }, ownerRuntime,
  } });
  await expect(sdkCommand(['registry', '--project-dir', root, '--stack', 'dev'])).rejects.toThrow(reason);
  await expect(watchSdk(JSON.parse(profile), 'dev', new AbortController().signal)).rejects.toThrow(reason);
  expect(await fs.readFile(path.join(state, 'install.json'), 'utf8')).toBe(profile);
  expect(await fs.readFile(path.join(state, 'active.json'), 'utf8')).toBe(profile);
  expect(rpc.disconnect).toHaveBeenCalledTimes(2);
});

it.each([undefined, 'unavailable', 'owner-changed'])('refuses stale owner runtime observations: %s', async connection => {
  rpc.status.mockResolvedValue({ execution: { ownerCapabilities: { applicationRuntimeResolution: 1 },
    connection: connection && { status: connection }, ownerRuntime: runtime } });
  await expect(sdkCommand(['registry', '--project-dir', root, '--stack', 'dev']))
    .rejects.toThrow('requires a current execution owner observation');
  expect(await fs.readFile(path.join(state, 'install.json'), 'utf8')).toBe(profile);
});

it('still refuses a running source stack even when the owner supports SDK changes', async () => {
  rpc.stacks.mockResolvedValue([{ name: 'dev', type: 'local', apps: [{ status: 'online' }] }]);
  rpc.status.mockResolvedValue({ execution: { ownerCapabilities: { applicationRuntimeResolution: 1 } } });
  await expect(sdkCommand(['registry', '--project-dir', root, '--stack', 'dev']))
    .rejects.toThrow('Stop project/dev');
  expect(await fs.readFile(path.join(state, 'install.json'), 'utf8')).toBe(profile);
  expect(rpc.status).not.toHaveBeenCalled();
});

it('accepts the exact application runtime contract independently of the backend version', () => {
  expect(() => assertExecutionCapabilities(
    { applicationRuntimeResolution: 1, stackControl: 1 },
    { applicationRuntimeResolution: 1 }, 'Development SDK activation',
  )).not.toThrow();
});
