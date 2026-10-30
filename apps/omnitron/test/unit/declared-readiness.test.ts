import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServer } from 'node:http';
import { mkdtemp, rm, writeFile, symlink, stat, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkReadiness, ReadinessMonitor } from '../../src/health/readiness.js';
import { writeHealthHeartbeat } from '../../src/health/heartbeat.js';
import { validateReadiness } from '../../src/health/contracts.js';
import type { AppReadinessConfig } from '../../src/health/contracts.js';

const cleanups: Array<() => Promise<unknown>> = [];
afterEach(async () => { vi.unstubAllGlobals(); await Promise.all(cleanups.splice(0).map(fn => fn())); });
const directory = async () => {
  const dir = await mkdtemp(join(tmpdir(), 'omni-readiness-'));
  cleanups.push(() => rm(dir, { force: true, recursive: true }));
  return dir;
};
const server = async (handler: Parameters<typeof createServer>[0]) => {
  const s = createServer(handler);
  await new Promise<void>(resolve => s.listen(0, '127.0.0.1', resolve));
  cleanups.push(() => new Promise<void>(resolve => { s.closeAllConnections(); s.close(() => resolve()); }));
  return `http://127.0.0.1:${(s.address() as { port: number }).port}/health`;
};
const http = (url: string, expect = { status: 'ok' }): AppReadinessConfig => ({ probes: [{ name: 'api', type: 'http', url, expect }], timeoutMs: 100 });
const heartbeat = (file = 'health.json'): AppReadinessConfig => ({ probes: [{ name: 'cycle', type: 'heartbeat', file, maxAgeMs: 1000 }] });
const answer = { status: 'healthy' as const, checks: [{ name: 'work', status: 'pass' as const, message: 'Completed cycle' }] };

describe('declared HTTP readiness', () => {
  it('requires the actual successful status and declared health fields', async () => {
    let body = { status: 'ok', revision: 'one' };
    let code = 200;
    const url = await server((_req, res) => { res.writeHead(code); res.end(JSON.stringify(body)); });
    expect((await checkReadiness(http(url), '/')).status).toBe('healthy');
    body = { status: 'error', revision: 'one' };
    expect((await checkReadiness(http(url), '/')).checks[0]?.message).toContain('http_contract_mismatch');
    code = 503;
    expect((await checkReadiness(http(url), '/')).status).toBe('unhealthy');
  });
  it('does not follow redirects and never prints response bodies or URL queries', async () => {
    const url = await server((_req, res) => { res.writeHead(302, { location: '/login' }); res.end('private response'); });
    const result = await checkReadiness(http(url + '?token=private-token'), '/');
    expect(result.checks[0]?.message).toContain('returned 302');
    expect(JSON.stringify(result)).not.toMatch(/private-token|private response/);
  });
  it('bounds the body and reports invalid JSON without echoing it', async () => {
    let body = 'secret-not-json';
    const url = await server((_req, res) => res.end(body));
    expect((await checkReadiness(http(url), '/')).checks[0]?.message).toContain('http_invalid_json');
    body = 'x'.repeat(65537);
    expect((await checkReadiness(http(url), '/')).checks[0]?.message).toContain('http_body_too_large');
  });
  it('times out a response whose body never completes', async () => {
    const url = await server((_req, res) => { res.writeHead(200); res.write('{'); });
    const result = await checkReadiness(http(url), '/');
    expect(result.status).toBe('unhealthy');
    expect(result.checks[0]?.message).toContain('within 100 ms');
  });
  it('keeps absence and invalid declarations visible', async () => {
    expect((await checkReadiness(undefined, '/')).status).toBe('degraded');
    expect((await checkReadiness({ probes: [] }, '/')).status).toBe('unhealthy');
    expect(() => validateReadiness(http('http://user:secret@localhost/health'))).toThrow();
    expect(() => validateReadiness({ probes: [...heartbeat().probes, { ...heartbeat().probes[0], name: 'second' }] })).toThrow();
  });
});

describe('completed-cycle heartbeats', () => {
  it('publishes a private atomic report and requires the current launch', async () => {
    const dir = await directory();
    const file = join(dir, 'health.json');
    await writeHealthHeartbeat(answer, { file, runId: 'current' });
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    expect(await readdir(dir)).toEqual(['health.json']);
    expect((await checkReadiness(heartbeat(), dir, 'current')).status).toBe('healthy');
    expect((await checkReadiness(heartbeat(), dir, 'previous')).checks[0]?.message).toContain('heartbeat_wrong_run');
  });
  it('rejects absent, stale, future and invalid reports', async () => {
    const dir = await directory();
    const file = join(dir, 'health.json');
    expect((await checkReadiness(heartbeat(), dir, 'run')).checks[0]?.message).toContain('heartbeat_missing');
    await writeHealthHeartbeat(answer, { file, runId: 'run', now: Date.now() - 1001 });
    expect((await checkReadiness(heartbeat(), dir, 'run')).checks[0]?.message).toContain('heartbeat_stale');
    await writeHealthHeartbeat(answer, { file, runId: 'run', now: Date.now() + 10000 });
    expect((await checkReadiness(heartbeat(), dir, 'run')).checks[0]?.message).toContain('heartbeat_future');
    await writeFile(file, '{"schemaVersion":2}');
    expect((await checkReadiness(heartbeat(), dir, 'run')).checks[0]?.message).toContain('heartbeat_unreadable');
  });
  it('never follows a substituted symlink or accepts oversized files', async () => {
    const dir = await directory();
    await writeHealthHeartbeat(answer, { file: join(dir, 'real.json'), runId: 'run' });
    await symlink('real.json', join(dir, 'health.json'));
    expect((await checkReadiness(heartbeat(), dir, 'run')).status).toBe('unhealthy');
    await writeFile(join(dir, 'huge.json'), 'x'.repeat(65537));
    expect((await checkReadiness(heartbeat('huge.json'), dir, 'run')).checks[0]?.message).toContain('heartbeat_invalid_file');
  });
  it('retains failure from either the report verdict or its named checks', async () => {
    const dir = await directory();
    const options = { file: join(dir, 'health.json'), runId: 'run' };
    await writeHealthHeartbeat({ ...answer, status: 'unhealthy' }, options);
    expect((await checkReadiness(heartbeat(), dir, 'run')).status).toBe('unhealthy');
    await writeHealthHeartbeat({ ...answer, checks: [{ name: 'delivery', status: 'fail', message: 'Rejected' }] }, options);
    expect((await checkReadiness(heartbeat(), dir, 'run')).status).toBe('unhealthy');
  });
});

describe('concurrent readiness readers', () => {
  it('share one measurement and invalidate it when configuration or launch changes', async () => {
    const fetch = vi.fn(async () => new Response('{"status":"ok"}'));
    vi.stubGlobal('fetch', fetch);
    const monitor = new ReadinessMonitor();
    const owner = {};
    const entry = { name: 'api', cwd: '/', readiness: http('http://localhost/health') };
    await Promise.all([monitor.check(owner, entry, 'one'), monitor.check(owner, entry, 'one')]);
    await monitor.check(owner, entry, 'one');
    expect(fetch).toHaveBeenCalledTimes(1);
    await monitor.check(owner, entry, 'two');
    entry.readiness = http('http://localhost/new-health');
    await monitor.check(owner, entry, 'two');
    expect(fetch).toHaveBeenCalledTimes(3);
  });
});

describe('the supervisor keeps readiness tied to its actual launch', () => {
  it('does not promote a stopped or replaced process using an earlier HTTP answer', async () => {
    const { OrchestratorService } = await import('../../src/orchestrator/orchestrator.service.js');
    const { AppHandle } = await import('../../src/orchestrator/app-handle.js');
    const handle = new AppHandle({ name: 'api', cwd: '/', readiness: http('http://localhost/health') }, 'classic');
    handle.status = 'online';
    handle.healthRunId = 'old';
    let finish: (response: Response) => void = () => {};
    vi.stubGlobal('fetch', () => new Promise<Response>(resolve => { finish = resolve; }));
    const self = { handles: new Map([['api', handle]]), readinessMonitor: new ReadinessMonitor(), readinessSignatures: new WeakMap(), logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } };
    const pending = OrchestratorService.prototype.getHealth.call(self as never);
    handle.healthRunId = 'replacement';
    finish(new Response('{"status":"ok"}'));
    expect((await pending)['api']?.checks[0]?.message).toContain('measurement_superseded');
    const next = OrchestratorService.prototype.getHealth.call(self as never);
    handle.status = 'stopped';
    finish(new Response('{"status":"ok"}'));
    expect((await next)['api']?.status).toBe('unhealthy');
  });
  it('propagates a new run identity and the resolved report path to a classic child', async () => {
    const { launchClassic } = await import('../../src/orchestrator/classic-launcher.js');
    const { AppHandle } = await import('../../src/orchestrator/app-handle.js');
    const dir = await directory();
    await writeFile(join(dir, 'child.mjs'), `import fs from 'node:fs';
fs.mkdirSync(new URL('./reports/', import.meta.url), { recursive: true });
fs.writeFileSync(process.env.OMNITRON_HEALTH_FILE, JSON.stringify({ schemaVersion: 1, timestamp: Date.now(), runId: process.env.OMNITRON_RUN_ID, status: 'healthy', checks: [{name:'work',status:'pass'}] }));
process.send({type:'ready'}); setInterval(() => {}, 1000);`);
    const entry = { name: 'worker', cwd: dir, script: 'child.mjs', readiness: heartbeat('reports/health.json') };
    const handle = new AppHandle(entry, 'classic');
    const child = await launchClassic(entry, handle, dir, { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never);
    try {
      expect(handle.healthRunId).toMatch(/^[a-f0-9-]{36}$/);
      expect((await checkReadiness(entry.readiness, dir, handle.healthRunId)).status).toBe('healthy');
    } finally {
      await new Promise<void>(resolve => { child.once('exit', () => resolve()); child.kill('SIGTERM'); });
    }
  });
});
