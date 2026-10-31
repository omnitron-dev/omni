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
import { DaemonStateStore } from '../../src/daemon/daemon-state-store.service.js';
import { ProjectRegistry } from '../../src/project/registry.js';
import { ProjectService } from '../../src/services/project.service.js';

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
  it('refuses an ambiguous public stack after the default configuration changes', async () => {
    registry.importConfiguration(input());
    const service = Object.assign(Object.create(ProjectService.prototype), {
      registry, ensureConfig: async () => ({}), resolveStacks: () => ({ research: {} }),
    }) as ProjectService;
    await expect(service.resolveProjectStack({ project: 'sample', stack: 'research' })).rejects.toThrow(/Ambiguous/);
    await expect(service.resolveProjectStack({ project: 'sample-research', stack: 'local' })).resolves.toEqual({ project: 'sample-research', stack: 'local' });
  });
});
