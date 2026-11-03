import 'reflect-metadata';
import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
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
    expect(graph.warnings).toEqual([expect.objectContaining({ reason: expect.stringContaining('refresh failed') })]);
    expect(f.metadata().read(f.bootstrap)).toEqual(record);
    f.metadata().save(record);
    expect((await f.service.getTopology({ project: 'sample', stack: 'dev' })).warnings).toEqual([]);
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
  it('uses owner launch declarations after a backend replacement even when there was no controller cache', async () => {
    const f = fixture();
    const record = captureBootstrapMetadata(f.bootstrap, f.bootstrap, { omnitronConfig: { database: true } });
    Object.assign(f.service, { orchestrator: { getHandle: () => ({ bootstrapMetadata: record }) } });
    const graph = await f.service.getTopology({ project: 'sample', stack: 'dev' });
    expect(graph.warnings).toEqual([]);
    expect(graph.dependencies[0]).toMatchObject({ service: 'postgres' });
    expect(graph.coverage?.[0]?.source).toBe('launch');
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
    expect(Reflect.getMetadata(METADATA_KEYS.METHOD_AUTH, ProjectRpcService.prototype, 'refreshTopologyMetadata')).toEqual({ roles: ['admin'] });
    expect(Reflect.getMetadata(METADATA_KEYS.METHOD_AUTH, ProjectRpcService.prototype, 'getTopology').roles).toContain('viewer');
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
