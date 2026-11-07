import 'reflect-metadata';
import { afterEach, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { transpileModule, ScriptTarget, ModuleKind, preProcessFile } from 'typescript';
import { loadEcosystemConfig } from '../../src/config/loader.js';
import { create } from 'tar';
import { DEFAULT_ECOSYSTEM } from '../../src/config/defaults.js';
import type { InfrastructureConfig } from '../../src/infrastructure/types.js';
import { expandServiceDeclarations, normalizeInfraConfig } from '../../src/infrastructure/config-normalizer.js';
import { resolveInfrastructure } from '../../src/infrastructure/service-resolver.js';
import { createDefaultRegistry } from '../../src/infrastructure/presets/index.js';
import { mergeInfrastructure } from '../../src/infrastructure/merge-config.js';
import { artifactVolumeBindings, bindArtifactVolumes, releaseBuildEntries } from '../../src/release/artifact-volumes.js';
import { readInstalledReleaseReceipt } from '../../src/release/installed-origin.js';
import { inspectLocalReleasePayloads, LocalReleaseNotPreparedError } from '../../src/release/local-installation.js';
import * as installation from '../../src/release/local-installation.js';
import { inspectReleaseArtifact } from '../../src/release/artifact-inspection.js';
import { importReleaseArtifacts } from '../../src/release/import-artifacts.js';
import { loadRelease } from '../../src/release/load.js';
import { decideStackRelease, type ReleaseManifest } from '../../src/release/manifest.js';
import { releaseTreeDigest } from '../../src/release/runtime-provenance.js';
import { sha256File } from '../../src/release/portable-archive.js';
import { targetRuntime } from '../../src/release/target-runtime.js';
import { ProjectService } from '../../src/services/project.service.js';
import { linkFixtureDependencies } from '../helpers/installed-dependencies.js';
import { stageFixtureExtractor } from '../runtime/fixture-extractor.mjs';

const cleanup: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const root of cleanup.splice(0)) await fs.rm(root, { recursive: true, force: true }); });
const hash = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
const binding = { service: 'gateway', app: 'web', directory: 'dist/public', target: '/var/www/site' };
const infra = (): InfrastructureConfig => ({ services: { gateway: { type: 'daemon', ports: {}, env: {}, docker: { image: 'example.invalid/gateway:fixture' } } }, artifactVolumes: { web: { ...binding } } });

async function fixture(label = 'one') {
  const tmp = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'artifact-volume-'))); cleanup.push(tmp);
  const payload = path.join(tmp, 'payload'), store = path.join(tmp, 'releases'), producerRoot = path.join(store, 'producer-' + label), consumerRoot = path.join(store, 'consumer-' + label);
  await fs.mkdir(path.join(payload, 'dist/public'), { recursive: true, mode: 0o700 });
  await fs.writeFile(path.join(payload, 'dist/public/index.html'), '<h1>' + label + '</h1>');
  await fs.writeFile(path.join(payload, 'package.json'), '{"name":"fixture-static","type":"module"}');
  const target = await targetRuntime();
  const closureFile = path.join(payload, '.omnitron-closure.json');
  await fs.writeFile(closureFile, JSON.stringify({ protocol: 1, runtime: target, nodeOptions: '', payloadSha256: await releaseTreeDigest(payload, true, false, ['.omnitron-closure.json']) }));
  await fs.mkdir(path.join(producerRoot, 'artifacts'), { recursive: true });
  await fs.mkdir(path.join(consumerRoot, 'artifacts'), { recursive: true });
  const archive = path.join(producerRoot, 'artifacts/site-1.tar.gz');
  await create({ gzip: true, file: archive, cwd: payload, portable: true }, ['dist', 'package.json', '.omnitron-closure.json']);
  const artifact = { app: 'site', version: '1', sha256: await sha256File(archive), bytes: (await fs.stat(archive)).size,
    closureSha256: await sha256File(closureFile), packageSource: { directory: 'web', manifestBlob: 'd'.repeat(40), migrations: {} } };
  const producer: ReleaseManifest = { id: 'producer-' + label, project: { repo: 'https://example.invalid/product.git', commit: 'a'.repeat(40) },
    omni: { repo: 'https://example.invalid/framework.git', commit: 'b'.repeat(40) }, artifacts: [artifact],
    gates: ['build', 'test', 'test:native', 'test:migrations', 'test:account'].map(name => ({ name, status: 'passed' as const })),
    builtWith: { omnitron: 'fixture', packages: [], target }, builtAt: '', builtBy: 'fixture' };
  const raw = JSON.stringify(producer, null, 2) + '\n';
  await fs.writeFile(path.join(producerRoot, 'manifest.json'), raw);
  const entry = { name: 'web', enabled: false, releaseFrom: { release: producer.id, manifestSha256: hash(raw), app: 'site' } };
  // The ordinary release builder selects this payload even though runtime membership excludes it.
  const config = { ...DEFAULT_ECOSYSTEM, apps: [entry], infrastructure: { artifactVolumes: { web: binding } } };
  const imported = await importReleaseArtifacts(releaseBuildEntries(config), path.join(consumerRoot, 'artifacts'), store);
  const consumer: ReleaseManifest = { ...producer, id: 'consumer-' + label, project: { ...producer.project, commit: 'c'.repeat(40) },
    artifacts: imported.artifacts, imports: imported.imports, gates: [{ name: 'test:consumer', status: 'passed' }] };
  await fs.writeFile(path.join(consumerRoot, 'manifest.json'), JSON.stringify(consumer));
  return { tmp, store, producer, consumer, entry, release: await loadRelease(consumer.id, store), archive };
}

it('collects explicit disabled payloads in release phase without reading runtime service configuration', () => {
  const app = { name: 'web', enabled: false, releaseFrom: { release: 'producer', manifestSha256: 'a'.repeat(64), app: 'site' } };
  const config = { ...DEFAULT_ECOSYSTEM, apps: [{ name: 'api', script: 'api.js' }, app, { name: 'unused', enabled: false, script: 'unused.js' }],
    stacks: { production: { type: 'local' as const, apps: ['api'], infrastructure: { artifactVolumes: { web: binding } } } } };
  expect(releaseBuildEntries(config).map(entry => entry.name)).toEqual(['api', 'web']);
  expect(config.apps[1]).toBe(app); expect(app.enabled).toBe(false);
  expect(() => artifactVolumeBindings(config.stacks.production.infrastructure)).toThrow('custom Docker service');
});

it.each(['../public', '/public', 'dist/../public', 'dist//public', 'dist/./public', 'node_modules/public', 'dist/Node_Modules', 'dist\\public', 'file:public'])('refuses unsafe source directory %s', directory => {
  const i = infra(); i.artifactVolumes!['web']!.directory = directory;
  expect(() => artifactVolumeBindings(i)).toThrow('package-relative');
});

it.each(['\r', '\n', '\t', '\x7f'])('refuses Docker mount control characters in declared directory and target: %j', delimiter => {
  const source = infra(); source.artifactVolumes!['web']!.directory = 'dist/public' + delimiter + 'extra';
  expect(() => artifactVolumeBindings(source)).toThrow('package-relative');
  const destination = infra(); destination.artifactVolumes!['web']!.target = '/var/www/site' + delimiter + 'extra';
  expect(() => artifactVolumeBindings(destination)).toThrow('package-relative');
});

it.each(['\r', '\n', '\t', '\x7f', ':'])('refuses mount separators or control characters inherited from the physical installation root: %j', async delimiter => {
  const tmp = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'artifact-volume-'))); cleanup.push(tmp);
  const root = path.join(tmp, 'installed' + delimiter + 'extra');
  await fs.mkdir(path.join(root, 'dist/public'), { recursive: true });
  const declaration = infra(), before = structuredClone(declaration);
  await expect(bindArtifactVolumes(declaration, new Map([['web', root]]))).rejects.toThrow('cannot be encoded as a Docker mount');
  expect(declaration).toEqual(before);
});

it('preserves commas supported by the ordinary argv -v mount encoder', async () => {
  const tmp = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'artifact-volume-'))); cleanup.push(tmp);
  const root = path.join(tmp, 'installed,one'), directory = 'dist/public,two', target = '/var/www/site,three';
  await fs.mkdir(path.join(root, directory), { recursive: true });
  const declaration = infra(); Object.assign(declaration.artifactVolumes!['web']!, { directory, target });
  const resolved = await bindArtifactVolumes(declaration, new Map([['web', root]]));
  const service = resolved!.services!['gateway']!; if ('preset' in service) throw Error('fixture');
  expect(service.docker!.volumes!['web']).toEqual({ source: path.join(root, directory), target, readonly: true });
});

it.each(['/var/www/site', '/var/www', '/var/www/site/assets'])('refuses target overlap with an existing Docker mount: %s', target => {
  const i = infra(); const service = i.services!['gateway']!;
  if ('preset' in service) throw Error('fixture');
  service.docker!.volumes = { ordinary: { source: '/owned/ordinary', target } };
  expect(() => artifactVolumeBindings(i)).toThrow('overlaps');
});

it('refuses conflicting keys, variant overlaps and two artifact mounts, preserving the normalizer boundary', () => {
  const i = infra(); const service = i.services!['gateway']!;
  if ('preset' in service) throw Error('fixture');
  service.docker!.volumes = { web: '/elsewhere' };
  expect(() => artifactVolumeBindings(i)).toThrow('volume key');
  delete service.docker!.volumes;
  service.docker!.variants = { bridge: { volumes: { existing: '/var/www/site/assets' } } };
  expect(() => artifactVolumeBindings(i)).toThrow('overlaps');
  delete service.docker!.variants;
  i.artifactVolumes!['second'] = { ...binding, target: '/var/www' };
  expect(() => artifactVolumeBindings(i)).toThrow('overlapping');
  expect(() => normalizeInfraConfig(infra(), createDefaultRegistry())).toThrow('selected and verified');
});

it('requires a verified installation when resolving containers from pre-expanded services', () => {
  const declaration = infra();
  const services = expandServiceDeclarations(declaration, createDefaultRegistry());
  expect(services['gateway']?.docker?.volumes).toBeUndefined();
  expect(() => resolveInfrastructure(declaration, services)).toThrow('selected and verified');
  expect(() => resolveInfrastructure(declaration, {})).toThrow('selected and verified');
});

it('prepares, inspects and remounts a static-only imported artifact without any JS launch or application execution', async () => {
  const f = await fixture();
  expect(f.consumer.artifacts[0]!.launch).toBeUndefined();
  expect(decideStackRelease(f.consumer, undefined, ['web']).action).not.toBe('refuse');
  await expect(inspectLocalReleasePayloads(f.release, [f.entry])).rejects.toBeInstanceOf(LocalReleaseNotPreparedError);
  const before = await sha256File(f.archive), roots = await inspectLocalReleasePayloads(f.release, [f.entry], true);
  const declaration = infra(), original = structuredClone(declaration);
  const resolved = await bindArtifactVolumes(declaration, roots);
  expect(declaration).toEqual(original);
  expect(resolved!.artifactVolumes).toBeUndefined();
  const service = resolved!.services!['gateway']!;
  if ('preset' in service) throw Error('fixture');
  expect(service.docker!.volumes!['web']).toEqual({ source: path.join(roots.get('web')!, 'dist/public'), target: '/var/www/site', readonly: true });
  const inspection = await inspectReleaseArtifact(f.consumer.id, 'web', { releasesRoot: f.store, files: [{ path: 'dist/public/index.html', includeContents: true }] });
  expect(inspection.files.map(file => file.path)).toEqual(['dist/public/index.html']);
  expect(inspection.files[0]!.contents!.toString()).toBe('<h1>one</h1>');
  expect(await inspectLocalReleasePayloads(f.release, [f.entry])).toEqual(roots);
  expect(await sha256File(f.archive)).toBe(before);
  await fs.writeFile(path.join(roots.get('web')!, 'dist/public/index.html'), 'tampered');
  await expect(inspectLocalReleasePayloads(f.release, [f.entry])).rejects.toThrow('admitted payload');
});

it('retains producer admission and configured origin checks for a payload with no process', async () => {
  const f = await fixture();
  await expect(inspectLocalReleasePayloads(f.release, [{ ...f.entry, releaseFrom: { ...f.entry.releaseFrom, app: 'elsewhere' } }], true)).rejects.toThrow('Configured payload source');
  const producer = { ...f.producer, gates: [{ name: 'test', status: 'failed' as const }] }, raw = JSON.stringify(producer), pin = hash(raw);
  const consumer = { ...f.consumer, artifacts: [{ ...f.consumer.artifacts[0]!, origin: { ...f.entry.releaseFrom, manifestSha256: pin } }], imports: [{ manifestJson: raw, sha256: pin }] };
  expect(decideStackRelease(consumer, undefined, ['web'])).toMatchObject({ action: 'refuse' });
});

it.each(['parent-link', 'child-link', 'nested-dependencies'])('never exposes source aliases or dependencies: %s', async kind => {
  const f = await fixture(), roots = await inspectLocalReleasePayloads(f.release, [f.entry], true), root = roots.get('web')!;
  if (kind === 'parent-link') {
    await fs.rename(path.join(root, 'dist'), path.join(root, 'original-dist'));
    await fs.symlink('original-dist', path.join(root, 'dist'));
  } else if (kind === 'child-link') await fs.symlink('../../package.json', path.join(root, 'dist/public/leak.json'));
  else await fs.mkdir(path.join(root, 'dist/public/node_modules'));
  await expect(bindArtifactVolumes(infra(), roots)).rejects.toThrow(/physical|link|dependencies/);
});

it('reselects the old verified mount without deleting the newer installation', async () => {
  const a = await fixture('old'), b = await fixture('new');
  const old = await inspectLocalReleasePayloads(a.release, [a.entry], true), newer = await inspectLocalReleasePayloads(b.release, [b.entry], true);
  const restored = await bindArtifactVolumes(infra(), await inspectLocalReleasePayloads(a.release, [a.entry]));
  const service = restored!.services!['gateway']!; if ('preset' in service) throw Error('fixture');
  expect((service.docker!.volumes!['web'] as { source: string }).source).toBe(path.join(old.get('web')!, 'dist/public'));
  expect(await fs.readFile(path.join(newer.get('web')!, 'dist/public/index.html'), 'utf8')).toBe('<h1>new</h1>');
});

it('checkRelease prepare verifies the disabled payload but never adds it to executable membership or provisions the gateway', async () => {
  const f = await fixture();
  const apps = ['core', 'api', 'mail'].map(name => ({ name, script: name + '.js' }));
  const definition = { type: 'local' as const, apps: apps.map(app => app.name), infrastructure: infra() };
  const config = { ...DEFAULT_ECOSYSTEM, apps: [...apps, f.entry], stacks: { production: definition } };
  const execution = vi.spyOn(installation, 'inspectLocalReleaseInstallation').mockResolvedValue(apps);
  const stop = vi.fn(), provision = vi.fn();
  const service = Object.create(ProjectService.prototype) as ProjectService;
  Object.assign(service, {
    registry: { get: () => ({ path: f.tmp }) }, loadProjectConfig: async () => config,
    resolveStacks: () => config.stacks, assertStartAuthority: vi.fn(), admitRelease: async () => f.release,
    localSelection: () => ({ read: () => ({ release: null }) }), stackEnvFor: async () => ({}),
    checkLocalOwner: async () => ({ phase: 'stopped', apps: [] }),
    orchestrator: { getExecutionOwnerPid: () => process.pid, getExecutionOwnerPackage: async () => f.tmp, stopStackExecution: stop },
    infraManager: { provisionStack: provision },
  });
  const unprepared = await service.checkRelease('consumer', 'production', f.consumer.id);
  expect(unprepared).toMatchObject({ ok: false, state: 'unprepared' });
  expect(unprepared.preparedArtifactVolumes).toBeUndefined();
  const prepared = await service.checkRelease('consumer', 'production', f.consumer.id, true);
  expect(prepared).toMatchObject({ ok: true });
  const roots = await inspectLocalReleasePayloads(f.release, [f.entry]);
  expect(prepared.preparedArtifactVolumes).toEqual([{ binding: 'web', ...binding,
    source: path.join(roots.get('web')!, binding.directory), readonly: true,
    releaseId: f.release.id, manifestSha256: f.release.manifestSha256, artifactSha256: f.consumer.artifacts[0]!.sha256 }]);
  expect(execution.mock.calls.at(-1)![2].map(entry => entry.name)).toEqual(['core', 'api', 'mail']);
  expect(stop).not.toHaveBeenCalled(); expect(provision).not.toHaveBeenCalled();
  Object.assign(service, { checkLocalOwner: async () => ({ phase: 'running', apps: [] }) });
  const readOnly = await service.checkRelease('consumer', 'production', f.consumer.id);
  expect(readOnly).toMatchObject({ ok: false, state: 'requires-stop' });
  expect(readOnly.preparedArtifactVolumes).toBeUndefined();
  const stopRequired = await service.checkRelease('consumer', 'production', f.consumer.id, true);
  expect(stopRequired).toMatchObject({ ok: false, state: 'requires-stop', preparedArtifactVolumes: prepared.preparedArtifactVolumes });
  expect(stop).not.toHaveBeenCalled(); expect(provision).not.toHaveBeenCalled();
  await fs.writeFile(path.join(roots.get('web')!, binding.directory, 'index.html'), 'changed');
  const failed = await service.checkRelease('consumer', 'production', f.consumer.id, true);
  expect(failed.ok).toBe(false); expect(failed.preparedArtifactVolumes).toBeUndefined();
});

it('merges artifact declarations by name without changing unrelated infrastructure', () => {
  const merged = mergeInfrastructure({ infrastructure: infra() }, { infrastructure: { artifactVolumes: { web: { ...binding, directory: 'other/public' } } } });
  expect(merged!.artifactVolumes!['web']!.directory).toBe('other/public');
  expect(merged!.services).toEqual(infra().services);
});

it('refuses a static release switch before provisioning unless the owner has durably stopped the stack', async () => {
  const infrastructure = infra(), entries = ['core', 'api', 'mail'].map(name => ({ name, script: name + '.js' }));
  const definition = { type: 'local' as const, apps: entries.map(entry => entry.name), infrastructure };
  const config = { ...DEFAULT_ECOSYSTEM, apps: [...entries, { name: 'web', enabled: false, script: 'never.js' }] };
  const stop = vi.fn(), start = vi.fn(), service = Object.create(ProjectService.prototype) as ProjectService;
  Object.assign(service, {
    loadProjectConfig: async () => config, resolveStacks: () => ({ production: definition }), assertStartAuthority: vi.fn(),
    localSelection: () => ({ read: () => ({ revision: 0, release: null }) }), registry: { get: () => undefined },
    admitRelease: async () => ({ id: 'new', manifestSha256: 'a'.repeat(64) }),
    installedRelease: async () => ({ entries, infrastructure: undefined }),
    checkLocalOwner: async () => ({ phase: 'running', apps: [] }), startLocalStack: start,
    orchestrator: { stopStackExecution: stop }, stackStates: new Map(),
  });
  await expect(service['runStackStart']('consumer', 'production', 'operator', false, 'new', { attach: false }, false, false)).rejects.toThrow('Stop this local stack');
  expect(start).not.toHaveBeenCalled(); expect(stop).not.toHaveBeenCalled();
  await expect(service['runStackStart']('consumer', 'production', 'operator', false, undefined, { attach: false }, false, false)).rejects.toThrow('require a selected release');
  expect(start).not.toHaveBeenCalled();
});

it('actual admission rejects remote artifact mounts before definitions, owner requests or provisioning', async () => {
  const f = await fixture(), nodes = vi.fn(), definitions = vi.fn(), provision = vi.fn();
  const service = Object.create(ProjectService.prototype) as ProjectService;
  const config = { ...DEFAULT_ECOSYSTEM, apps: [f.entry], infrastructure: infra() };
  Object.assign(service, { releaseStore: async () => f.store, askReleaseOwners: nodes,
    loadAppDefinitions: definitions, infraManager: { provisionStack: provision } });
  await expect(service['admitRelease']('consumer', 'production', { type: 'remote', apps: [] }, config, f.consumer.id, 'check'))
    .rejects.toThrow('independently owned local stack');
  expect(nodes).not.toHaveBeenCalled(); expect(definitions).not.toHaveBeenCalled(); expect(provision).not.toHaveBeenCalled();
});

it('ordinary loader and real admission bind imported public pins before a stopped-owner or infrastructure mutation', async () => {
  const f = await fixture(), repo = path.join(f.tmp, 'repo'); await fs.mkdir(repo);
  const definition = { type: 'local' as const, apps: [] as string[], infrastructure: infra() };
  const config = { ...DEFAULT_ECOSYSTEM, apps: [f.entry], stacks: { production: definition } };
  await fs.writeFile(path.join(repo, 'producer.json'), JSON.stringify(f.entry.releaseFrom));
  await fs.writeFile(path.join(repo, 'omnitron.config.mjs'), `import producer from './producer.json' with { type: 'json' };\nexport default {...${JSON.stringify(config)},apps:[{name:'web',enabled:false,releaseFrom:producer}]};\n`);
  const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
  git('init', '-q'); git('add', '.'); git('-c', 'user.name=fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'consumer');
  const consumer = { ...f.consumer, project: { ...f.consumer.project, commit: git('rev-parse', 'HEAD') } };
  await fs.writeFile(path.join(f.release.root, 'manifest.json'), JSON.stringify(consumer));
  const loaded = await loadEcosystemConfig(repo, 'release');
  expect(loaded.stacks!['production']!.infrastructure!.artifactVolumes).toEqual(infra().artifactVolumes);
  const stop = vi.fn(), provision = vi.fn(), start = vi.fn(), service = Object.create(ProjectService.prototype) as ProjectService;
  Object.assign(service, {
    loadProjectConfig: async () => loaded, resolveStacks: () => loaded.stacks!, assertStartAuthority: vi.fn(),
    registry: { get: () => ({ path: repo }) }, releaseStore: async () => f.store, releaseRunningOn: async () => null,
    localSelection: () => ({ read: () => ({ revision: 0, release: null }) }), stackEnvFor: async () => ({}),
    orchestrator: { getExecutionOwnerPid: () => process.pid, getExecutionOwnerPackage: async () => f.tmp,
      inspectStackExecution: async () => ({ phase: 'running', apps: [] }), stopStackExecution: stop },
    infraManager: { provisionStack: provision }, startLocalStack: start, stackStates: new Map(),
    logger: { info: vi.fn() },
  });
  expect(await service.checkRelease('consumer', 'production', consumer.id, true)).toMatchObject({ ok: false, state: 'requires-stop' });
  await expect(service['runStackStart']('consumer', 'production', 'operator', false, consumer.id, { attach: false }, false, false))
    .rejects.toThrow('Stop this local stack');
  expect(stop).not.toHaveBeenCalled(); expect(start).not.toHaveBeenCalled(); expect(provision).not.toHaveBeenCalled();
  await fs.writeFile(path.join(repo, 'producer.json'), JSON.stringify({ ...f.entry.releaseFrom, app: 'mutated' }));
  await expect(service['admitRelease']('consumer', 'production', definition, loaded, consumer.id, 'check')).rejects.toThrow('differ from its commit');
});

it('diagnoses the verified selected mount and refuses changed bytes without falling back to raw configuration', async () => {
  const f = await fixture(), roots = await inspectLocalReleasePayloads(f.release, [f.entry], true);
  const definition = { type: 'local' as const, apps: [] as string[], infrastructure: infra() };
  const config = { ...DEFAULT_ECOSYSTEM, apps: [f.entry], stacks: { production: definition } };
  const plan = vi.fn(async () => []), service = Object.create(ProjectService.prototype) as ProjectService;
  Object.assign(service, {
    registry: { get: () => ({ path: f.tmp }) }, configRegistry: new Map([['consumer', { config, loadedAt: Date.now() }]]),
    resolveStacks: () => config.stacks, assertStartAuthority: vi.fn(), stackStates: new Map(),
    localSelection: () => ({ read: () => ({ release: { id: f.release.id, manifestSha256: f.release.manifestSha256 } }) }),
    releaseStore: async () => f.store, stackEnvFor: async () => ({}),
    orchestrator: { getExecutionOwnerPid: () => process.pid, getExecutionOwnerPackage: async () => f.tmp },
    infraManager: { planStack: plan },
  });
  const result = await service['inspectStackReadiness']('consumer', 'production');
  expect(result.checks.some(check => check.code === 'infrastructure.invalid')).toBe(false);
  expect(plan).toHaveBeenCalledTimes(1);
  const infrastructure = (plan.mock.calls[0] as unknown[])[3] as InfrastructureConfig;
  expect(infrastructure.artifactVolumes).toBeUndefined();
  const gateway = infrastructure.services!['gateway']!; if ('preset' in gateway) throw Error('fixture');
  expect(gateway.docker!.volumes!['web']).toEqual({ source: path.join(roots.get('web')!, 'dist/public'), target: '/var/www/site', readonly: true });
  plan.mockClear();
  await fs.writeFile(path.join(roots.get('web')!, 'dist/public/index.html'), 'changed');
  const refused = await service['inspectStackReadiness']('consumer', 'production');
  expect(refused.checks).toContainEqual(expect.objectContaining({ code: 'release.unavailable', state: 'blocked' }));
  expect(plan).not.toHaveBeenCalled();
  Object.assign(service, { localSelection: () => ({ read: () => ({ release: null }) }) });
  const unselected = await service['inspectStackReadiness']('consumer', 'production');
  expect(unselected.checks).toContainEqual(expect.objectContaining({
    code: 'release.mounts-unselected', state: 'blocked', message: expect.stringContaining('web → gateway:/var/www/site'),
  }));
  expect(plan).not.toHaveBeenCalled();
});

it('keeps the ordinary standalone destination installer self-contained after separating payload verification', async () => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'frozen-command-'))); cleanup.push(root);
  const source = path.join(root, 'source'), destination = path.join(root, 'installed');
  await fs.mkdir(source, { mode: 0o700 }); await fs.mkdir(destination, { mode: 0o700 });
  // Verification may read this file but must never evaluate it.
  await fs.writeFile(path.join(source, 'main.mjs'), "throw Error('application must not execute during installation');\n");
  const nodeOptions = '--max-old-space-size=256', target = await targetRuntime();
  const closure = path.join(source, '.omnitron-closure.json');
  await fs.writeFile(closure, JSON.stringify({ protocol: 1, runtime: target, nodeOptions,
    payloadSha256: await releaseTreeDigest(source, true, false, ['.omnitron-closure.json']) }));
  const archive = path.join(destination, 'worker.tar.gz');
  await create({ gzip: true, file: archive, cwd: source, portable: true }, ['main.mjs', '.omnitron-closure.json']);
  const launch = { mode: 'script' as const, file: 'main.mjs', closureSha256: await sha256File(closure) };
  const origin = { releaseId: 'fixture-release', manifestSha256: 'a'.repeat(64), artifactSha256: await sha256File(archive),
    artifactBytes: (await fs.stat(archive)).size, app: 'worker', frameworkCommit: 'b'.repeat(40),
    runtimeOrigin: { projectCommit: 'c'.repeat(40), producerApp: 'worker',
      consumer: { releaseId: 'fixture-release', manifestSha256: 'a'.repeat(64), app: 'worker' }, entry: { relativeFile: launch.file, mode: launch.mode } } };
  // Function.toString must see ordinary compiled ESM, not Vitest's rewritten
  // __vite_ssr_import_* aliases. Compile the actual dependency graph unchanged.
  const control = path.resolve(import.meta.dirname, '../..');
  const compilerPackage = path.join(root, 'compiler'), compiled = path.join(compilerPackage, 'dist');
  const seen = new Set<string>();
  async function compile(relative: string): Promise<void> {
    if (seen.has(relative)) return; seen.add(relative);
    const input = path.join(control, 'src', relative.replace(/\.js$/, '.ts'));
    const js = transpileModule(await fs.readFile(input, 'utf8'), { compilerOptions: {
      target: ScriptTarget.ES2022, module: ModuleKind.ESNext, esModuleInterop: true,
    }, fileName: input }).outputText;
    const output = path.join(compiled, relative);
    await fs.mkdir(path.dirname(output), { recursive: true }); await fs.writeFile(output, js);
    for (const dep of preProcessFile(js, true, true).importedFiles) {
      if (dep.fileName.startsWith('.')) await compile(path.normalize(path.join(path.dirname(relative), dep.fileName)));
    }
  }
  await compile('release/frozen-installation.js');
  await compile('release/installed-graph.js');
  await fs.writeFile(path.join(compilerPackage, 'package.json'), '{"type":"module"}');
  await linkFixtureDependencies(compilerPackage);
  const packages = path.join(root, 'receiver', 'packages'), receiver = path.join(packages, '0');
  await stageFixtureExtractor(compiled, receiver, (i: number) => path.join(packages, String(i + 1)));
  const args = [destination, 'worker.tar.gz', launch, origin, { root, executable: process.execPath }, nodeOptions, receiver];
  const script = `import {installFrozenApplicationCommand} from ${JSON.stringify(pathToFileURL(path.join(compiled, 'release/frozen-installation.js')).href)};
import {execFileSync} from 'node:child_process';
try { process.stdout.write(execFileSync('/bin/sh', ['-c', installFrozenApplicationCommand(...${JSON.stringify(args)})],
  {encoding:'utf8',timeout:10000,maxBuffer:1048576})); }
catch(error) { process.stderr.write(String(error.stderr ?? error).slice(-4000)); process.exitCode=1; }`;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8', timeout: 15_000, maxBuffer: 1_048_576 });
  expect(result.error).toBeUndefined(); expect(result.stderr).toBe(''); expect(result.status).toBe(0);
  expect(JSON.parse(result.stdout)).toBe(nodeOptions);
  expect(await readInstalledReleaseReceipt(destination)).toMatchObject({ version: 2, origin, nodeOptions,
    artifactPayloadUnchanged: true, frameworkContentUnchanged: true });
});
