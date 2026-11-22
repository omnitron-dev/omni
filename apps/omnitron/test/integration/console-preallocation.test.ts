import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { once } from 'node:events';
import { spawn, type ChildProcess } from 'node:child_process';
import { beforeAll, beforeEach, afterAll, afterEach, expect, it, vi } from 'vitest';
import { createNullLogger } from '@omnitron-dev/titan/module/logger';
import { runtimeArtifactDigest } from '../../src/shared/runtime-artifact.js';
import { readRuntimeUpdateReceipt, runtimeUpdatePlanDigest, runRuntimeUpdate, type RuntimeUpdateActions } from '../../src/daemon/runtime-update.js';
import { runtimeUpdateActions, verifyRuntimeUpdateTarget } from '../../src/daemon/runtime-update-host.js';
import { readColdBatch } from '../../src/project/cold-stack-start.js';
import { ReviewedConsoleAllocation, consoleConfigIdentity, consoleSpecification } from '../../src/webapp/console-allocation.js';
import { generateNginxConfig, WebappService } from '../../src/webapp/webapp.service.js';
import { containerSpecHash, preparedContainer } from '../../src/infrastructure/container-runtime.js';
import type { RuntimeUpdatePlan, RuntimeUpdateReference } from '../../src/shared/dto/runtime-update.js';

const home = await vi.hoisted(async () => {
  const fs = await import('node:fs/promises'), os = await import('node:os');
  const instance = await fs.mkdtemp((await fs.realpath(os.tmpdir())) + '/omnitron-allocation-');
  vi.stubEnv('OMNITRON_HOME', instance);
  return instance;
});
vi.mock('../../src/config/defaults.js', async original => ({ ...await original<object>(), OMNITRON_HOME: home }));
// Native supervision is the boundary. The real down command observes its unloaded backend and leaves the
// instance's independent nginx alive. An unexpected fallback must never reach an installed host service.
vi.mock('../../src/commands/service.js', () => ({
  installedService: () => ({ scope: 'user' }),
  serviceBootout: () => events.push('stop ' + inspect(canonical).Id),
}));
vi.mock('../../src/commands/daemon-cmd.js', () => ({ daemonStop: () => { throw Error('Unexpected direct daemon shutdown'); } }));
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
let port: number, canonical: string, next: number, host: RuntimeUpdateActions;
const ownerStatus = Error('Owner inventory is beyond the isolated Console boundary');
let previous: RuntimeUpdateReference, target: RuntimeUpdateReference, configuration: Awaited<ReturnType<typeof consoleConfigIdentity>>;
const configFile = path.join(home, 'webapp/nginx/nginx.conf');
const retainedText = '# Legacy Console configuration\n';
const targetText = () => generateNginxConfig('host.docker.internal', port + 1, port + 2);
let onInspect: (ref: string) => void, beforeRemove: (id: string) => void, afterRemove: () => void, beforeRename: () => void, beforeCreate: () => Promise<void>, afterCreate: () => void, afterRename: () => void, beforeStart: () => void, afterStart: () => void, afterAdmission: () => void | Promise<void>;

function native(id: string, name: string, status: string, labels: Record<string, string>, mounts: string[], binding: string) {
  const [ip, hostPort, containerPort] = binding.split(':');
  const ports = { [containerPort + '/tcp']: [{ HostIp: ip, HostPort: hostPort }] };
  return { Id: id, Name: '/' + name, Config: { Image: 'nginx:alpine', Labels: labels },
    State: { Status: status, Health: { Status: 'healthy' } },
    HostConfig: { PortBindings: ports }, NetworkSettings: { Ports: status === 'running' ? ports : {}, Networks: { omnitron: {} } },
    Mounts: mounts.map(value => {
      const [source, Destination, mode] = value.split(':');
      const mount = path.isAbsolute(source!) ? { Type: 'bind', Source: source! }
        : { Type: 'volume', Name: source!, Source: '/var/lib/docker/volumes/' + source + '/_data' };
      return { ...mount, Destination: Destination!, RW: mode !== 'ro' };
    }) };
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
    case 'inspect': {
      const format = fields(args, '--format')[0];
      if (format?.includes('"Mounts":[')) {
        expect(format).toContain('$m.Type');
        expect(format).toContain('$m.Name');
      }
      onInspect(ref);
      return { stdout: JSON.stringify([inspect(ref)]) };
    }
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
    case 'rm': {
      expect(args).toEqual(['container', 'rm', '--force', '--', ref]);
      expect(inspect(ref).Id).toBe(ref);
      events.push('retire ' + ref);
      beforeRemove(ref);
      expect(containers.delete(ref)).toBe(true);
      afterRemove();
      return { stdout: ref };
    }
    case 'rename': {
      const item = inspect(args.at(-2)!);
      expect(args).toEqual(['container', 'rename', '--', item.Id, canonical]);
      if ([...containers.values()].some(value => value.Name === '/' + canonical)) throw refused('Canonical name is in use');
      beforeRename();
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
  const stamp = JSON.stringify({ commit, dirty: false, builtAt: '2026-11-01T00:00:00.000Z' });
  await fs.writeFile(path.join(root, 'BUILD.json'), stamp);
  const cli = path.join(stage, 'packages/0/dist/cli');
  await fs.mkdir(cli, { recursive: true });
  await fs.writeFile(path.join(cli, 'omnitron.js'), '// sealed fixture entry');
  await fs.writeFile(path.join(cli, '../BUILD.json'), stamp);
  await fs.writeFile(path.join(stage, 'node'), 'sealed fixture executable', { mode: 0o700 });
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
  host = await runtimeUpdateActions({
    instance: home, runtime: await verifyRuntimeUpdateTarget(path.join(home, 'runtime/releases', target.artifact)),
    async call(argv) { expect(argv).toEqual(['status']); throw ownerStatus; },
    async run(cwd, executable, args) {
      expect(cwd).toBe(home);
      expect(path.dirname(args[0]!)).toBe(path.join(path.dirname(executable), 'packages/0/dist/cli'));
      expect(args.slice(1)).toEqual(['down']);
      await (await import('../../src/commands/up.js')).downCommand();
      return '';
    },
  });
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
  onInspect = beforeRemove = afterRemove = beforeRename = afterCreate = afterRename = beforeStart = afterStart = afterAdmission = () => {};
  startApps();
});
afterEach(async () => { await stopApps(); await fs.rm(directory, { recursive: true, force: true }); });
afterAll(async () => { server.close(); await once(server, 'close'); await fs.rm(home, { recursive: true, force: true }); vi.unstubAllEnvs(); });

function scenario() {
  const scope = { project: 'fixture', stack: 'local' }, owner = 'd'.repeat(64);
  const ids = pids();
  const plan: RuntimeUpdatePlan = { protocol: 1, stackAdmissionProtocol: 1, instance: home, target, backupOperations: [], excluded: [], watches: [],
    consolePublication: { containerId: inspect(canonical).Id, address, port, configuration }, configuration: { basis: 'retained-next-start', sha256: 'f'.repeat(64) },
    before: { console: previous.artifact, consoleCommit: previous.commit, backend: owner, owner, guardian: owner, backendCommit: 'd'.repeat(40),
      ownerCommit: 'd'.repeat(40), scope: 'user', ownerId: 'original', ownerPid: 42, backendPid: 43, guardianPid: 44, revision: 1,
      ownerLifetime: '01234567-0000-0000-0000-000000000001:1234', retiredPids: ids },
    infrastructure: { schemaScope: 'node', digest: 'a'.repeat(64), containers: [], database: null },
    stacks: [{ ...scope, runtimeScope: scope, path: home, enabled: true, status: 'running', infrastructureMode: 'preserve', infrastructureReview: null,
      savedSelection: { kind: 'working-tree' }, selection: { kind: 'working-tree' }, startReview: '4'.repeat(64), apps: ids.map((pid, index) => ({
        name: String(index), handleKey: 'fixture/local/' + index, status: 'online', pid, generation: String(pid), health: 'healthy', release: null })) }] };
  const digest = runtimeUpdatePlanDigest(plan);
  const allocation = (direction: 'previous' | 'target') =>
    new ReviewedConsoleAllocation(home, digest, direction, direction === 'target' ? target : previous, plan.consolePublication!, target);
  const actions: RuntimeUpdateActions = {
    prepare: async () => plan,
    prepareConsole: (plan, direction) => host.prepareConsole(plan, direction),
    async admit() { events.push('admit'); await afterAdmission(); },
    async releaseAdmission(_, _digest, requested) { if (requested) events.push('release'); await allocation('target').discard(); },
    async validateStop(owner, forward, rollback) {
      if (forward) await allocation('target').verify();
      else await expect(host.validateStop(owner, undefined, rollback)).rejects.toBe(ownerStatus);
    },
    retireConsole: (plan, direction) => host.retireConsole(plan, direction),
    async stop(owner) { await host.stop(owner); await stopApps(); },
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
      await allocation(direction).assertPublished(inspect(canonical).Id);
      expect(await served()).toBe(release.commit);
      expect(inspect(canonical).Mounts).toContainEqual({ Type: 'bind', Source: dist(release), Destination: '/usr/share/nginx/html', RW: false });
      expect(pids()).toHaveLength(2);
      return { backend: release.artifact, owner: release.artifact, guardian: release.artifact, ownerId: direction, console: release, stacks: [], watches: [] };
    },
  };
  const run = (operation: 'prepare' | 'apply' | 'recover') =>
    runRuntimeUpdate({ operation, actions, directory, ...(operation !== 'prepare' && { digest }) });
  return { run, digest, allocation, ids, plan, actions };
}

it('verifies a prepared named volume by Docker name and rejects a different volume on the same target', async () => {
  const declaration = { ...consoleSpecification(home, dist(target), port, address), name: 'example-prepared',
    volumes: [{ source: 'example-data', target: '/data' }] };
  const creation = '830e43bc-c3c3-4e32-a951-70457ac541f8';
  const id = await preparedContainer(declaration, { operation: 'allocate', creation });
  await expect(preparedContainer(declaration, { operation: 'verify', creation, id })).resolves.toBe(id);
  Object.assign(inspect(id).Mounts[0]!, { Name: 'other-volume' });
  await expect(preparedContainer(declaration, { operation: 'verify', creation, id })).rejects.toThrow('native mounts differ');
});

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
  if (response === 'lost') afterCreate = afterRemove = afterRename = afterStart = () => { throw lost(); };
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
    'create', 'admit', 'stop ' + originalId, 'retire ' + originalId, 'rename ' + candidateId, 'start ' + candidateId,
    'create', 'stop ' + candidateId, 'retire ' + candidateId, 'rename ' + restoredId, 'start ' + restoredId,
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
  expect(events.map(value => value.split(' ')[0])).toEqual(['create', 'admit', 'stop', 'retire', 'rename', 'repair', 'start']);
  expect(inspect(canonical).Id).toBe(events.at(-1)!.split(' ')[1]);
});


it('restores through the public receipt when an older starter left the original nginx serving and the target staged', async () => {
  const { run, actions, allocation } = scenario();
  const start = actions.start, stop = actions.stop, retire = actions.retireConsole;
  let failedCandidate = false;
  actions.retireConsole = async (plan, direction) => { if (direction === 'previous') await retire(plan, direction); };
  actions.start = async (destination, plan, restoration) => {
    if ('artifact' in destination) {
      failedCandidate = true;
      expect(await served()).toBe(previous.commit);
      throw Error('Earlier cold starter could not publish over the surviving incumbent');
    }
    await start(destination, plan, restoration);
  };
  actions.canRestore = async () => !failedCandidate;
  actions.stop = async owner => { await stop(owner); failedCandidate = false; };
  await run('prepare');
  await expect(run('apply')).rejects.toThrow('was rolled-back');
  const receipt = JSON.parse(await fs.readFile(path.join(directory, 'current.json'), 'utf8'));
  expect(receipt).toMatchObject({ phase: 'rolled-back', rollbackOwner: { ownerId: 'candidate' }, acceptance: { console: previous } });
  expect(await served()).toBe(previous.commit);
  expect(events.filter(e => e.startsWith('retire'))).toEqual(['retire ' + originalId]);
  expect(events.filter(e => e.startsWith('start'))).toEqual(['start ' + inspect(canonical).Id]);
  await allocation('target').discard(true);
  expect([...containers.keys()]).toEqual([inspect(canonical).Id]);
});

it.each(['target', 'previous'] as const)('keeps a same-instance foreign canonical ID untouched during %s handoff', async direction => {
  const { run, allocation, plan } = scenario();
  await run('prepare');
  await allocation('target').prepare(targetText());
  const selected = allocation(direction);
  if (direction === 'previous') await selected.prepare(targetText());
  const foreign = 'e'.repeat(64), incumbent = inspect(originalId);
  containers.delete(originalId);
  containers.set(foreign, { ...incumbent, Id: foreign });
  const before = events.length;
  await expect(host.retireConsole(plan, direction)).rejects.toThrow('another allocation');
  if (direction === 'previous') await expect(host.validateStop(plan.before, undefined, plan)).rejects.toThrow('another allocation');
  await expect(selected.publish(consoleSpecification(home, dist(direction === 'target' ? target : previous), port, address), targetText()))
    .rejects.toThrow('another allocation');
  expect(events.slice(before)).toEqual([]);
  expect(inspect(canonical).Id).toBe(foreign);
  expect(await fs.readFile(configFile, 'utf8')).toBe(retainedText);
});

it('observes an unresolved removal across rollback, and resumes only after the same immutable ID is absent', async () => {
  const { run, allocation } = scenario(), clock = performance.now.bind(performance);
  let offset = 0, pending = false;
  const now = vi.spyOn(performance, 'now').mockImplementation(() => clock() + offset);
  try {
    await run('prepare');
    const forward = allocation('target'), rollback = allocation('previous');
    await forward.prepare(targetText());
    beforeRemove = () => { pending = true; throw lost(); };
    onInspect = id => { if (pending && id === originalId) offset += 31_000; };
    await expect(forward.releaseCanonical()).rejects.toThrow('removal is unconfirmed');
    await rollback.prepare(targetText());
    await expect(rollback.releaseCanonical()).rejects.toThrow('removal is unconfirmed');
    expect(events.filter(e => e.startsWith('retire'))).toEqual(['retire ' + originalId]);
    expect(await served()).toBe(previous.commit);
    containers.delete(originalId); // Docker completes the earlier exact-ID request.
    await rollback.publish(consoleSpecification(home, dist(previous), port, address), targetText());
    expect(await served()).toBe(previous.commit);
    expect(events.filter(e => e.startsWith('retire'))).toEqual(['retire ' + originalId]);
    expect(events.filter(e => e.startsWith('start'))).toHaveLength(1);
  } finally { now.mockRestore(); }
});


it.each(['rename', 'start'] as const)('allows rollback of an issued forward %s only after Docker confirms its effect', async effect => {
  const { run, allocation } = scenario(), clock = performance.now.bind(performance);
  let offset = 0;
  const now = vi.spyOn(performance, 'now').mockImplementation(() => clock() + offset);
  try {
    await run('prepare');
    const forward = allocation('target'), rollback = allocation('previous');
    await forward.prepare(targetText());
    const staged = [...containers.values()].find(item => item.State.Status === 'created')!;
    const unanswered = () => { offset += 610_000; throw lost(); };
    if (effect === 'rename') beforeRename = unanswered;
    else beforeStart = unanswered;
    await expect(forward.publish(consoleSpecification(home, dist(target), port, address), targetText())).rejects.toThrow('unconfirmed');
    await rollback.prepare(targetText());
    await expect(rollback.predecessor()).rejects.toThrow('unconfirmed');
    expect(events.filter(e => e.startsWith('retire'))).toEqual(['retire ' + originalId]);
    if (effect === 'rename') staged.Name = '/' + canonical;
    else { staged.State.Status = 'running'; staged.NetworkSettings.Ports = staged.HostConfig.PortBindings; }
    expect(await rollback.predecessor()).toBe(staged.Id);
  } finally { now.mockRestore(); }
});

it('requires the published native ID even when a different Console serves the same reviewed build', async () => {
  const { run } = scenario();
  await run('prepare'); await run('apply');
  const candidate = inspect(canonical), foreign = 'f'.repeat(64);
  containers.delete(candidate.Id); containers.set(foreign, { ...candidate, Id: foreign });
  expect(await served()).toBe(target.commit);
  await expect(run('apply')).rejects.toThrow('differs from the published allocation');
  expect(inspect(canonical).Id).toBe(foreign);
});


it('keeps the first allocation timestamps visible while recovery rechecks the same native ID and starts fresh on a new plan', async () => {
  const { run, actions, digest } = scenario();
  await run('prepare');
  await run('apply');
  const validate = actions.validateStop;
  actions.validateStop = async (...args) => {
    await validate(...args);
    if (args[2]) throw Error('Fixture refused before process retirement');
  };
  await expect(run('recover')).rejects.toThrow('refused before retirement');
  const timing = (await readRuntimeUpdateReceipt(directory))!.consoleAllocation!.previous!;
  expect(timing).toEqual({ startedAt: expect.any(String), readyAt: expect.any(String) });
  const staged = [...containers.values()].find(item => item.State.Status === 'created')!;
  const creates = events.filter(e => e.startsWith('create'));
  const prepare = actions.prepareConsole;
  actions.prepareConsole = async (plan, direction) => {
    expect((await readRuntimeUpdateReceipt(directory))!.consoleAllocation!.previous).toEqual(timing);
    let inspected = false;
    onInspect = ref => { if (ref === staged.Id) inspected = true; };
    await prepare(plan, direction);
    expect(inspected).toBe(true);
  };
  actions.validateStop = validate;
  expect(await run('recover')).toMatchObject({ phase: 'rolled-back', consoleAllocation: { previous: timing } });
  expect(inspect(canonical).Id).toBe(staged.Id);
  expect(events.filter(e => e.startsWith('create'))).toEqual(creates);

  const fresh = scenario();
  expect(fresh.digest).not.toBe(digest);
  await fresh.run('prepare'); await fresh.run('apply'); await fresh.run('recover');
  const next = (await readRuntimeUpdateReceipt(directory))!.consoleAllocation!.previous!;
  expect(Date.parse(next.startedAt)).toBeGreaterThan(Date.parse(timing.readyAt!));
  expect(Date.parse(next.readyAt!)).toBeGreaterThanOrEqual(Date.parse(next.startedAt));
});

it.each(['rename', 'start'] as const)('can restore after Docker definitively refuses the forward %s without an effect', async effect => {
  const { run, allocation } = scenario();
  await run('prepare');
  const once = () => {
    beforeRename = beforeStart = () => {};
    throw refused('Error response from daemon: fixture operation rejected');
  };
  if (effect === 'rename') beforeRename = once;
  else beforeStart = once;
  await expect(run('apply')).rejects.toThrow('was rolled-back');
  expect(await served()).toBe(previous.commit);
  expect((await readRuntimeUpdateReceipt(directory))!.phase).toBe('rolled-back');
  await allocation('target').discard(true);
  expect([...containers.keys()]).toEqual([inspect(canonical).Id]);
  expect(events.filter(event => event.startsWith('start'))).toEqual(['start ' + inspect(canonical).Id]);
});
