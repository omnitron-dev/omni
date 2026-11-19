import 'reflect-metadata';
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { afterAll, expect, it, vi } from 'vitest';
import { METADATA_KEYS } from '@omnitron-dev/titan/decorators';
import { validateAccessRequirements } from '@omnitron-dev/titan/netron/auth';
import { createNullLogger } from '@omnitron-dev/titan/module/logger';
import { StateStore } from '../../src/daemon/state-store.js';
import { DaemonStateStore } from '../../src/daemon/daemon-state-store.service.js';
import { OrchestratorService } from '../../src/orchestrator/orchestrator.service.js';
import { ProjectService } from '../../src/services/project.service.js';
import { ProjectRpcService } from '../../src/services/project.rpc-service.js';
import { PipelineService } from '../../src/services/pipeline.service.js';
import { PipelineRpcService } from '../../src/services/pipeline.rpc-service.js';
import { AuditService } from '../../src/services/audit.service.js';
import { runWithAuth } from '../../src/services/auth-context.js';
import { createPipelineTestDatabase } from '../fixtures/pipeline-database.js';
import { testExecution } from '../fixtures/execution.js';
import { initCommand } from '../../src/commands/init.js';
import { planStarter } from '../../src/project/starter-plan.js';
import { defaultProjectStarterNeeds as defaultNeeds, type ProjectStarterNeeds } from '../../src/shared/dto/project.js';

const home = await vi.hoisted(async () => {
  const io = await import('node:fs/promises'), os = await import('node:os'), path = await import('node:path');
  const directory = await io.realpath(await io.mkdtemp(path.join(os.tmpdir(), 'omni-project-')));
  vi.stubEnv('OMNITRON_HOME', directory);
  return directory;
});
const logger = createNullLogger();
const store = new DaemonStateStore(logger, path.join(home, 'data/daemon-state.db'));
const owner = new OrchestratorService(logger, {} as never, new StateStore(store), home, { reapForeignOrphans: false });
// Only the fixture's own jobs participate. Host-wide sampling and startup reconciliation are outside this test.
Object.assign(owner, { ensureBootReconciled: async () => {}, ensureMetricsPolling: () => {}, persistState: () => {} });
const service = new ProjectService(logger, owner, store);
const rpc = new ProjectRpcService(service);
const execute = promisify(execFile);

afterAll(async () => {
  try { await owner.stopAll(); await service.dispose(); }
  finally { await store.dispose(); vi.unstubAllEnvs(); fs.rmSync(home, { recursive: true, force: true }); }
});

// Exercise the installed public packages without a network install. Each generated
// project receives only its own declared direct dependencies.
function installFixtureDependencies(directory: string, dependencies: Record<string, string>) {
  const require = createRequire(import.meta.url);
  for (const [name, version] of Object.entries(dependencies)) {
    const location = require.resolve.paths(name)?.map(root => path.join(root, name)).find(dir => fs.existsSync(path.join(dir, 'package.json')));
    if (!location) throw Error('Missing installed dependency ' + name);
    const pkg = JSON.parse(fs.readFileSync(path.join(location, 'package.json'), 'utf8'));
    expect({ name: pkg.name, version: pkg.version }).toEqual({ name, version });
    const target = path.join(directory, 'node_modules', name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.symlinkSync(location, target, 'dir');
  }
}

it('admits only administrators to both review and apply', () => {
  for (const method of ['reviewProjectCreation', 'createProject']) {
    const auth = Reflect.getMetadata(METADATA_KEYS.METHOD_AUTH, ProjectRpcService.prototype, method);
    for (const role of ['viewer', 'operator', 'service_role', 'admin']) {
      expect(validateAccessRequirements({ roles: [role], permissions: [] }, auth).allowed).toBe(role === 'admin');
    }
  }
});

it('checks the whole needs matrix and only includes the requested driver and framework', () => {
  for (const automation of [true, false]) {
    for (const persistence of ['none', 'sqlite', 'postgresql', 'mysql'] as const) {
      for (const service of ['none', 'node', 'titan'] as const) {
        const needs = { automation, persistence, service };
        if (!automation && persistence === 'none' && service === 'none') {
          expect(() => planStarter('matrix', needs)).toThrow('Select'); continue;
        }
        const { manifest, files } = planStarter('matrix', needs);
        const deps = Object.keys(manifest.dependencies);
        expect(deps.includes('@xec-sh/core')).toBe(automation);
        expect(deps.includes('@kysera/executor')).toBe(persistence !== 'none');
        expect(deps.includes('@omnitron-dev/titan')).toBe(service === 'titan');
        expect(deps).not.toContain('@omnitron-dev/omnitron');
        const drivers = { sqlite: 'better-sqlite3', postgresql: 'pg', mysql: 'mysql2' };
        expect(deps.filter(dep => Object.values(drivers).includes(dep))).toEqual(persistence === 'none' ? [] : [drivers[persistence]]);
        for (const command of Object.values(manifest.commands))
          expect(files.map(file => file.path)).toContain(command.slice('node '.length));
        expect(JSON.parse(files.find(file => file.path === 'omnitron.starter.json')!.content)).toEqual(manifest);
      }
    }
  }
});

it('reviews without writes, refuses stale or occupied targets, and preserves existing files and links', async () => {
  const input = { name: 'occupied', needs: defaultNeeds }, root = path.join(home, 'workspaces');
  const preview = await rpc.reviewProjectCreation(input);
  expect(fs.existsSync(preview.path)).toBe(false);
  await expect(rpc.createProject({ ...input, digest: '0'.repeat(64) })).rejects.toThrow('review changed');
  await expect(rpc.createProject({ ...input, needs: { ...defaultNeeds, automation: true }, digest: preview.digest })).rejects.toThrow('review changed');
  await expect(rpc.reviewProjectCreation({ ...input, path: '/unselected' } as never)).rejects.toThrow('Review takes');
  await expect(rpc.reviewProjectCreation({ ...input, name: '../another' })).rejects.toThrow('project name');
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  const target = path.join(home, 'existing'); fs.mkdirSync(target);
  fs.writeFileSync(path.join(target, 'owned'), 'keep');
  fs.symlinkSync(target, preview.path);
  await expect(rpc.createProject({ ...input, digest: preview.digest })).rejects.toThrow('already exists');
  expect(fs.readdirSync(target)).toEqual(['owned']);
  fs.unlinkSync(preview.path);
  fs.renameSync(root, root + '-original');
  try {
    fs.symlinkSync(target, root);
    await expect(rpc.reviewProjectCreation(input)).rejects.toThrow('directories owned');
    expect(fs.readdirSync(target)).toEqual(['owned']);
  } finally { fs.unlinkSync(root); fs.renameSync(root + '-original', root); }
  expect((await rpc.listProjects()).some(project => project.name === input.name)).toBe(false);
});

it('rolls back only its own unchanged files if the registry refuses the write', async () => {
  const input = { name: 'unregistered', needs: defaultNeeds }, preview = await rpc.reviewProjectCreation(input);
  const decline = vi.spyOn(store, 'upsertProjectSync').mockImplementationOnce(() => {
    fs.writeFileSync(path.join(preview.path, 'operator-note'), 'keep');
    fs.writeFileSync(path.join(preview.path, 'README.md'), 'edited during registration');
    throw Error('Registry write refused');
  });
  try {
    await expect(rpc.createProject({ ...input, digest: preview.digest })).rejects.toThrow('Registry write refused');
    expect(fs.readdirSync(preview.path).sort()).toEqual(['README.md', 'operator-note']);
    expect(fs.readFileSync(path.join(preview.path, 'README.md'), 'utf8')).toBe('edited during registration');
    expect(store.selectProjectsSync().some(row => row.name === input.name)).toBe(false);
  } finally { decline.mockRestore(); }
});

it.each(['postgresql', 'mysql'] as const)('loads the %s driver and requires a selected database before opening a connection', async persistence => {
  const input = { name: 'external-' + persistence, needs: { automation: false, service: 'none' as const, persistence } };
  const review = await rpc.reviewProjectCreation(input);
  await rpc.createProject({ ...input, digest: review.digest });
  installFixtureDependencies(review.path, review.manifest.dependencies);
  const connectionVariable = 'PROJECT_EXTERNAL_' + persistence.toUpperCase() + '_DATABASE_URL';
  const env: NodeJS.ProcessEnv = { ...process.env, DATABASE_URL: 'unrelated ambient setting' };
  delete env[connectionVariable];
  await expect(execute(process.execPath, ['starter-data.js'], { cwd: review.path, env, timeout: 10_000 }))
    .rejects.toThrow('Set ' + connectionVariable + ' for the selected ' + persistence + ' database');
});

it.each([
  ['automation', { automation: true, persistence: 'none', service: 'none' }],
  ['persistence', { automation: false, persistence: 'sqlite', service: 'none' }],
  ['combined', { automation: true, persistence: 'sqlite', service: 'titan' }],
  ['basic', defaultNeeds],
] as const)('registers %s through the project RPC, matches CLI output, and runs its declared programs', async (name, needs: ProjectStarterNeeds) => {
  const input = { name, needs };
  const preview = await rpc.reviewProjectCreation(input);
  const results = await Promise.allSettled([rpc.createProject({ ...input, digest: preview.digest }), rpc.createProject({ ...input, digest: preview.digest })]);
  const registered = results.filter(result => result.status === 'fulfilled');
  expect(registered).toHaveLength(1);
  expect(registered[0]!.value.totalStacks).toBe(needs.service === 'none' ? 0 : 1);
  expect((await rpc.listProjects()).filter(project => project.name === name).map(project => project.path)).toEqual([preview.path]);
  const directory = path.join(home, 'cli-' + name); fs.mkdirSync(directory);
  const cwd = vi.spyOn(process, 'cwd').mockReturnValue(directory);
  try { await initCommand({ name, automation: needs.automation, database: needs.persistence, service: needs.service }); }
  finally { cwd.mockRestore(); }
  for (const file of preview.files) {
    expect(fs.readFileSync(path.join(preview.path, file.path), 'utf8')).toBe(file.content);
    expect(fs.readFileSync(path.join(directory, file.path), 'utf8')).toBe(file.content);
  }
  const stacks = await rpc.listStacks({ project: name });
  expect(stacks.map(stack => stack.name)).toEqual(needs.service === 'none' ? [] : ['dev']);
  installFixtureDependencies(preview.path, preview.manifest.dependencies);
  if (needs.automation || needs.persistence !== 'none') {
    const args = ['--silent', 'run', needs.automation ? 'automation' : 'data'];
    const { stdout } = await execute('npm', args, { cwd: preview.path, timeout: 45_000 });
    const result = JSON.parse(stdout);
    if (needs.automation) {
      expect(result.node).toBe(process.version);
      expect([...result.checked].sort()).toEqual(preview.files.filter(file => file.path.endsWith('.js')).map(file => file.path).sort());
    }
    if (needs.persistence !== 'none') {
      const record = needs.automation ? result.event : result;
      expect(record).toMatchObject({ source: 'command', id: expect.any(String) });
      const { openSqliteDatabase } = await import('@omnitron-dev/titan-database/sqlite');
      const database = openSqliteDatabase(path.join(preview.path, 'starter.sqlite'), { readonly: true, fileMustExist: true });
      try { expect(database.prepare('SELECT id, source FROM starter_events').all()).toEqual([record]); }
      finally { database.close(); }
    }
  }
  if (needs.service !== 'none') {
    try {
      const stack = await rpc.startStack({ project: name, stack: 'dev', workingTree: true });
      expect(stack.apps).toMatchObject([{ name: 'worker', status: 'online', pid: expect.any(Number) }]);
    } finally { await owner.stopAll(); }
  }
}, 120_000);

it('runs the standalone Xec/Kysera program via a reviewed controller Pipeline and records one durable event', async () => {
  const name = 'job-project';
  const needs = { automation: true, persistence: 'sqlite', service: 'none' } as const;
  const review = await rpc.reviewProjectCreation({ name, needs });
  const project = await rpc.createProject({ name, needs, digest: review.digest });
  expect(project.totalStacks).toBe(0);
  installFixtureDependencies(project.path, review.manifest.dependencies);
  const { stdout } = await execute('npm', ['run', '--silent', 'pipeline'], { cwd: project.path, timeout: 45_000 });
  const definition = JSON.parse(stdout);
  expect(definition.steps).toMatchObject([{ kind: 'xec', cwd: project.path, retries: 0 }]);
  const applicationDatabase = path.join(project.path, 'starter.sqlite');
  const catalogue = createPipelineTestDatabase();
  const engine = new PipelineService(catalogue, logger, testExecution);
  try {
    await sql`CREATE TABLE omnitron_audit_log (
      id INTEGER PRIMARY KEY, action TEXT NOT NULL, actorId TEXT, actorType TEXT NOT NULL,
      resourceType TEXT NOT NULL, resourceId TEXT, details TEXT, ipAddress TEXT)`.execute(catalogue);
    const pipelines = new PipelineRpcService(engine, { validateSession: async () => null }, new AuditService(logger, catalogue));
    await runWithAuth({ userId: 'omnitron-local', roles: ['admin'], permissions: [], metadata: { source: 'local-unix-socket' } }, async () => {
      const saved = await pipelines.createPipeline(definition);
      const runId = randomUUID();
      const prepared = await pipelines.prepareRun({ runId, id: saved.id, expectedRevision: saved.revision });
      expect(prepared.review!.projects).toEqual([]);
      await expect(pipelines.startRun({ runId, expectedDigest: '0'.repeat(64) })).rejects.toThrow('Review the exact pipeline admission');
      expect(fs.existsSync(applicationDatabase)).toBe(false);
      const request = { runId, expectedDigest: prepared.review!.digest };
      await pipelines.startRun(request);
      await vi.waitFor(async () => {
        expect((await pipelines.getRunStatus({ runId }))?.status).toBe('success');
      }, { timeout: 60_000, interval: 100 });
      const replay = await pipelines.startRun(request);
      expect(await pipelines.listPipelines()).toMatchObject([{ id: saved.id }]);
      expect(await pipelines.listRuns({ pipelineId: saved.id })).toMatchObject([{ id: runId, status: 'success' }]);
      const output = JSON.parse(replay.steps[0]!.output!);
      expect(output.event).toMatchObject({ source: 'command', id: expect.any(String) });
      const { openSqliteDatabase } = await import('@omnitron-dev/titan-database/sqlite');
      const db = openSqliteDatabase(applicationDatabase, { readonly: true, fileMustExist: true });
      try { expect(db.prepare('SELECT id, source FROM starter_events').all()).toEqual([output.event]); }
      finally { db.close(); }
    });
  } finally { await engine.dispose(); await catalogue.destroy(); }
}, 120_000);
