// RUN IN A DISPOSABLE LINUX INSTANCE. Mount the release read-only under a separate
// writable release store. Set OMNITRON_HOME to a fresh private directory before Node starts.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { fork, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { allocationInput } from '../commands/passive-allocation.js';
import { checkAllocationParents, stagePassiveAllocation } from './receiver.mjs';
import { buildSmokeRelease, activateSmoke } from './activation-fixture.mjs';

const [pkg, storeRoot, admittedId, admittedDeclarations, work] = process.argv.slice(2);
assert.equal(process.platform, 'linux');
assert.equal(process.env.OMNITRON_HOME, work);
assert.deepEqual(await fs.readdir(work), []);
const sdk = name => import(pathToFileURL(path.join(pkg, 'dist', name + '.js')).href);
const { targetRuntime } = await sdk('release/target-runtime');
const { ExecutionClient } = await sdk('daemon/execution-client');
const { DaemonStateStore } = await sdk('daemon/daemon-state-store.service');
const { ProjectService } = await sdk('services/project.service');
const { DaemonRpcService } = await sdk('daemon/daemon.rpc-service');
const { ProjectRpcService } = await sdk('services/project.rpc-service');
const { createDaemonClient } = await sdk('daemon/daemon-client');
const { assertPrivateControlSocket } = await sdk('daemon/private-control-client');
const { DEFAULT_ECOSYSTEM, DEFAULT_DAEMON_CONFIG } = await sdk('config/defaults');
const { loadRelease } = await sdk('release/load');
const { renderNodeAppConfig } = await sdk('project/node-app-config');
const { prepareNodeConfigPublication } = await sdk('services/node-registration');
const { inspectLocalReleaseInstallation } = await sdk('release/local-installation');
const { readInstalledReleaseReceipt } = await sdk('release/installed-origin');
const { assertSameApplicationRuntime } = await sdk('services/host-upgrade');
const { inspectStackContainers, listManagedContainers } = await sdk('infrastructure/container-runtime');
const { confirmStoppedPlacement } = await sdk('project/remote-placement');
const require = createRequire(path.join(pkg, 'package.json'));
const subpkg = name => import(pathToFileURL(require.resolve(name)));
const { Netron } = await subpkg('@omnitron-dev/titan/netron');
const { UnixSocketTransport } = await subpkg('@omnitron-dev/titan/netron/transport/unix');
const { AuthenticationManager, AuthorizationManager } = await subpkg('@omnitron-dev/titan/netron/auth');
const logger = { debug() {}, info() {}, warn() {}, error() {}, trace() {}, fatal() {}, child() { return this; } };
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const log = line => process.stderr.write(line + '\n');
const target = await targetRuntime(), build = JSON.parse(await fs.readFile(path.join(pkg, 'dist/BUILD.json'), 'utf8'));
const smoke = process.env.PASSIVE_ACTIVE_SMOKE === '1';
const replace = process.env.PASSIVE_REPLACEMENT_SMOKE === '1';
if (replace) assert.ok(smoke, 'Replacement rehearsal requires the synthetic active fixture');
const id = smoke ? 'passive-smoke-' + Date.now() : admittedId;
const declarationsFile = smoke ? path.join(work, 'smoke-capture.json') : admittedDeclarations;
if (smoke) await buildSmokeRelease(sdk, work, storeRoot, id, declarationsFile, target, build.commit);
const bytes = await fs.readFile(declarationsFile), capture = JSON.parse(bytes);
const prepared = { protocol: 1, project: capture.project, stack: capture.stack, commit: capture.commit, release: id,
  manifestSha256: capture.manifestSha256, declarationsSha256: sha(bytes), nodeId: capture.config.stacks[capture.stack].nodes[0].nodeId,
  sshFingerprint: 'SHA256:' + 'Q'.repeat(43), digest: sha('isolated fixture admission') };
const options = { fromNode: 'previous-fixture', user: 'fixture', uid: process.getuid(), backend: sha('fixture backend'), ownerArtifact: sha('fixture owner') };
const spec = allocationInput(prepared, bytes, { ...options, expectPrepared: prepared.digest });
const { project, stack } = prepared, configDir = path.join(replace ? '/opt/omnitron/projects' : path.join(work, 'projects'), project), ownerDir = path.join(work, 'owner');
const report = { protocol: 1, release: id, target, commit: build.commit, checks: [] };
const check = (name, value = true) => { report.checks.push({ name, value }); log(name); };
const phases = path.join(work, 'progress.json');
const save = () => fs.writeFile(phases, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
await fs.mkdir(ownerDir, { mode: 0o700 }); await fs.mkdir(path.dirname(configDir), { mode: 0o700 });
const boot = path.join(ownerDir, 'boot.json');
await fs.writeFile(boot, JSON.stringify({ directory: ownerDir, cwd: ownerDir, config: { ...DEFAULT_ECOSYSTEM, apps: [] },
  daemonConfig: { ...DEFAULT_DAEMON_CONFIG, logDir: path.join(work, 'logs') } }), { mode: 0o600 });
const ownerLog = await fs.open(path.join(work, 'owner.log'), 'a', 0o600);
const worker = fork(path.join(pkg, 'dist/daemon/execution-entry.js'), [boot], {
  cwd: ownerDir, execArgv: [], stdio: ['ignore', ownerLog.fd, ownerLog.fd, 'ipc'],
});
const ended = once(worker, 'exit'); await ownerLog.close();
const client = new ExecutionClient(path.join(ownerDir, 'owner.sock'), logger);
const endpoint = new Netron(logger, { id: 'passive-qualification' }), socket = path.join(work, 'daemon.sock');
const api = createDaemonClient(socket);
let db;
try {
  const [ready] = await Promise.race([once(worker, 'message'), ended.then(() => { throw Error('Fixture execution owner exited during startup'); })]);
  assert.equal(ready.type, 'execution-ready');
  const connected = await client.connect(), grant = await client.acquire();
  assert.equal(connected.status.owner.pid, worker.pid);
  db = new DaemonStateStore(logger, path.join(work, 'data/controller.db'));
  const service = new ProjectService(logger, client.orchestrator, db);
  endpoint.registerTransport('unix', () => new UnixSocketTransport());
  endpoint.registerTransportServer('unix', { name: 'project-test', options: { path: socket, force: false, mode: 0o600 } });
  endpoint.configureAuth(new AuthenticationManager(logger, { authenticate: async () => { throw Error('Private fixture socket required'); },
    validateToken: async () => { throw Error('No token accepted'); }, tokenCache: { enabled: false } }), new AuthorizationManager(logger));
  endpoint.setTransportAuthContext('unix', { userId: 'fixture-local', roles: ['admin'], permissions: [] });
  await endpoint.peer.exposeService(new DaemonRpcService(client.orchestrator, undefined, undefined, DEFAULT_ECOSYSTEM));
  await endpoint.peer.exposeService(new ProjectRpcService(service));
  await endpoint.start();
  await assertPrivateControlSocket(socket);
  const projects = await api.service('OmnitronProject');
  const owner = async () => {
    await client.refresh();
    assert.equal(await fs.realpath('/proc/' + worker.pid + '/exe'), await fs.realpath(process.execPath));
    return { root: pkg, executable: process.execPath, commit: build.commit, target,
      execution: { mode: 'resident', protocol: 1, ownerId: connected.status.owner.id, pid: worker.pid, epoch: grant.epoch } };
  };
  const ports = { owner, sameOwner: assertSameApplicationRuntime, projects,
    checkParents: name => checkAllocationParents(path.join(work, 'active'), path.dirname(configDir), name, replace),
    processes: async () => { await client.refresh(); return client.orchestrator.list(); },
    containers: () => listManagedContainers({ orThrow: true }), render: renderNodeAppConfig, publication: prepareNodeConfigPublication,
    install: inspectLocalReleaseInstallation, readReceipt: readInstalledReleaseReceipt, loadRelease: r => loadRelease(r, storeRoot) };
  const scope = { project, stack, applications: true };
  await assert.rejects(service.inspectNodeStackStop(scope), /no verified source-stack binding/);
  check('an unregistered recipient cannot be stopped as an application allocation'); await save();
  const unexpected = path.join(path.dirname(configDir), 'existing-allocation');
  await fs.mkdir(unexpected, { mode: 0o700 });
  await assert.rejects(stagePassiveAllocation(spec, configDir, ports), /Operational allocation directory/);
  await fs.rmdir(unexpected);
  const receipt = await stagePassiveAllocation(spec, configDir, ports);
  report.receipt = receipt; check('all frozen application trees registered over the private project socket', receipt.trees.length); await save();
  assert.equal((await projects.getProject({ name: project })).runningStacks, 0);
  const mtime = (await fs.stat(path.join(configDir, 'omnitron.config.mjs'), { bigint: true })).mtimeNs;
  for (const opts of [{}, { release: id }, { workingTree: true }])
    await assert.rejects(projects.startStack({ project, stack: 'deployed', ...opts }));
  assert.deepEqual(await ports.processes(), []);
  check('ordinary and explicit local starts left zero handles'); await save();
  assert.deepEqual(await stagePassiveAllocation(spec, configDir, ports), receipt);
  assert.equal((await fs.stat(path.join(configDir, 'omnitron.config.mjs'), { bigint: true })).mtimeNs, mtime);
  check('passive retry verified the same trees and preserved publication identity'); await save();
  const host = 'receiver.fixture', end = { nodeId: prepared.nodeId, host, port: 9700, pin: sha('fixture pin') };
  const stop = async (expectedContainers = []) => {
    const plan = await service.prepareNodeStackStop(scope);
    assert.deepEqual(plan.containers.map(c => c.id), expectedContainers);
    assert.deepEqual(plan.execution.apps, []);
    const ack = await service.executeNodeStackStop({ project, stack, operationId: plan.operationId });
    const after = await service.inspectNodeStackStop(scope);
    // The controller stores these fields from the native prepare and execute acknowledgements.
    const progress = { id: plan.operationId, phase: 'stopped', intentCommitted: true, completedAt: ack.observedAt, nodes: [
      { node: host + ':9700', nodeId: end.nodeId, outcome: 'stopped', operationId: ack.operationId,
        observedAt: ack.observedAt, definition: plan.definition, execution: ack.applications },
    ] };
    confirmStoppedPlacement(scope, end, progress, after);
    return { operation: ack.operationId, revision: ack.applications.revision, removed: ack.removedContainers, physical: after.containers.length };
  };
  report.immediateStop = await stop();
  check('native full stop on the disabled allocation verified the owner revision and empty footprint'); await save();
  if (process.env.PASSIVE_FIXTURE_CONTAINER_IMAGE) {
    const id = execFileSync('docker', ['create', '--network', 'none', '--label', 'omnitron.managed=true',
      '--label', 'omnitron.project=' + project, '--label', 'omnitron.stack=' + stack, process.env.PASSIVE_FIXTURE_CONTAINER_IMAGE, 'true'], { encoding: 'utf8' }).trim();
    assert.match(id, /^[a-f0-9]{64}$/);
    try {
      await assert.rejects(stagePassiveAllocation(spec, configDir, ports), /physical stack containers/);
      report.partialStop = await stop([id]); assert.deepEqual(report.partialStop.removed, [id]);
      assert.equal(report.partialStop.physical, 0);
      check('full stop retired the single real allocation created by partial provisioning'); await save();
    } finally {
      if ((await inspectStackContainers(scope)).some(c => c.id === id)) execFileSync('docker', ['rm', id]);
    }
  }
  let latest = spec;
  if (replace) {
    const second = id + '-next', file = path.join(work, 'next-capture.json');
    await buildSmokeRelease(sdk, work, storeRoot, second, file, target, build.commit);
    const input = await fs.readFile(file), recorded = JSON.parse(input);
    const next = { ...prepared, release: second, manifestSha256: recorded.manifestSha256, declarationsSha256: sha(input), digest: sha(input) };
    latest = allocationInput(next, input, { ...options, expectPrepared: next.digest, replaces: receipt, expectReplaced: receipt.ticket });
    ports.fingerprint = (await sdk('project/node-stack-stop')).stackDefinitionFingerprint;
    const before = (await fs.stat(configDir)).ino;
    report.replacement = await stagePassiveAllocation(latest, configDir, ports);
    assert.notEqual(report.replacement.definitionSha256, receipt.definitionSha256);
    assert.equal(report.replacement.replaced, receipt.ticket);
    assert.deepEqual(await stagePassiveAllocation(latest, configDir, ports), report.replacement);
    assert.equal((await fs.stat(path.join(path.dirname(configDir), '.passive-replacements', latest.ticket, 'exchange'))).ino, before);
    report.replacementStop = await stop();
    check('same-path project reread and complete native stop confirmed the replacement release and preserved the previous inode'); await save();
  }
  if (smoke) {
    report.active = await activateSmoke({ sdk, pkg, work, release: await ports.loadRelease(latest.prepared.release), owner, client, logger, project, stack, dir: configDir });
    check('ordinary remote registration and CLI started only the synthetic programs from their active frozen trees'); await save();
  } else {
    const config = (await import(pathToFileURL(path.join(configDir, 'omnitron.config.mjs')))).default;
    const live = config.apps.map(app => ({ ...app, enabled: true, env: { FIXTURE_RESOURCE: 'synthetic' } }));
    const artifacts = live.map(a => ({ app: a.name, version: '2', directory: 'active', launch: { mode: a.bootstrap ? 'bootstrap' : 'script', file: 'fixture.js' } }));
    const active = prepareNodeConfigPublication({ directory: configDir, project, operation: 'ordinary-active', artifacts,
      body: renderNodeAppConfig({ project, sourceStack: stack, apps: live, artifacts, artifactRoot: path.join(work, 'active') }) });
    execFileSync('sh', ['-c', active.command], { input: active.stdin });
    const actual = (await import(pathToFileURL(path.join(configDir, 'omnitron.config.mjs')).href + '?active')).default;
    assert.equal(actual.stacks.deployed.release, undefined); assert.ok(actual.apps.every(a => a.enabled && a.env.FIXTURE_RESOURCE === 'synthetic'));
    await projects.addProject({ name: project, path: configDir });
  }
  const currentHandles = async () => (await ports.processes()).map(({ name, pid, generation }) => ({ name, pid, generation }));
  const activeHandles = await currentHandles();
  const activeStat = (await fs.stat(path.join(configDir, 'omnitron.config.mjs'), { bigint: true })).mtimeNs;
  await assert.rejects(stagePassiveAllocation(latest, configDir, ports), /allocation changed/);
  assert.equal((await fs.stat(path.join(configDir, 'omnitron.config.mjs'), { bigint: true })).mtimeNs, activeStat);
  assert.deepEqual(await currentHandles(), activeHandles);
  check('normal active publication replaced every passive gate and final retry preserved the active configuration'); await save();
  process.stdout.write(JSON.stringify(report) + '\n');
} finally {
  await api.disconnect(); await endpoint.stop().catch(() => {}); await client.close().catch(() => {});
  worker.kill('SIGTERM'); await ended; await db?.dispose();
}
