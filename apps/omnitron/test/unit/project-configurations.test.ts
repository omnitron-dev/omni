import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createNullLogger } from '@omnitron-dev/titan/module/logger';

const sandbox = await vi.hoisted(async () => {
  const fs = await import('node:fs'); const os = await import('node:os'); const path = await import('node:path');
  return fs.mkdtempSync(path.join(os.tmpdir(), 'project-catalogue-'));
});
vi.mock('../../src/shared/paths.js', async original => {
  const module = await original<typeof import('../../src/shared/paths.js')>();
  return { ...module, expandPath: (value: string) => value.startsWith('~/') ? `${sandbox}/${value.slice(2)}` : module.expandPath(value) };
});
vi.mock('../../src/config/defaults.js', async original => ({ ...await original<typeof import('../../src/config/defaults.js')>(), OMNITRON_HOME: sandbox }));
import { DaemonRpcService } from '../../src/daemon/daemon.rpc-service.js';
import { DaemonStateStore } from '../../src/daemon/daemon-state-store.service.js';
import { ProjectRegistry } from '../../src/project/registry.js';
import { ProjectService } from '../../src/services/project.service.js';
import { ProjectRpcService } from '../../src/services/project.rpc-service.js';

let db: DaemonStateStore; let registry: ProjectRegistry; let root: string; let counter = 0;
const registeredAt = '2026-01-01T00:00:00.000Z';
beforeEach(() => {
  root = path.join(sandbox, String(++counter));
  db = new DaemonStateStore(createNullLogger(), path.join(root, 'state.sqlite'));
  for (const [name, relative] of [['sample', 'repo'], ['sample-research', 'repo/research'], ['another', 'another']]) {
    const location = path.join(root, relative!); fs.mkdirSync(location, { recursive: true });
    fs.writeFileSync(path.join(location, 'omnitron.config.mjs'), 'export default { apps: [], stacks: { local: { type: "local" } } };');
    db.upsertProjectSync({ name: name!, path: location, added_at: registeredAt, last_seen: registeredAt });
  }
  db.kvSetSync('project:sample-research:enabled-stacks', ['local']);
  db.kvSetSync('retained-history', { checkpoint: 17 });
  registry = new ProjectRegistry(db);
});
afterEach(async () => { vi.restoreAllMocks(); await db.dispose(); });
afterAll(() => fs.rmSync(sandbox, { recursive: true, force: true }));
const input = () => ({ project: 'sample', name: 'research', registration: 'sample-research', path: path.join(root, 'repo/research'), stacks: { local: 'research' }, expectedRevision: registry.catalogRevision() });

describe('one repository owns many stacks', () => {
  it('atomically moves ownership, preserves namespaces and reopens without resurrecting projects', () => {
    const original = registry.get('sample-research')!;
    registry.importConfiguration(input());
    expect(db.selectProjectsSync().map(row => row.name).sort()).toEqual(['another', 'sample']);
    expect(registry.get('sample-research')).toMatchObject(original);
    expect(registry.registrations('sample')).toHaveLength(2);
    expect(registry.resolveStack({ project: 'sample', stack: 'research' })).toEqual({ project: 'sample-research', stack: 'local' });
    expect(registry.resolveStack({ project: 'sample-research', stack: 'local' })).toEqual({ project: 'sample-research', stack: 'local' });
    registry.persist();
    registry = new ProjectRegistry(db);
    expect(registry.list()).toHaveLength(2);
    expect(registry.listRegistrations()).toHaveLength(3);
    expect(registry.get('sample-research')?.enabledStacks).toEqual(['local']);
    expect(db.kvGetSync('retained-history')).toEqual({ checkpoint: 17 });
    registry.detachConfiguration('sample', 'research', registry.catalogRevision());
    expect(registry.list()).toHaveLength(3);
    expect(registry.get('sample-research')).toEqual(original);
  });
  it('rolls back the row deletion if persisting the ownership record fails', () => {
    const before = registry.recoveryDigest();
    const write = db.kvSetSync.bind(db);
    vi.spyOn(db, 'kvSetSync').mockImplementation((key, value) => { if (key.endsWith(':configurations')) throw new Error('disk write failed'); write(key, value); });
    expect(() => registry.importConfiguration(input())).toThrow('disk write failed');
    expect(registry.list()).toHaveLength(3);
    expect(registry.recoveryDigest()).toBe(before);
  });
  it('refuses stale revisions and stale controller caches', () => {
    const stale = new ProjectRegistry(db); const old = input();
    registry.importConfiguration(old);
    expect(() => stale.importConfiguration(old)).toThrow(/changed/);
    expect(() => stale.importConfiguration(input())).toThrow(/reload/);
    expect(() => stale.recoveryDigest()).toThrow(/outside this controller/);
  });
  it('preserves the pre-migration recovery digest and includes ownership after migration', () => {
    const expected = createHash('sha256').update(JSON.stringify(registry.list().map(p => ({
      name: p.name, path: p.path, registeredAt: p.registeredAt, enabledStacks: [...(p.enabledStacks ?? [])].sort(),
    })).sort((a, b) => a.name.localeCompare(b.name)))).digest('hex');
    expect(registry.recoveryDigest()).toBe(expected);
    registry.importConfiguration(input());
    expect(registry.recoveryDigest()).not.toBe(expected);
  });
  it('refuses cross-project ownership, symlink escapes, duplicate names and remapping only part of a namespace', () => {
    expect(() => registry.importConfiguration({ ...input(), registration: 'another', path: path.join(root, 'another') })).toThrow(/service binding/);
    fs.symlinkSync(path.join(root, 'another'), path.join(root, 'repo/link'));
    expect(() => registry.importConfiguration({ ...input(), registration: 'another', path: path.join(root, 'repo/link') })).toThrow(/service binding/);
    expect(() => registry.importConfiguration({ ...input(), stacks: { local: 'test', production: 'test' } })).toThrow(/distinct/);
    expect(() => registry.add('duplicate', path.join(root, 'repo/research'))).toThrow(/belongs to project/);
    registry.importConfiguration(input());
    expect(() => registry.remove('sample')).toThrow(/detach/);
    expect(() => registry.remove('sample-research')).toThrow(/not a separate project/);
  });
  it('addresses local daemon processes by their one public owner, including imported stacks', async () => {
    registry.importConfiguration(input());
    const configs: Record<string, Record<string, { type: string }>> = {
      sample: { dev: { type: 'local' }, edge: { type: 'remote' } },
      'sample-research': { local: { type: 'local' }, hidden: { type: 'local' } },
      another: { dev: { type: 'local' } },
    };
    const projects = Object.assign(Object.create(ProjectService.prototype), {
      registry, getLoadedConfig: (name: string) => configs[name], resolveStacks: (stacks: unknown) => stacks,
    }) as ProjectService;
    const handles = ['sample/dev/api', 'sample-research/local/api', 'another/dev/api', 'sample/edge/api', 'sample-research/hidden/api', 'loose'];
    const processes = handles.map(name => ({ name, status: 'online' }));
    const getApp = vi.fn((name: string) => processes.find(process => process.name === name)
      ?? (name === 'api' ? processes[0] : undefined));
    const owners = vi.fn((project?: string) => projects.localApplicationScopes(project));
    const daemon = new DaemonRpcService({ list: () => processes, getApp } as never,
      {} as never, {} as never, {} as never, {} as never, undefined, owners);

    expect(await daemon.list()).toEqual(processes);
    expect(owners).not.toHaveBeenCalled();
    const listed = await daemon.list({ workspaces: true });
    expect(owners).toHaveBeenCalledTimes(1);
    const imported = { project: 'sample', stack: 'research' };
    expect(listed.map(item => item.workspace)).toEqual([
      { project: 'sample', stack: 'dev' }, imported, { project: 'another', stack: 'dev' }, null, null, null,
    ]);
    expect(await daemon.getApp({ ...imported, app: 'api' })).toMatchObject({ name: 'sample-research/local/api', workspace: imported });
    expect(owners).toHaveBeenLastCalledWith('sample');
    expect(await daemon.getApp({ name: 'sample-research/local/api', exact: true })).toMatchObject({ workspace: imported });
    expect(await daemon.getApp({ name: 'loose', exact: true })).toMatchObject({ name: 'loose', workspace: null });
    expect(await daemon.getApp({ name: 'api' })).toMatchObject({ name: 'sample/dev/api' });
    await expect(daemon.getApp({ name: 'api', exact: true })).rejects.toThrow();
    await expect(daemon.getApp({ ...imported, app: 'removed' })).rejects.toThrow();
    getApp.mockClear();
    await expect(daemon.getApp({ project: 'sample', stack: 'edge', app: 'api' })).rejects.toThrow();
    await expect(daemon.getApp({ ...imported, app: 'another/dev/api' })).rejects.toThrow();
    // A remote declaration colliding with an imported local public name is ambiguous.
    configs['sample']!['research'] = { type: 'remote' };
    await expect(daemon.getApp({ ...imported, app: 'api' })).rejects.toThrow();
    expect(getApp).not.toHaveBeenCalled();
    expect((await daemon.list({ workspaces: true }))[1]?.workspace).toBeNull();
  });
  it('refuses an ambiguous public stack after the default configuration changes', async () => {
    registry.importConfiguration(input());
    const service = Object.assign(Object.create(ProjectService.prototype), {
      registry, ensureConfig: async () => ({}), resolveStacks: () => ({ research: {} }),
    }) as ProjectService;
    await expect(service.resolveProjectStack({ project: 'sample', stack: 'research' })).rejects.toThrow(/Ambiguous/);
    await expect(service.resolveProjectStack({ project: 'sample-research', stack: 'local' })).resolves.toEqual({ project: 'sample-research', stack: 'local' });
  });
});


describe('the public project catalogue on first read', () => {
  let service: ProjectService;
  let rpc: ProjectRpcService;
  beforeEach(() => {
    registry.importConfiguration(input());
    const owner = { list: () => [], getHealth: async () => ({}) };
    service = new ProjectService(createNullLogger(), owner as never, db);
    rpc = new ProjectRpcService(service);
  });
  afterEach(() => service.dispose());

  it('counts all configured public stacks before opening their inventory', async () => {
    fs.writeFileSync(path.join(root, 'repo/omnitron.stacks.json'), JSON.stringify({
      local: { type: 'local' }, edge: { type: 'remote', nodes: [{ host: 'edge.example', role: 'app' }] },
    }));
    const load = vi.spyOn(service, 'loadProjectConfig');
    const observe = vi.spyOn(service, 'withRemoteAppStatuses');
    const [first, second] = await Promise.all([rpc.listProjects(), rpc.listProjects()]);
    expect(second).toEqual(first);
    expect(load.mock.calls.map(([name]) => name).sort()).toEqual(['another', 'sample', 'sample-research']);
    expect(observe).not.toHaveBeenCalled();
    const project = first.find(row => row.name === 'sample')!;
    expect(project).toMatchObject({ totalStacks: 3, runningStacks: 0, enabledStacks: ['research'] });
    expect(first.find(row => row.name === 'another')?.totalStacks).toBe(1);
    const stacks = await rpc.listStacks({ project: project.name });
    expect(stacks.map(stack => stack.name).sort()).toEqual(['edge', 'local', 'research']);
    expect(project.totalStacks).toBe(stacks.length);
    expect(stacks.find(stack => stack.name === 'research')?.runtimeScope).toEqual({ project: 'sample-research', stack: 'local' });
    expect(load).toHaveBeenCalledTimes(3);
  });

  it('identifies an unreadable imported configuration and retries after repair', async () => {
    const config = path.join(root, 'repo/research/omnitron.config.mjs');
    fs.renameSync(config, config + '.saved');
    await expect(rpc.listProjects()).rejects.toThrow(/research/);
    expect(await rpc.getProject({ name: 'another' })).toMatchObject({ totalStacks: 1 });
    fs.renameSync(config + '.saved', config);
    expect(await rpc.getProject({ name: 'sample-research' })).toMatchObject({ name: 'sample', totalStacks: 2 });
  });

  it('rejects a catalogue whose ownership changed during a cold load', async () => {
    let resume!: () => void;
    const gate = new Promise<void>(resolve => { resume = resolve; });
    const load = service.loadProjectConfig.bind(service);
    vi.spyOn(service, 'loadProjectConfig').mockImplementationOnce(async name => {
      await gate;
      return load(name);
    });
    const reading = rpc.listProjects();
    try {
      await service.detachProjectConfiguration({ project: 'sample', name: 'research', expectedRevision: registry.catalogRevision() });
    } finally { resume(); }
    await expect(reading).rejects.toThrow('Project catalogue changed');
    const next = await rpc.listProjects();
    expect(next.map(project => project.name).sort()).toEqual(['another', 'sample', 'sample-research']);
    expect(next.every(project => project.totalStacks === 1)).toBe(true);
  });
});


describe('public configuration import admission', () => {
  const rpc = () => new ProjectRpcService(Object.assign(Object.create(ProjectService.prototype), {
    registry, daemonStateStore: db, configRegistry: new Map(), stackStates: new Map(), logger: createNullLogger(),
    ensureConfig: async () => ({ apps: [], stacks: { default: { type: 'local' } } }),
    emit: vi.fn(), getProject: () => ({ name: 'sample' }),
  }) as ProjectService);
  const source = (name: string) => {
    const location = path.join(root, 'repo', name);
    fs.mkdirSync(location, { recursive: true });
    fs.writeFileSync(path.join(location, 'omnitron.config.mjs'),
      'export default { apps: [], stacks: { local: { type: "local" } } };');
    return location;
  };
  it('creates a new explicit runtime namespace without reading nonexistent retained state', async () => {
    const request = { ...input(), name: 'atlas', registration: 'sample-atlas-successor', path: source('atlas'), stacks: { local: 'atlas' } };
    await rpc().importConfiguration(request);
    expect(registry.resolveStack({ project: 'sample', stack: 'atlas' })).toEqual({ project: request.registration, stack: 'local' });
    const reopened = new ProjectRegistry(db);
    expect(reopened.get(request.registration)).toMatchObject({ path: request.path, configuration: { project: 'sample', name: 'atlas' } });
    expect(reopened.get('sample-research')?.enabledStacks).toEqual(['local']);
  });
  it('retains an existing namespace and its enabled stack history', async () => {
    await rpc().importConfiguration(input());
    expect(registry.get('sample-research')).toMatchObject({ registeredAt, enabledStacks: ['local'] });
    expect(db.kvGetSync('retained-history')).toEqual({ checkpoint: 17 });
  });
  it('checks retained intent even when the existing runtime namespace is generated', async () => {
    const location = source('generated');
    registry.importConfiguration({ project: 'sample', name: 'generated', path: location,
      stacks: { local: 'generated' }, expectedRevision: registry.catalogRevision() });
    registry.setStackEnabled('sample--generated', 'missing', true);
    const before = registry.catalogRevision();
    await expect(rpc().importConfiguration({ project: 'sample', name: 'generated', path: location,
      stacks: { local: 'generated' }, expectedRevision: before })).rejects.toThrow(/Auto-start source stack 'missing'/);
    expect(registry.catalogRevision()).toBe(before);
  });
  it('refuses a foreign existing registration and stale catalogue revisions without mutation', async () => {
    const initial = registry.catalogRevision(), location = source('new');
    await expect(rpc().importConfiguration({ ...input(), name: 'new', registration: 'another', path: location }))
      .rejects.toThrow(/another configuration path/);
    expect(registry.catalogRevision()).toBe(initial);
    await rpc().importConfiguration(input());
    const after = registry.catalogRevision();
    await expect(rpc().importConfiguration({ ...input(), name: 'new', registration: 'sample-new', path: location, expectedRevision: initial }))
      .rejects.toThrow(/changed/);
    expect(registry.catalogRevision()).toBe(after);
    expect(registry.get('sample-new')).toBeNull();
  });
});
