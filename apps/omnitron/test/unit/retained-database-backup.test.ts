import 'reflect-metadata';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, expect, it, vi } from 'vitest';
import { createNullLogger } from '@omnitron-dev/titan/module/logger';
import { DaemonStateStore } from '../../src/daemon/daemon-state-store.service.js';
import { StateStore } from '../../src/daemon/state-store.js';
import { OrchestratorService } from '../../src/orchestrator/orchestrator.service.js';
import { AppHandle } from '../../src/orchestrator/app-handle.js';
import { ProjectService } from '../../src/services/project.service.js';
import { ProjectRpcService } from '../../src/services/project.rpc-service.js';
import { ProjectRegistry } from '../../src/project/registry.js';
import { BackupService } from '../../src/services/backup.service.js';
import { BackupRpcService } from '../../src/services/backup.rpc-service.js';
import { backupCreateCommand } from '../../src/commands/backup.js';
import * as daemon from '../../src/daemon/daemon-client.js';
import * as runtime from '../../src/infrastructure/container-runtime.js';
import * as preservation from '../../src/infrastructure/existing-containers.js';
import { InfrastructureService } from '../../src/infrastructure/infrastructure.service.js';
import { ExecutionService } from '../../src/execution/execution.service.js';
import { testExecution } from '../fixtures/execution.js';
import type { IEcosystemConfig } from '../../src/config/types.js';
import { DEFAULT_ECOSYSTEM } from '../../src/config/defaults.js';
import type { StackStopProgress } from '../../src/shared/dto/project.js';

const home = vi.hoisted(async () => {
  const fs = await import('node:fs'), os = await import('node:os'), path = await import('node:path');
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'retained-db-suite-')));
});
vi.mock('../../src/config/defaults.js', async original => ({
  ...await original<Record<string, unknown>>(), OMNITRON_HOME: await home,
}));
const scope = { project: 'example', stack: 'dev' };
const key = 'stack:example/dev:last-stop', target = 'example/dev/ledger';
const pg = 'a'.repeat(64), redis = 'b'.repeat(64), image = 'sha256:' + 'c'.repeat(64);
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  try { for (const cleanup of cleanups.splice(0)) await cleanup(); }
  finally { vi.restoreAllMocks(); }
});
afterAll(async () => { fs.rmSync(await home, { recursive: true, force: true }); });

async function fixture(stopInventory: 'complete' | 'missing-resource' | 'no-database' | 'legacy-owner' = 'complete', database = 'ledger') {
  const root = fs.mkdtempSync(path.join(await home, 'project-'));
  const logger = createNullLogger();
  const store = new DaemonStateStore(logger, path.join(root, 'data/daemon-state.db'));
  const ownerStore = new DaemonStateStore(logger, path.join(root, 'execution/state.db'));
  cleanups.push(async () => { await store.dispose(); await ownerStore.dispose(); });
  const registeredAt = '2026-01-01T00:00:00Z';
  store.upsertProjectSync({ name: 'catalog', path: root, added_at: registeredAt, last_seen: registeredAt });
  const source = path.join(root, 'development');
  fs.mkdirSync(source);
  fs.writeFileSync(path.join(source, 'omnitron.config.js'), 'throw Error("a backup must not execute configuration code")');
  const registry = new ProjectRegistry(store);
  registry.importConfiguration({ project: 'catalog', name: 'development', path: source, registration: scope.project,
    stacks: { dev: 'testing' }, expectedRevision: registry.catalogRevision() });
  store.kvSetSync('project:example:enabled-stacks', ['dev']);
  const infrastructure = { ...(stopInventory !== 'no-database' && { postgres: { databases: { [database]: {} }, port: 15432,
    user: 'archiver', password: 'fixture-private-password' } }), redis: {} };
  const config: IEcosystemConfig = { ...DEFAULT_ECOSYSTEM, apps: [{ name: 'api', script: './server.js' }],
    stacks: { dev: { type: 'local', infrastructure } } };
  const controller = () => {
    const state = new StateStore(ownerStore);
    const owner = new OrchestratorService(logger, {} as never, state, root, { reapForeignOrphans: false });
    const projects = new ProjectService(logger, owner, store);
    vi.spyOn(projects, 'getLoadedConfig').mockImplementation(project => project === scope.project ? config : { ...DEFAULT_ECOSYSTEM, apps: [] });
    vi.spyOn(projects as any, 'loadProjectConfig').mockResolvedValue(config);
    return { owner, projects, state, manager: projects.getInfraManager() };
  };
  const warm = controller();
  if (stopInventory === 'legacy-owner') {
    const stop = warm.owner.stopStackExecution.bind(warm.owner);
    vi.spyOn(warm.owner, 'stopStackExecution').mockImplementation(async request => { await stop(request); return undefined as never; });
  }
  const handle = new AppHandle({ name: 'example/dev/api', script: './server.js' }, 'classic');
  Object.assign(warm.owner, { handles: new Map([[handle.name, handle]]) });
  // Give the real manager a provisioned declaration without contacting a native runtime.
  vi.spyOn(InfrastructureService.prototype, 'provision').mockResolvedValue({ services: {}, ready: true });
  await warm.manager.provisionStack(scope.project, scope.stack, config.stacks!['dev']!, infrastructure);
  const inventory = [{ name: 'example-dev-redis', id: redis }];
  if (stopInventory === 'complete' || stopInventory === 'legacy-owner') inventory.unshift({ name: 'example-dev-postgres', id: pg });
  vi.spyOn(runtime, 'inspectStackContainers').mockImplementation(async () => structuredClone(inventory));
  const lifecycle = new ProjectRpcService(warm.projects);
  const request = { project: 'catalog', stack: 'testing', keepInfrastructure: true };
  const review = await lifecycle.reviewStackStop(request);
  expect(review.digest).toBeTruthy();
  const stopped = await lifecycle.stopStack({ ...request, review: review.digest! });
  expect(stopped).toMatchObject({ name: 'testing', runtimeScope: scope, stopOperation: { phase: 'stopped' } });
  if (stopInventory === 'complete') expect(stopped.stopOperation?.retainedDatabaseSha256).toMatch(/^[a-f0-9]{64}$/);
  else expect(stopped.stopOperation?.retainedDatabaseSha256).toBeUndefined();
  expect(stopped.apps[0]?.status).toBe('stopped');
  const cold = controller();
  expect((await cold.owner.inspectStackExecution(scope)).apps).toEqual([]);
  expect(cold.manager.listInstances()).toEqual([]);
  const native = vi.spyOn(preservation, 'reviewExistingContainers').mockImplementation(async (desired, _probes, observedScope) => {
    expect(observedScope).toEqual(scope);
    expect(desired.map(container => container.name).sort()).toEqual(['example-dev-postgres', 'example-dev-redis']);
    return { scope, protocol: 1, mode: 'preserve', digest: 'd'.repeat(64), checks: [],
      containers: inventory.map(container => ({ ...container, fingerprint: 'f'.repeat(64) })) };
  });
  const executor = new ExecutionService(logger);
  const inspect = vi.spyOn(executor, 'inspectDockerTarget').mockResolvedValue({ id: pg, image });
  const execute = vi.spyOn(executor, 'execute').mockImplementation(command => testExecution.execute({
    ...command, adapter: 'local', adapterOptions: { type: 'local' }, command: process.execPath,
    args: ['-e', 'process.stdout.end("SELECT 1;\\n")'],
  }));
  const backups = new BackupService({ logger } as never, store, executor, cold.projects);
  cleanups.push(async () => { backups.dispose(); await executor.dispose(); });
  const rpc = new BackupRpcService(backups, null);
  return { ...cold, store, config, native, inventory, inspect, execute, backups, rpc };
}

it('creates an indexed backup through the CLI after a fresh owner loses both inventories', async () => {
  const f = await fixture();
  const submit = f.rpc.createBackup.bind(f.rpc);
  vi.spyOn(f.rpc, 'createBackup').mockImplementation(async request => {
    await submit(request);
    f.inventory[0]!.id = 'e'.repeat(64);
    throw Error('Lost the create reply after archive publication');
  });
  const read = vi.spyOn(f.rpc, 'getOperation');
  vi.spyOn(daemon, 'createDaemonClient').mockReturnValue({ isReachable: async () => true,
    service: async () => f.rpc, disconnect: async () => {} } as never);
  const start = vi.spyOn(f.projects, 'startStack'), provision = vi.spyOn(f.manager, 'provisionStack'), adopt = vi.spyOn(f.manager, 'preserveStack');
  const prior = process.exitCode;
  try {
    process.exitCode = undefined; await backupCreateCommand(target); expect(process.exitCode).toBeUndefined();
  } finally { process.exitCode = prior; }
  const [record] = await f.backups.listBackups();
  expect(record).toMatchObject({ database: 'ledger', ...scope, scope: 'stack', compressed: true });
  const receipt = f.backups.getOperation(record!.id);
  expect(read).toHaveBeenCalledExactlyOnceWith({ id: record!.id });
  expect(receipt).toMatchObject({ state: 'succeeded', artifact: { id: record!.id, sizeBytes: record!.size } });
  expect(receipt!.resources).toEqual(expect.arrayContaining([
    { kind: 'database', ...scope, name: 'ledger' }, { kind: 'database-endpoint', name: JSON.stringify([pg, 'ledger']) },
  ]));
  expect(JSON.stringify(receipt)).not.toContain('fixture-private-password');
  expect(f.inspect).toHaveBeenCalledExactlyOnceWith(pg);
  expect(f.execute.mock.calls[0]?.[0]).toMatchObject({ args: ['127.0.0.1', '-U', 'archiver', '-d', 'ledger'],
    adapterOptions: { image, network: 'container:' + pg, entrypoint: 'pg_dump', env: { PGPASSWORD: 'fixture-private-password' } } });
  expect(f.owner.list()).toEqual([]); expect(f.manager.listInstances()).toEqual([]);
  expect(start).not.toHaveBeenCalled(); expect(provision).not.toHaveBeenCalled(); expect(adopt).not.toHaveBeenCalled();
  await expect(f.rpc.restoreBackup({ backupId: record!.id })).rejects.toThrow('no running database');
  expect(f.execute).toHaveBeenCalledOnce();
});

const refusal = {
  legacy: /no retained database identity/, superseded: /No current completed local stop/, 'full stop': /No current completed local stop/,
  'owner revision': /differ from the confirmed stop/, enabled: /No current completed local stop/, registration: /differ from the confirmed stop/,
  remote: /independently owned local stack/, external: /non-owning stack/, 'undeclared database': /is not declared/,
  'newly declared database': /differ from the confirmed stop/, replacement: /differ from the confirmed stop/,
  'other resource': /differ from the confirmed stop/, 'truncated ID': /differ from the confirmed stop/, 'native mismatch': /could not be verified for backup/,
  'foreign scope': /Native infrastructure ownership is unconfirmed/, 'adapter mismatch': /execution adapter could not confirm/,
  'stop during inspection': /changed for 'example\/dev' during retained backup admission/,
};
it.each(Object.keys(refusal) as Array<keyof typeof refusal>)('refuses %s before journaling or executing', async change => {
  const f = await fixture(), operationId = randomUUID();
  const stop = f.store.kvGetSync<StackStopProgress>(key)!;
  let database = target;
  switch (change) {
    case 'legacy': delete stop.retainedDatabaseSha256; break;
    case 'superseded': stop.supersededAt = new Date().toISOString(); break;
    case 'full stop': delete stop.keepInfrastructure; break;
    case 'owner revision': f.state.updateStackIntent(scope, prior => ({ ...prior, revision: prior.revision + 1 })); break;
    case 'enabled': f.store.kvSetSync('project:example:enabled-stacks', ['dev']); break;
    case 'registration': {
      const moved = fs.mkdtempSync(path.join(await home, 'moved-'));
      fs.writeFileSync(path.join(moved, 'omnitron.config.js'), 'export default {}');
      f.projects.updateProject(scope.project, { path: moved });
      break;
    }
    case 'remote': f.config.stacks!['dev']!.type = 'remote'; break;
    case 'external': f.config.stacks!['dev']!.infrastructureOwnership = 'external'; break;
    case 'undeclared database': database = 'example/dev/other'; break;
    case 'newly declared database': f.config.stacks!['dev']!.infrastructure!.postgres!.databases!['other'] = {}; database = 'example/dev/other'; break;
    case 'replacement': f.inventory[0]!.id = '9'.repeat(64); break;
    case 'other resource': f.inventory[1]!.id = '9'.repeat(64); break;
    case 'truncated ID': f.inventory[0]!.id = pg.slice(0, 12); break;
    case 'native mismatch': f.native.mockResolvedValue({ protocol: 1, mode: 'preserve', digest: null, checks: [], containers: [] }); break;
    case 'foreign scope': f.native.mockResolvedValue({ protocol: 1, mode: 'preserve', digest: 'd'.repeat(64), checks: [],
      scope: { project: 'other', stack: 'dev' }, containers: f.inventory.map(item => ({ ...item, fingerprint: 'f'.repeat(64) })) }); break;
    case 'adapter mismatch': f.inspect.mockResolvedValue({ id: redis, image }); break;
    case 'stop during inspection': f.inspect.mockImplementation(async () => {
      f.store.kvSetSync(key, { ...stop, supersededAt: new Date().toISOString() }); return { id: pg, image };
    }); break;
    default: throw Error('Unknown fixture condition: ' + (change satisfies never));
  }
  f.store.kvSetSync(key, stop);
  await expect(f.rpc.createBackup({ database, operationId })).rejects.toThrow(refusal[change]);
  expect(f.backups.getOperation(operationId)).toBeNull();
  expect(f.store.selectBackupsSync()).toEqual([]);
  expect(f.execute).not.toHaveBeenCalled();
});

it.each(['missing-resource', 'no-database', 'legacy-owner'] as const)('keeps the completed stop with %s and declines a cold dump', async condition => {
  const f = await fixture(condition), operationId = randomUUID();
  await expect(f.rpc.createBackup({ database: target, operationId })).rejects.toThrow('no retained database identity');
  expect(f.backups.getOperation(operationId)).toBeNull();
  expect(f.native).not.toHaveBeenCalled();
});

it('passes a declared database name containing libpq punctuation as one literal name', async () => {
  const name = "records=west's\\daily";
  const f = await fixture('complete', name);
  const record = await f.rpc.createBackup({ database: 'example/dev/' + name });
  expect(record.database).toBe(name);
  expect(f.execute.mock.calls[0]?.[0].args?.at(-1)).toBe("dbname='records=west\\'s\\\\daily'");
});

it('keeps automatic discovery and bare names limited to live inventory', async () => {
  const f = await fixture();
  await expect(f.rpc.createBackup({ database: 'ledger' })).rejects.toThrow('Unknown backup target');
  expect(await f.rpc.createAllBackups()).toEqual([]);
  expect(await (f.backups as any).runScheduledBackup(target)).toBe('failed');
  expect(f.native).not.toHaveBeenCalled(); expect(f.inspect).not.toHaveBeenCalled(); expect(f.execute).not.toHaveBeenCalled();
});
