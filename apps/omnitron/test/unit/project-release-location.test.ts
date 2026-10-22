import fs from 'node:fs';
import path from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createNullLogger } from '@omnitron-dev/titan/module/logger';

const sandbox = await vi.hoisted(async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  return fs.mkdtempSync(path.join(os.tmpdir(), 'project-release-'));
});
vi.mock('../../src/shared/paths.js', async (original) => {
  const module = await original<typeof import('../../src/shared/paths.js')>();
  return { ...module, expandPath: (value: string) => value.startsWith('~/') ? `${sandbox}/${value.slice(2)}` : module.expandPath(value) };
});
import { DaemonStateStore } from '../../src/daemon/daemon-state-store.service.js';
import { ProjectRegistry } from '../../src/project/registry.js';
import { ProjectService } from '../../src/services/project.service.js';

const logger = createNullLogger();
let store: DaemonStateStore;
let registry: ProjectRegistry;
let original: string;
let release: string;
let counter = 0;
beforeEach(() => {
  const root = path.join(sandbox, String(++counter));
  original = path.join(root, 'first');
  release = path.join(root, 'second', 'production');
  for (const directory of [original, release]) {
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, 'omnitron.config.mjs'), 'export default { apps: [] };\n');
  }
  store = new DaemonStateStore(logger, path.join(root, 'state.sqlite'));
  registry = new ProjectRegistry(store);
});
afterEach(async () => { await store.dispose(); });
afterAll(() => { fs.rmSync(sandbox, { recursive: true, force: true }); });

describe('immutable releases preserve project identity', () => {
  it('keeps the name, workspace, registration time and enabled stacks after reopening SQLite', async () => {
    const project = registry.add('research-lab', original);
    project.enabledStacks = ['production'];
    registry.persist();
    const workspace = registry.getWorkspaceDir(project.name);
    fs.writeFileSync(path.join(workspace, 'retained.log'), 'history');
    // Another project can already have the same name as the new directory basename.
    registry.add('production', original);
    const updated = registry.updatePath(project.name, release);
    expect(updated).toEqual({ ...project, path: release });
    expect(fs.readFileSync(path.join(workspace, 'retained.log'), 'utf8')).toBe('history');
    await store.dispose();
    const reopened = new ProjectRegistry(store);
    expect(reopened.get(project.name)).toEqual(updated);
    expect(reopened.get('production')?.path).toBe(original);
    expect(reopened.list()).toHaveLength(2);
  });

  it('does not change persisted registration when the new configuration is absent', async () => {
    const before = registry.add('research-lab', original);
    expect(() => registry.updatePath(before.name, path.join(release, 'missing'))).toThrow(/No omnitron.config/);
    await store.dispose();
    expect(new ProjectRegistry(store).get(before.name)).toEqual(before);
  });

  it('can pin an existing symlink registration to its immutable target', () => {
    const current = path.join(path.dirname(original), 'current');
    fs.symlinkSync(release, current, 'dir');
    registry.add('research-lab', current);
    expect(registry.updatePath('research-lab', release).path).toBe(release);
    fs.unlinkSync(current);
    fs.symlinkSync(original, current, 'dir');
    expect(registry.get('research-lab')?.path).toBe(release);
  });

  it('rejects moving a running stack, then invalidates the old config after a stopped move', () => {
    registry.add('research-lab', original);
    const stack = { project: 'research-lab', stack: 'production', status: 'running' };
    const cache = new Map([['research-lab', { config: 'old' }]]);
    const service = Object.assign(Object.create(ProjectService.prototype), {
      registry, logger, configRegistry: cache,
      stackStates: new Map([['research-lab/production', stack]]),
      toProjectInfo: (p: unknown) => p, emit: vi.fn(),
    }) as ProjectService;
    expect(() => service.updateProject('research-lab', { path: release })).toThrow(/Stop them/);
    expect(registry.get('research-lab')?.path).toBe(original);
    expect(cache.has('research-lab')).toBe(true);
    stack.status = 'stopped';
    expect(service.updateProject('research-lab', { path: release }).name).toBe('research-lab');
    expect(cache.has('research-lab')).toBe(false);
    expect(registry.get('research-lab')?.path).toBe(release);
  });
});
