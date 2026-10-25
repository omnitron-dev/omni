import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { HostIngressService } from '../../src/infrastructure/host-ingress.service.js';
import { checkIngressConflicts, normalizeIngressApplication, normalizeIngressSettings, renderHostIngress } from '../../src/infrastructure/host-ingress-config.js';
import { DockerHostIngressRuntime } from '../../src/infrastructure/host-ingress-runtime.js';
import type { HostIngressApply, HostIngressRuntime, HostIngressSettings } from '../../src/infrastructure/host-ingress-types.js';
import type { IngressLock } from '../../src/infrastructure/host-ingress-lock.js';

let root: string, certs: string, settings: HostIngressSettings, runtime: FakeRuntime, service: HostIngressService;
let serial: Promise<unknown> = Promise.resolve();
const lock: IngressLock = async (_file, body) => { const next = serial.then(body, body); serial = next.catch(() => {}); return next; };
class FakeRuntime implements HostIngressRuntime {
  active: string | null = null;
  failure: 'validate' | 'activate' | 'acknowledge' | null = null;
  persistent = false;
  removed = 0;
  activations = 0;
  constructor(readonly directory: string) {}
  async inspect() { return { exists: this.active !== null, running: this.active !== null }; }
  fail(at: string) { if (this.failure === at) { if (!this.persistent) this.failure = null; throw new Error(`injected ${at} failure`); } }
  async validate() { this.fail('validate'); }
  async activate() { this.activations++; this.fail('activate'); this.active = path.basename(await fs.readlink(path.join(this.directory, 'current'))); }
  async acknowledge(_settings: HostIngressSettings, generation: string) { this.fail('acknowledge'); if (this.active !== generation) throw new Error('wrong observed generation'); }
  async observed() { return this.active; }
  async remove() { this.removed++; this.active = null; }
}
function app(name = 'a', port = 4611): HostIngressApply {
  return { expectedGeneration: null, owner: { project: `project-${name}`, stack: 'production', app: 'api' }, reservedPorts: [port, port + 1], routes: [{ domains: [`${name}.example.test`], tls: { certificate: 'certificate.pem', privateKey: 'key.pem' }, locations: [{ path: '/netron', deny: 404 }, { path: '/api/site/', upstream: { host: '127.0.0.1', port }, stripPrefix: true }, { path: '/', upstream: { host: '127.0.0.1', port }, stripPrefix: false }] }] };
}
beforeEach(async () => {
  serial = Promise.resolve(); root = await fs.mkdtemp(path.join(os.tmpdir(), 'omni-ingress-test-')); certs = path.join(root, 'source'); await fs.mkdir(certs);
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', path.join(certs, 'key.pem'), '-out', path.join(certs, 'certificate.pem'), '-days', '1', '-subj', '/CN=ignored.example.test', '-addext', 'subjectAltName=DNS:a.example.test,DNS:b.example.test,DNS:*.wild.example.test'], { stdio: 'ignore' });
  settings = normalizeIngressSettings({ image: `openresty/openresty@sha256:${'a'.repeat(64)}`, httpPort: 18080, httpsPort: 18443, controlPort: 18280, certificateRoot: certs, proxyPolicy: { mode: 'direct', trustedCidrs: [] } });
  runtime = new FakeRuntime(path.join(root, 'state')); service = new HostIngressService(path.join(root, 'state'), runtime, lock); await service.configure(settings);
});
afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });

describe('host ingress ownership and publication', () => {
  it('preflights TLS, domains and all ports without snapshots, publication or claiming reservations', async () => {
    const result = await service.check(app()); expect(result).toMatchObject({ valid: true, generation: null, nativeConfigValidated: false, reservedPorts: [4611, 4612] });
    expect((await service.status()).generation).toBe(null); expect(runtime.active).toBe(null);
    await expect(fs.stat(path.join(service.root, 'certificates'))).rejects.toMatchObject({ code: 'ENOENT' });
    const first = await service.apply(app()); const other = app('b', 4710); other.reservedPorts.push(4612);
    await expect(service.check({ ...other, expectedGeneration: first.generation })).rejects.toThrow('TCP port 4612');
    expect((await service.status()).generation).toBe(first.generation);
  });
  it('retains two tenants, reserves all service ports, and removes only the exact owner', async () => {
    const first = await service.apply(app()); const second = await service.apply({ ...app('b', 4710), expectedGeneration: first.generation });
    expect((await service.status()).applications).toHaveLength(2);
    const wrong = app('b', 4810); wrong.reservedPorts.push(4612);
    await expect(service.apply({ ...wrong, expectedGeneration: second.generation })).rejects.toThrow('TCP port 4612');
    const removed = await service.remove({ owner: app().owner, expectedGeneration: second.generation });
    expect((await service.status()).applications.map((a) => a.owner)).toEqual([app('b').owner]); expect(removed.observedGeneration).toBe(removed.generation);
  });
  it('requires CAS even for same owner, and identical content has one generation', async () => {
    const first = await service.apply(app()); await expect(service.apply(app())).rejects.toThrow('generation conflict');
    const activations = runtime.activations;
    const repeat = await service.apply({ ...app(), expectedGeneration: first.generation }); expect(runtime.activations).toBe(activations); expect(repeat.changed).toBe(false); expect(repeat.generation).toBe(first.generation);
    const results = await Promise.allSettled(['a', 'b'].map((name, i) => service.apply({ ...app(name, 4810 + i * 10), expectedGeneration: first.generation })));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1); expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
  });
  it('rejects duplicate normalized domain across owners without changing the active generation', async () => {
    const first = await service.apply(app()); const other = app('b', 4710); other.routes[0]!.domains = ['A.Example.Test.'];
    await expect(service.apply({ ...other, expectedGeneration: first.generation })).rejects.toThrow('Domain a.example.test'); expect(runtime.active).toBe(first.generation);
  });
  it.each(['validate', 'activate', 'acknowledge'] as const)('restores the previous two-tenant configuration when %s fails', async (failure) => {
    const first = await service.apply(app()); const second = await service.apply({ ...app('b', 4710), expectedGeneration: first.generation });
    runtime.failure = failure;
    await expect(service.apply({ ...app('a', 4810), expectedGeneration: second.generation })).rejects.toThrow('failure');
    const state = await service.status(); expect(state.generation).toBe(second.generation); expect(state.observedGeneration).toBe(second.generation); expect(state.applications).toHaveLength(2); expect(state.recoveryPending).toBe(false);
  });
  it('keeps a recovery journal after rollback failure, and a new service recovers it', async () => {
    const first = await service.apply(app()); runtime.failure = 'activate'; runtime.persistent = true;
    await expect(service.apply({ ...app('a', 4810), expectedGeneration: first.generation })).rejects.toThrow('rollback needs recovery');
    expect((await service.status()).recoveryPending).toBe(true); runtime.failure = null;
    const restarted = new HostIngressService(service.root, runtime, lock); const state = await restarted.recover();
    expect(state.generation).toBe(first.generation); expect(state.observedGeneration).toBe(first.generation); expect(state.recoveryPending).toBe(false);
  });
  it('undoes an initial failed publication instead of reporting an active generation', async () => {
    runtime.failure = 'acknowledge'; await expect(service.apply(app())).rejects.toThrow('previous generation restored');
    expect((await service.status()).generation).toBe(null); expect(runtime.active).toBe(null); expect(runtime.removed).toBe(1);
  });
  it('recovers both crash windows using durable journal state, not process memory', async () => {
    const first = await service.apply(app()); const second = await service.apply({ ...app('b', 4710), expectedGeneration: first.generation });
    const { createHash } = await import('node:crypto');
    const journal = { version: 1, previous: first.generation, candidate: second.generation, phase: 'prepared', settingsHash: createHash('sha256').update(JSON.stringify(settings)).digest('hex') };
    await fs.writeFile(path.join(service.root, 'pending.json'), JSON.stringify(journal));
    expect((await service.recover()).generation).toBe(first.generation);
    await fs.unlink(path.join(service.root, 'current')); await fs.symlink(`generations/${second.generation}`, path.join(service.root, 'current'));
    await fs.writeFile(path.join(service.root, 'pending.json'), JSON.stringify({ ...journal, phase: 'acknowledged' }));
    expect((await service.recover()).generation).toBe(second.generation); expect(runtime.active).toBe(second.generation);
  });
  it('reuses other tenants TLS snapshots without touching their external key files', async () => {
    const first = await service.apply(app()); await fs.rename(path.join(certs, 'certificate.pem'), path.join(certs, 'b.pem')); await fs.rename(path.join(certs, 'key.pem'), path.join(certs, 'b.key'));
    const second = app('b', 4710); second.routes[0]!.tls = { certificate: 'b.pem', privateKey: 'b.key' };
    await service.apply({ ...second, expectedGeneration: first.generation }); expect((await service.status()).applications).toHaveLength(2);
  });
  it('checks SAN rather than CN, rejects key mismatch, and rejects certificate path escape', async () => {
    const request = app(); request.routes[0]!.domains = ['ignored.example.test']; await expect(service.apply(request)).rejects.toThrow('SAN');
    execFileSync('openssl', ['genrsa', '-out', path.join(certs, 'wrong.key'), '2048'], { stdio: 'ignore' });
    const mismatch = app(); mismatch.routes[0]!.tls.privateKey = 'wrong.key'; await expect(service.apply(mismatch)).rejects.toThrow('do not match');
    await fs.copyFile(path.join(certs, 'certificate.pem'), path.join(root, 'outside.pem')); await fs.symlink(path.join(root, 'outside.pem'), path.join(certs, 'escape.pem'));
    const escape = app(); escape.routes[0]!.tls.certificate = 'escape.pem'; await expect(service.apply(escape)).rejects.toThrow('escapes');
    const wildcard = app(); wildcard.routes[0]!.domains = ['one.wild.example.test']; expect((await service.apply(wildcard)).changed).toBe(true);
  });
  it('rejects corrupted TLS snapshots on status, idempotence and subsequent publication', async () => {
    const first = await service.apply(app()); const state = await service.status();
    const object = state.applications[0]!.routes[0]!.certificateObject;
    await fs.appendFile(path.join(service.root, 'certificates', object, 'certificate.pem'), '\n');
    await expect(service.status()).rejects.toThrow('TLS snapshot content hash mismatch');
    await expect(service.apply({ ...app(), expectedGeneration: first.generation })).rejects.toThrow('TLS snapshot content hash mismatch');
    await expect(service.apply({ ...app('b', 4710), expectedGeneration: first.generation })).rejects.toThrow('TLS snapshot content hash mismatch');
    expect(runtime.active).toBe(first.generation);
  });

  it('fails closed on modified generation configuration, invalid symlink, and host setting drift', async () => {
    const first = await service.apply(app()); await fs.appendFile(path.join(service.root, 'generations', first.generation, 'nginx.conf'), '# changed');
    await expect(service.status()).rejects.toThrow('content mismatch'); await fs.unlink(path.join(service.root, 'current')); await fs.symlink('/tmp', path.join(service.root, 'current')); await expect(service.status()).rejects.toThrow('current pointer');
    await expect(service.configure({ ...settings, controlPort: 18281 })).rejects.toThrow('immutable');
  });
});

describe('closed ingress schema and proxy policy', () => {
  it('rejects remote upstreams, nginx injection, traversal, port conflicts and ambiguous locations', () => {
    const request = app(); (request.routes[0]!.locations[2] as any).upstream.host = '169.254.169.254'; expect(() => normalizeIngressApplication(request)).toThrow('literal loopback');
    for (const name of ['*.example.test', 'a.example.test;return 200', 'a.example.test/evil', '127.0.0.1']) { const r = app(); r.routes[0]!.domains = [name]; expect(() => normalizeIngressApplication(r)).toThrow(); }
    const duplicate = app(); duplicate.routes[0]!.locations.push({ path: '/netron/', upstream: { host: '127.0.0.1', port: 4611 }, stripPrefix: true }); expect(() => normalizeIngressApplication(duplicate)).toThrow('Duplicate location');
    const traversal = app(); traversal.routes[0]!.tls.certificate = '../key'; expect(() => normalizeIngressApplication(traversal)).toThrow('relative');
    const overlarge = app(); overlarge.routes[0]!.maxBodyBytes = 128 * 1024 * 1024 + 1; expect(() => normalizeIngressApplication(overlarge)).toThrow('maxBodyBytes');
    const conflict = normalizeIngressApplication(app()); conflict.reservedPorts.push(settings.controlPort); expect(() => checkIngressConflicts(settings, [conflict])).toThrow('reserved');
    expect(() => normalizeIngressSettings({ ...settings, proxyPolicy: { mode: 'cloudflare-only', trustedCidrs: ['0.0.0.0/0'] } })).toThrow('CIDR');
  });
  it('renders prefix rewriting, exact and descendant deny, websocket support and socket-peer trust', async () => {
    const first = await service.apply(app()); const state = await service.status();
    const cf = normalizeIngressSettings({ ...settings, proxyPolicy: { mode: 'cloudflare-only', trustedCidrs: ['173.245.48.0/20', '2400:cb00::/32'] } });
    const output = renderHostIngress(cf, { version: 1, sequence: 1, generation: first.generation, applications: state.applications });
    expect(output).toContain('proxy_pass http://127.0.0.1:4611/;'); expect(output).toContain('proxy_pass http://127.0.0.1:4611;'); expect(output).toContain('location = /netron { return 404; }'); expect(output).toContain('location ^~ /netron/ { return 404; }'); expect(output).toContain('proxy_set_header Upgrade $http_upgrade;');
    expect(output).toContain('client_max_body_size 16777216;'); expect(output).toContain('proxy_buffering off;'); expect(output).toContain("log_format ingress_route '$request_method $uri $status';");
    expect(output).toContain('geo $realip_remote_addr $ingress_trusted_proxy'); expect(output).toContain('if ($ingress_trusted_proxy = 0)'); expect(output).toContain('ssl_reject_handshake on'); expect(output).toContain('return 444'); expect(output).toContain('https://$host:18443$request_uri'); expect(output).toContain('proxy_set_header X-Forwarded-For $remote_addr;');
  });
  it('never adopts a foreign host container, and uses no app-managed lifecycle label', async () => {
    const calls: string[][] = []; const exec = async (_file: string, args: string[]) => { calls.push(args); if (args[0] === 'inspect') return JSON.stringify([{ Config: { Labels: {}, Image: settings.image }, HostConfig: { NetworkMode: 'host' }, Mounts: [] }]); return ''; };
    const docker = new DockerHostIngressRuntime(service.root, exec); await expect(docker.inspect(settings)).rejects.toThrow('foreign'); await expect(docker.remove(settings)).rejects.toThrow('foreign'); expect(calls.some((a) => a[0] === 'rm')).toBe(false);
    const commands: string[][] = []; const absent = new DockerHostIngressRuntime(service.root, async (_file, args) => { commands.push(args); if (args[0] === 'inspect') throw new Error('No such container: omnitron-host-ingress'); return ''; });
    await absent.validate(settings, '1-aaaaaaaaaaaaaaaa'); const invocation = commands.find((a) => a[0] === 'run')!;
    expect(invocation).toContain('--read-only'); expect(invocation).toContain('never'); expect(invocation.some((a) => a.includes('omnitron.managed'))).toBe(false); expect(invocation).toContain('-t');
  });
});

it.skipIf(!process.env['OMNITRON_INGRESS_DOCKER_TEST_IMAGE'])('native OpenResty acknowledges generations, isolates hosts, strips prefixes and keeps the second tenant live', async () => {
  const http = await import('node:http'); const https = await import('node:https');
  const serverA = http.createServer((request, response) => { let size = 0; request.on('data', (chunk) => { size += chunk.length; }); request.on('end', () => response.end(request.method === 'POST' ? `bytes:${size}` : `A:${request.url}`)); });
  const serverB = http.createServer((request, response) => { response.end(`B:${request.url}`); });
  await new Promise<void>((resolve) => serverA.listen(28461, '127.0.0.1', resolve));
  await new Promise<void>((resolve) => serverB.listen(28471, '127.0.0.1', resolve));
  const nativeSettings = { ...settings, image: process.env['OMNITRON_INGRESS_DOCKER_TEST_IMAGE']!, httpPort: 28080, httpsPort: 28443, controlPort: 28280 };
  const directory = path.join(root, 'native'); const docker = new DockerHostIngressRuntime(directory);
  const native = new HostIngressService(directory, docker, lock);
  const ca = await fs.readFile(path.join(certs, 'certificate.pem'));
  const get = (host: string, url: string) => new Promise<{ code: number; body: string }>((resolve, reject) => {
    const request = https.get({ host: '127.0.0.1', port: 28443, servername: host, path: url, ca, headers: { Host: host }, agent: false, timeout: 2000 }, (response) => {
      let body = ''; response.on('data', (chunk) => { body += chunk; }); response.on('end', () => resolve({ code: response.statusCode!, body }));
    }); request.on('error', reject); request.on('timeout', () => request.destroy(new Error('HTTPS probe timed out')));
  });
  try {
    const state = await docker.inspect(nativeSettings); if (state.exists) throw new Error('Native ingress fixture requires the dedicated container name to be unused');
    await native.configure(nativeSettings); const first = await native.apply(app('a', 28461));
    const upload = (bytes: number) => new Promise<number>((resolve, reject) => {
      const request = https.request({ host: '127.0.0.1', port: 28443, servername: 'a.example.test', path: '/upload', method: 'POST', ca, headers: { Host: 'a.example.test', 'Content-Length': bytes }, agent: false }, (response) => { response.resume(); response.on('end', () => resolve(response.statusCode!)); });
      request.on('error', reject); request.end(Buffer.alloc(bytes));
    });
    expect(await upload(2 * 1024 * 1024)).toBe(200);
    expect(await get('a.example.test', '/api/site/value')).toEqual({ code: 200, body: 'A:/value' });
    expect((await get('a.example.test', '/netron')).code).toBe(404); expect((await get('a.example.test', '/netron/rpc')).code).toBe(404);
    const second = await native.apply({ ...app('b', 28471), expectedGeneration: first.generation });
    expect(await get('b.example.test', '/hello')).toEqual({ code: 200, body: 'B:/hello' });
    await expect(get('unknown.example.test', '/')).rejects.toThrow();
    await native.remove({ owner: app().owner, expectedGeneration: second.generation });
    expect(await get('b.example.test', '/still-live')).toEqual({ code: 200, body: 'B:/still-live' });
    await expect(get('a.example.test', '/')).rejects.toThrow();
    const third = await native.status(); const limited = app('b', 28471); limited.routes[0]!.maxBodyBytes = 1024;
    await native.apply({ ...limited, expectedGeneration: third.generation });
    const limitedPost = await new Promise<number>((resolve, reject) => { const request = https.request({ host: '127.0.0.1', port: 28443, servername: 'b.example.test', path: '/', method: 'POST', ca, headers: { Host: 'b.example.test', 'Content-Length': 2048 }, agent: false }, (response) => { response.resume(); response.on('end', () => resolve(response.statusCode!)); }); request.on('error', reject); request.end(Buffer.alloc(2048)); });
    expect(limitedPost).toBe(413);
  } finally {
    await docker.remove(nativeSettings);
    await Promise.all([new Promise<void>((resolve) => serverA.close(() => resolve())), new Promise<void>((resolve) => serverB.close(() => resolve()))]);
  }
});


it.skipIf(!process.env['OMNITRON_INGRESS_DOCKER_TEST_IMAGE'])('native Linux kernel lock excludes concurrent publishers and releases after process death', () => {
  const source = path.resolve(import.meta.dirname, '../../src/infrastructure/host-ingress-lock.ts');
  const fixture = path.resolve(import.meta.dirname, '../fixtures/host-ingress-lock.mjs');
  const output = execFileSync('docker', ['run', '--rm', '--pull', 'never', '--network', 'none', '--memory', '128m', '--cpus', '1', '--read-only', '--tmpfs', '/tmp:rw,nosuid,size=4m', '--mount', `type=bind,source=${source},target=/test/host-ingress-lock.ts,readonly`, '--mount', `type=bind,source=${fixture},target=/test/host-ingress-lock.mjs,readonly`, '--entrypoint', 'node', 'node:22.14.0-bookworm-slim', '--experimental-strip-types', '/test/host-ingress-lock.mjs'], { encoding: 'utf8', timeout: 20_000, stdio: ['ignore', 'pipe', 'pipe'] });
  expect(output.trim()).toBe('exclusive; crash released; exception released');
});
