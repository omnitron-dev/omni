import 'reflect-metadata';
import { afterEach, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
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
`) {
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
  const scope = { project: 'research', stack: 'publication' }, registered = { name: scope.project, path: repo, registeredAt: '2026-01-01T00:00:00Z' };
  const selection = new LocalReleaseSelection(state, scope, registered.registeredAt);
  selection.select(0, { id: release.id, manifestSha256: release.manifestSha256 });
  const getRuntime = vi.fn(async () => structuredClone(owner));
  const projects = Object.create(ProjectService.prototype) as ProjectService;
  Object.assign(projects, { logger, daemonStateStore: state, configRegistry: new Map([[scope.project, { config }]]),
    registry: { get: (name: string) => name === scope.project ? registered : undefined, resolveStack: (value: unknown) => value },
    nodeStackStop: { assertMutable() {} }, orchestrator: { getExecutionOwnerRuntime: getRuntime }, releaseStore: async () => store });
  const raw = new Database(path.join(root, 'pipelines.sqlite'));
  raw.exec(`CREATE TABLE pipelines(id TEXT PRIMARY KEY,name TEXT UNIQUE NOT NULL,description TEXT,steps TEXT NOT NULL,triggers TEXT NOT NULL,createdAt TEXT NOT NULL,updatedAt TEXT NOT NULL);
    CREATE TABLE pipeline_runs(id TEXT PRIMARY KEY,pipelineId TEXT NOT NULL,status TEXT NOT NULL,steps TEXT NOT NULL,startedAt TEXT NOT NULL,completedAt TEXT,triggeredBy TEXT NOT NULL,params TEXT);`);
  db = new Kysely<OmnitronDatabase>({ dialect: new SqliteDialect({ database: withDateBinding(raw) }) });
  pipelines = new PipelineService(db, logger as never);
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
  'refuses %s drift before creating a run or spawning the release child', async kind => {
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
    expect(await f.pipelines.listRuns(pipeline.id)).toEqual([]);
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
  const restarted = new PipelineService(f.db, logger as never);
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
    if (++observations < 3) return;
    await new Promise(resolve => setImmediate(resolve));
    throw Error('Owner grant was replaced after admission');
  });
  const pipeline = await f.pipelines.createPipeline(f.definition);
  const run = await f.terminal((await f.pipelines.executePipeline(pipeline.id, {}, 'reviewed', pipeline.revision)).id);
  expect(run.status).toBe('failed');
  expect(run.steps[0]!.error).toContain('Owner grant was replaced');
  expect(observations).toBe(3);
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
