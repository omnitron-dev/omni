import 'reflect-metadata';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { DaemonStateStore } from '../../src/daemon/daemon-state-store.service.js';
import { LocalReleaseSelection } from '../../src/project/local-release-selection.js';
import { ProjectService } from '../../src/services/project.service.js';
import type { IEcosystemAppEntry } from '../../src/config/types.js';

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanup.splice(0)) await close(); });

function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'local-release-selection-'));
  const log = { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn(), child: () => log };
  const state = path.join(root, 'state.sqlite'), repo = path.join(root, 'repo');
  mkdirSync(repo);
  const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
  git('init', '-q');
  writeFileSync(path.join(repo, 'omnitron.config.mjs'), 'export default {};\n');
  git('add', '.'); git('-c', 'user.name=fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'fixture');
  const scope = { project: 'research', stack: 'lab' }, registration = '2026-01-01T00:00:00Z';
  const working = { name: 'api', script: 'dev.mjs', cwd: '.', env: { DATA_DIR: repo } };
  const config = { apps: [working], stacks: { lab: { type: 'local', infrastructureOwnership: 'external' } } };
  const selected = { id: 'release-1', manifestSha256: 'a'.repeat(64) };
  const installed = { ...working, script: path.join(root, 'installed/run.mjs'), cwd: repo, releaseRoot: path.join(root, 'installed'), watch: false as const };
  const fqn = 'research/lab/api';
  const handle = { name: fqn, entry: { ...working, name: fqn } as IEcosystemAppEntry, status: 'stopped', pid: null as number | null };
  let phase: 'running' | 'stopped' = 'running';
  const owner = {
    inspectStackExecution: vi.fn(async () => ({ ...scope, revision: 1, phase, apps: [{ name: fqn, generation: 'one' }] })),
    getHandle: () => handle,
    stopStackExecution: vi.fn(async () => { expect(handle.status).toBe('stopped'); phase = 'stopped'; }),
    redefineApp: vi.fn(async (name: string, entry: IEcosystemAppEntry) => { expect(name).toBe(fqn); handle.entry = entry; return true; }),
    enableStackExecution: vi.fn(async () => { phase = 'running'; }),
    startApp: vi.fn(async (entry: IEcosystemAppEntry) => { expect(phase).toBe('running'); handle.entry = entry; handle.status = 'online'; handle.pid = 123; }),
  };
  let db = new DaemonStateStore(log as never, state);
  const make = () => {
    const service = new ProjectService(log as never, owner as never, db);
    const release = { ...selected, manifest: { project: { commit: git('rev-parse', 'HEAD') }, omni: { commit: 'b'.repeat(40) } } };
    Object.assign(service, {
      registry: { get: () => ({ ...scope, path: repo, registeredAt: registration }), setStackEnabled: () => {} },
      loadProjectConfig: async () => config, resolveStacks: () => config.stacks,
      markPriorStopSuperseded: vi.fn(), admitRelease: async () => release,
      installedEntries: async () => [installed], stackEnvFor: async () => ({}),
      toStackInfo: () => ({ name: 'lab', type: 'local', status: handle.status === 'online' ? 'running' : 'stopped', apps: [{ name: 'api', status: handle.status }] }),
    });
    return service;
  };
  const selector = () => new LocalReleaseSelection(db, scope, registration);
  cleanup.push(async () => { await db.dispose(); rmSync(root, { recursive: true, force: true }); });
  return { handle, owner, make, installed, selected, selector, registration, scope, db, config,
    stopped: () => { handle.status = 'stopped'; handle.pid = null; },
    phase: () => phase,
    reboot: async () => { await db.dispose(); db = new DaemonStateStore(log as never, state); return make(); },
  };
}

it('keeps the selected launch after a cold SQLite reopen and restores the working tree only on explicit rollback', async () => {
  const f = fixture();
  await f.make().startStack('research', 'lab', { release: f.selected.id });
  expect(f.selector().read()).toEqual({ revision: 1, release: f.selected });
  expect(f.handle.entry).toMatchObject({ script: f.installed.script, cwd: f.installed.cwd, watch: false });
  const service = await f.reboot();
  f.stopped();
  await service.startStack('research', 'lab', { source: 'boot' });
  expect(f.handle.entry.script).toBe(f.installed.script);
  await expect(service.startStack('research', 'lab', { workingTree: true })).rejects.toThrow(/Stop the applications/);
  expect(f.selector().read().revision).toBe(1);
  f.stopped();
  await service.startStack('research', 'lab', { workingTree: true });
  expect(f.selector().read()).toEqual({ revision: 2, release: null });
  expect(f.handle.entry.script).toBe('dev.mjs');
});

it('retains a durable selection behind the owner stop fence when redefining a retained entry loses its acknowledgement', async () => {
  const f = fixture();
  f.owner.redefineApp.mockRejectedValueOnce(Error('RPC acknowledgement lost'));
  await expect(f.make().startStack('research', 'lab', { release: f.selected.id })).rejects.toThrow(/acknowledgement lost/);
  expect(f.phase()).toBe('stopped');
  expect(f.selector().read().release).toEqual(f.selected);
  expect(f.owner.enableStackExecution).not.toHaveBeenCalled();
  expect(f.owner.startApp).not.toHaveBeenCalled();
  const recovered = await f.reboot();
  await recovered.startStack('research', 'lab', { source: 'operator' });
  expect(f.handle.entry.script).toBe(f.installed.script);
  expect(f.selector().read().revision).toBe(1);
});

it('rejects a stale writer, a corrupt pin and another project lifetime', () => {
  const f = fixture();
  f.selector().select(0, f.selected);
  expect(() => f.selector().select(0, null)).toThrow(/changed/);
  const other = new LocalReleaseSelection(f.db, f.scope, '2027-01-01T00:00:00Z');
  expect(other.read().release).toBeNull();
  expect(() => f.selector().select(1, { id: f.selected.id, manifestSha256: 'invalid' })).toThrow(/Invalid/);
  expect(f.selector().read()).toEqual({ revision: 1, release: f.selected });
});

it('keeps prepare, admission and launch distinct while applications are serving', async () => {
  const f = fixture();
  const service = f.make();
  const { LocalReleaseNotPreparedError } = await import('../../src/release/local-installation.js');
  let staged = false;
  const project = vi.fn(async (_project, _stack, _definition, _config, _release, prepare) => {
    if (prepare) staged = true;
    if (!staged) throw new LocalReleaseNotPreparedError('The release needs preparation');
    return [f.installed];
  });
  Object.assign(service, { installedEntries: project });
  f.handle.status = 'online'; f.handle.pid = 123;
  expect(await service.checkRelease('research', 'lab', f.selected.id)).toMatchObject({ ok: false, state: 'unprepared' });
  expect(staged).toBe(false);
  expect(await service.checkRelease('research', 'lab', f.selected.id, true)).toMatchObject({ ok: false, state: 'requires-stop' });
  expect(staged).toBe(true);
  expect(f.selector().read().release).toBeNull();
  expect(f.owner.stopStackExecution).not.toHaveBeenCalled();
  expect(f.owner.redefineApp).not.toHaveBeenCalled();
});

it('refuses a different manifest under a previously selected release id before involving the owner', async () => {
  const f = fixture();
  f.selector().select(0, { ...f.selected, manifestSha256: 'e'.repeat(64) });
  await expect(f.make().startStack('research', 'lab', { source: 'boot' })).rejects.toThrow(/manifest changed/);
  expect(f.owner.inspectStackExecution).not.toHaveBeenCalled();
  expect(f.owner.startApp).not.toHaveBeenCalled();
});

function changedMembership(f: ReturnType<typeof fixture>, supported = true, selected: typeof f.selected | null = f.selected) {
  const removed = { ...f.handle, name: 'research/lab/web', entry: { ...f.handle.entry, name: 'research/lab/web' } };
  let retained = true;
  f.owner.inspectStackExecution.mockImplementation(async () => ({ ...f.scope, revision: 1, phase: f.phase(),
    apps: [f.handle, ...(retained ? [removed] : [])].map(handle => ({ name: handle.name, generation: 'one' })) }));
  f.owner.getHandle = (name?: string) => name === removed.name ? removed : f.handle;
  const reconcile = vi.fn(async () => {
    expect(f.phase()).toBe('stopped');
    expect(f.selector().read().release).toEqual(selected);
    retained = false;
    f.handle.entry = { ...f.installed, name: f.handle.name };
  });
  Object.assign(f.owner, { getExecutionCapabilities: () => supported ? { stoppedStackReconciliation: 1 } : {}, reconcileStoppedStack: reconcile });
  return { removed, reconcile, hasRemoved: () => retained };
}

it('commits the selected graph behind a completed stop before retiring removed applications', async () => {
  const f = fixture();
  const change = changedMembership(f);
  await f.make().startStack('research', 'lab', { release: f.selected.id });
  expect(f.owner.stopStackExecution).toHaveBeenCalledOnce();
  expect(change.reconcile).toHaveBeenCalledWith(expect.objectContaining({
    plan: expect.objectContaining({ phase: 'stopped', apps: expect.arrayContaining([{ name: 'research/lab/web', generation: 'one' }]) }),
    entries: [expect.objectContaining({ name: f.handle.name, releaseRoot: f.installed.releaseRoot })],
  }));
  expect(change.hasRemoved()).toBe(false);
  expect(f.owner.redefineApp).not.toHaveBeenCalled();
  expect(f.owner.startApp).toHaveBeenCalledTimes(1);
});

it('uses the same stopped-graph contract for an ordinary unpinned development stack', async () => {
  const f = fixture();
  const change = changedMembership(f, true, null);
  await f.make().startStack('research', 'lab');
  expect(change.reconcile).toHaveBeenCalledWith(expect.objectContaining({ entries: [expect.objectContaining({
    name: f.handle.name, script: 'dev.mjs',
  })] }));
  expect(f.owner.stopStackExecution).toHaveBeenCalledOnce();
  expect(f.handle.entry.script).toBe('dev.mjs');
  expect(f.selector().read()).toEqual({ revision: 0, release: null });
});

it('refuses an older owner before changing selection, stopping or starting applications', async () => {
  const f = fixture();
  changedMembership(f, false);
  await expect(f.make().startStack('research', 'lab', { release: f.selected.id })).rejects.toThrow('owner upgrade');
  expect(f.selector().read().revision).toBe(0);
  expect(f.owner.stopStackExecution).not.toHaveBeenCalled();
  expect(f.owner.redefineApp).not.toHaveBeenCalled();
  expect(f.owner.startApp).not.toHaveBeenCalled();
});

it.each([false, true])('refuses an unsupported installed target before owner or selection effects (reconciliation support %s)', async supported => {
  const f = fixture();
  Object.assign(f.installed, { instances: 2 });
  const reconcile = vi.fn();
  Object.assign(f.owner, { getExecutionCapabilities: () => supported ? { stoppedStackReconciliation: 1 } : {}, reconcileStoppedStack: reconcile });
  const result = await f.make().startStack('research', 'lab', { release: f.selected.id }).catch(error => error);
  expect(f.owner.stopStackExecution).not.toHaveBeenCalled();
  expect(f.owner.redefineApp).not.toHaveBeenCalled();
  expect(reconcile).not.toHaveBeenCalled();
  expect(f.owner.enableStackExecution).not.toHaveBeenCalled();
  expect(f.owner.startApp).not.toHaveBeenCalled();
  expect(f.selector().read()).toEqual({ revision: 0, release: null });
  expect(result).toBeInstanceOf(Error);
  expect(result.message).toContain('Declare process.instances');
});

it('refuses an unsupported configured target before provisioning infrastructure', async () => {
  const f = fixture();
  Object.assign(f.config.apps[0]!, { instances: 2 });
  f.config.stacks.lab.infrastructureOwnership = 'stack';
  const service = f.make();
  const provision = vi.spyOn(service['infraManager'], 'provisionStack').mockRejectedValue(Error('infrastructure reached'));
  const result = await service.startStack('research', 'lab').catch(error => error);
  expect(provision).not.toHaveBeenCalled();
  expect(f.owner.stopStackExecution).not.toHaveBeenCalled();
  expect(f.owner.startApp).not.toHaveBeenCalled();
  expect(result).toBeInstanceOf(Error);
  expect(result.message).toContain('Declare process.instances');
});

it('validates the built target immediately before changing the owner fence', async () => {
  const f = fixture(), service = f.make();
  Object.assign(service, { stackEntryBuilder: () => (entry: IEcosystemAppEntry) => ({ ...entry, name: f.handle.name, instances: 2 }) });
  await expect(service.startStack('research', 'lab', { release: f.selected.id })).rejects.toThrow('Declare process.instances');
  expect(f.owner.stopStackExecution).not.toHaveBeenCalled();
  expect(f.owner.redefineApp).not.toHaveBeenCalled();
  expect(f.owner.enableStackExecution).not.toHaveBeenCalled();
  expect(f.owner.startApp).not.toHaveBeenCalled();
  expect(f.selector().read()).toEqual({ revision: 0, release: null });
});

it('refuses a preservation review of an invalid cached target before consulting infrastructure', async () => {
  const f = fixture(), service = f.make();
  Object.assign(f.config.apps[0]!, { instances: 2 });
  Object.assign(service, { getLoadedConfig: () => f.config });
  const review = vi.spyOn(service['infraManager'], 'reviewPreservation');
  const result = await service.reviewStackStart('research', 'lab', { infrastructure: 'preserve' });
  expect(result.digest).toBeNull();
  expect(result.targets).toEqual([expect.objectContaining({ node: 'preflight', reason: expect.any(String) })]);
  expect(review).not.toHaveBeenCalled();
  expect(f.owner.stopStackExecution).not.toHaveBeenCalled();
});

it('reports retired registrations through the admission result shared by CLI and Console', async () => {
  const f = fixture();
  changedMembership(f);
  const service = f.make();
  Object.assign(service, { admitRelease: async () => ({ ...f.selected, manifest: { gates: [] }, files: [] }) });
  const result = await service.checkRelease('research', 'lab', f.selected.id);
  expect(result).toMatchObject({ ok: true, because: expect.stringContaining('research/lab/web') });
  expect(result.because).toContain('whole-stack stop');
  expect(f.selector().read().revision).toBe(0);
  expect(f.owner.startApp).not.toHaveBeenCalled();
});

it('requires all applications to stop before shrinking a stack, including a worker without a representative PID', async () => {
  const f = fixture();
  const change = changedMembership(f);
  f.handle.status = 'online';
  await expect(f.make().startStack('research', 'lab', { release: f.selected.id })).rejects.toThrow('Stop the applications');
  expect(f.selector().read().revision).toBe(0);
  expect(change.reconcile).not.toHaveBeenCalled();
});

it.each(['boot', 'auto-resume'] as const)('never removes retained applications during %s', async source => {
  const f = fixture();
  const change = changedMembership(f);
  f.selector().select(0, f.selected);
  await expect(f.make().startStack('research', 'lab', { source })).rejects.toThrow('Automatic resume cannot remove');
  expect(change.reconcile).not.toHaveBeenCalled();
  expect(f.owner.stopStackExecution).not.toHaveBeenCalled();
  expect(f.selector().read().revision).toBe(1);
});

it('recovers the committed target after reconciliation completed but its reply was lost', async () => {
  const f = fixture();
  const change = changedMembership(f);
  const reconcile = change.reconcile.getMockImplementation()!;
  change.reconcile.mockImplementationOnce(async () => { await reconcile(); throw new Error('reply lost'); });
  await expect(f.make().startStack('research', 'lab', { release: f.selected.id })).rejects.toThrow('reply lost');
  expect(change.hasRemoved()).toBe(false);
  expect(f.phase()).toBe('stopped');
  expect(f.owner.startApp).not.toHaveBeenCalled();
  const recovered = await f.reboot();
  await recovered.startStack('research', 'lab', { source: 'operator' });
  expect(change.reconcile).toHaveBeenCalledTimes(2);
  expect(f.owner.startApp).toHaveBeenCalledOnce();
  expect(f.selector().read()).toEqual({ revision: 1, release: f.selected });
});
