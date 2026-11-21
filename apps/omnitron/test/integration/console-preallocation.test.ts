import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { once } from 'node:events';
import { spawn, type ChildProcess } from 'node:child_process';
import { beforeAll, beforeEach, afterAll, afterEach, expect, it, vi } from 'vitest';
import { createNullLogger } from '@omnitron-dev/titan/module/logger';
import { runtimeArtifactDigest } from '../../src/shared/runtime-artifact.js';
import { runtimeUpdatePlanDigest, runRuntimeUpdate, type RuntimeUpdateActions } from '../../src/daemon/runtime-update.js';
import { readColdBatch } from '../../src/project/cold-stack-start.js';
import { ReviewedConsoleAllocation, consoleConfigIdentity, consoleSpecification } from '../../src/webapp/console-allocation.js';
import { generateNginxConfig, WebappService } from '../../src/webapp/webapp.service.js';
import { containerSpecHash } from '../../src/infrastructure/container-runtime.js';
import type { RuntimeUpdatePlan, RuntimeUpdateReference } from '../../src/shared/dto/runtime-update.js';

const home = await vi.hoisted(async () => {
  const fs = await import('node:fs/promises'), os = await import('node:os');
  return fs.mkdtemp((await fs.realpath(os.tmpdir())) + '/omnitron-allocation-');
});
vi.mock('../../src/config/defaults.js', async original => ({ ...await original<object>(), OMNITRON_HOME: home }));
vi.mock('../../src/infrastructure/phantom-endpoint-janitor.js', () => ({
  PhantomEndpointJanitor: class { async sweepNetwork(_: string, name: string) { events.push('repair ' + name); return 1; } },
}));
vi.mock('@xec-sh/core', async original => ({
  ...await original<object>(),
  ExecutionEngine: class {
    execute(command: { args: string[] }) { return execute(command.args); }
    async dispose() {}
  },
  DockerAdapter: class {
    async listImages() { return ['nginx:alpine']; }
    async listContainers() { return [...containers.values()].map(item => item.Name.slice(1)); }
    async inspectContainer(name: string) { return inspect(name); }
    async removeContainer(id: string) { expect(containers.delete(id)).toBe(true); events.push('remove ' + id); }
  },
}));

const directory = path.join(home, 'runtime/local-updates'), address = '127.0.0.1', originalId = 'a'.repeat(64);
const lost = () => Object.assign(Error('Lost Docker response'), { code: 'TIMEOUT_ERROR' });
const refused = (stderr: string) => Object.assign(Error(stderr), { code: 'COMMAND_FAILED', stderr });
const dist = (release: RuntimeUpdateReference) => path.join(home, 'runtime/releases', release.artifact, 'packages/0/webapp/dist');
const gate = () => Promise.withResolvers<void>();
const fields = (args: string[], key: string) => args.flatMap((item, index) => item === key ? [args[index + 1]!] : []);
const events: string[] = [], applications: ChildProcess[] = [];
let port: number, canonical: string, next: number;
let previous: RuntimeUpdateReference, target: RuntimeUpdateReference, configuration: Awaited<ReturnType<typeof consoleConfigIdentity>>;
const configFile = path.join(home, 'webapp/nginx/nginx.conf');
const retainedText = '# Legacy Console configuration\n';
const targetText = () => generateNginxConfig('host.docker.internal', port + 1, port + 2);
let beforeCreate: () => Promise<void>, afterCreate: () => void, afterRename: () => void, beforeStart: () => void, afterStart: () => void, afterAdmission: () => void | Promise<void>;

function native(id: string, name: string, status: string, labels: Record<string, string>, mounts: string[], binding: string) {
  const [ip, hostPort, containerPort] = binding.split(':');
  const ports = { [containerPort + '/tcp']: [{ HostIp: ip, HostPort: hostPort }] };
  return { Id: id, Name: '/' + name, Config: { Image: 'nginx:alpine', Labels: labels },
    State: { Status: status, Health: { Status: 'healthy' } },
    HostConfig: { PortBindings: ports }, NetworkSettings: { Ports: status === 'running' ? ports : {}, Networks: { omnitron: {} } },
    Mounts: mounts.map(value => { const [Source, Destination, mode] = value.split(':'); return { Source: Source!, Destination: Destination!, RW: mode !== 'ro' }; }) };
}
const containers = new Map<string, ReturnType<typeof native>>();
function inspect(ref: string) {
  const item = containers.get(ref) ?? [...containers.values()].find(value => value.Name === '/' + ref);
  if (!item) throw refused('No such container: ' + ref);
  return item;
}
async function execute(args: string[]) {
  expect(args[0]).toBe('container');
  const ref = args.at(-1)!;
  switch (args[1]) {
    case 'inspect': return { stdout: JSON.stringify([inspect(ref)]) };
    case 'create': {
      const name = fields(args, '--name')[0]!, id = (++next).toString(16).padStart(64, '0');
      events.push('create ' + name);
      await beforeCreate();
      if ([...containers.values()].some(value => value.Name === '/' + name)) throw refused('Name is in use');
      containers.set(id, native(id, name, 'created', Object.fromEntries(fields(args, '--label').map(label => label.split('='))),
        fields(args, '-v'), fields(args, '-p')[0]!));
      afterCreate();
      return { stdout: id };
    }
    case 'rename': {
      const item = inspect(args.at(-2)!);
      expect(args).toEqual(['container', 'rename', '--', item.Id, canonical]);
      if ([...containers.values()].some(value => value.Name === '/' + canonical)) throw refused('Canonical name is in use');
      item.Name = '/' + canonical;
      events.push('rename ' + item.Id);
      afterRename();
      return { stdout: '' };
    }
    case 'start': {
      const item = inspect(ref);
      expect(args).toEqual(['container', 'start', '--', item.Id]);
      expect([item.Name, item.State.Status]).toEqual(['/' + canonical, 'created']);
      beforeStart();
      item.State.Status = 'running';
      item.NetworkSettings.Ports = item.HostConfig.PortBindings;
      events.push('start ' + item.Id);
      afterStart();
      return { stdout: ref };
    }
    default: throw Error('Unexpected Docker operation ' + args[1]);
  }
}

const server = http.createServer(async (request, response) => {
  try {
    const item = inspect(canonical);
    if (item.State.Status !== 'running' || request.url !== '/BUILD.json') throw Error('unavailable');
    const root = item.Mounts.find(mount => mount.Destination === '/usr/share/nginx/html')!.Source;
    response.end(await fs.readFile(path.join(root, 'BUILD.json')));
  } catch { response.writeHead(503).end(); }
});
async function served() {
  const response = await fetch('http://' + address + ':' + port + '/BUILD.json');
  expect(response.status).toBe(200);
  return (await response.json()).commit;
}
async function installed(commit: string) {
  const stage = await fs.mkdtemp(path.join(home, 'seal-')), root = path.join(stage, 'packages/0/webapp/dist');
  await fs.mkdir(root, { recursive: true, mode: 0o700 });
  await fs.writeFile(path.join(root, 'index.html'), commit);
  await fs.writeFile(path.join(root, 'BUILD.json'), JSON.stringify({ commit, dirty: false, builtAt: '2026-11-01T00:00:00.000Z' }));
  const artifact = await runtimeArtifactDigest(stage);
  await fs.writeFile(path.join(stage, 'RUNTIME.json'), JSON.stringify({ protocol: 1, sha256: artifact, platform: process.platform,
    arch: process.arch, nodeVersion: process.version, packages: 1 }), { mode: 0o600 });
  await fs.rename(stage, path.join(home, 'runtime/releases', artifact));
  return { artifact, commit };
}
function startApps() {
  for (const name of ['api', 'worker']) applications.push(spawn(process.execPath, ['-e', 'setInterval(() => {}, 60000)', name], { stdio: 'ignore' }));
}
function pids() {
  return applications.map(app => { process.kill(app.pid!, 0); return app.pid!; });
}
async function stopApps() {
  await Promise.all(applications.splice(0).map(async child => {
    const closed = once(child, 'exit');
    child.kill();
    await closed;
  }));
}
beforeAll(async () => {
  server.listen(0, address);
  await once(server, 'listening');
  port = (server.address() as { port: number }).port;
  await fs.mkdir(path.join(home, 'runtime/releases'), { recursive: true, mode: 0o700 });
  previous = await installed('b'.repeat(40));
  target = await installed('c'.repeat(40));
  await fs.mkdir(path.join(home, 'webapp/nginx'), { recursive: true });
  await fs.writeFile(path.join(home, 'config.json'), JSON.stringify({ initialized: true, role: 'master', webapp: true, httpPort: port }), { mode: 0o600 });
});
beforeEach(async () => {
  await fs.rm(configFile, { force: true });
  await fs.writeFile(configFile, retainedText);
  configuration = await consoleConfigIdentity(home);
  const incumbent = consoleSpecification(home, dist(previous), port, address);
  canonical = incumbent.name;
  containers.clear(); events.length = 0; next = 0;
  containers.set(originalId, native(originalId, canonical, 'running', { ...incumbent.labels, 'omnitron.spec-hash': containerSpecHash(incumbent) },
    incumbent.volumes.map(volume => volume.source + ':' + volume.target + ':ro'), address + ':' + port + ':80'));
  beforeCreate = async () => {};
  afterCreate = afterRename = beforeStart = afterStart = afterAdmission = () => {};
  startApps();
});
afterEach(async () => { await stopApps(); await fs.rm(directory, { recursive: true, force: true }); });
afterAll(async () => { server.close(); await once(server, 'close'); await fs.rm(home, { recursive: true, force: true }); });

function scenario() {
  const scope = { project: 'fixture', stack: 'local' }, owner = 'd'.repeat(64);
  const ids = pids();
  const plan: RuntimeUpdatePlan = { protocol: 1, stackAdmissionProtocol: 1, instance: home, target, backupOperations: [], excluded: [], watches: [],
    consolePublication: { containerId: originalId, address, port, configuration }, configuration: { basis: 'retained-next-start', sha256: 'f'.repeat(64) },
    before: { console: previous.artifact, consoleCommit: previous.commit, backend: owner, owner, guardian: owner, backendCommit: 'd'.repeat(40),
      ownerCommit: 'd'.repeat(40), scope: 'user', ownerId: 'original', ownerPid: 42, backendPid: 43, guardianPid: 44, revision: 1,
      ownerLifetime: '01234567-0000-0000-0000-000000000001:1234', retiredPids: ids },
    infrastructure: { schemaScope: 'node', digest: 'a'.repeat(64), containers: [], database: null },
    stacks: [{ ...scope, runtimeScope: scope, path: home, enabled: true, status: 'running', infrastructureMode: 'preserve', infrastructureReview: null,
      savedSelection: { kind: 'working-tree' }, selection: { kind: 'working-tree' }, startReview: '4'.repeat(64), apps: ids.map((pid, index) => ({
        name: String(index), handleKey: 'fixture/local/' + index, status: 'online', pid, generation: String(pid), health: 'healthy', release: null })) }] };
  const digest = runtimeUpdatePlanDigest(plan);
  const allocation = (direction: 'previous' | 'target') =>
    new ReviewedConsoleAllocation(home, digest, direction, direction === 'target' ? target : previous, plan.consolePublication!);
  const actions: RuntimeUpdateActions = {
    prepare: async () => plan,
    prepareConsole: async (_, direction) => allocation(direction).prepare(targetText()),
    async admit() { events.push('admit'); await afterAdmission(); },
    async releaseAdmission(_, _digest, requested) { if (requested) events.push('release'); await allocation('target').discard(); },
    async validateStop(_, forward) { await allocation(forward ? 'target' : 'previous').verify(); },
    async stop() { events.push('stop ' + inspect(canonical).Id); containers.delete(inspect(canonical).Id); await stopApps(); },
    async assertStopped() { expect(applications).toHaveLength(0); },
    canRestore: async () => !applications.length,
    validateRestore: async () => {},
    captureForRollback: async () => ({ ...plan.before, ownerId: 'candidate', owner: target.artifact, guardian: target.artifact, backend: target.artifact }),
    withRollbackAdmission: async (_, _live, stop) => stop(),
    async start() {
      const batch = await readColdBatch(home);
      const service = new WebappService(createNullLogger(), { port, bindHost: async () => address }, path.dirname(dist(target)));
      await service.startOnBoot(batch);
      await service.startOnBoot(batch); // An observer seeing the completed effect cannot replay it.
      startApps();
    },
    async accept(_, direction) {
      const release = direction === 'target' ? target : previous;
      expect(await served()).toBe(release.commit);
      expect(inspect(canonical).Mounts).toContainEqual({ Source: dist(release), Destination: '/usr/share/nginx/html', RW: false });
      expect(pids()).toHaveLength(2);
      return { backend: release.artifact, owner: release.artifact, guardian: release.artifact, ownerId: direction, console: release, stacks: [], watches: [] };
    },
  };
  const run = (operation: 'prepare' | 'apply' | 'recover') =>
    runRuntimeUpdate({ operation, actions, directory, ...(operation !== 'prepare' && { digest }) });
  return { run, digest, allocation, ids };
}

it('keeps both application PIDs and the old HTTP publication through a delayed refusal, before backup admission', async () => {
  const { run, ids } = scenario(), entered = gate(), reply = gate();
  await run('prepare');
  expect(events).toEqual([]);
  beforeCreate = async () => { entered.resolve(); await reply.promise; throw refused('fixture storage is full'); };
  const result = run('apply');
  await entered.promise;
  try {
    expect(await served()).toBe(previous.commit);
    expect(inspect(canonical).Id).toBe(originalId);
    expect(pids()).toEqual(ids);
    expect(events.map(value => value.split(' ')[0])).toEqual(['create']);
  } finally { reply.resolve(); }
  await expect(result).rejects.toThrow('Docker refused');
  expect(await run('recover')).toMatchObject({ phase: 'aborted' });
  expect(events.map(value => value.split(' ')[0])).toEqual(['create']);
  expect([...containers.keys()]).toEqual([originalId]);
  expect(pids()).toEqual(ids);
  expect(await served()).toBe(previous.commit);
});

it.each(['acknowledged', 'lost'])('prepares each exact release before stopping its predecessor, with %s Docker responses', async response => {
  const { run, ids } = scenario();
  const duringAllocation: Array<{ id: string; pids: number[]; commit: string }> = [];
  beforeCreate = async () => { duringAllocation.push({ id: inspect(canonical).Id, pids: pids(), commit: await served() }); };
  if (response === 'lost') afterCreate = afterRename = afterStart = () => { throw lost(); };
  await run('prepare');
  expect(await run('apply')).toMatchObject({ phase: 'accepted', admissionRequestedAt: expect.any(String),
    consoleAllocation: { target: { startedAt: expect.any(String), readyAt: expect.any(String) } } });
  const candidateId = inspect(canonical).Id, candidateApps = pids();
  expect(await fs.readFile(configFile, 'utf8')).toBe(targetText());
  expect(candidateId).not.toBe(originalId);
  expect(candidateApps).not.toEqual(ids);
  expect(await run('recover')).toMatchObject({ phase: 'rolled-back', acceptance: { console: previous } });
  const restoredId = inspect(canonical).Id;
  expect(await fs.readFile(configFile, 'utf8')).toBe(retainedText);
  expect(duringAllocation).toEqual([{ id: originalId, pids: ids, commit: previous.commit }, { id: candidateId, pids: candidateApps, commit: target.commit }]);
  expect(events.map(value => value.startsWith('create ') ? 'create' : value)).toEqual([
    'create', 'admit', 'stop ' + originalId, 'rename ' + candidateId, 'start ' + candidateId,
    'create', 'stop ' + candidateId, 'rename ' + restoredId, 'start ' + restoredId,
  ]);
  expect([...containers.keys()]).toEqual([restoredId]);
});

it('refuses a substituted native allocation before stopping the incumbent and preserves the foreign container', async () => {
  const { run, ids } = scenario();
  afterAdmission = () => {
    const staged = [...containers.values()].find(item => item.State.Status === 'created')!;
    staged.Config.Labels['omnitron.creation'] = 'foreign';
  };
  await run('prepare');
  await expect(run('apply')).rejects.toThrow('another creation');
  expect(events.map(value => value.split(' ')[0])).toEqual(['create', 'admit', 'release']);
  expect(pids()).toEqual(ids);
  expect(inspect(canonical).Id).toBe(originalId);
  expect(await served()).toBe(previous.commit);
  expect(containers.size).toBe(2);
});

it.each(['contents', 'inode', 'symlink'])('detects changed configuration %s before shutdown and disposes only the inactive ID', async change => {
  const { run, ids } = scenario();
  afterAdmission = async () => {
    if (change === 'contents') await fs.appendFile(configFile, '# independently edited');
    else {
      await fs.rename(configFile, configFile + '.original');
      if (change === 'inode') await fs.writeFile(configFile, retainedText);
      else await fs.symlink(configFile + '.original', configFile);
    }
  };
  await run('prepare');
  await expect(run('apply')).rejects.toThrow();
  expect(events.map(value => value.split(' ')[0])).toEqual(['create', 'admit', 'release', 'remove']);
  expect([...containers.keys()]).toEqual([originalId]);
  expect(pids()).toEqual(ids);
  expect(await served()).toBe(previous.commit);
});

it('checks the exact renamed native ID before writing the mounted configuration', async () => {
  const { run, allocation } = scenario();
  await run('prepare');
  const selected = allocation('target');
  await selected.prepare(targetText());
  containers.delete(originalId);
  afterRename = () => { inspect(canonical).Config.Labels['omnitron.creation'] = 'other creator'; };
  await expect(selected.publish(consoleSpecification(home, dist(target), port, address), targetText())).rejects.toThrow('another creation');
  expect(await fs.readFile(configFile, 'utf8')).toBe(retainedText);
  expect(events.map(value => value.split(' ')[0])).toEqual(['create', 'rename']);
});

it('refuses an unrecorded rename even when the native ID and nonce still match', async () => {
  const { run, allocation } = scenario();
  await run('prepare');
  const selected = allocation('target');
  await selected.prepare(targetText());
  containers.delete(originalId);
  const staged = [...containers.values()][0]!;
  staged.Name = '/' + canonical;
  await expect(selected.publish(consoleSpecification(home, dist(target), port, address), targetText())).rejects.toThrow('outside its recorded operation');
  expect(await fs.readFile(configFile, 'utf8')).toBe(retainedText);
  expect(events.map(value => value.split(' ')[0])).toEqual(['create']);
});

it('retains accepted service and application generations when allocation of the exact rollback artifact fails', async () => {
  const { run } = scenario();
  await run('prepare');
  await run('apply');
  const candidateId = inspect(canonical).Id, candidatePids = pids(), baseline = events.length;
  beforeCreate = async () => { expect(await served()).toBe(target.commit); throw refused('fixture storage is full'); };
  await expect(run('recover')).rejects.toThrow('refused before retirement');
  const receipt = JSON.parse(await fs.readFile(path.join(directory, 'current.json'), 'utf8'));
  expect(receipt).toMatchObject({ phase: 'accepted', consoleAllocation: { previous: { startedAt: expect.any(String) } } });
  expect(events.slice(baseline).map(value => value.split(' ')[0])).toEqual(['create']);
  expect(inspect(canonical).Id).toBe(candidateId);
  expect(pids()).toEqual(candidatePids);
  expect(await served()).toBe(target.commit);
});

it('recovers a late native create after the deadline without repeating it or requesting admission', async () => {
  const { run, ids } = scenario();
  const clock = performance.now.bind(performance);
  let offset = 0, late: ReturnType<typeof native>;
  const now = vi.spyOn(performance, 'now').mockImplementation(() => clock() + offset);
  try {
    afterCreate = () => {
      late = [...containers.values()].find(item => item.State.Status === 'created')!;
      containers.delete(late.Id);
      offset += 610_000;
      throw lost();
    };
    await run('prepare');
    await expect(run('apply')).rejects.toThrow('allocation is still unconfirmed');
    expect(JSON.parse(await fs.readFile(path.join(directory, 'current.json'), 'utf8'))).toMatchObject({ phase: 'draining' });
    expect(await served()).toBe(previous.commit);
    expect(pids()).toEqual(ids);
    containers.set(late!.Id, late!);
    expect(await run('recover')).toMatchObject({ phase: 'aborted' });
    expect(events.map(value => value.startsWith('create ') ? 'create' : value)).toEqual(['create', 'remove ' + late!.Id]);
    expect([...containers.keys()]).toEqual([originalId]);
    expect(pids()).toEqual(ids);
  } finally { now.mockRestore(); }
});

it('starts the same immutable allocation after a definite stale-endpoint refusal and confirmed repair', async () => {
  const { run } = scenario();
  beforeStart = () => { beforeStart = () => {}; throw refused('endpoint with name ' + canonical + ' already exists in network omnitron'); };
  await run('prepare');
  expect(await run('apply')).toMatchObject({ phase: 'accepted' });
  expect(events.map(value => value.split(' ')[0])).toEqual(['create', 'admit', 'stop', 'rename', 'repair', 'start']);
  expect(inspect(canonical).Id).toBe(events.at(-1)!.split(' ')[1]);
});
