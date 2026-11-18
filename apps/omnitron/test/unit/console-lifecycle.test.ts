import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { afterAll, afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createNullLogger } from '@omnitron-dev/titan/module/logger';
import { writePrivateRecord } from '../../src/daemon/execution-journal.js';
import { ensurePersistedJwtSecret, readSavedDaemonConfig, savedDaemonOverrides, withInstancePolicy } from '../../src/config/saved.js';
import { readColdBatch } from '../../src/project/cold-stack-start.js';
import { runtimeArtifactDigest } from '../../src/shared/runtime-artifact.js';
import { WebappService } from '../../src/webapp/webapp.service.js';
import type { ContainerState, ResolvedContainer } from '../../src/infrastructure/types.js';

const home = await vi.hoisted(async () => {
  const fs = await import('node:fs/promises');
  const os = await import('node:os');
  return fs.mkdtemp((await fs.realpath(os.tmpdir())) + '/omnitron-console-');
});
vi.mock('../../src/config/defaults.js', async original => ({ ...await original<object>(), OMNITRON_HOME: home }));
const docker = vi.hoisted(() => ({ state: null as ContainerState | null, create: vi.fn(), remove: vi.fn(), stop: vi.fn(), image: vi.fn() }));
vi.mock('../../src/infrastructure/container-runtime.js', async original => ({
  ...await original<object>(), getContainerState: async () => docker.state,
  createContainer: docker.create, removeContainer: docker.remove, stopContainer: docker.stop, ensureImage: docker.image,
}));
import { containerSpecHash } from '../../src/infrastructure/container-runtime.js';

const pkg = path.join(home, 'source/webapp');
const file = path.join(home, 'runtime/local-updates/current.json');
const original = { artifact: 'a'.repeat(64), commit: 'a'.repeat(40) };
const target = { artifact: 'd'.repeat(64), commit: 'd'.repeat(40) };
const id = 'f'.repeat(64);
const stamp = (commit: string) => ({ commit, dirty: false, builtAt: '2026-10-01T00:00:00.000Z' });
const service = () => new WebappService(createNullLogger(), { port: 19800, bindHost: async () => '127.0.0.1' }, pkg);
const config = (enabled: boolean) => fs.writeFile(path.join(home, 'config.json'), JSON.stringify({
  initialized: true, role: 'master', webapp: enabled, httpPort: 19800, consoleBindHost: '192.0.2.10', files: { enabled: false }, auth: { jwtSecret: 'fixture' },
}), { mode: 0o600 });

async function assets(dist: string, commit: string) {
  await fs.mkdir(dist, { recursive: true, mode: 0o700 });
  await fs.writeFile(path.join(dist, 'index.html'), '<html>Console fixture</html>');
  await fs.writeFile(path.join(dist, 'BUILD.json'), JSON.stringify(stamp(commit)));
}

async function installed(commit: string) {
  const stage = await fs.mkdtemp(path.join(home, 'stage-'));
  await assets(path.join(stage, 'packages/0/webapp/dist'), commit);
  const artifact = await runtimeArtifactDigest(stage);
  await fs.writeFile(path.join(stage, 'RUNTIME.json'), JSON.stringify({ protocol: 1, sha256: artifact,
    platform: process.platform, arch: process.arch, nodeVersion: process.version, packages: 1 }), { mode: 0o600 });
  const root = path.join(home, 'runtime/releases', artifact);
  await fs.mkdir(path.dirname(root), { recursive: true, mode: 0o700 });
  await fs.rename(stage, root);
  return { artifact, commit };
}

async function hold(phase: string, previous: typeof original | null, candidate = target) {
  const plan = { protocol: 1, stackAdmissionProtocol: 1, instance: home, target: candidate,
    before: { backend: original.artifact, owner: original.artifact, console: previous?.artifact ?? null, consoleCommit: previous?.commit ?? null,
      revision: 1, ownerId: 'retired', ownerPid: 42, ownerLifetime: '01234567-0000-0000-0000-000000000001:1234' },
    configuration: { basis: 'retained-next-start', sha256: 'e'.repeat(64) }, infrastructure: { database: null }, excluded: [], stacks: [] };
  const digest = createHash('sha256').update(JSON.stringify(plan)).digest('hex');
  await writePrivateRecord(file, { protocol: 1, plan, digest, phase, updatedAt: new Date().toISOString() });
  return readColdBatch(home);
}

function create(spec: ResolvedContainer) {
  docker.state = { name: spec.name, containerId: id, image: spec.image, status: 'running', health: 'healthy', labels: spec.labels,
    specHash: containerSpecHash(spec), mounts: spec.volumes.map(volume => ({ source: volume.source, target: volume.target, readOnly: true })),
    portBindings: { '80/tcp': spec.ports.map(port => ({ address: port.bindHost!, port: port.host })) } };
  return id;
}
function gate() {
  let open!: () => void;
  const wait = new Promise<void>(resolve => { open = resolve; });
  return { open, wait };
}

beforeEach(async () => {
  vi.clearAllMocks();
  docker.state = null;
  docker.image.mockResolvedValue(undefined);
  docker.create.mockImplementation(create);
  docker.remove.mockImplementation(async (value: string) => { expect(value).toBe(id); docker.state = null; });
  await config(false);
  await assets(path.join(pkg, 'dist'), original.commit);
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    expect(url).toBe('http://127.0.0.1:19800/BUILD.json');
    const mount = docker.state?.mounts?.find(volume => volume.target === '/usr/share/nginx/html');
    return Response.json(JSON.parse(await fs.readFile(path.join(mount!.source, 'BUILD.json'), 'utf8')));
  }));
});
afterEach(async () => {
  vi.unstubAllGlobals();
  await fs.rm(file, { force: true });
  await fs.rm(path.join(home, 'runtime/releases'), { recursive: true, force: true });
});
afterAll(() => fs.rm(home, { recursive: true, force: true }));

it.each(['starting', 'restoring'] as const)('mounts only the reviewed %s Console when the bridge, previous backend and retained Console differ', async phase => {
  const retained = await installed('b'.repeat(40)), candidate = await installed(target.commit);
  const batch = await hold(phase, retained, candidate);
  await config(true);
  await service().startOnBoot(batch);
  const selected = phase === 'restoring' ? retained : candidate;
  expect(docker.create).toHaveBeenCalledWith(expect.objectContaining({ volumes: expect.arrayContaining([
    { source: path.join(home, 'runtime/releases', selected.artifact, 'packages/0/webapp/dist'), target: '/usr/share/nginx/html', readonly: true },
  ]) }), { fullId: true, pull: 'never' });
  await expect(service().start({ force: true })).rejects.toThrow('held');
  await expect(service().stop()).rejects.toThrow('held');
  await service().startOnBoot(batch);
  expect(docker.create).toHaveBeenCalledTimes(1);
  expect(docker.remove).not.toHaveBeenCalled();
});

it.each(['starting', 'restoring'])('preserves OFF during %s without Docker mutation or asset preparation', async phase => {
  await service().startOnBoot(await hold(phase, null));
  expect(docker.create).not.toHaveBeenCalled();
  expect(docker.image).not.toHaveBeenCalled();
  expect(readSavedDaemonConfig()?.webapp).toBe(false);
});

it.each(['starting', 'restoring'])('refuses a foreign Console during %s without removing or replacing it', async phase => {
  const retained = await installed('b'.repeat(40)), candidate = await installed(target.commit);
  const batch = await hold(phase, retained, candidate);
  await config(true);
  docker.state = { name: 'foreign-console', containerId: id, image: 'nginx', status: 'running',
    labels: { 'omnitron.instance-home': '/different-instance' } };
  await expect(service().startOnBoot(batch)).rejects.toThrow('does not belong');
  expect(docker.create).not.toHaveBeenCalled();
  expect(docker.remove).not.toHaveBeenCalled();
  expect(docker.stop).not.toHaveBeenCalled();
  expect(readSavedDaemonConfig()?.webapp).toBe(true);
});

it.each(['starting', 'restoring'])('does not accept or repeat a %s publication whose HTTP build is unconfirmed', async phase => {
  const retained = await installed('b'.repeat(40)), candidate = await installed(target.commit);
  const batch = await hold(phase, retained, candidate);
  await config(true);
  vi.stubGlobal('fetch', vi.fn(async () => Response.json(stamp('c'.repeat(40)))));
  await expect(service().startOnBoot(batch)).rejects.toThrow('HTTP build');
  expect(docker.create).toHaveBeenCalledOnce();
  expect(docker.remove).not.toHaveBeenCalled();
  expect(docker.stop).not.toHaveBeenCalled();
  expect(readSavedDaemonConfig()?.webapp).toBe(true);
});

it.each(['missing', 'wrong-commit', 'damaged'] as const)('refuses a %s retained artifact before altering a container or boot policy', async failure => {
  const retained = failure === 'missing' ? original : await installed('b'.repeat(40));
  if (failure === 'damaged') await fs.appendFile(path.join(home, 'runtime/releases', retained.artifact, 'packages/0/webapp/dist/index.html'), 'modified');
  const expected = failure === 'wrong-commit' ? { ...retained, commit: 'c'.repeat(40) } : retained;
  const batch = await hold('restoring', expected);
  await config(true);
  await expect(service().startOnBoot(batch)).rejects.toThrow();
  expect(docker.create).not.toHaveBeenCalled();
  expect(docker.remove).not.toHaveBeenCalled();
  expect(readSavedDaemonConfig()?.webapp).toBe(true);
});

it('lets an update publish its hold while image preparation is waiting and rejects the delayed operator before effect', async () => {
  const preparing = gate(), pulled = gate();
  docker.image.mockImplementation(async () => { preparing.open(); await pulled.wait; });
  const manual = service().start({ force: true });
  await preparing.wait;
  try { await withInstancePolicy(home, () => hold('draining', null)); }
  finally { pulled.open(); }
  await expect(manual).rejects.toThrow('held');
  expect(docker.create).not.toHaveBeenCalled();
  expect(readSavedDaemonConfig()?.webapp).toBe(false);
});

it('serializes an automatic and a manual start across service instances and stops the owned Console without a daemon', async () => {
  await config(true);
  const creating = gate(), reply = gate();
  docker.create.mockImplementation(async spec => { const result = create(spec); creating.open(); await reply.wait; return result; });
  const boot = service().startOnBoot(null);
  await creating.wait;
  const manual = service().start();
  reply.open();
  await boot;
  await expect(manual).resolves.toMatchObject({ running: true, healthy: true, port: 19800, autoStart: true });
  expect(docker.create).toHaveBeenCalledOnce();
  const offline = new WebappService(createNullLogger());
  await expect(offline.stop()).resolves.toBe(false);
  expect(docker.stop).toHaveBeenCalledWith(id, 5);
  expect(savedDaemonOverrides(readSavedDaemonConfig())).toMatchObject({ consoleBindHost: '192.0.2.10', httpPort: 19800 });
  expect(readSavedDaemonConfig()).toMatchObject({ webapp: false, files: { enabled: false }, httpPort: 19800, auth: { jwtSecret: 'fixture' } });
});

it('preserves an independently initialized JWT secret and the Console preference across concurrent configuration writers', async () => {
  const saved = readSavedDaemonConfig()!;
  delete saved.auth;
  await fs.writeFile(path.join(home, 'config.json'), JSON.stringify(saved));
  const entered = gate(), finish = gate();
  docker.create.mockImplementation(async spec => { entered.open(); await finish.wait; return create(spec); });
  const manual = service().start();
  await entered.wait;
  const secret = ensurePersistedJwtSecret();
  finish.open();
  await manual;
  expect(readSavedDaemonConfig()?.webapp).toBe(true);
  expect(await secret).toMatch(/^[0-9a-f]{64}$/);
  expect(readSavedDaemonConfig()).toMatchObject({ webapp: true, auth: { jwtSecret: await secret }, files: { enabled: false } });
});

it('leaves an owned matching container intact when its HTTP response serves the wrong build', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json(stamp('c'.repeat(40)))));
  await expect(service().start()).rejects.toThrow('HTTP build');
  await expect(service().start()).rejects.toThrow('HTTP build');
  expect(docker.create).toHaveBeenCalledOnce();
  expect(docker.remove).not.toHaveBeenCalled();
});
