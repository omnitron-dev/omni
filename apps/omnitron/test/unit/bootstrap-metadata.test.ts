import 'reflect-metadata';
import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { Netron } from '@omnitron-dev/titan/netron';
import { HttpNativeServer } from '@omnitron-dev/titan/netron/transport/http';
import { AuthenticationManager, AuthorizationManager } from '@omnitron-dev/titan/netron/auth';
import { createNullLogger } from '@omnitron-dev/titan/module/logger';
import { DaemonStateStore } from '../../src/daemon/daemon-state-store.service.js';
import { BootstrapMetadataStore, captureBootstrapMetadata, metadataSourceChanged } from '../../src/project/bootstrap-metadata.js';
import { ProjectService } from '../../src/services/project.service.js';
import { ProjectRpcService } from '../../src/services/project.rpc-service.js';
import { METADATA_KEYS } from '@omnitron-dev/titan/decorators';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const fn of cleanup.splice(0)) await fn(); });
const logger = { info() {}, error() {}, warn() {}, debug() {} } as never;
function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-declarations-'));
  fs.mkdirSync(path.join(directory, 'app/src'), { recursive: true });
  fs.writeFileSync(path.join(directory, 'package.json'), '{"type":"module"}');
  const bootstrap = path.join(directory, 'app/src/bootstrap.js');
  fs.writeFileSync(bootstrap, "throw new Error('A topology read must not execute this file')");
  let db = new DaemonStateStore(logger, path.join(directory, 'state.sqlite'));
  cleanup.push(async () => { await db.dispose(); fs.rmSync(directory, { recursive: true, force: true }); });
  const entries = [{ name: 'api', bootstrap: 'app/src/bootstrap.js' }];
  const metadata = () => new BootstrapMetadataStore(db);
  const service = Object.assign(Object.create(ProjectService.prototype), {
    logger, localSelection: () => ({ read: () => ({ revision: 0, release: null }) }),
    registry: { get: () => ({ path: directory }) }, bootstrapTopology: new Map(),
    get bootstrapMetadata() { return metadata(); },
    orchestrator: { getHandle: () => undefined },
    ensureConfig: async () => ({ apps: entries }),
    resolveStacks: () => ({ dev: { type: 'local', apps: 'all' }, test: { type: 'remote', apps: 'all' } }),
    resolveStackApps: () => entries, stackEnvFor: async () => ({}),
    infraManager: { getPortAllocation: () => undefined, getNormalizedServices: () => undefined },
  }) as ProjectService;
  return { directory, bootstrap, metadata, service, reopen: async () => {
    await db.dispose(); db = new DaemonStateStore(logger, path.join(directory, 'state.sqlite'));
    Object.assign(service, { bootstrapMetadata: metadata() });
  } };
}

describe('durable bootstrap declaration evidence', () => {
  it('survives a cold reader, retains failures and does not import application code while reading topology', async () => {
    const f = fixture();
    const record = captureBootstrapMetadata(f.bootstrap, f.bootstrap, { omnitronConfig: { redis: true } });
    f.metadata().save(record);
    await f.reopen();
    expect(f.metadata().read(f.bootstrap)).toEqual(record);
    let graph = await f.service.getTopology({ project: 'sample', stack: 'dev' });
    expect(graph.warnings).toEqual([]);
    expect(graph.dependencies).toEqual([expect.objectContaining({ service: 'redis', port: 6379 })]);
    expect(graph.coverage).toEqual([expect.objectContaining({ source: 'snapshot', capturedAt: record.capturedAt })]);
    f.metadata().fail(f.bootstrap);
    await f.reopen();
    graph = await f.service.getTopology({ project: 'sample', stack: 'dev' });
    expect(graph.warnings).toEqual([expect.objectContaining({ reason: expect.stringContaining('Declaration read failed') })]);
    expect(f.metadata().read(f.bootstrap)).toEqual(record);
    f.metadata().save(record);
    expect((await f.service.getTopology({ project: 'sample', stack: 'dev' })).warnings).toEqual([]);
  });
  it('persists safe missing-module evidence and clears it only after a successful declaration capture', async () => {
    const f = fixture();
    const record = captureBootstrapMetadata(f.bootstrap, f.bootstrap, {});
    f.metadata().save(record);
    f.metadata().fail(f.bootstrap, new Error("Cannot find module '/private/project/build/dependency.js' imported from /private/project/index.ts"));
    await f.reopen();
    const state = f.metadata().readState(f.bootstrap);
    expect(state.failure?.reason).toContain('module "dependency.js" is unavailable');
    expect(state.failure?.reason).not.toContain('/private');
    expect(Number.isFinite(Date.parse(state.failure!.at))).toBe(true);
    expect(state.metadata).toEqual(record);
    f.metadata().save(record);
    expect(f.metadata().readState(f.bootstrap).failure).toBeNull();
  });
  it('reports changed or missing declaration sources without executing them or silently discarding the snapshot', async () => {
    const f = fixture();
    const record = captureBootstrapMetadata(f.bootstrap, f.bootstrap, {});
    f.metadata().save(record);
    fs.writeFileSync(f.bootstrap, "throw new Error('modified')");
    expect(metadataSourceChanged(record)).toBe(true);
    expect((await f.service.getTopology({ project: 'sample', stack: 'dev' })).warnings[0]?.reason).toContain('changed after');
    fs.unlinkSync(f.bootstrap);
    expect(metadataSourceChanged(record)).toBe(true);
    expect(f.metadata().read(f.bootstrap)).toEqual(record);
  });
  it('propagates a real isolated loader failure through refresh, durable evidence and start prerequisite refusal', async () => {
    const f = fixture();
    fs.writeFileSync(f.bootstrap, "import './not-built.js'; export default {};");
    const report = await f.service.refreshTopologyMetadata({ project: 'sample', stack: 'dev' });
    expect(report.refreshed).toBe(0);
    expect(report.failures[0]?.reason).toContain('module "not-built.js" is unavailable');
    expect(JSON.stringify(report)).not.toContain(f.directory);
    await expect(f.service['loadAppDefinitions']('sample', { type: 'local' } as never,
      { apps: [{ name: 'api', bootstrap: 'app/src/bootstrap.js' }] } as never))
      .rejects.toThrow('Could not read declarations for api: module "not-built.js" is unavailable');
    await f.reopen();
    expect(f.metadata().readState(f.bootstrap).failure?.reason).toContain('module "not-built.js" is unavailable');
  });
  it('uses owner launch declarations after a backend replacement even when there was no controller cache', async () => {
    const f = fixture();
    const record = captureBootstrapMetadata(f.bootstrap, f.bootstrap, { omnitronConfig: { database: true } });
    Object.assign(f.service, { orchestrator: { getHandle: () => ({ bootstrapMetadata: record }) } });
    const graph = await f.service.getTopology({ project: 'sample', stack: 'dev' });
    expect(graph.warnings).toEqual([]);
    expect(graph.dependencies[0]).toMatchObject({ service: 'postgres' });
    expect(graph.coverage?.[0]?.source).toBe('launch');
  });
  it('reads imported application topology from the owner launch after handoff and reports absent selection', async () => {
    const f = fixture();
    const record = captureBootstrapMetadata(f.bootstrap, f.bootstrap, { omnitronConfig: { database: true } });
    const entries = [{ name: 'imported', releaseFrom: { release: 'producer-1', manifestSha256: 'a'.repeat(64), app: 'api' } }];
    Object.assign(f.service, { resolveStackApps: () => entries, ensureConfig: async () => ({ apps: entries }),
      localSelection: () => ({ read: () => ({ release: { id: 'consumer-1', manifestSha256: 'b'.repeat(64) } }) }),
      orchestrator: { getHandle: () => ({ bootstrapMetadata: record }) } });
    let graph = await f.service.getTopology({ project: 'sample', stack: 'dev' });
    expect(graph.warnings).toEqual([]);
    expect(graph.dependencies[0]).toMatchObject({ service: 'postgres' });
    expect(graph.coverage?.[0]).toMatchObject({ app: 'imported', source: 'launch' });
    Object.assign(f.service, { orchestrator: { getHandle: () => ({ entry: { script: '/installed/worker.js' } }) } });
    graph = await f.service.getTopology({ project: 'sample', stack: 'dev' });
    expect(graph.coverage?.[0]?.source).toBe('entry');
    expect(graph.warnings).toEqual([]);
    Object.assign(f.service, { localSelection: () => ({ read: () => ({ release: null }) }) });
    graph = await f.service.getTopology({ project: 'sample', stack: 'dev' });
    expect(graph.coverage?.[0]?.source).toBe('missing');
    expect(graph.warnings[0]?.reason).toContain('no selected release');
  });
  it('explicitly refreshes shared bootstrap declarations once across stacks without launching workloads', async () => {
    const f = fixture();
    const marker = path.join(f.directory, 'imports.txt');
    fs.writeFileSync(f.bootstrap, `import fs from 'node:fs'; fs.appendFileSync(${JSON.stringify(marker)}, ${JSON.stringify('read\n')});
      export default {name:'api',version:'1',processes:[{name:'main',module:'./main.js'}],omnitronConfig:{redis:true},
        hooks:{ beforeCreate(){throw new Error('Lifecycle must not start');} }};`);
    const result = await f.service.refreshTopologyMetadata({ project: 'sample' });
    expect(result).toEqual({ refreshed: 1, failures: [] });
    expect(fs.readFileSync(marker, 'utf8')).toBe('read\n');
    const graph = await f.service.getTopology({ project: 'sample' });
    expect(graph.coverage).toHaveLength(2);
    expect(graph.warnings).toEqual([]);
    expect(fs.readFileSync(marker, 'utf8')).toBe('read\n');
    fs.writeFileSync(f.bootstrap, "throw new Error('Fixture metadata unavailable')");
    expect((await f.service.refreshTopologyMetadata({ project: 'sample' })).failures).toHaveLength(1);
    expect(f.metadata().read(f.bootstrap)?.definition.omnitronConfig).toEqual({ redis: true });
    expect(f.metadata().readState(f.bootstrap).failure).not.toBeNull();
  });
  it('keeps code-importing refresh administrative while graph reads remain available to viewers', () => {
    expect(Reflect.getMetadata(METADATA_KEYS.METHOD_AUTH, ProjectRpcService.prototype, 'checkRelease').roles).not.toContain('viewer');
    expect(Reflect.getMetadata(METADATA_KEYS.METHOD_AUTH, ProjectRpcService.prototype, 'refreshTopologyMetadata')).toEqual({ roles: ['admin'] });
    expect(Reflect.getMetadata(METADATA_KEYS.METHOD_AUTH, ProjectRpcService.prototype, 'getTopology').roles).toContain('viewer');
  });
  it('captures the exact prepared candidate before selection while the previous release serves', async () => {
    const f = fixture();
    const candidate = path.join(f.directory, 'candidate');
    fs.mkdirSync(candidate);
    const bootstrap = path.join(candidate, 'bootstrap.js');
    fs.writeFileSync(bootstrap, "export default {name:'api',version:'2',processes:[{name:'main',module:'./main.js'}],omnitronConfig:{redis:true}};\n");
    const pin = { id: 'release-a', manifestSha256: 'a'.repeat(64) };
    const inspected: unknown[][] = [];
    Object.assign(f.service, {
      localSelection: () => ({ read: () => ({ release: pin }) }),
      admitRelease: async (_project: string, _stack: string, _definition: unknown, _config: unknown, id: string) => {
        expect(id).toBe('release-b'); return { id, manifestSha256: 'b'.repeat(64) };
      },
      installedEntries: async (...args: unknown[]) => { inspected.push(args); return [{ name: 'api', bootstrap, releaseRoot: candidate }]; },
    });
    const result = await f.service.refreshTopologyMetadata({ project: 'sample', stack: 'dev', release: 'release-b' });
    expect(result).toMatchObject({ refreshed: 1, failures: [] });
    expect(inspected[0]?.[5]).toBe(false);
    expect(f.metadata().read(bootstrap)?.definition).toEqual({ omnitronConfig: { redis: true } });
    expect(f.metadata().read(f.bootstrap)).toBeNull();
    expect(pin.id).toBe('release-a');
    await expect(f.service.refreshTopologyMetadata({ project: 'sample', release: 'release-b' })).rejects.toThrow(/stack/i);
    await expect(f.service.refreshTopologyMetadata({ project: 'sample', stack: 'test', release: 'release-b' })).rejects.toThrow(/local/i);
  });
  it('reports missing and stale installed candidate declarations before a stop, without running candidate code', async () => {
    const f = fixture(), candidate = path.join(f.directory, 'release-b'), marker = path.join(f.directory, 'executed');
    fs.mkdirSync(candidate);
    const bootstrap = path.join(candidate, 'bootstrap.js');
    const source = `import fs from 'node:fs'; fs.appendFileSync(${JSON.stringify(marker)}, 'import\\n');
      export default {name:'api',version:'2',processes:[{name:'main',module:'./main.js'}]};`;
    fs.writeFileSync(bootstrap, source);
    const entries = [{ name: 'api', bootstrap, releaseRoot: candidate }];
    const pin = { id: 'release-a', manifestSha256: 'a'.repeat(64) };
    Object.assign(f.service, {
      getLoadedConfig: () => ({ apps: entries }), loadProjectConfig: async () => ({ apps: entries }), assertStartAuthority: () => undefined,
      localSelection: () => ({ read: () => ({ release: pin }) }),
      admitRelease: async () => ({ id: 'release-b', manifestSha256: 'b'.repeat(64), files: [], manifest: { gates: [] } }),
      installedRelease: async () => ({ entries }), installedEntries: async () => entries,
      checkLocalOwner: async () => ({ phase: 'stopped', apps: [] }),
    });
    const check = (prepare: boolean) => f.service.checkRelease('sample', 'dev', 'release-b', prepare);
    expect(await check(true)).toMatchObject({ declarations: 'refresh-required', declarationReason: expect.stringContaining('api:') });
    const review = await f.service.reviewStackStart('sample', 'dev', { release: 'release-b' });
    expect(review).toMatchObject({ digest: null, targets: [{ node: 'preflight', reason: expect.stringContaining('api:'),
      refreshDeclarations: { release: 'release-b' } }] });
    expect(fs.existsSync(marker)).toBe(false);
    const result = await f.service.refreshTopologyMetadata({ project: 'sample', stack: 'dev', release: 'release-b' });
    expect(result).toEqual({ refreshed: 1, failures: [] });
    expect(await check(false)).not.toHaveProperty('declarations');
    fs.appendFileSync(bootstrap, '\n// Changed candidate\n');
    expect(await check(false)).toMatchObject({ declarations: 'refresh-required', declarationReason: expect.stringContaining('source changed') });
    f.metadata().fail(bootstrap, Error("Cannot find package 'missing-probe' imported from /private/path"));
    const failure = await check(true);
    expect(failure.declarationReason).toContain('missing-probe');
    expect(failure.declarationReason).not.toContain('/private');
    expect(fs.readFileSync(marker, 'utf8')).toBe('import\n');
    expect(pin.id).toBe('release-a');
  });

  it('routes explicit refresh through only the configuration owning the public stack and preserves the exact release', async () => {
    const capture = vi.fn(async () => ({ refreshed: 1, failures: [] }));
    const rpc = new ProjectRpcService({
      resolveProjectStack: async () => ({ project: 'ozar-markets', stack: 'local' }),
      projectConfigurations: () => [{ name: 'ozar' }, { name: 'ozar-markets' }],
      refreshTopologyMetadata: capture,
    } as never);
    await expect(rpc.refreshTopologyMetadata({ project: 'ozar', release: 'candidate' })).rejects.toThrow(/stack/i);
    expect(capture).not.toHaveBeenCalled();
    expect(await rpc.refreshTopologyMetadata({ project: 'ozar', stack: 'markets/local', release: 'candidate' })).toEqual({ refreshed: 1, failures: [] });
    expect(capture).toHaveBeenCalledExactlyOnceWith({ project: 'ozar-markets', stack: 'local', release: 'candidate' }, expect.any(Number));
  });
  it('authorizes operator inspection and reserves candidate imports for admins through the Netron HTTP transport', async () => {
    const logger = createNullLogger();
    const netron = new Netron(logger);
    const server = new HttpNativeServer({ host: '127.0.0.1', port: 0, cors: false });
    const tokens = new Map(['viewer', 'operator', 'admin'].map(role => [role, randomUUID()]));
    netron.configureAuth(new AuthenticationManager(logger, {
      authenticate: () => { throw Error('Use a fixture session'); },
      validateToken: token => {
        const role = [...tokens].find(([, value]) => value === token)?.[0];
        if (!role) throw Error('Unknown fixture session');
        return { userId: role, roles: [role], permissions: [] };
      },
    }), new AuthorizationManager(logger));
    const capture = vi.fn(async () => ({ refreshed: 1, failures: [] }));
    const inspect = vi.fn(async () => ({ ok: false, state: 'requires-stop', declarations: 'refresh-required', because: 'stop' }));
    const service = new ProjectRpcService({ resolveProjectStack: async (scope: unknown) => scope,
      projectConfigurations: () => [{ name: 'sample' }], refreshTopologyMetadata: capture, checkRelease: inspect } as never);
    try {
      await netron.start();
      await netron.peer.exposeService(service);
      server.setPeer(netron.peer);
      await server.listen();
      const invoke = async (role: string, method: string) => {
        const response = await fetch('http://127.0.0.1:' + server.port + '/netron/invoke', {
          method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + tokens.get(role) },
          body: JSON.stringify({ id: randomUUID(), service: 'OmnitronProject', method,
            input: [{ project: 'sample', stack: 'dev', release: 'candidate', prepare: true }] }),
        });
        await response.arrayBuffer();
        return response.status;
      };
      expect(await invoke('viewer', 'checkRelease')).toBe(403);
      expect(await invoke('operator', 'checkRelease')).toBe(200);
      expect(await invoke('viewer', 'refreshTopologyMetadata')).toBe(403);
      expect(await invoke('operator', 'refreshTopologyMetadata')).toBe(403);
      expect(capture).not.toHaveBeenCalled();
      expect(await invoke('admin', 'refreshTopologyMetadata')).toBe(200);
      expect(capture).toHaveBeenCalledExactlyOnceWith({ project: 'sample', stack: 'dev', release: 'candidate' }, expect.any(Number));
      expect(inspect).toHaveBeenCalledExactlyOnceWith('sample', 'dev', 'candidate', true);
    } finally {
      await server.close();
      await netron.stop();
    }
  });
  it('reports unread declarations when the shared deadline expires and retains the last snapshot', async () => {
    const f = fixture();
    const record = captureBootstrapMetadata(f.bootstrap, f.bootstrap, { omnitronConfig: { redis: true } });
    f.metadata().save(record);
    const result = await f.service.refreshTopologyMetadata({ project: 'sample' }, Date.now() - 1);
    expect(result.refreshed).toBe(0);
    expect(result.failures).toHaveLength(1);
    expect(f.metadata().read(f.bootstrap)).toEqual(record);
    expect(f.metadata().readState(f.bootstrap).failure).not.toBeNull();
  });
});
