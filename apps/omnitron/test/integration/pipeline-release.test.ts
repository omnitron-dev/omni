import { testExecution } from '../fixtures/execution.js';
import { createPipelineTestDatabase } from '../fixtures/pipeline-database.js';
import 'reflect-metadata';
import { afterEach, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { Netron, type RemotePeer } from '@omnitron-dev/titan/netron';
import { AuthenticationManager, AuthorizationManager } from '@omnitron-dev/titan/netron/auth';
import { HttpNativeServer } from '@omnitron-dev/titan/netron/transport/http';
import { createNullLogger } from '@omnitron-dev/titan/module/logger';
import { PipelineRpcService } from '../../src/services/pipeline.rpc-service.js';
import { FlowLedger } from '../../src/flows/flow-ledger.js';
import { hostFlowRuntime, flowWorkspaceReader } from '../../src/flows/host-flow-runtime.js';
import { FlowsRpcService } from '../../src/flows/flows.rpc-service.js';
import type { SavedFlow, FlowReceipt, FlowDefinition, OmnitronAuthUser } from '../../src/shared/dto/services.js';
import { createAuthContextWrapper } from '../../src/services/auth-context.js';
import type { IOmnitronPipelinesService } from '../../src/shared/dto/services.js';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { isDeepStrictEqual } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import Database from 'better-sqlite3';
import { Kysely, SqliteDialect, sql } from 'kysely';
import { create } from 'tar';
import { Pipeline as XecPipeline } from '@xec-sh/ops';
import { readProcessLifetime } from '@omnitron-dev/common/process-identity';
import { PipelineService } from '../../src/services/pipeline.service.js';
import { ProjectService } from '../../src/services/project.service.js';
import { DaemonStateStore } from '../../src/daemon/daemon-state-store.service.js';
import { withDateBinding } from '../../src/database/sqlite-date-binding.js';
import type { OmnitronDatabase } from '../../src/database/schema.js';
import type { ApplicationRuntime } from '../../src/services/host-upgrade.js';
import type { PipelineDef, PipelineStep } from '../../src/shared/dto/pipelines.js';
import { LocalReleaseSelection } from '../../src/project/local-release-selection.js';
import { DEFAULT_ECOSYSTEM } from '../../src/config/defaults.js';
import { inspectLocalReleaseInstallation } from '../../src/release/local-installation.js';
import { targetRuntime } from '../../src/release/target-runtime.js';
import { CLOSURE_FILE } from '../../src/release/application-closure.js';
import { releaseTreeDigest } from '../../src/release/runtime-provenance.js';
import { loadRelease } from '../../src/release/load.js';
import transition from '../fixtures/publication-owner-transition.json' with { type: 'json' };

const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const logger = { info() {}, error() {}, warn() {}, debug() {}, child() { return this; } };
const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { vi.unstubAllEnvs(); vi.restoreAllMocks(); for (const close of cleanup.splice(0).reverse()) await close(); });

/** Real SQLite, Git admission, archives, installation verifier, Node children and
 * Xec. Only registry/OS-service ownership discovery is supplied by the fixture;
 * native executable inspection still checks the two actual private owner PIDs. */
async function fixture(program = `
import fs from 'node:fs';
fs.appendFileSync(process.env.WITNESS, JSON.stringify({ pid: process.pid, executable: process.execPath, entry: import.meta.url,
  args: process.argv.slice(2), options: process.env.NODE_OPTIONS, search: process.env.NODE_PATH }) + '\\n');
console.log('release completed');
`, projectName = 'research') {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'pipeline-release-')));
  const children: ChildProcess[] = [];
  let pipelines: PipelineService | undefined, db: Kysely<OmnitronDatabase> | undefined, state: DaemonStateStore | undefined;
  cleanup.push(async () => {
    await pipelines?.dispose();
    for (const child of children) {
      if (child.exitCode === null && child.signalCode === null) {
        const exited = once(child, 'exit'); child.kill('SIGKILL'); await exited;
      }
    }
    await db?.destroy(); await state?.dispose(); await fs.rm(root, { recursive: true, force: true });
  });
  const runtime = await targetRuntime();
  const owners: ApplicationRuntime[] = [];
  for (const artifact of [transition.oldReceipt.ownerArtifact, transition.newReceipt.ownerArtifact]) {
    const directory = path.join(root, 'runtime', artifact), packageRoot = path.join(directory, 'packages/0');
    await fs.mkdir(packageRoot, { recursive: true });
    // A system Node may depend on its installation's rpath libraries. Execute
    // that real binary; the exact reported defect changes ownerPackage even
    // when the executable bytes/ABI are identical. Never copy an incomplete Node.
    const executable = process.execPath;
    const child = spawn(executable, ['-e', 'process.send("ready");setInterval(()=>{},1000)'], {
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'], env: { ...process.env, NODE_OPTIONS: '', NODE_PATH: '' },
    });
    children.push(child);
    let stderr = '';
    child.stderr!.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-4096); });
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('Fixture owner did not become ready: ' + stderr)), 5000);
      child.once('message', message => { clearTimeout(timer); message === 'ready' ? resolve() : reject(Error('Unexpected owner readiness')); });
      child.once('exit', code => { clearTimeout(timer); reject(Error('Fixture owner exited ' + code + ': ' + stderr)); });
      child.once('error', error => { clearTimeout(timer); reject(error); });
    });
    const birth = readProcessLifetime(child.pid!);
    if (birth.state !== 'alive') throw Error('Fixture owner has no native lifetime proof');
    owners.push({ root: packageRoot, executable, target: runtime, commit: 'b'.repeat(40),
      execution: { mode: 'resident', protocol: 1, ownerId: artifact, pid: child.pid!, epoch: 1, lifetime: birth.identity } });
  }
  let owner = owners[0]!;
  const repo = path.join(root, 'project'), payload = path.join(root, 'payload'), store = path.join(root, 'releases');
  await fs.mkdir(repo); await fs.mkdir(path.join(payload, 'dist'), { recursive: true });
  const app = { name: 'publication', script: 'dist/watch.mjs', cwd: '.', env: { WITNESS: path.join(root, 'witness') } };
  const config = { ...DEFAULT_ECOSYSTEM, apps: [app], stacks: { publication: { type: 'local' as const, apps: [app.name] } } };
  await fs.writeFile(path.join(repo, 'omnitron.config.mjs'), 'export default ' + JSON.stringify(config) + ';\n');
  const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
  git('init', '-q'); git('add', '.'); git('-c', 'user.name=fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'fixture');
  const commit = git('rev-parse', 'HEAD');
  await fs.writeFile(path.join(payload, 'dist/watch.mjs'), 'export {};\n');
  await fs.writeFile(path.join(payload, 'dist/publish.mjs'), program);
  const closure = JSON.stringify({ protocol: 1, runtime, nodeOptions: '', payloadSha256: await releaseTreeDigest(payload, true, false, [CLOSURE_FILE]) });
  await fs.writeFile(path.join(payload, CLOSURE_FILE), closure, { mode: 0o600 });
  const releaseId = 'publication-fixture', published = path.join(store, releaseId);
  await fs.mkdir(path.join(published, 'artifacts'), { recursive: true });
  const archive = path.join(published, 'artifacts/publication-1.tar.gz');
  await create({ file: archive, cwd: payload, gzip: true, portable: true }, ['dist', CLOSURE_FILE]);
  const bytes = await fs.readFile(archive);
  const manifest = { id: releaseId, project: { repo: 'fixture-project', commit }, omni: { repo: 'fixture-framework', commit: 'b'.repeat(40) },
    builtAt: new Date().toISOString(), gates: [{ name: 'test', status: 'passed' }], builtWith: { omnitron: 'fixture', packages: [], target: runtime },
    artifacts: [{ app: app.name, version: '1', bytes: bytes.length, sha256: hash(bytes), launch: { mode: 'script', file: 'dist/watch.mjs', closureSha256: hash(closure) } }] };
  await fs.writeFile(path.join(published, 'manifest.json'), JSON.stringify(manifest));
  const release = await loadRelease(releaseId, store);
  const installed = [];
  for (const item of owners) installed.push((await inspectLocalReleaseInstallation(release, 'publication', [app], {
    prepare: true, ownerPid: item.execution!.pid, ownerPackage: item.root, runtime,
    requiredFiles: { publication: ['dist/publish.mjs'] },
  }))[0]!);
  state = new DaemonStateStore(logger as never, path.join(root, 'state.sqlite'));
  const scope = { project: projectName, stack: 'publication' }, registered = { name: scope.project, path: repo, registeredAt: '2026-01-01T00:00:00Z' };
  const selection = new LocalReleaseSelection(state, scope, registered.registeredAt);
  selection.select(0, { id: release.id, manifestSha256: release.manifestSha256 });
  const getRuntime = vi.fn(async () => structuredClone(owner));
  const projects = Object.create(ProjectService.prototype) as ProjectService;
  Object.assign(projects, { logger, daemonStateStore: state, configRegistry: new Map([[scope.project, { config }]]),
    registry: { get: (name: string) => name === scope.project ? registered : undefined, resolveStack: (value: unknown) => value,
      registrations: (name:string) => name === scope.project ? [registered] : [] },
    nodeStackStop: { assertMutable() {} }, orchestrator: { getExecutionOwnerRuntime: getRuntime }, releaseStore: async () => store });
  db = createPipelineTestDatabase(path.join(root, 'pipelines.sqlite'));
  pipelines = new PipelineService(db, logger as never, testExecution);
  const gate = vi.fn();
  pipelines.configure({ getNode: () => undefined, nodeToSshTarget: async () => { throw Error('No remote execution'); } } as never, undefined,
    { projects, assertLifecycle: gate });
  const step: PipelineStep = { name: 'publish', kind: 'release', target: { ...scope, app: app.name, entry: 'dist/publish.mjs',
    artifact: { releaseId, manifestSha256: release.manifestSha256, artifactSha256: hash(bytes), producerApp: app.name, projectCommit: commit, frameworkCommit: 'b'.repeat(40) } },
    args: ['literal;$(touch unexpected)', 'with spaces'], retries: 0 };
  const definition: PipelineDef = { name: 'publication', steps: [step] };
  const terminal = async (id: string) => {
    for (let i = 0; i < 400; i++) {
      const run = await pipelines!.getRunStatus(id);
      if (run && !['running', 'pending', 'cancelling'].includes(run.status)) return run;
      await delay(25);
    }
    throw Error('Run failed to terminate');
  };
  return { root, repo, app, config, state, db, projects, pipelines, definition, step, gate, getRuntime, owners, installed, selection,
    selectOwner(index: number) { owner = owners[index]!; }, terminal,
    witness: async () => (await fs.readFile(app.env.WITNESS, 'utf8')).trim().split('\n').map(line => JSON.parse(line)),
    noEffects: async () => expect(await fs.stat(app.env.WITNESS).then(() => true, () => false)).toBe(false) };
}

it('admits a reviewed release flow over native Netron HTTP and observes one local child after a lost start reply and repeated input', async () => {
  const f = await fixture();
  const published = await f.pipelines.createPipeline(f.definition);
  const workspace = { project: 'research', stack: 'publication' };
  const ref = { workspace, id: randomUUID() };
  const auth = {
    validateSession: async (id: string) =>
      id === 'private-flow-session' ? ({ id: 'fixture-editor', role: 'admin' } as OmnitronAuthUser) : null,
  };
  const audit = { record: vi.fn(async () => {}) };
  const pipelines = new PipelineRpcService(f.pipelines, auth, audit);
  const start = pipelines.startRun.bind(pipelines);
  const lost = vi.spyOn(pipelines, 'startRun').mockImplementationOnce(async (request) => {
    await start(request);
    throw Error('Private fixture dropped the start reply');
  });
  const scope = flowWorkspaceReader(f.projects);
  const host = hostFlowRuntime(new FlowLedger(f.state.initSync()), {
    auth,
    pipelines,
    scope,
    admit: async () => {},
    studio: { postReceipt: vi.fn(), postIfNew: vi.fn() },
    report: (error) => {
      throw error;
    },
  });
  cleanup.push(() => host.dispose());
  const service = new FlowsRpcService(host, auth, audit, scope, async () => {});
  const log = createNullLogger(),
    netron = new Netron(log);
  cleanup.push(() => netron.stop());
  netron.configureAuth(
    new AuthenticationManager(log, {
      authenticate: async () => {
        throw Error('Private fixture credential required');
      },
      validateToken: async (token) => {
        if (token !== 'private-flow-admin' && token !== 'private-flow-viewer')
          throw Error('Unknown fixture credential');
        return {
          userId: 'fixture-editor',
          roles: [token.endsWith('admin') ? 'admin' : 'viewer'],
          permissions: [],
          metadata: { sessionId: 'private-flow-session' },
        };
      },
      tokenCache: { enabled: false },
    }),
    new AuthorizationManager(log)
  );
  await netron.start();
  await netron.peer.exposeService(service);
  const http = new HttpNativeServer({
    host: '127.0.0.1',
    port: 0,
    cors: false,
    invocationWrapper: createAuthContextWrapper(),
  });
  http.setPeer(netron.peer);
  await http.listen();
  cleanup.push(() => http.close());
  const call = async (method: string, input: unknown, role = 'admin') => {
    const response = await fetch('http://127.0.0.1:' + http.port + '/netron/invoke', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer private-flow-' + role },
      body: JSON.stringify({ id: randomUUID(), service: 'OmnitronFlows', method, input: [input] }),
    });
    const body = (await response.json()) as { success: boolean; data: unknown; error?: unknown };
    if (!response.ok || !body.success) throw Error(response.status + ' ' + JSON.stringify(body.error));
    return body.data;
  };
  const definition: FlowDefinition = {
    version: 1,
    name: 'Reviewed publication',
    nodes: [
      { id: 'signal', type: 'input.manual@1', config: {} },
      {
        id: 'publish',
        type: 'output.run-pipeline@1',
        config: { pipelineId: published.id, revision: published.revision },
      },
    ],
    edges: [{ from: 'signal', port: 'event', to: 'publish' }],
  };
  const save = { ...ref, definition, expectedRevision: null };
  await expect(call('save', save, 'viewer')).rejects.toThrow('403');
  const draft = (await call('save', save)) as SavedFlow;
  const active = (await call('activate', { ...ref, revision: draft.revision, activation: null })) as SavedFlow;
  const input = {
    ...ref,
    activation: active.active!.id,
    event: { id: randomUUID(), source: 'signal', type: 'manual', data: { operatorInput: 'synthetic' } },
  };
  const intent = (await call('submit', input)) as FlowReceipt;
  const delivery = intent.deliveries[0]!;
  await vi.waitFor(
    async () => {
      const history = (await call('history', ref)) as FlowReceipt[];
      expect(history[0]!.deliveries[0]).toMatchObject({ id: delivery.id, status: 'delivered', result: delivery.id });
    },
    { timeout: 15000 }
  );
  const run = await f.terminal(delivery.id);
  expect(run.status).toBe('success');
  expect(run.review?.parameterNames).toEqual([]);
  expect(run.review?.definitionRevision).toBe(published.revision);
  expect(run.steps[0]?.executions?.[0]?.state).toBe('completed');
  expect(((await call('submit', input)) as FlowReceipt).deliveries[0]!.id).toBe(delivery.id);
  expect(await f.pipelines.listRuns(published.id)).toHaveLength(1);
  expect(await f.witness()).toHaveLength(1);
  expect(lost).toHaveBeenCalledExactlyOnceWith({ runId: delivery.id, expectedDigest: run.review!.digest, params: {} });

  let allowStart!: () => void;
  const holdStart = new Promise<void>((resolve) => {
    allowStart = resolve;
  });
  let ownerChecking!: () => void;
  const waiting = new Promise<void>((resolve) => {
    ownerChecking = resolve;
  });
  const observed = vi.spyOn(pipelines, 'getRunStatus');
  // Prepare reaches the owner. Pause while its separate start is waiting for the final lifecycle check.
  f.gate
    .mockImplementationOnce(async () => {})
    .mockImplementationOnce(() => {
      ownerChecking();
      return holdStart;
    });
  const interrupted = (await call('submit', { ...input, event: { ...input.event, id: randomUUID() } })) as FlowReceipt;
  const held = interrupted.deliveries[0]!;
  try {
    await waiting;
    await call('deactivate', { ...ref, revision: draft.revision, activation: input.activation });
  } finally {
    allowStart();
  }
  await vi.waitFor(() => expect(observed.mock.calls.filter(([request]) => request.runId === held.id)).toHaveLength(2));
  await host.dispose();
  expect((await f.pipelines.getRunStatus(held.id))?.status).toBe('awaiting-review');
  expect(host.ledger.history(ref)[0]?.deliveries[0]).toMatchObject({
    id: held.id,
    status: 'unconfirmed',
    result: held.id,
  });
  expect(await f.witness()).toHaveLength(1);
});

it('models the owner transition: unchanged artifact and runtime, different installation binding', () => {
  expect(transition.oldReceipt.origin).toEqual(transition.newReceipt.origin);
  expect(transition.oldReceipt.target).toEqual(transition.newReceipt.target);
  expect(transition.oldReceipt.nodeOptions).toBe(transition.newReceipt.nodeOptions);
  expect(transition.matches).toEqual({ old: true, candidate: false });
  expect(transition.binding.old).not.toBe(transition.binding.candidate);
  expect(transition.oldReceipt.ownerArtifact).not.toBe(transition.newReceipt.ownerArtifact);
  expect(transition.oldReceipt.origin.artifactSha256).toBe('b'.repeat(64));
});

it('executes one registered definition through Xec under two owner roots without rewriting identity or history', async () => {
  const f = await fixture();
  // The frozen caller compares the literal shell/PATH definition; no path
  // normalization is used by the replacement contract or this comparison.
  const oldDefinition = (index: number) => ({ run: `${f.owners[index]!.executable} ${f.installed[index]!.releaseRoot}/dist/publish.mjs`,
    env: { PATH: path.dirname(f.owners[index]!.executable) } });
  expect(isDeepStrictEqual(oldDefinition(0), oldDefinition(1))).toBe(false);
  const pipeline = await f.pipelines.createPipeline(f.definition);
  const first = await f.terminal((await f.pipelines.executePipeline(pipeline.id, {}, 'reviewed', pipeline.revision)).id);
  expect(first.status).toBe('success');
  f.selectOwner(1);
  const second = await f.terminal((await f.pipelines.executePipeline(pipeline.id, {}, 'reviewed', pipeline.revision)).id);
  expect(second.status).toBe('success');
  expect(await f.pipelines.getPipeline(pipeline.id)).toEqual(pipeline);
  expect(await f.pipelines.listRuns(pipeline.id)).toHaveLength(2);
  expect(first.steps[0]!.sourceHash).toBe(second.steps[0]!.sourceHash);
  expect(first.steps[0]!.executions![0]!.installationRoot).not.toBe(second.steps[0]!.executions![0]!.installationRoot);
  expect(second.steps[0]!.executions![0]).toMatchObject({ state: 'completed', pid: expect.any(Number), owner: { id: f.owners[1]!.execution!.ownerId } });
  expect((await f.witness()).map(value => value.executable)).toEqual(f.owners.map(value => value.executable));
  expect((await f.witness())[1]).toMatchObject({ args: f.step.args, options: '', search: '' });
  expect(second.steps[0]!.output).toContain('release completed');
});

it.each(['artifact', 'entry', 'payload', 'node', 'options', 'symlink', 'unprepared', 'selection'])(
  'records rejection of %s drift without spawning the release child', async kind => {
    const f = await fixture();
    if (f.step.kind !== 'release') throw Error('fixture');
    if (kind === 'artifact') f.step.target.artifact = { ...f.step.target.artifact, artifactSha256: 'f'.repeat(64) };
    if (kind === 'entry') f.step.target.entry = 'dist/missing.mjs';
    if (kind === 'payload') await fs.writeFile(path.join(f.installed[0]!.releaseRoot!, 'dist/publish.mjs'), 'throw Error("changed");');
    if (kind === 'node') f.owners[0]!.target = { ...f.owners[0]!.target!, executableSha256: 'f'.repeat(64) };
    if (kind === 'options') f.app.env = { ...f.app.env, NODE_OPTIONS: '--require=./injected.js' } as typeof f.app.env;
    if (kind === 'symlink') { const file = path.join(f.installed[0]!.releaseRoot!, 'dist/publish.mjs'); await fs.unlink(file); await fs.symlink(path.join(f.repo, 'outside.mjs'), file); }
    if (kind === 'unprepared') await fs.rm(f.installed[0]!.releaseRoot!, { recursive: true });
    if (kind === 'selection') f.selection.select(1, null);
    const pipeline = await f.pipelines.createPipeline(f.definition);
    await expect(f.pipelines.executePipeline(pipeline.id, {}, 'reviewed', pipeline.revision)).rejects.toThrow();
    expect(await f.pipelines.listRuns(pipeline.id)).toMatchObject([{ status: 'failed' }]);
    await f.noEffects();
  });

it('rechecks the owner after admission and before every attempt, without retargeting', async () => {
  const f = await fixture();
  const original = f.projects.resolvePipelineRelease.bind(f.projects);
  vi.spyOn(f.projects, 'resolvePipelineRelease').mockImplementation(async (...args) => {
    const admitted = await original(...args);
    f.selectOwner(1);
    return admitted;
  });
  const pipeline = await f.pipelines.createPipeline(f.definition);
  const run = await f.terminal((await f.pipelines.executePipeline(pipeline.id, {}, 'reviewed', pipeline.revision)).id);
  expect(run.status).toBe('failed');
  expect(run.steps[0]!.error).toMatch(/changed after admission/);
  await f.noEffects();
});

it.each(['changed', 'missing'])('refuses %s native lifetime even with the same owner ID, PID and executable', async mode => {
  const f = await fixture();
  const original = f.projects.resolvePipelineRelease.bind(f.projects);
  vi.spyOn(f.projects, 'resolvePipelineRelease').mockImplementation(async (...args) => {
    const admitted = await original(...args);
    if (mode === 'changed') f.owners[0]!.execution!.lifetime += ':replaced';
    else delete f.owners[0]!.execution!.lifetime;
    return admitted;
  });
  const pipeline = await f.pipelines.createPipeline(f.definition);
  const run = await f.terminal((await f.pipelines.executePipeline(pipeline.id, {}, 'reviewed', pipeline.revision)).id);
  expect(run.status).toBe('failed');
  await f.noEffects();
});

it('correlates identical concurrent Commands by their preserved Xec onSpawn callback', async () => {
  const f = await fixture(`import fs from 'node:fs';
fs.appendFileSync(process.env.WITNESS, JSON.stringify({pid:process.pid})+'\\n');
await new Promise(resolve=>setTimeout(resolve,250)); console.log(process.pid);`);
  f.definition.steps = [{ ...f.step, name: 'first' }, { ...f.step, name: 'second' }];
  const pipeline = await f.pipelines.createPipeline(f.definition);
  const run = await f.terminal((await f.pipelines.executePipeline(pipeline.id, {}, 'reviewed', pipeline.revision)).id);
  expect(run.status).toBe('success');
  const children = (await f.witness()).map(item => item.pid).sort();
  const observed = run.steps.map(step => {
    expect(step.executions).toHaveLength(1);
    expect(step.executions![0]!.state).toBe('completed');
    expect(Number(step.output!.trim())).toBe(step.executions![0]!.pid);
    return step.executions![0]!.pid;
  }).sort();
  expect(new Set(observed).size).toBe(2);
  expect(observed).toEqual(children);
});

it.each(['missing', 'unknown'])('refuses %s Xec command correlation before child effects', async mode => {
  const f = await fixture();
  const original = XecPipeline.prototype.run;
  vi.spyOn(XecPipeline.prototype, 'run').mockImplementation(function withoutCorrelation(this: XecPipeline, context, options) {
    return original.call(this, context, { ...options, execute: command => {
      const changed = { ...command };
      if (mode === 'missing') delete changed.onSpawn;
      else changed.onSpawn = () => {};
      return options!.execute!(changed);
    } });
  });
  const pipeline = await f.pipelines.createPipeline(f.definition);
  const run = await f.terminal((await f.pipelines.executePipeline(pipeline.id, {}, 'reviewed', pipeline.revision)).id);
  expect(run.status).toBe('failed');
  expect(run.steps[0]!.error).toContain('did not retain the admitted pipeline command binding');
  expect(run.steps[0]!.executions).toBeUndefined();
  await f.noEffects();
});

it('keeps ordinary shell and Xec steps in the same known-command graph', async () => {
  const f = await fixture();
  f.definition.steps = [{ name: 'shell', run: 'printf "ordinary shell"' },
    { name: 'script', kind: 'xec', run: 'console.log("ordinary xec")' }, f.step];
  const pipeline = await f.pipelines.createPipeline(f.definition);
  const run = await f.terminal((await f.pipelines.executePipeline(pipeline.id, {}, 'reviewed', pipeline.revision)).id);
  expect(run.status).toBe('success');
  expect(run.steps[0]!.output).toBe('ordinary shell');
  expect(run.steps[1]!.output).toContain('ordinary xec');
  expect(run.steps[0]!.executions).toBeUndefined();
  expect(run.steps[1]!.executions).toBeUndefined();
  expect(run.steps[2]!.executions![0]!.state).toBe('completed');
});

it('uses Xec retry and bounded output while verifying every attempt', async () => {
  const f = await fixture(`import fs from 'node:fs';
const previous=fs.existsSync(process.env.WITNESS); fs.appendFileSync(process.env.WITNESS, JSON.stringify({pid:process.pid})+'\\n');
process.stdout.write('line\\n'.repeat(100000)); process.exitCode=previous?0:3;`);
  f.step.retries = 1;
  const pipeline = await f.pipelines.createPipeline(f.definition);
  const run = await f.terminal((await f.pipelines.executePipeline(pipeline.id, {}, 'reviewed', pipeline.revision)).id);
  expect(run.status).toBe('success');
  expect(run.steps[0]).toMatchObject({ attempts: 2, outputTruncated: true });
  expect(run.steps[0]!.executions!.map(item => [item.attempt, item.state])).toEqual([[1, 'completed'], [2, 'completed']]);
  expect(Buffer.byteLength(run.steps[0]!.output!)).toBeLessThanOrEqual(32768);
  expect(await f.witness()).toHaveLength(2);
});

it('waits for Xec cancellation and never starts a dependent release operation', async () => {
  const f = await fixture(`import fs from 'node:fs';
fs.appendFileSync(process.env.WITNESS, JSON.stringify({pid:process.pid})+'\\n'); await new Promise(resolve=>setTimeout(resolve,30000));`);
  f.definition.steps = [f.step, { ...f.step, name: 'dependent', dependsOn: [f.step.name] }];
  const pipeline = await f.pipelines.createPipeline(f.definition);
  const started = await f.pipelines.executePipeline(pipeline.id, {}, 'reviewed', pipeline.revision);
  let pid = 0;
  for (let i = 0; i < 200 && !pid; i++) {
    pid = await f.witness().then(items => items[0]?.pid ?? 0, () => 0); if (!pid) await delay(25);
  }
  expect(pid).toBeGreaterThan(0);
  await f.pipelines.cancelRun(started.id);
  expect((await f.pipelines.getRunStatus(started.id))!.status).toBe('cancelled');
  expect(() => process.kill(pid, 0)).toThrow();
  expect(await f.witness()).toHaveLength(1);
});

it('refuses a changed owner after effects and never retries an unconfirmed attempt', async () => {
  const f = await fixture();
  f.step.retries = 1;
  const original = f.projects.resolvePipelineRelease.bind(f.projects);
  vi.spyOn(f.projects, 'resolvePipelineRelease').mockImplementation(async (...args) => {
    const admitted = await original(...args); let checks = 0;
    return { ...admitted, verify: async () => { if (++checks === 2) f.selectOwner(1); await admitted.verify(); } };
  });
  const pipeline = await f.pipelines.createPipeline(f.definition);
  const run = await f.terminal((await f.pipelines.executePipeline(pipeline.id, {}, 'reviewed', pipeline.revision)).id);
  expect(run.status).toBe('failed');
  expect(run.steps[0]!.executions).toHaveLength(1);
  expect(run.steps[0]!.executions![0]!.state).toBe('unconfirmed');
  expect(await f.witness()).toHaveLength(1);
});

it('reconciles interrupted prepared/started attempts durably as unconfirmed without replaying effects', async () => {
  const f = await fixture();
  if (f.step.kind !== 'release') throw Error('fixture');
  const pipeline = await f.pipelines.createPipeline(f.definition);
  const operation = await f.projects.resolvePipelineRelease(f.step.target, { env: {} });
  await f.db.insertInto('pipeline_runs').values({ id: 'interrupted-fixture', pipelineId: pipeline.id, status: 'running',
    startedAt: new Date(), completedAt: null, triggeredBy: 'fixture', params: '{}',
    steps: JSON.stringify([{ name: 'publish', status: 'running', duration: 1, executions:
      ['prepared', 'started', 'completed'].map((state, index) => ({ ...operation.evidence, state, attempt: index + 1 })) }]),
  }).execute();
  const restarted = new PipelineService(f.db, logger as never, testExecution);
  await restarted.initialize();
  const observed = await restarted.getRunStatus('interrupted-fixture');
  expect(observed!.status).toBe('interrupted');
  expect(observed!.steps[0]!.executions!.map(attempt => attempt.state)).toEqual(['unconfirmed', 'unconfirmed', 'completed']);
  const row = await f.db.selectFrom('pipeline_runs').select('steps').where('id', '=', 'interrupted-fixture').executeTakeFirstOrThrow();
  if (typeof row.steps !== 'string') throw Error('Expected persisted SQLite JSON cell');
  expect(JSON.parse(row.steps)[0].executions.map((attempt: { state: string }) => attempt.state))
    .toEqual(['unconfirmed', 'unconfirmed', 'completed']);
  await restarted.dispose();
  await f.noEffects();
});

it('never retries successful child effects when durable completion fails', async () => {
  const f = await fixture();
  f.step.retries = 2;
  const diagnostics = vi.spyOn(logger, 'error');
  await sql.raw(`CREATE TRIGGER refuse_completed_attempt BEFORE UPDATE OF steps ON pipeline_runs
    WHEN NEW.steps LIKE '%"state":"completed"%'
    BEGIN SELECT RAISE(FAIL, 'fixture durable completion refused'); END`).execute(f.db);
  const pipeline = await f.pipelines.createPipeline(f.definition);
  const run = await f.terminal((await f.pipelines.executePipeline(pipeline.id, {}, 'reviewed', pipeline.revision)).id);
  expect(run.status).toBe('failed');
  expect(await f.witness()).toHaveLength(1);
  expect(run.steps[0]!.executions).toHaveLength(1);
  expect(run.steps[0]!.executions![0]!.state).toBe('unconfirmed');
  expect(diagnostics.mock.calls.some(call => JSON.stringify(call).includes('fixture durable completion refused'))).toBe(true);
});

it('rechecks lifecycle authority after journal admission before child effects', async () => {
  const f = await fixture();
  const original = f.projects.resolvePipelineRelease.bind(f.projects);
  vi.spyOn(f.projects, 'resolvePipelineRelease').mockImplementation(async (...args) => {
    const admitted = await original(...args);
    return { ...admitted, verify: async () => { await admitted.verify(); f.gate.mockImplementation(() => { throw Error('Controller handoff is in progress'); }); } };
  });
  const pipeline = await f.pipelines.createPipeline(f.definition);
  const run = await f.terminal((await f.pipelines.executePipeline(pipeline.id, {}, 'reviewed', pipeline.revision)).id);
  expect(run.status).toBe('failed');
  await f.noEffects();
});

it.each(['shell', 'xec'] as const)('awaits fresh lifecycle admission before ordinary %s child effects', async kind => {
  const f = await fixture();
  const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
  const source = "require('node:fs').writeFileSync(process.env.WITNESS,'effect')";
  f.definition.steps = [{ name: 'ordinary', kind, env: f.app.env, run: kind === 'shell'
    ? `${quote(process.execPath)} -e ${quote(source)}`
    : "import fs from 'node:fs'; fs.writeFileSync(process.env.WITNESS, 'effect');" }];
  let observations = 0;
  f.gate.mockImplementation(async () => {
    if (++observations < 4) return;
    await new Promise(resolve => setImmediate(resolve));
    throw Error('Owner grant was replaced after admission');
  });
  const pipeline = await f.pipelines.createPipeline(f.definition);
  const run = await f.terminal((await f.pipelines.executePipeline(pipeline.id, {}, 'reviewed', pipeline.revision)).id);
  expect(run.status).toBe('failed');
  expect(run.steps[0]!.error).toContain('Owner grant was replaced');
  expect(observations).toBe(4);
  await f.noEffects();
});

it.each(['LD_PRELOAD', 'LD_AUDIT', 'LD_LIBRARY_PATH', 'DYLD_INSERT_LIBRARIES', 'DYLD_FRAMEWORK_PATH'])(
  'refuses inherited %s before owner observation or child effects', async key => {
    const f = await fixture();
    const pipeline = await f.pipelines.createPipeline(f.definition);
    f.getRuntime.mockClear();
    vi.stubEnv(key, '/not-an-admitted-library');
    await expect(f.pipelines.executePipeline(pipeline.id, {}, 'reviewed', pipeline.revision)).rejects.toThrow(key);
    expect(f.getRuntime).not.toHaveBeenCalled();
    await f.noEffects();
  });

it('does not route a release step over SSH, accept shell source, or relax reviewed revisions', async () => {
  const f = await fixture();
  await expect(f.pipelines.createPipeline({ ...f.definition, steps: [{ ...f.step, nodeId: 'remote' }] })).rejects.toThrow('remote execution is unsupported');
  await expect(f.pipelines.createPipeline({ ...f.definition, steps: [{ ...f.step, run: 'echo injected' } as PipelineStep] })).rejects.toThrow('cannot contain shell');
  await expect(f.pipelines.createPipeline({ ...f.definition, steps: [{ ...f.step, env: { LD_PRELOAD: 'injected' } }] })).rejects.toThrow('LD_PRELOAD');
  const pipeline = await f.pipelines.createPipeline(f.definition);
  await expect(f.pipelines.executePipeline(pipeline.id, {}, 'reviewed', 'e'.repeat(64))).rejects.toThrow('changed after review');
  await f.noEffects();
});


it('recovers two independent projects through the same Titan/Netron/Xec path without repeating a lost acknowledgement', async () => {
  const a = await fixture(undefined, 'project-a'), b = await fixture(undefined, 'project-b');
  const resolver = { projectConfigurations: (project: string) => [{ name: project, path: project === 'project-a' ? a.repo : b.repo,
    registeredAt: '2026-01-01T00:00:00Z' }], resolvePipelineRelease: (target: Parameters<ProjectService['resolvePipelineRelease']>[0],
    options: Parameters<ProjectService['resolvePipelineRelease']>[1]) =>
    (target.project === 'project-a' ? a.projects : b.projects).resolvePipelineRelease(target, options) };
  const configure = (service: PipelineService) => service.configure({ getNode: () => null,
    nodeToSshTarget: async () => { throw Error('No remote host'); } }, undefined, { projects: resolver, assertLifecycle() {} });
  configure(a.pipelines);
  let service = a.pipelines;
  const auth = { validateSession: async () => ({ id: 'reviewer', role: 'admin' }) };
  const audit = { record: async () => {} };
  const log = createNullLogger();
  let loseReplyFor = '', discarded = false;
  let caller: Netron;
  const server = new Netron(log);
  cleanup.push(() => server.stop());
  server.configureAuth(new AuthenticationManager(log, {
    authenticate: credentials => {
      if (credentials.username !== 'reviewer' || credentials.password !== 'fixture') throw Error('Invalid fixture identity');
      return { userId: 'reviewer', roles: ['admin'], permissions: [], metadata: { sessionId: 'fixture-session' } };
    },
  }));
  const authContext = createAuthContextWrapper();
  server.registerTransportServer('tcp', { name: 'tcp', options: { host: '127.0.0.1', port: 0,
    invocationWrapper: async (metadata: Map<string, unknown>, fn: () => Promise<unknown>) => {
      const result = await authContext(metadata, fn);
      if (loseReplyFor && result && typeof result === 'object' && 'id' in result && result.id === loseReplyFor &&
        'status' in result && result.status === 'running') {
        // Actual receiver, sealed artifact and Xec child complete first. Drop the
        // real TCP connection before its acknowledgement reaches the caller.
        expect((await a.terminal(loseReplyFor)).status).toBe('success');
        discarded = true; loseReplyFor = ''; await caller.stop();
      }
      return result;
    },
  } });
  await server.start();
  await server.peer.exposeService(new PipelineRpcService(service, auth as never, audit));
  const connect = async () => {
    caller = new Netron(log);
    // Capture this instance, not the later restarted client, for cleanup.
    const client = caller; cleanup.push(() => client.stop());
    await client.start();
    const peer = await client.connect(`tcp://127.0.0.1:${server.transportServers.get('tcp')!.port}`) as RemotePeer;
    await peer.runTask('authenticate', { username: 'reviewer', password: 'fixture' });
    return peer.queryInterface<IOmnitronPipelinesService>('OmnitronPipelines');
  };
  let rpc = await connect();
  const pa = await rpc.createPipeline({ ...a.definition, name: 'delivery-a' });
  const pb = await rpc.createPipeline({ ...b.definition, name: 'delivery-b' });
  const requestA = { id: pa.id, runId: randomUUID(), expectedRevision: pa.revision, params: { token: 'private-fixture-input' } };
  const prepared = await rpc.prepareRun(requestA);
  expect(prepared.status).toBe('awaiting-review');
  expect(prepared.review?.projects).toEqual(['project-a']);
  expect(service.activeRunCount()).toBe(0);
  expect(JSON.stringify(prepared)).not.toContain('private-fixture-input');
  expect(JSON.stringify(prepared)).not.toContain('parameterKey');
  const runningB = await rpc.executePipeline({ id: pb.id, runId: randomUUID(), expectedRevision: pb.revision });
  expect((await a.terminal(runningB.id)).status).toBe('success');
  expect(await b.witness()).toHaveLength(1);
  await a.noEffects();
  const aScope = { project: 'project-a', stack: 'publication', limit: 1 };
  expect(await rpc.getPipeline({ id: pa.id, workspace: aScope })).toEqual(pa);
  expect(await rpc.getPipeline({ id: pb.id, workspace: aScope })).toBeNull();
  expect(await rpc.listWorkspace(aScope)).toMatchObject({ definitions: [{ id: pa.id }],
    runs: [{ id: prepared.id, pipelineName: 'delivery-a', status: 'awaiting-review' }] });
  expect(await rpc.listWorkspace({ ...aScope, project: 'project-b' })).toMatchObject({ definitions: [{ id: pb.id }],
    runs: [{ id: runningB.id, pipelineName: 'delivery-b', status: 'success' }] });
  expect(await rpc.listWorkspace({ ...aScope, stack: 'staging' })).toEqual({ definitions: [], runs: [] });
  loseReplyFor = prepared.id;
  const start = { runId: prepared.id, expectedDigest: prepared.review!.digest, params: requestA.params };
  await expect(rpc.startRun(start)).rejects.toThrow();
  expect(discarded).toBe(true);
  expect(await a.witness()).toHaveLength(1);

  // Recreate the receiver with a new connection to its durable database and a
  // new caller. No in-memory run, identity map or successful RPC reply survives.
  await service.dispose();
  await server.peer.unexposeService('OmnitronPipelines');
  const restoredDb = new Kysely<OmnitronDatabase>({ dialect: new SqliteDialect({
    database: withDateBinding(new Database(path.join(a.root, 'pipelines.sqlite'))),
  }) });
  cleanup.push(() => restoredDb.destroy());
  service = new PipelineService(restoredDb, log, testExecution); cleanup.push(() => service.dispose());
  configure(service); await service.initialize();
  await server.peer.exposeService(new PipelineRpcService(service, auth as never, audit));
  rpc = await connect();
  const recovered = await rpc.startRun(start);
  expect(recovered.status).toBe('success');
  expect(recovered.startedBy).toBe('reviewer');
  expect(recovered.steps[0]!.executions).toHaveLength(1);
  expect(await a.witness()).toHaveLength(1);
  expect((await rpc.prepareRun(requestA)).id).toBe(prepared.id);
  expect((await rpc.listWorkspace(aScope)).runs).toMatchObject([{ id: prepared.id, status: 'success' }]);
  await expect(rpc.prepareRun({ ...requestA, id: pb.id })).rejects.toThrow(/another pipeline command/);
  await expect(rpc.startRun({ ...start, params: { token: 'changed' } })).rejects.toThrow(/Parameters differ/);
});

it('retains an uncertain real effect across restart and refuses redelivery', async () => {
  const f = await fixture();
  const pipeline = await f.pipelines.createPipeline(f.definition);
  const request = { id: pipeline.id, runId: randomUUID(), expectedRevision: pipeline.revision };
  const prepared = await f.pipelines.prepareRun(request, 'reviewer');
  const execute = testExecution.execute.bind(testExecution);
  vi.spyOn(testExecution, 'execute').mockImplementationOnce(async command => {
    await execute(command);
    throw Error('Injected loss after child effect, before completion receipt');
  });
  const start = { runId: prepared.id, expectedDigest: prepared.review!.digest };
  const result = await f.terminal((await f.pipelines.startRun(start, 'reviewer')).id);
  expect(result.steps[0]!.executions?.[0]?.state).toBe('unconfirmed');
  expect(await f.witness()).toHaveLength(1);
  await f.pipelines.dispose();
  const recovered = new PipelineService(f.db, createNullLogger(), testExecution);
  cleanup.push(() => recovered.dispose()); await recovered.initialize();
  const receipt = await recovered.startRun(start, 'reviewer');
  expect(receipt.steps[0]!.executions?.[0]?.state).toBe('unconfirmed');
  expect(await f.witness()).toHaveLength(1);
});

it('keeps review durable, parameter-bound and cancellable without occupying an executor', async () => {
  const f = await fixture();
  const pipeline = await f.pipelines.createPipeline(f.definition);
  const request = { runId: randomUUID(), id: pipeline.id, expectedRevision: pipeline.revision,
    params: { beta: 2, alpha: 'secret-fixture-value' } };
  const prepared = await f.pipelines.prepareRun(request, 'reviewer');
  const reordered = await f.pipelines.prepareRun({ ...request, params: { alpha: 'secret-fixture-value', beta: 2 } }, 'reviewer');
  expect(reordered.review).toEqual(prepared.review);
  const stored = await f.db.selectFrom('pipeline_runs').select('admission').where('id', '=', prepared.id).executeTakeFirstOrThrow();
  expect(JSON.stringify(stored)).not.toContain('secret-fixture-value');
  await expect(f.pipelines.deletePipeline(pipeline.id)).rejects.toThrow('outstanding requests');
  await f.pipelines.dispose();
  const recovered = new PipelineService(f.db, createNullLogger(), testExecution); cleanup.push(() => recovered.dispose());
  await recovered.initialize();
  expect((await recovered.getRunStatus(prepared.id))?.status).toBe('awaiting-review');
  expect(recovered.activeRunCount()).toBe(0);
  await recovered.cancelRun(prepared.id);
  expect((await recovered.startRun({ runId: prepared.id, expectedDigest: prepared.review!.digest, params: request.params }, 'reviewer')).status).toBe('cancelled');
  await f.noEffects();
});

it('admits one execution under concurrent delivery and rejects changed approval bytes', async () => {
  const f = await fixture();
  const pipeline = await f.pipelines.createPipeline(f.definition);
  const prepared = await f.pipelines.prepareRun({ runId: randomUUID(), id: pipeline.id, expectedRevision: pipeline.revision }, 'reviewer');
  const start = { runId: prepared.id, expectedDigest: prepared.review!.digest };
  await expect(f.pipelines.startRun({ ...start, expectedDigest: '0'.repeat(64) }, 'reviewer')).rejects.toThrow('exact pipeline admission');
  const results = await Promise.all(Array.from({ length: 16 }, () => f.pipelines.startRun(start, 'reviewer')));
  expect(results.every(result => result.id === prepared.id)).toBe(true);
  expect((await f.terminal(prepared.id)).status).toBe('success');
  expect(await f.witness()).toHaveLength(1);
});

it('reserves capacity per registered project and leaves another project free to finish', async () => {
  const a = await fixture(`import fs from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
fs.appendFileSync(process.env.WITNESS, '{}\\n');
while (!fs.existsSync(process.env.GATE)) await delay(25);
`, 'capacity-a');
  const b = await fixture(undefined, 'capacity-b');
  const gate = path.join(a.root, 'continue'); Object.assign(a.app.env, { GATE: gate });
  a.pipelines.configure({ getNode: () => null, nodeToSshTarget: async () => { throw Error('fixture'); } }, undefined, {
    projects: { resolvePipelineRelease: (target, options) =>
      (target.project === 'capacity-a' ? a.projects : b.projects).resolvePipelineRelease(target, options) }, assertLifecycle() {},
  });
  const pa = await a.pipelines.createPipeline({ ...a.definition, name: 'capacity-a' });
  const pb = await a.pipelines.createPipeline({ ...b.definition, name: 'capacity-b' });
  try {
    const first = await a.pipelines.executePipeline(pa.id, {}, 'reviewer', pa.revision);
    const second = await a.pipelines.executePipeline(pa.id, {}, 'reviewer', pa.revision);
    const pending = await a.pipelines.prepareRun({ runId: randomUUID(), id: pa.id, expectedRevision: pa.revision }, 'reviewer');
    await expect(a.pipelines.startRun({ runId: pending.id, expectedDigest: pending.review!.digest }, 'reviewer')).rejects.toThrow('capacity');
    expect((await a.pipelines.getRunStatus(pending.id))?.status).toBe('awaiting-review');
    const independent = await a.pipelines.executePipeline(pb.id, {}, 'reviewer', pb.revision);
    expect((await a.terminal(independent.id)).status).toBe('success');
    expect((await a.pipelines.getRunStatus(first.id))?.status).toBe('running');
    expect((await a.pipelines.getRunStatus(second.id))?.status).toBe('running');
    await a.pipelines.cancelRun(pending.id);
    await fs.writeFile(gate, 'continue');
    expect((await a.terminal(first.id)).status).toBe('success');
    expect((await a.terminal(second.id)).status).toBe('success');
    expect(await a.witness()).toHaveLength(2);
    expect(await b.witness()).toHaveLength(1);
  } finally { await fs.writeFile(gate, 'continue'); }
});


it('finishes cancellation during admission instead of leaving the request cancelling', async () => {
  const f = await fixture();
  const pipeline = await f.pipelines.createPipeline(f.definition);
  const prepared = await f.pipelines.prepareRun({ runId: randomUUID(), id: pipeline.id, expectedRevision: pipeline.revision }, 'reviewer');
  let enter!: () => void, release!: () => void;
  const entered = new Promise<void>(resolve => { enter = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  f.gate.mockImplementationOnce(async () => { enter(); await gate; });
  const starting = f.pipelines.startRun({ runId: prepared.id, expectedDigest: prepared.review!.digest }, 'reviewer');
  const rejected = expect(starting).rejects.toThrow('Cancelled');
  await entered;
  const cancelling = f.pipelines.cancelRun(prepared.id);
  await new Promise(resolve => setImmediate(resolve));
  release();
  await rejected; await cancelling;
  expect((await f.pipelines.getRunStatus(prepared.id))?.status).toBe('cancelled');
  expect(f.pipelines.activeRunCount()).toBe(0);
  await f.noEffects();
});

it('continues a pinned graph after a checkpoint acknowledgement fails without rerunning the completed effect', async () => {
  const f = await fixture();
  const definition = await f.pipelines.createPipeline({ name: 'recoverable', steps: [f.step,
    { name: 'after', kind: 'xec', dependsOn: [f.step.name], cwd: f.root,
      run: "import fs from 'node:fs'; fs.appendFileSync('after', 'once\\n');" }] });
  const originalUpdate = f.db.updateTable.bind(f.db);
  let interrupted = false;
  const hook = vi.spyOn(f.db, 'updateTable').mockImplementation(((table: never) => {
    const wrap = (builder: any): any => new Proxy(builder, { get(target, key) {
      const value = Reflect.get(target, key);
      if (typeof value !== 'function') return value;
      if (key === 'execute') return async () => {
        const compiled = target.compile();
        const checkpoint = compiled.parameters.find((item: unknown) => typeof item === 'string' && item.startsWith('[{') && item.includes('"status":"success"'));
        const result = await value.call(target);
        if (!interrupted && table === 'pipeline_runs' && checkpoint) {
          interrupted = true;
          throw Error('Lost acknowledgement after durable step completion');
        }
        return result;
      };
      return (...args: unknown[]) => { const next = value.apply(target, args); return next && typeof next.compile === 'function' ? wrap(next) : next; };
    } });
    return wrap(originalUpdate(table));
  }) as never);
  const started = await f.pipelines.executePipeline(definition.id, {}, 'operator', definition.revision);
  const failed = await f.terminal(started.id);
  hook.mockRestore();
  expect(interrupted).toBe(true);
  expect(failed.status).toBe('failed');
  expect(failed.recovery).toMatchObject({ completed: [f.step.name], pending: ['after'], blocked: [] });
  expect(await f.witness()).toHaveLength(1);
  // Changing the editable definition cannot change the already reviewed remaining graph.
  await f.db.updateTable('pipelines').set({ steps: JSON.stringify([{ name: 'replacement', run: 'exit 99' }]) }).where('id', '=', definition.id).execute();
  const recovered = new PipelineService(f.db, logger as never, testExecution);
  cleanup.push(() => recovered.dispose());
  recovered.configure({} as never, undefined, { projects: f.projects, assertLifecycle: f.gate });
  const request = { runId: started.id, expectedDigest: failed.recovery!.digest };
  await expect(recovered.resumeRun({ ...request, expectedDigest: 'f'.repeat(64) }, 'operator')).rejects.toThrow('checkpoint');
  await Promise.all(Array.from({ length: 8 }, () => recovered.resumeRun(request, 'operator')));
  for (let i = 0; i < 200 && (await recovered.getRunStatus(started.id))?.status === 'running'; i++) await delay(25);
  expect((await recovered.getRunStatus(started.id))?.status).toBe('success');
  expect(await f.witness()).toHaveLength(1);
  expect(await fs.readFile(path.join(f.root, 'after'), 'utf8')).toBe('once\n');
  expect((await recovered.resumeRun(request, 'operator')).status).toBe('success');
});

it('reconciles a lost remote deployment response through native project inspection before continuing', async () => {
  const f = await fixture();
  const target = { project: 'remote', stack: 'test', releaseId: 'sealed', manifestSha256: 'a'.repeat(64), review: 'b'.repeat(64) };
  const evidence = { target, scope: { project: 'remote', stack: 'test', registeredAt: '2026-01-01T00:00:00Z' }, expected: [{ node: 'test-node', app: 'api', releaseId: 'sealed', manifestSha256: 'a'.repeat(64), artifactSha256: 'c'.repeat(64) }], state: 'prepared' as const };
  let deployed = false, reachable = false;
  const dispatch = vi.fn(async () => { deployed = true; throw Error('Connection closed after deployment'); });
  const inspect = vi.fn(async () => ({ basis: 'observed-target' as const, observedAt: new Date().toISOString(), confirmed: deployed && reachable,
    apps: [{ node: 'test-node', app: 'api', launchId: deployed && reachable ? 'launch' : null, matches: deployed && reachable }] }));
  f.pipelines.configure({} as never, undefined, { projects: { resolvePipelineRelease: f.projects.resolvePipelineRelease.bind(f.projects),
    resolvePipelineDeployment: async () => ({ evidence, execute: dispatch }), inspectPipelineDeployment: inspect }, assertLifecycle: f.gate });
  const pipeline = await f.pipelines.createPipeline({ name: 'delivery', steps: [
    { name: 'deploy', kind: 'deploy', target }, { name: 'verify', kind: 'xec', dependsOn: ['deploy'], cwd: f.root,
      run: "import fs from 'node:fs'; fs.appendFileSync('verified', 'once\\n');" }] });
  const failed = await f.terminal((await f.pipelines.executePipeline(pipeline.id, {}, 'operator', pipeline.revision)).id);
  expect(failed.steps[0]!.deployment?.state).toBe('unconfirmed');
  await expect(f.pipelines.resumeRun({ runId: failed.id, expectedDigest: failed.recovery!.digest }, 'operator')).rejects.toThrow('block');
  const missing = await f.pipelines.reconcileRun(failed.id);
  expect(missing.recovery!.blocked).toEqual(['deploy']);
  reachable = true;
  const read = await f.pipelines.reconcileRun(failed.id);
  expect(read.recovery).toMatchObject({ completed: ['deploy'], pending: ['verify'], blocked: [] });
  await f.pipelines.resumeRun({ runId: read.id, expectedDigest: read.recovery!.digest }, 'operator');
  expect((await f.terminal(read.id)).status).toBe('success');
  expect(dispatch).toHaveBeenCalledTimes(1);
  expect(await fs.readFile(path.join(f.root, 'verified'), 'utf8')).toBe('once\n');
});
