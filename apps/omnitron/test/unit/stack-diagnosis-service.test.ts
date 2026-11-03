import 'reflect-metadata';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProjectService } from '../../src/services/project.service.js';
import { ProjectRpcService } from '../../src/services/project.rpc-service.js';
import { captureBootstrapMetadata } from '../../src/project/bootstrap-metadata.js';
import { METADATA_KEYS } from '@omnitron-dev/titan/decorators';
import { publicStack } from '../../src/project/public-stack.js';
const directories: string[] = [];
afterEach(() => directories.splice(0).forEach(directory => fs.rmSync(directory, { recursive: true, force: true })));
function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'stack-diagnosis-')); directories.push(directory);
  fs.mkdirSync(path.join(directory, 'app/src'), { recursive: true });
  const bootstrap = path.join(directory, 'app/src/bootstrap.js'); fs.writeFileSync(bootstrap, 'throw new Error("MUST NOT EXECUTE")');
  const record = captureBootstrapMetadata(bootstrap, bootstrap, { omnitronConfig: { database: true } });
  const entries = [{ name: 'api', bootstrap: 'app/src/bootstrap.js' }];
  const metadata = { readState: vi.fn(() => ({ metadata: record })) };
  const config = { apps: entries, stacks: { dev: { type: 'local', apps: 'all' } } };
  const plan = vi.fn(async () => []);
  const service = Object.assign(Object.create(ProjectService.prototype), {
    nodeStackStop: { assertMutable: vi.fn() },
    localSelection: () => ({ read: () => ({ revision: 0, release: null }) }),
    registry: { get: () => ({ path: directory }) }, configRegistry: new Map([['sample', { config, loadedAt: Date.now() }]]),
    bootstrapTopology: new Map(), diagnosesInFlight: new Map(), bootstrapMetadata: metadata, orchestrator: { getHandle: () => undefined },
    resolveStacks: () => config.stacks, resolveStackApps: () => entries, stackEnvFor: async () => ({}),
    infraManager: { planStack: plan, getPortAllocation: () => null, getNormalizedServices: () => null },
  }) as ProjectService;
  return { service, config, bootstrap, metadata, plan };
}
describe('read-only readiness contract', () => {
  it('uses persisted declarations without importing bootstrap code or executing a lifecycle operation', async () => {
    const f = fixture(); const report = await f.service.diagnoseStack('sample', 'dev');
    expect(report.status).toBe('ready');
    expect(f.plan.mock.calls[0]).toEqual(expect.arrayContaining([expect.objectContaining({ postgres: { databases: { api: {} } } })]));
    expect(report.deferred).toContain('Database authentication, schema and migrations');
  });
  it('reports a missing requested migrator without executing application code or connecting to the DB', async () => {
    const f = fixture();
    Object.assign(f.config.stacks.dev, { infrastructure: { postgres: { databases: { api: { migrate: true } } } } });
    const blocked = await f.service.diagnoseStack('sample', 'dev');
    expect(blocked.status).toBe('blocked');
    expect(blocked.checks).toContainEqual(expect.objectContaining({ code: 'migrations.unavailable', state: 'blocked', message: expect.stringContaining('migration script is unavailable') }));
    const root = path.dirname(path.dirname(path.dirname(f.bootstrap)));
    fs.mkdirSync(path.join(root, 'apps/api/src/database'), { recursive: true });
    fs.writeFileSync(path.join(root, 'apps/api/src/database/migrate.ts'), 'throw Error("MUST NOT EXECUTE")');
    const available = await f.service.diagnoseStack('sample', 'dev');
    expect(available.checks).toContainEqual(expect.objectContaining({ code: 'migrations.entries', state: 'pass' }));
    expect(available.deferred).toContain('Database authentication, schema and migrations');
    Object.assign(f.config.apps[0]!, { env: { DATABASE_URL: 'postgres://u:p@localhost/api?sslmode=require' } });
    const incompatible = await f.service.diagnoseStack('sample', 'dev');
    expect(incompatible.checks).toContainEqual(expect.objectContaining({ code: 'migrations.unavailable', state: 'blocked', message: expect.stringContaining('refuses DATABASE_URL options') }));
  });
  it('reports an unselected imported release instead of treating it as an unchecked classic command', async () => {
    const f = fixture();
    Object.assign(f.service, { resolveStackApps: () => [{ name: 'imported', releaseFrom: { release: 'producer-1', manifestSha256: 'a'.repeat(64), app: 'api' } }] });
    const report = await f.service.diagnoseStack('sample', 'dev');
    expect(report.status).toBe('blocked');
    expect(report.checks).toContainEqual(expect.objectContaining({ code: 'release.import-unselected', state: 'blocked' }));
    expect(report.checks.some(check => check.code === 'application.classic')).toBe(false);
    await expect(f.service['loadAppDefinitions']('sample', f.config.stacks.dev as never, f.config as never)).rejects.toThrow('requires a prepared and selected release');
  });
  it('reports the same authority refusal for start readiness and release preflight', async () => {
    const f = fixture();
    Object.assign(f.config.stacks.dev, { type: 'remote', nodes: [{ host: 'test.example', role: 'app' }] });
    Object.assign(f.service, { clusterStop: {}, loadProjectConfig: async () => f.config });
    const diagnosis = await f.service.diagnoseStack('sample', 'dev');
    const check = diagnosis.checks.find(check => check.code === 'start.authority');
    expect(check?.state).toBe('blocked');
    expect(await f.service.checkRelease('sample', 'dev', 'sample-release')).toEqual({ ok: false, because: check?.message });
  });
  it('retains incomplete declaration coverage after source edits', async () => {
    const f = fixture(); fs.appendFileSync(f.bootstrap, '\n// changed');
    const report = await f.service.diagnoseStack('sample', 'dev');
    expect(report.status).toBe('unknown'); expect(report.checks).toContainEqual(expect.objectContaining({ code: 'declaration.unknown' }));
  });
  it('does not probe local Docker for remote placements', async () => {
    const f = fixture(); Object.assign(f.config.stacks.dev, { type: 'remote', nodes: [{ host: 'test.example', role: 'app' }] });
    const report = await f.service.diagnoseStack('sample', 'dev');
    expect(report.status).toBe('unknown'); expect(f.plan).not.toHaveBeenCalled();
    expect(report.checks).toContainEqual(expect.objectContaining({ code: 'remote.prerequisites' }));
  });
  it('keeps a failed vault resolution free of secret values', async () => {
    const f = fixture(); Object.assign(f.service, { stackEnvFor: async () => { throw new Error('SECRET=private-value'); } });
    const report = await f.service.diagnoseStack('sample', 'dev');
    expect(report.status).toBe('blocked'); expect(JSON.stringify(report)).not.toContain('private-value');
  });
  it('exposes diagnosis as a reader operation without widening declaration refresh', () => {
    const read = Reflect.getMetadata(METADATA_KEYS.METHOD_AUTH, ProjectRpcService.prototype, 'diagnoseStack');
    const refresh = Reflect.getMetadata(METADATA_KEYS.METHOD_AUTH, ProjectRpcService.prototype, 'refreshTopologyMetadata');
    expect(read.roles).toContain('viewer'); expect(refresh.roles).not.toContain('viewer');
  });
  it('shows release admission without leaking unrelated stack configuration', () => {
    const info = publicStack({ config: { type: 'local', release: { mode: 'required' }, env: { TOKEN: 'private-value' } } } as never);
    expect(info.config.release?.mode).toBe('required'); expect(JSON.stringify(info)).not.toContain('private-value');
  });
});
