import 'reflect-metadata';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { create } from 'tar';
import { afterEach, expect, it, vi } from 'vitest';
import { createNullLogger } from '@omnitron-dev/titan/module/logger';
import { ProjectService } from '../../src/services/project.service.js';
import { DaemonStateStore } from '../../src/daemon/daemon-state-store.service.js';
import { DEFAULT_ECOSYSTEM } from '../../src/config/defaults.js';
import { CLOSURE_FILE } from '../../src/release/application-closure.js';
import { releaseTreeDigest } from '../../src/release/runtime-provenance.js';
import { readInstalledReleaseReceipt } from '../../src/release/installed-origin.js';
import { targetRuntime } from '../../src/release/target-runtime.js';
import { loadRelease } from '../../src/release/load.js';
import { captureBootstrapMetadata } from '../../src/project/bootstrap-metadata.js';
import { writePrivateRecord } from '../../src/daemon/execution-journal.js';
import { readRestartConfiguration, saveRestartConfiguration, restartLaunchIntent, assertRestartOwnerDefaults } from '../../src/project/runtime-restart.js';
import type { RuntimeRestartConfiguration } from '../../src/project/runtime-restart.js';
import type { IEcosystemAppEntry, IEcosystemConfig } from '../../src/config/types.js';

// OS service ownership is independently exercised by cold-stack-start.test.ts.
// This fixture keeps the real cold receipt, SQLite attempt, Git admission,
// archive verification, installation and public ProjectService start path.
vi.mock('../../src/project/cold-stack-start.js', async original => {
  const actual = await original<typeof import('../../src/project/cold-stack-start.js')>();
  return { ...actual, reviewedColdStart: async (_home: string, batch: any, scope: any, _registration: unknown, _kind: unknown, automatic: boolean) => {
    if (!automatic) throw Error('Stack operation is held');
    return { digest: batch.digest, direction: batch.direction, scope, review: batch.stacks[0].startReview,
      ownerId: 'replacement', ownerPid: process.pid, ownerLifetime: '01234567-0000-0000-0000-000000000001:1234' };
  } };
});

const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.splice(0)) await close(); vi.restoreAllMocks(); });

async function fixture(bootstrap = false) {
  const home = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'retained-restart-')));
  const repo = path.join(home, 'project'), payload = path.join(home, 'payload'), store = path.join(home, 'releases');
  await Promise.all([repo, payload, path.join(home, 'old-owner'), path.join(home, 'new-owner'), path.join(home, 'data')].map(dir => fs.mkdir(dir)));
  const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
  await fs.writeFile(path.join(repo, 'omnitron.config.mjs'), "import './research.mjs'; export default {};\n");
  await fs.writeFile(path.join(repo, 'research.mjs'), 'export const selection = 1;\n');
  git('init', '-q'); git('add', '.'); git('-c', 'user.name=test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'original');
  const commit = git('rev-parse', 'HEAD');
  await fs.writeFile(path.join(payload, 'main.js'), 'throw Error("review must never execute an application");');
  if (bootstrap) {
    for (const [name, files] of Object.entries({ omnitron: ['index.js', 'orchestrator/bootstrap-process.js'], titan: ['index.js'] })) {
      const root = path.join(payload, 'node_modules/@omnitron-dev', name);
      await fs.mkdir(root, { recursive: true });
      await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ name: '@omnitron-dev/' + name, main: 'index.js' }));
      for (const file of files) {
        await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true });
        await fs.writeFile(path.join(root, file), 'throw Error("review must never execute an adapter");');
      }
    }
  }
  const runtime = await targetRuntime();
  const closure = JSON.stringify({ protocol: 1, runtime, nodeOptions: '', payloadSha256: await releaseTreeDigest(payload, true, false, [CLOSURE_FILE]) });
  await fs.writeFile(path.join(payload, CLOSURE_FILE), closure, { mode: 0o600 });
  const publication = path.join(store, 'fixture');
  await fs.mkdir(path.join(publication, 'artifacts'), { recursive: true });
  const archive = path.join(publication, 'artifacts/worker-1.0.0.tar.gz');
  await create({ file: archive, cwd: payload, gzip: true }, ['main.js', CLOSURE_FILE, ...(bootstrap ? ['node_modules'] : [])]);
  const bytes = await fs.readFile(archive);
  await fs.writeFile(path.join(publication, 'manifest.json'), JSON.stringify({ id: 'fixture',
    project: { repo: 'project', commit }, omni: { repo: 'framework', commit: 'b'.repeat(40) }, builtAt: new Date().toISOString(),
    gates: [{ name: 'build', status: 'passed' }], builtWith: { omnitron: '0.4.9', packages: [], target: runtime },
    artifacts: [{ app: 'worker', version: '1.0.0', bytes: bytes.length, sha256: sha(bytes),
      launch: { mode: bootstrap ? 'bootstrap' : 'script', file: 'main.js', closureSha256: sha(closure) } }] }));
  const release = await loadRelease('fixture', store);
  const scope = { project: 'sample', stack: 'dev' }, registration = { name: 'sample', path: repo, registeredAt: '2026-11-14T00:00:00Z', enabledStacks: ['dev'] };
  const config: IEcosystemConfig = { ...structuredClone(DEFAULT_ECOSYSTEM), apps: [{ name: 'worker', ...(bootstrap ? { bootstrap: 'main.js' } : { script: 'main.js' }), cwd: repo,
    env: { NATIVE_SHA: 'retained-binary-proof' } }], stacks: { dev: { type: 'local', infrastructureOwnership: 'external',
      settings: { env: { PRIVATE_VALUE: 'retained-secret' } } } } };
  const handles = new Map<string, { name: string; entry: IEcosystemAppEntry; status: string; pid: number }>();
  let ownerRoot = path.join(home, 'old-owner');
  const owner = {
    getExecutionOwnerRuntime: async () => ({ root: ownerRoot, executable: process.execPath, commit: 'b'.repeat(40), target: runtime,
      execution: { mode: 'resident', protocol: 1, ownerId: 'fixture-owner', pid: process.pid, epoch: 1 } }),
    refreshObservation: vi.fn(async () => {}), getHandle: (name: string) => handles.get(name),
    inspectStackExecution: vi.fn(async () => ({ ...scope, revision: 1, phase: 'running', apps: [...handles.values()].map(value => ({ name: value.name, generation: 'fixture' })) })),
    enableStackExecution: vi.fn(async () => {}),
    startApp: vi.fn(async (entry: IEcosystemAppEntry) => { handles.set(entry.name, { name: entry.name, entry, status: 'online', pid: process.pid }); }),
  };
  const db = new DaemonStateStore(createNullLogger(), path.join(home, 'data/daemon-state.db'));
  const service: any = new ProjectService(createNullLogger(), owner as never, db);
  Object.assign(service, {
    registry: { get: () => registration, recoveryDigest: () => 'a'.repeat(64), setStackEnabled: vi.fn() },
    releaseStore: async () => store, releaseRunningOn: async () => release.id, markPriorStopSuperseded: vi.fn(),
    toStackInfo: () => ({ name: scope.stack, type: 'local', status: 'running', apps: [...handles.values()] }),
  });
  service.configRegistry.set(scope.project, { config, loadedAt: 1000 });
  vi.spyOn(service.infraManager, 'reviewPreservation').mockResolvedValue({ protocol: 1, mode: 'preserve', scope,
    digest: 'c'.repeat(64), checks: [], containers: [] });
  const provision = vi.spyOn(service.infraManager, 'provisionStack');
  const migrations = vi.spyOn(service, 'runStackMigrations');
  const selector = service.localSelection(scope.project, scope.stack);
  selector.select(0, { id: release.id, manifestSha256: release.manifestSha256 });
  const installed = await service.installedRelease(scope.project, scope.stack, config.stacks!['dev'], config, release, true);
  if (bootstrap) service.bootstrapMetadata.save(captureBootstrapMetadata(installed.entries[0].bootstrap, installed.entries[0].bootstrap, { requires: {} }));
  const environment = await service.stackEnvFor(scope.project, scope.stack, config.stacks!['dev'], ['worker']);
  const definitions = service.preservationDefinitions(scope.project, scope.stack, installed.entries);
  const entry = service.stackEntryBuilder(scope.project, scope.stack, config.stacks!['dev'], config, definitions, environment)(installed.entries[0]);
  handles.set(entry.name, { name: entry.name, entry, status: 'online', pid: process.pid });
  cleanup.push(async () => { await service.dispose(); await db.dispose(); await fs.rm(home, { recursive: true, force: true }); });
  const capture = async (): Promise<RuntimeRestartConfiguration> => ({ protocol: 1, registryDigest: 'a'.repeat(64), ownerId: 'original',
    inventoryDigest: 'e'.repeat(64), watchConfig: structuredClone(config), ...await service.captureRuntimeRestart([scope]) });
  const boot = async (configuration: RuntimeRestartConfiguration, direction = 'starting') => {
    const digest = await saveRestartConfiguration(home, configuration);
    const plan = { protocol: 1, stackAdmissionProtocol: 1, instance: home, configuration: { sha256: digest, basis: 'retained-next-start' },
      target: { artifact: 'd'.repeat(64) }, before: { backend: 'f'.repeat(64), owner: 'f'.repeat(64), ownerId: 'original', ownerPid: 42,
        ownerLifetime: '01234567-0000-0000-0000-000000000001:12', revision: 1 }, infrastructure: { database: null },
      stacks: [{ ...scope, runtimeScope: scope, path: repo, enabled: true, startReview: configuration.stacks[0]!.review.digest }], excluded: [] };
    await writePrivateRecord(path.join(home, 'runtime/local-updates/current.json'), { protocol: 1, digest: sha(JSON.stringify(plan)), plan, phase: direction });
    ownerRoot = path.join(home, direction === 'restoring' ? 'old-owner' : 'new-owner');
    handles.clear(); service.stackStates.clear(); service.configRegistry.clear();
    delete service.retainedConfiguration;
    await service.loadProjectConfig(scope.project);
    return digest;
  };
  return { service, scope, config, registration, capture, boot, repo, home, release, entry, handles, owner, selector, provision, migrations, archive };
}

it('restarts the retained release after unused imported source changes, restages for the new owner, and restores the old owner binding', async () => {
  const f = await fixture(), configuration = await f.capture();
  const initialReview = await f.service.reviewStackStart(f.scope.project, f.scope.stack);
  expect(initialReview.digest).toBe(configuration.stacks[0]!.review.digest);
  f.service.setInfrastructurePolicy(f.scope.project, f.scope.stack, initialReview.digest);
  await fs.writeFile(path.join(f.repo, 'research.mjs'), 'export const selection = 2;\n');
  await expect(f.service.admitRelease(f.scope.project, f.scope.stack, f.config.stacks!['dev'], f.config, f.release.id, 'check')).rejects.toThrow('differ from its commit');
  expect((await f.service.reviewStackStart(f.scope.project, f.scope.stack)).digest).toBeNull();
  await f.boot(configuration);
  await expect(f.service.startStack(f.scope.project, f.scope.stack, { source: 'operator' })).rejects.toThrow('held');
  await f.service.startStack(f.scope.project, f.scope.stack, { source: 'boot' });
  const launched = f.owner.startApp.mock.calls[0]![0];
  expect(launched.releaseRoot).not.toBe(f.entry.releaseRoot);
  expect(restartLaunchIntent(launched)).toEqual(restartLaunchIntent(f.entry));
  expect(launched.cwd).toBe(f.repo);
  expect(launched.env).toMatchObject({ PRIVATE_VALUE: 'retained-secret', NATIVE_SHA: 'retained-binary-proof' });
  expect((await readInstalledReleaseReceipt(launched.releaseRoot!)).ownerPackage).toBe(path.join(f.home, 'new-owner'));
  expect((await f.capture()).stacks[0]!.review.digest).toBe(initialReview.digest);
  const handoff = await f.service.prepareHandoff();
  f.service.stackStates.clear(); f.service.configRegistry.clear(); delete f.service.retainedConfiguration;
  await f.service.adoptHandoff(handoff); f.service.resumeAfterHandoff();
  expect((await f.capture()).stacks[0]!.review.digest).toBe(initialReview.digest);
  await expect(f.service.startStack(f.scope.project, f.scope.stack, { source: 'boot' })).rejects.toThrow('already attempted');
  await f.boot(configuration, 'restoring');
  await f.service.startStack(f.scope.project, f.scope.stack, { source: 'boot' });
  expect(f.owner.startApp.mock.calls[1]![0].releaseRoot).toBe(f.entry.releaseRoot);
  expect(f.selector.read().release).toEqual({ id: f.release.id, manifestSha256: f.release.manifestSha256 });
  expect(f.provision).not.toHaveBeenCalled(); expect(f.migrations).not.toHaveBeenCalled();
});

it('refuses next-start environment drift before recording restart authority', async () => {
  const f = await fixture();
  f.handles.get(f.entry.name)!.entry.env = { ...f.entry.env, PRIVATE_VALUE: 'different' };
  await expect(f.capture()).rejects.toThrow('next-start definition differs');
  expect(f.owner.startApp).not.toHaveBeenCalled();
});

it('retains captured bootstrap declarations across owner restaging without evaluating the bootstrap during review', async () => {
  const f = await fixture(true), configuration = await f.capture();
  expect(configuration.stacks[0]!.declarations).toEqual([['worker', expect.objectContaining({ requires: {} })]]);
  await f.boot(configuration);
  const capture = vi.spyOn(f.service, 'loadAppDefinitions');
  await f.service.startStack(f.scope.project, f.scope.stack, { source: 'boot' });
  const launched = f.owner.startApp.mock.calls[0]![0];
  expect(launched.bootstrap).not.toBe(f.entry.bootstrap);
  expect(restartLaunchIntent(launched)).toEqual(restartLaunchIntent(f.entry));
  expect(capture).not.toHaveBeenCalled();
  expect((await f.capture()).stacks[0]!.declarations).toEqual(configuration.stacks[0]!.declarations);
});

it.each(['archive', 'payload', 'selection', 'launch', 'registration'])('refuses %s drift before owner startup', async kind => {
  const f = await fixture(), configuration = await f.capture();
  if (kind === 'launch') configuration.stacks[0]!.launches[0]!.env = { PRIVATE_VALUE: 'substituted' };
  await f.boot(configuration);
  if (kind === 'archive') await fs.appendFile(f.archive, 'tamper');
  if (kind === 'payload') {
    const installed = await f.service.installedRelease(f.scope.project, f.scope.stack, f.config.stacks!['dev'], f.config, f.release, true);
    await fs.appendFile(installed.entries[0].script, '// changed sealed payload');
  }
  if (kind === 'selection') f.selector.select(1, { id: f.release.id, manifestSha256: 'f'.repeat(64) });
  if (kind === 'registration') f.registration.registeredAt = '2027-01-01T00:00:00Z';
  await expect(f.service.startStack(f.scope.project, f.scope.stack, { source: 'boot' })).rejects.toThrow();
  expect(f.owner.startApp).not.toHaveBeenCalled(); expect(f.provision).not.toHaveBeenCalled();
});

it('binds private configuration bytes and keeps resolved secrets out of the public plan', async () => {
  const f = await fixture(), configuration = await f.capture(), digest = await f.boot(configuration);
  expect(await readRestartConfiguration(f.home, digest)).toEqual(configuration);
  const file = path.join(f.home, 'runtime/local-updates', 'configuration-' + digest + '.json');
  expect((await fs.stat(file)).mode & 0o077).toBe(0);
  expect(await fs.readFile(path.join(f.home, 'runtime/local-updates/current.json'), 'utf8')).not.toContain('retained-secret');
  configuration.stacks[0]!.environment['worker'] = { PRIVATE_VALUE: 'changed' };
  await fs.writeFile(file, JSON.stringify(configuration));
  await expect(readRestartConfiguration(f.home, digest)).rejects.toThrow('changed');
});

it('permits changed unused declarations but refuses startup defaults an old owner cannot replace', async () => {
  const config = { ...structuredClone(DEFAULT_ECOSYSTEM), apps: [{ name: 'worker', script: 'main.js' }] };
  expect(() => assertRestartOwnerDefaults({ ...config, apps: [{ ...config.apps[0]!, script: 'changed.js' }] }, config)).not.toThrow();
  expect(() => assertRestartOwnerDefaults({ ...config, supervision: { ...config.supervision, maxRestarts: 99 } }, config)).toThrow('startup defaults');
  expect(() => assertRestartOwnerDefaults({ ...config, logging: { ...config.logging, maxFiles: 99 } }, config)).toThrow('startup defaults');
});
