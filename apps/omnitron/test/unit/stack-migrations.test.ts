import 'reflect-metadata';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { syncBuiltinESMExports } from 'node:module';
import { afterEach, expect, it, vi } from 'vitest';
import { createNullLogger } from '@omnitron-dev/titan/module/logger';
import { ProjectService } from '../../src/services/project.service.js';
import { DaemonStateStore } from '../../src/daemon/daemon-state-store.service.js';
import { StateStore } from '../../src/daemon/state-store.js';
import { OrchestratorService } from '../../src/orchestrator/orchestrator.service.js';
import { StackInfrastructureManager } from '../../src/infrastructure/stack-infra-manager.js';
import { captureBootstrapMetadata } from '../../src/project/bootstrap-metadata.js';
import { recoveryState, RecoveryState } from '../../src/daemon/recovery-state.js';
import { OperationJournal, assertOperationJournalCompatibility } from '../../src/execution/operation-journal.js';
import { StackMigrations } from '../../src/project/stack-migrations.js';
import * as provenance from '../../src/release/runtime-provenance.js';
import { inspectMigrationDependencies } from '../../src/services/migration-execution.js';
import { migrationWorkspaceBindings } from '../../src/services/migration-workspace-bindings.js';
import { normalizeInfraConfig } from '../../src/infrastructure/config-normalizer.js';
import { createDefaultRegistry } from '../../src/infrastructure/presets/index.js';
import { BackupService } from '../../src/services/backup.service.js';
import type { StackMigrationRequest } from '../../src/shared/dto/project.js';
const { sql, readiness, native, preserved } = vi.hoisted(() => ({ sql: vi.fn(), readiness: vi.fn(), native: vi.fn(), preserved: vi.fn() }));
vi.mock('../../src/services/migration-process.js', () => ({ executeLocalMigration: sql }));
vi.mock('../../src/services/wait-for-postgres.js', () => ({ waitForPostgres: readiness }));
vi.mock('../../src/infrastructure/container-runtime.js', async original => ({
  ...await original<typeof import('../../src/infrastructure/container-runtime.js')>(), getContainerState: native,
}));
vi.mock('../../src/infrastructure/existing-containers.js', async original => ({
  ...await original<typeof import('../../src/infrastructure/existing-containers.js')>(), reviewExistingContainers: preserved,
}));
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { vi.restoreAllMocks(); for (const cleanup of cleanups.splice(0)) await cleanup(); sql.mockReset(); readiness.mockReset(); native.mockReset(); preserved.mockReset(); });
const scope = { project: 'example', stack: 'dev' }, handle = 'example/dev/api';
function deferred() { let release!: () => void; const promise = new Promise<void>(resolve => { release = resolve; }); return { promise, release }; }
async function fixture() {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'owner-migration-')));
  await fs.writeFile(path.join(root, 'omnitron.config.ts'), 'throw Error("review must not import configuration")');
  const store = new DaemonStateStore(createNullLogger(), path.join(root, 'data/daemon-state.db'));
  cleanups.push(async () => {
    for (const receipt of new OperationJournal(store, new RecoveryState()).pending()) recoveryState.release('execution.operation.' + receipt.id);
    await store.dispose(); await fs.rm(root, { recursive: true, force: true });
  });
  const cwd = path.join(root, 'apps/api'); await fs.mkdir(path.join(cwd, 'src/database'), { recursive: true });
  await fs.writeFile(path.join(cwd, 'package.json'), '{"name":"@example/api","version":"1.0.0","type":"module"}');
  const bootstrap = path.join(cwd, 'src/bootstrap.ts'), migration = path.join(cwd, 'src/database/config.ts');
  await fs.writeFile(bootstrap, 'throw Error("bootstrap must not run during review")');
  await fs.writeFile(migration, 'throw Error("migration must not run during review")');
  for (const name of ['tsx', '@omnitron-dev/omnitron']) {
    const directory = path.join(cwd, 'node_modules', name); await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(path.join(directory, 'package.json'), JSON.stringify({ name, version: '1.0.0' }));
    await fs.writeFile(path.join(directory, 'index.js'), 'export const fixture = true;');
  }
  const entries = [{ name: 'api', cwd: 'apps/api', bootstrap: 'src/bootstrap.ts' }];
  const config: any = { apps: entries, stacks: { dev: { type: 'local', apps: 'all',
    infrastructure: { postgres: { databases: { api: { migrate: { app: 'api', config: 'src/database/config.ts', releaseConfig: 'dist/database/config.js' } } } } },
    settings: { appEnv: { api: { PRIVATE_TOKEN: { secret: 'api-key' } } } },
  } } };
  const execution: any = { ...scope, revision: 3, phase: 'stopped', apps: [{ name: handle, generation: 'generation-1' }] };
  const app = { status: 'stopped', pid: undefined };
  const owner: any = { getExecutionCapabilities: () => ({ applicationRuntimeResolution: 2 }), getExecutionOwnerRuntime: async () => ({ root: '/fixture/owner', executable: '/fixture/node', commit: 'a'.repeat(40),
    target: { platform: 'fixture', arch: 'fixture', node: 'v24', abi: '137', executableSha256: 'b'.repeat(64), libc: null },
    execution: { mode: 'resident', protocol: 1, ownerId: 'fixture-owner', pid: 123, epoch: 1 } }),
    inspectStackExecution: vi.fn(async () => structuredClone(execution)), getApp: () => app, getHandle: () => undefined };
  const secrets = { get: vi.fn(async () => 'private-fixture-token') };
  store.upsertProjectSync({ name: 'example', path: root, added_at: '2026-11-18T00:00:00Z', last_seen: '2026-11-18T00:00:00Z' });
  const service = new ProjectService(createNullLogger(), owner, store, { secrets: secrets as never });
  const internals = service as any;
  internals.configRegistry.set('example', { config, loadedAt: 1 });
  internals.bootstrapMetadata.save(captureBootstrapMetadata(bootstrap, bootstrap, { omnitronConfig: { database: true } }));
  const services = normalizeInfraConfig(config.stacks.dev.infrastructure, createDefaultRegistry());
  services['postgres']!.secrets = { user: 'fixture-user', password: 'private-fixture-password' };
  const instance = { getResolvedContainerName: () => 'example-dev-postgres', holdForPreservation: vi.fn(async () => {}) };
  const allocation = { servicePorts: { postgres: { main: 25432 } }, postgresPort: 25432, redisPort: 26379,
    minioPort: 29000, minioConsolePort: 29001, redisDbStart: 0, redisDbEnd: 3, containerPrefix: 'example-dev' };
  const observation = { protocol: 1, mode: 'preserve', digest: 'e'.repeat(64), checks: [],
    containers: [{ name: 'example-dev-postgres', id: 'd'.repeat(64), fingerprint: 'f'.repeat(64) }] };
  internals.infraManager = { getPortAllocation: () => allocation, getNormalizedServices: () => services, getInstance: () => instance,
    inspectPreservedBindings: async () => ({ allocation, definition: { normalizedServices: services,
      containers: [{ name: 'example-dev-postgres', labels: { 'omnitron.service': 'postgres' } }] }, review: observation }) };
  preserved.mockResolvedValue(observation);
  native.mockRejectedValue(new Error('Migration review must inspect the full preserved definition'));
  internals.requireNoColdBatch = vi.fn(async () => {});
  store.kvSetSync('stack:example/dev:last-stop', { id: randomUUID(), phase: 'stopped', keepInfrastructure: true, intentCommitted: true });
  sql.mockResolvedValue({ stdout: '', stderr: '' }); readiness.mockResolvedValue(undefined);
  return { root, cwd, store, service, internals, app, execution, config, migration, secrets, services, allocation, instance, observation };
}
async function request(f: Awaited<ReturnType<typeof fixture>>): Promise<StackMigrationRequest> {
  const review = await f.service.reviewStackMigrations(scope); expect(review.digest).toMatch(/^[a-f0-9]{64}$/);
  return { ...scope, review: review.digest!, operationId: randomUUID() };
}
it('reviews a working tree that keeps reading migration sources beyond the first minute', async () => {
  const f = await fixture();
  const files = new Set<string>();
  for (const name of ['a', 'b', 'c', 'd']) {
    const directory = path.join(f.cwd, 'src', name);
    await fs.mkdir(directory);
    const file = path.join(directory, 'query.sql');
    await fs.writeFile(file, name); files.add(file);
  }
  const original = await f.service.reviewStackMigrations(scope);
  const start = Date.now(), open = fs.open.bind(fs);
  let elapsed = 0;
  const wall = vi.spyOn(Date, 'now').mockImplementation(() => start + elapsed);
  const monotonic = vi.spyOn(performance, 'now').mockImplementation(() => elapsed);
  const slow = vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
    const fd = await open(...args);
    if (files.has(String(args[0]))) elapsed += 20_000;
    return fd;
  });
  syncBuiltinESMExports();
  try {
    const reviewed = await f.service.reviewStackMigrations(scope);
    expect(elapsed).toBe(80_000);
    expect(reviewed.digest).toBe(original.digest);
    expect(reviewed.digest).toMatch(/^[a-f0-9]{64}$/);
    expect(sql).not.toHaveBeenCalled(); expect(readiness).not.toHaveBeenCalled();
  } finally { slow.mockRestore(); monotonic.mockRestore(); wall.mockRestore(); syncBuiltinESMExports(); }
});

it('reviews owner ports and vault references without imports, DB access or persistent mutation', async () => {
  const f = await fixture(), before = recoveryState.token();
  f.execution.phase = 'running'; f.app.status = 'online';
  const online = await f.service.reviewStackMigrations({ ...scope, app: 'api' });
  expect(online).toMatchObject({ stopped: false, digest: null, targets: [{ app: 'api', database: 'api', mode: 'config' }] });
  expect(JSON.stringify(online)).not.toMatch(/private-fixture|postgres:\/\//);
  expect(sql).not.toHaveBeenCalled(); expect(readiness).not.toHaveBeenCalled();
  expect(recoveryState.token()).toBe(before); expect(f.store.kvGetSync('execution.operation.active')).toBeNull();
  f.execution.phase = 'stopped'; f.app.status = 'stopped';
  const input = await request(f);
  input.operationId = input.operationId.toUpperCase();
  const receipt = await f.service.migrateStack(input);
  expect(receipt.state).toBe('succeeded'); expect(sql).toHaveBeenCalledTimes(2);
  expect(sql.mock.calls[1]?.[1]).toMatchObject({ DATABASE_URL: 'postgres://fixture-user:private-fixture-password@127.0.0.1:25432/api', PRIVATE_TOKEN: 'private-fixture-token' });
  expect(readiness.mock.calls[0]).toEqual(['127.0.0.1', 25432, 'fixture-user', 'private-fixture-password', 180000, 'postgres://fixture-user:private-fixture-password@127.0.0.1:25432/api']);
  expect(await f.service.migrateStack(input)).toEqual(receipt); expect(sql).toHaveBeenCalledTimes(2);
  expect(f.store.kvGetSync<any>('execution.operation.active')?.protocol).toBe(1);
});
it('reads each source package once per inspection and rechecks before each external action', async () => {
  const f = await fixture();
  const digest = vi.spyOn(provenance, 'releaseTreeDigest');
  const sourceReads = () => digest.mock.calls.filter(([root]) => root === f.cwd).length;
  const input = await request(f);
  expect(sourceReads()).toBe(1);
  const observations: number[] = [];
  sql.mockImplementation(async () => { observations.push(sourceReads()); return { stdout: '', stderr: '' }; });
  readiness.mockImplementation(async () => { observations.push(sourceReads()); });
  expect((await f.service.migrateStack(input)).state).toBe('succeeded');
  // Request review, admission before drain, and reinspection under SDK locks precede these actions.
  expect(observations).toEqual([4, 5, 6]);
});
it('admits four package reads at a time and measures shared physical dependencies once per review', async () => {
  const f = await fixture();
  const { plan } = await f.internals.prepareStackMigrations(scope);
  const packages = Array.from({ length: 10 }, (_, i) => 'probe-' + i);
  const dependencies = Object.fromEntries([...packages, 'tsx'].map(name => [name, '1.0.0']));
  await fs.writeFile(path.join(f.cwd, 'package.json'), JSON.stringify({ name: 'app', version: '1.0.0', dependencies }));
  for (const name of packages) {
    const root = path.join(f.cwd, 'node_modules', name);
    await fs.mkdir(root);
    await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ name, version: '1.0.0', dependencies: { tsx: '1.0.0' } }));
  }
  const release = deferred(), ready = deferred();
  const original = provenance.releaseTreeDigest, calls: string[] = [];
  let active = 0, peak = 0;
  vi.spyOn(provenance, 'releaseTreeDigest').mockImplementation(async (dir, ...options) => {
    calls.push(dir);
    peak = Math.max(peak, ++active);
    if (active === 4) ready.release();
    try { await release.promise; return await original(dir, ...options); }
    finally { active--; }
  });
  const inspect = inspectMigrationDependencies(plan, { root: f.root, source: null, bindings: {} });
  try { await ready.promise; expect(calls).toHaveLength(4); }
  finally { release.release(); }
  expect(await inspect).toMatch(/^[a-f0-9]{64}$/);
  expect(peak).toBe(4);
  expect(new Set(calls).size).toBe(calls.length);
  expect(calls).toContain(path.join(f.cwd, 'node_modules/tsx'));
});

it.each(['untracked', 'program', 'port', 'secret', 'stop', 'pid', 'missing-handle', 'native'] as const)('rejects %s drift before SQL', async change => {
  const f = await fixture(), input = await request(f);
  if (change === 'untracked') await fs.writeFile(path.join(f.cwd, 'src/database/new-migration.ts'), 'export const revision = 2;');
  if (change === 'program') await fs.appendFile(f.migration, '\n// changed');
  if (change === 'port') f.allocation.servicePorts.postgres.main++;
  if (change === 'secret') f.secrets.get.mockResolvedValue('changed-secret');
  if (change === 'stop') f.store.kvSetSync('stack:example/dev:last-stop', { id: randomUUID(), phase: 'stopped', keepInfrastructure: false });
  if (change === 'pid') Object.assign(f.app, { pid: 123 });
  if (change === 'missing-handle') f.internals.orchestrator.getApp = () => undefined;
  if (change === 'native') f.observation.digest = '9'.repeat(64);
  await expect(f.service.migrateStack(input)).rejects.toThrow(/review changed|not fully stopped/);
  expect(sql).not.toHaveBeenCalled(); expect(readiness).not.toHaveBeenCalled();
});
it('migrates after a native owner restart with durable stop and no retained handles or infrastructure owners', async () => {
  const f = await fixture(), logger = createNullLogger();
  const intent = new StateStore(f.store);
  intent.updateStackIntent(scope, () => ({ revision: 3, phase: 'stopped', operationId: randomUUID(), fingerprint: 'f'.repeat(64) }));
  const freshState = new StateStore(f.store); await freshState.init();
  const freshOwner = Object.assign(new OrchestratorService(logger, {} as never, freshState), {
    getExecutionOwnerRuntime: f.internals.orchestrator.getExecutionOwnerRuntime,
  });
  expect(await freshOwner.inspectStackExecution(scope)).toMatchObject({ phase: 'stopped', apps: [] });
  const service = new ProjectService(logger, freshOwner, f.store, { secrets: f.secrets as never });
  const internals = service as any;
  internals.configRegistry.set('example', { config: f.config, loadedAt: 2 });
  Object.assign(f.config.stacks.dev.infrastructure.postgres, { port: 25432, user: 'fixture-user', password: 'private-fixture-password' });
  const manager = internals.infraManager as StackInfrastructureManager;
  const provision = vi.spyOn(manager, 'provisionStack'), adopt = vi.spyOn(manager, 'preserveStack');
  expect(manager.getPortAllocation('example', 'dev')).toBeNull();
  const before = recoveryState.token();
  const review = await service.reviewStackMigrations(scope);
  expect(review).toMatchObject({ stopped: true, digest: expect.any(String) });
  expect(recoveryState.token()).toBe(before);
  expect(manager.listInstances()).toEqual([]);
  expect(preserved.mock.calls[0]?.[0][0]).toMatchObject({ name: 'example-dev-postgres', ports: [{ host: 25432, container: 5432 }] });
  const receipt = await service.migrateStack({ ...scope, review: review.digest!, operationId: randomUUID() });
  expect(receipt.state).toBe('succeeded');
  expect(sql.mock.calls[1]?.[1].DATABASE_URL).toBe('postgres://fixture-user:private-fixture-password@127.0.0.1:25432/api');
  expect(provision).not.toHaveBeenCalled(); expect(adopt).not.toHaveBeenCalled();
  expect(manager.listInstances()).toEqual([]); expect(freshOwner.list()).toEqual([]);
  preserved.mockResolvedValue({ ...f.observation, digest: null });
  await expect(service.reviewStackMigrations(scope)).rejects.toThrow('could not be verified');
  expect(sql).toHaveBeenCalledTimes(2);
});
it.each(['source', 'loader'] as const)('rechecks the %s after readiness and retains a safe failed preflight receipt', async changed => {
  const f = await fixture(), input = await request(f);
  const file = changed === 'source' ? f.migration : path.join(f.cwd, 'node_modules/tsx/index.js');
  readiness.mockImplementation(async () => { await fs.appendFile(file, '\n// changed after readiness'); });
  const receipt = await f.service.migrateStack(input);
  expect(receipt).toMatchObject({ state: 'failed', code: 'MIGRATION_PREFLIGHT_FAILED' });
  expect(sql).toHaveBeenCalledOnce(); expect(sql.mock.calls[0]?.[2]).toEqual({ validate: true });
  expect(() => new StackMigrations(f.store).assertIdle(scope)).not.toThrow();
  expect(await f.service.migrateStack(input)).toEqual(receipt); expect(sql).toHaveBeenCalledOnce();
});
it('holds lifecycle and registration during SQL, then retains uncertainty without replay or downgrade', async () => {
  const f = await fixture(), input = await request(f), entered = deferred(), finish = deferred();
  sql.mockImplementation(async (_target, _env, options) => {
    if (!options?.validate) { entered.release(); await finish.promise; throw Error('lost reply with possibly committed SQL'); }
    return { stdout: '', stderr: '' };
  });
  const pending = f.service.migrateStack(input); await entered.promise;
  await expect(f.service.startStack('example', 'dev')).rejects.toThrow('migrations are in progress');
  await expect(f.service.stopStack('example', 'dev')).rejects.toThrow('migrations are in progress');
  expect(() => f.service.removeProject('example')).toThrow('migrations are in progress');
  expect(() => f.service.updateProject('example', { path: f.root })).toThrow('migrations are in progress');
  await expect(f.service.deleteStack('example', 'dev')).rejects.toThrow('migrations are in progress');
  expect(() => f.service.assertInfrastructureMutable(scope)).toThrow('migrations are in progress');
  expect(f.service.getStackMigration(input)?.state).toBe('running');
  finish.release(); const receipt = await pending;
  expect(receipt).toMatchObject({ state: 'unknown', code: 'MIGRATION_OUTCOME_UNCONFIRMED' });
  expect(await f.service.migrateStack(input)).toEqual(receipt);
  await expect(f.service.migrateStack({ ...input, operationId: randomUUID() })).rejects.toThrow('unconfirmed');
  expect(() => new StackMigrations(f.store).assertIdle(scope)).toThrow('unconfirmed');
  expect(f.store.kvGetSync<any>('execution.operation.active')?.protocol).toBe(3); expect(sql).toHaveBeenCalledTimes(2);
  const retained = await fs.readFile(path.join(f.root, '.omnitron/dev-sdk/pending-selection'), 'utf8');
  expect(JSON.parse(retained)).toMatchObject({ kind: 'migration', id: input.operationId });
  expect(retained).not.toContain('private-fixture');
  const runtime = path.join(f.root, 'runtime'); await fs.mkdir(path.join(runtime, 'execution'), { recursive: true });
  await fs.writeFile(path.join(runtime, 'package.json'), '{"type":"module"}');
  await fs.writeFile(path.join(runtime, 'execution/operation-journal.js'), 'export const BACKUP_REVIEW_PROTOCOL = 2;');
  await expect(assertOperationJournalCompatibility(f.root, runtime)).rejects.toThrow('pending stack migration');
  const backups = Object.assign(Object.create(BackupService.prototype), { operations: new OperationJournal(f.store, new RecoveryState()) }) as BackupService;
  expect(backups.getOperation(input.operationId)).toBeNull();
});
it('rejects an older stop after its awaited cold-batch admission', async () => {
  const f = await fixture(), input = await request(f), waiting = deferred(), continueStop = deferred();
  f.internals.requireNoColdBatch.mockImplementationOnce(async () => { waiting.release(); await continueStop.promise; });
  const stop = f.service.stopStack('example', 'dev'); const refused = expect(stop).rejects.toThrow('migrations are in progress'); await waiting.promise;
  const entered = deferred(), finish = deferred();
  sql.mockImplementation(async (_target, _env, options) => { if (!options?.validate) { entered.release(); await finish.promise; } return { stdout: '', stderr: '' }; });
  const operation = f.service.migrateStack(input); await entered.promise;
  continueStop.release(); await refused; expect(f.store.kvGetSync<any>('stack:example/dev:last-stop')?.phase).toBe('stopped');
  finish.release(); expect((await operation).state).toBe('succeeded');
});
it('refuses admission while an earlier configuration writer is unsettled', async () => {
  const f = await fixture(), input = await request(f), waiting = deferred();
  const writer = recoveryState.run('applyTopologyPlan', async () => { await waiting.promise; });
  await expect(f.service.migrateStack(input)).rejects.toThrow('configuration is changing'); expect(sql).not.toHaveBeenCalled();
  waiting.release(); await writer; expect((await f.service.migrateStack(input)).state).toBe('succeeded');
});
it('claims the actual overridden SQL endpoint alongside its verified native container', async () => {
  const f = await fixture(); f.config.stacks.dev.settings.appEnv.api.DATABASE_URL = 'postgres://u:p@db.example:6432/api';
  const input = await request(f), receipt = await f.service.migrateStack(input);
  expect(receipt.resources).toContainEqual({ kind: 'database-endpoint', name: '["db.example:6432","api"]' });
  expect(receipt.resources).toContainEqual({ kind: 'database-endpoint', name: JSON.stringify(['d'.repeat(64), 'api']) });
  expect(sql.mock.calls[1]?.[1].DATABASE_URL).toBe('postgres://u:p@db.example:6432/api');
});
it('refuses an owner without the SDK migration capability before any database access', async () => {
  const f = await fixture();
  f.internals.orchestrator.getExecutionCapabilities = () => ({ applicationRuntimeResolution: 1 });
  await expect(f.service.reviewStackMigrations(scope)).rejects.toThrow('applicationRuntimeResolution@2');
  expect(sql).not.toHaveBeenCalled(); expect(readiness).not.toHaveBeenCalled();
});
it('fingerprints dependency content and physical binding separately from migration source', async () => {
  const f = await fixture(), input = await request(f);
  await fs.writeFile(path.join(f.cwd, 'node_modules/tsx/index.js'), 'export const fixture = "changed loader";');
  await expect(f.service.migrateStack(input)).rejects.toThrow('review changed'); expect(sql).not.toHaveBeenCalled();
});
it('reads captured host declarations without importing the bootstrap or writing metadata', async () => {
  const f = await fixture();
  f.config.stacks.remote = { ...f.config.stacks.dev, type: 'remote', nodes: [{ host: 'node.example', role: 'app' }] };
  f.internals.loadProjectConfig = async () => f.config;
  const load = vi.spyOn(f.internals, 'loadAppDefinitions');
  const save = vi.spyOn(f.internals.bootstrapMetadata, 'save');
  f.internals.slaveConnector = { addSlave: async () => {}, waitUntilConnected: async () => true,
    invokeOnSlave: async () => ({ checkedAt: 'fixture', probes: [] }) };
  await f.service.inspectStackHost({ project: 'example', stack: 'remote' } as never);
  expect(load).not.toHaveBeenCalled(); expect(save).not.toHaveBeenCalled();
});
it.each(['parent-lock', 'dependency-binding'] as const)('rejects changed %s evidence before execution', async change => {
  const f = await fixture(), input = await request(f);
  if (change === 'parent-lock') await fs.writeFile(path.join(f.root, 'pnpm-lock.yaml'), 'lockfileVersion: 9.0\n');
  else {
    const dependency = path.join(f.cwd, 'node_modules/tsx'), relocated = path.join(f.root, 'loader');
    await fs.rename(dependency, relocated); await fs.symlink(relocated, dependency);
  }
  await expect(f.service.migrateStack(input)).rejects.toThrow('review changed'); expect(sql).not.toHaveBeenCalled();
});
it.each(['succeeded', 'cancelled'] as const)('finishes %s SDK cleanup only on replay without repeating SQL or relying on current registration paths', async state => {
  const f = await fixture(), input = await request(f);
  let receipt = await f.service.migrateStack(input);
  if (state === 'cancelled') {
    input.operationId = randomUUID();
    const journal = new OperationJournal(f.store, recoveryState);
    const { receipt: prepared } = journal.prepare({ id: input.operationId, kind: 'migration',
      resources: receipt.resources, inputDigest: input.review });
    receipt = journal.transition(input.operationId, prepared.revision, 'cancelled');
  }
  const marker = path.join(f.root, '.omnitron/dev-sdk/pending-selection');
  const retained = JSON.stringify({ kind: 'migration', root: f.root, id: input.operationId,
    review: input.review, journal: f.store.dbPath }) + '\n';
  await fs.writeFile(marker, retained, { mode: 0o600 });
  expect(receipt.resources.some(resource => resource.kind === 'sdk-consumer')).toBe(true);
  expect(f.service.getStackMigration({ ...scope, operationId: input.operationId.toUpperCase() })).toEqual(receipt);
  expect(await fs.readFile(marker, 'utf8')).toBe(retained);
  vi.spyOn(f.internals.registry, 'get').mockReturnValue({ path: path.join(f.root, 'different-registration') });
  expect(await f.service.migrateStack(input)).toEqual(receipt);
  expect(await fs.stat(marker).then(() => true, () => false)).toBe(false);
  expect(sql).toHaveBeenCalledTimes(2);
});
it('uses the canonical ancestor consumer workspace for an imported configuration', async () => {
  const f = await fixture();
  await fs.writeFile(path.join(f.root, 'pnpm-workspace.yaml'), 'packages:\n  - apps/*\n');
  const configuration = path.join(f.root, 'configurations/local'); await fs.mkdir(configuration, { recursive: true });
  vi.spyOn(f.internals.registry, 'get').mockReturnValue({ name: 'example', path: configuration, registeredAt: '2026-11-18T00:00:00Z' });
  f.config.apps[0].cwd = f.cwd;
  const input = await request(f), receipt = await f.service.migrateStack(input);
  const consumer = receipt.resources.find(resource => resource.kind === 'sdk-consumer');
  expect(JSON.parse(consumer!.name).root).toBe(f.root);
  expect(receipt.state).toBe('succeeded');
});
it('refuses an external source framework without a declared SDK binding', async () => {
  const f = await fixture(), outside = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'unowned-sdk-')));
  cleanups.push(() => fs.rm(outside, { recursive: true, force: true }));
  const target = path.join(f.cwd, 'node_modules/@omnitron-dev/omnitron');
  await fs.rename(target, path.join(outside, 'package')); await fs.symlink(path.join(outside, 'package'), target);
  await expect(f.service.reviewStackMigrations(scope)).rejects.toThrow('no declared SDK workspace owner');
  expect(sql).not.toHaveBeenCalled();
});

it('reviews a nested SDK importer and binds its linked package and transitive contents to the decision', async () => {
  const f = await fixture();
  const { plan } = await f.internals.prepareStackMigrations(scope);
  const source = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'nested-sdk-')));
  cleanups.push(() => fs.rm(source, { recursive: true, force: true }));
  const framework = path.join(source, 'framework'), importer = path.join(framework, 'web');
  const selected = path.join(source, 'ui'), name = '@omnitron-dev/prism';
  const appLink = path.join(f.cwd, 'node_modules/@omnitron-dev/omnitron');
  await fs.rename(appLink, framework);
  await fs.symlink(framework, appLink, 'dir');
  const owner = '@omnitron-dev/omnitron', bin = path.join(importer, 'node_modules/.bin');
  const executable = path.join(selected, 'cli.js'), leaf = path.join(selected, 'node_modules/leaf');
  await fs.mkdir(importer, { recursive: true });
  await fs.mkdir(leaf, { recursive: true });
  await fs.writeFile(path.join(importer, 'package.json'), JSON.stringify({ name: 'web', dependencies: { [name]: 'link:../../ui', [owner]: 'link:..' } }));
  await fs.writeFile(path.join(importer, 'pnpm-workspace.yaml'), [
    'nodeLinker: hoisted', 'preferSymlinkedExecutables: true', 'offline: true', 'pmOnFail: ignore',
    'storeDir: ' + path.join(source, 'store'), 'cacheDir: ' + path.join(source, 'cache'), '',
  ].join('\n'));
  await fs.writeFile(path.join(framework, 'package.json'), JSON.stringify({ name: owner, version: '1.0.0', bin: './index.js' }));
  await fs.writeFile(path.join(framework, 'index.js'), '#!/usr/bin/env node\nthrow Error("review must not execute this tool");\n');
  await fs.chmod(path.join(framework, 'index.js'), 0o755);
  await fs.writeFile(path.join(selected, 'package.json'), JSON.stringify({ name, version: '1.0.0', bin: { prism: './cli.js' }, dependencies: { leaf: '1.0.0' } }));
  await fs.writeFile(executable, '#!/usr/bin/env node\nthrow Error("review must not execute this tool");\n', { mode: 0o755 });
  await fs.writeFile(path.join(leaf, 'package.json'), '{"name":"leaf","version":"1.0.0"}');
  await fs.writeFile(path.join(leaf, 'index.js'), 'export default 1;');
  await promisify(execFile)('pnpm', ['install', '--offline', '--ignore-scripts'], { cwd: importer, timeout: 10_000 });
  const external = path.join(bin, 'prism'), internal = path.join(bin, 'omnitron');
  for (const [link, target] of [[external, executable], [internal, path.join(framework, 'index.js')],
    [path.join(importer, 'node_modules', name), selected], [path.join(importer, 'node_modules', owner), framework]] as const) {
    expect(await fs.readlink(link)).toBe(path.relative(path.dirname(link), target));
  }
  const sdk = { root: f.root, source, bindings: { [name]: selected, [owner]: framework } };
  const before = await inspectMigrationDependencies(plan, sdk);
  expect(await inspectMigrationDependencies(plan, sdk)).toBe(before);
  await fs.writeFile(path.join(leaf, 'index.js'), 'export default 2;');
  const changedDependency = await inspectMigrationDependencies(plan, sdk);
  expect(changedDependency).not.toBe(before);
  await expect(provenance.releaseTreeDigest(framework, true, true)).rejects.toThrow('packed boundary');
  await expect(inspectMigrationDependencies(plan.map((item: (typeof plan)[number]) => ({ ...item, target: { ...item.target, sealed: true } })), sdk))
    .rejects.toThrow('packed boundary');
  await expect(inspectMigrationDependencies(plan, { ...sdk, bindings: {} })).rejects.toThrow('packed boundary');

  const observed = migrationWorkspaceBindings(sdk, () => {});
  expect(await observed.inspect(external, executable)).toBe(true);
  await fs.appendFile(executable, '// changed executable\n');
  await expect(observed.verify()).rejects.toThrow('changed during verification');
  expect(await inspectMigrationDependencies(plan, sdk)).not.toBe(changedDependency);

  await fs.unlink(internal);
  await fs.symlink(path.relative(bin, path.join(framework, 'package.json')), internal);
  await expect(inspectMigrationDependencies(plan, sdk)).rejects.toThrow('unverified dependency binding');
  await fs.unlink(internal);
  await fs.symlink(path.relative(bin, path.join(framework, 'index.js')), internal);
  await fs.rename(external, path.join(bin, 'unknown'));
  await expect(inspectMigrationDependencies(plan, sdk)).rejects.toThrow('packed boundary');
  await fs.rename(path.join(bin, 'unknown'), external);
  const installed = path.join(importer, 'node_modules', name), replacement = path.join(source, 'other-install');
  await fs.mkdir(replacement);
  await fs.copyFile(path.join(selected, 'package.json'), path.join(replacement, 'package.json'));
  await fs.unlink(installed);
  await fs.symlink(path.relative(path.dirname(installed), replacement), installed, 'dir');
  await expect(inspectMigrationDependencies(plan, sdk)).rejects.toThrow('packed boundary');
  await fs.unlink(installed);
  await fs.symlink(path.relative(path.dirname(installed), selected), installed, 'dir');
  await fs.writeFile(path.join(importer, 'package.json'), '{"name":"web"}');
  await expect(inspectMigrationDependencies(plan, sdk)).rejects.toThrow('packed boundary');
});
