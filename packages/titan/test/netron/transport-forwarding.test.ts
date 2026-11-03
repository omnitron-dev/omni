import { afterEach, describe, expect, it, vi } from 'vitest';
import { Netron } from '../../src/netron/netron.js';
import { Public, Service } from '../../src/decorators/core.js';
import { AuthenticationManager } from '../../src/netron/auth/authentication-manager.js';
import { AuthorizationManager } from '../../src/netron/auth/authorization-manager.js';
import type { AuthContext } from '../../src/netron/auth/types.js';
import { Errors } from '../../src/errors/index.js';
import { TcpTransport } from '../../src/netron/transport/tcp-transport.js';
import { createAuthMiddleware } from '../../src/netron/transport/http/middleware/auth.js';
import { HttpNativeServer } from '../../src/netron/transport/http/index.js';
import type { RemotePeer } from '../../src/netron/remote-peer.js';
import type { Definition } from '../../src/netron/definition.js';
import type { Interface } from '../../src/netron/interface.js';
import { createMockLogger } from './test-utils.js';

@Service('ForwardedChild')
class Child {
  calls: string[] = [];
  @Public({ transports: ['tcp'] }) privateHop() { this.calls.push('private'); return 'private'; }
  @Public({ transports: ['tcp', 'http', 'websocket'] }) shared() { this.calls.push('shared'); return 'shared'; }
  @Public({ transports: ['tcp'] }) privateValue = 'private-value';
  @Public({ transports: ['tcp', 'http', 'websocket'] }) sharedValue = 'shared-value';
}

@Service({ name: 'ForwardedPrivateChild', transports: [new TcpTransport()] })
class PrivateChild { @Public() read() { return 'private-child'; } }

@Service('ForwardedProvider')
class Provider {
  calls: string[] = [];
  childInstance = new Child();
  @Public({ transports: ['tcp'] }) privateValue = 'private-value';
  @Public({ transports: ['tcp', 'websocket'] }) sharedValue = 'shared-value';
  @Public({ transports: ['tcp', 'websocket'], readonly: true }) readonlyValue = 'sealed';
  @Public({ transports: ['tcp', 'websocket'], readonly: true }) sharedChild = this.childInstance;
  constructor() {
    let value = this.sharedValue;
    Object.defineProperty(this, 'sharedValue', {
      enumerable: true,
      get: () => value,
      set: (next: string) => {
        if (next === 'reject') throw Errors.conflict('Fixture write rejected');
        value = next;
      },
    });
  }
  @Public({ transports: ['tcp'] }) privateHop() { this.calls.push('private'); return 'private'; }
  @Public({ transports: ['tcp', 'http'] }) shared() { this.calls.push('shared'); return 'shared'; }
  @Public({ auth: { roles: ['admin'] } }) protected() { this.calls.push('protected'); return 'protected'; }
  @Public() child() { return this.childInstance; }
  @Public() privateChild() { return new PrivateChild(); }
}

@Service({ name: 'ForwardedPrivateProvider', transports: [new TcpTransport()] })
class PrivateProvider { @Public() read() { return 'private-provider'; } }

@Service({ name: 'ForwardedVersions', version: '1.0.0' })
class VersionOne { @Public({ transports: ['tcp', 'http'] }) read() { return 'v1'; } }
@Service({ name: 'ForwardedVersions', version: '2.0.0' })
class VersionTwo { @Public({ transports: ['tcp', 'http'] }) read() { return 'v2'; } }

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });

async function fixture(earlyHttp = false, grantForwarding = true) {
  // The provider publishes through the ordinary remote-exposure contract.
  // TCP admits every provider method. The HTTP gateway must still enforce
  // the original declaration rather than trusting its own TCP credentials.
  const gateway = new Netron(createMockLogger(), { allowRemoteServiceExposure: true });
  cleanup.push(() => gateway.stop());
  const authz = new AuthorizationManager(createMockLogger());
  if (grantForwarding) authz.registerACL({ service: 'Forwarded*', allowedRoles: ['admin'] });
  const identity = (token: string): AuthContext => {
    if (!['admin', 'viewer'].includes(token)) throw new Error('Invalid fixture token');
    return { userId: token, roles: [token], permissions: [] };
  };
  gateway.configureAuth(new AuthenticationManager(createMockLogger(), {
    authenticate: credentials => identity(credentials.token ?? credentials.username ?? ''), validateToken: identity,
    tokenCache: { enabled: false },
  }), authz);
  gateway.registerTransportServer('tcp', { name: 'tcp', options: { host: '127.0.0.1', port: 0 } });
  gateway.registerTransportServer('websocket', { name: 'websocket', options: { host: '127.0.0.1', port: 0 } });
  await gateway.start();
  const http = new HttpNativeServer({ host: '127.0.0.1', port: 0 });
  cleanup.push(() => http.close());
  const publishHttp = async () => {
    http.setPeer(gateway.peer);
    gateway.transportServers.set('http', http);
    await http.listen();
  };
  if (earlyHttp) await publishHttp();
  const provider = new Netron(createMockLogger());
  cleanup.push(() => provider.stop());
  provider.configureAuth(new AuthenticationManager(createMockLogger(), {
    authenticate: () => ({ userId: 'trusted-gateway', roles: ['admin'], permissions: [] }),
  }));
  await provider.start();
  const peer = await provider.connect(`tcp://127.0.0.1:${gateway.transportServers.get('tcp')!.port}`) as RemotePeer;
  const instance = new Provider();
  await expect(peer.exposeService(instance), 'Publish provider members over TCP').resolves.toBeDefined();
  await expect(peer.exposeService(new PrivateProvider()), 'Publish a service-restricted provider over TCP').resolves.toBeDefined();
  const upstream = gateway.peers.get(provider.id)! as RemotePeer;
  await upstream.runTask('authenticate', { username: 'gateway', password: 'fixture' });
  const published = gateway.services.get('ForwardedProvider')!.definition;
  expect(await upstream.call(published.id, 'protected', [])).toBe('protected');
  expect(await upstream.call(published.id, 'privateHop', [])).toBe('private');
  instance.calls.length = 0;

  if (!earlyHttp) await publishHttp();
  const invoke = async (method: string, service = 'ForwardedProvider', token: string | undefined = 'admin') => {
    const response = await fetch(`http://127.0.0.1:${http.port}/netron/invoke`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', transport: 'tcp', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ id: 'forwarding', service, method, input: [], context: { transport: 'tcp' } }),
      signal: AbortSignal.timeout(5_000),
    });
    return { status: response.status, body: await response.json() as { success: boolean; data?: Definition; error?: { code: string } } };
  };
  return { gateway, instance, http, invoke, published, providerPeer: peer, authz };
}

describe('transport confinement across an HTTP gateway and TCP provider', () => {
  it.each([false, true])('retains restrictions across remote exposure with early HTTP=%s', async earlyHttp => {
    const f = await fixture(earlyHttp);
    expect(await f.invoke('shared')).toMatchObject({ status: 200, body: { success: true, data: 'shared' } });
    expect(await f.invoke('privateHop')).toMatchObject({ status: 404, body: { success: false } });
    expect(await f.invoke('read', 'ForwardedPrivateProvider')).toMatchObject({ status: 404, body: { success: false } });
    expect(f.instance.calls).toEqual(['shared']);
    // The gateway's view must not narrow the provider's authoritative definition.
    expect(f.published.meta.methods['privateHop']?.transports).toEqual(['tcp']);
    expect(Object.keys(f.published.meta.methods)).toContain('privateHop');
    await expect(f.providerPeer.runTask('expose_service', { name: 'MalformedPublisher', version: '',
      methods: { read: { type: 'string', arguments: [], transports: null } }, properties: {} })).rejects.toMatchObject({ code: 400 });
    expect(f.gateway.services.has('MalformedPublisher')).toBe(false);
  });

  it('preserves exact remote publication versions and unregisters only the selected version', async () => {
    const f = await fixture(true);
    const first = await f.providerPeer.exposeService(new VersionOne());
    const second = await f.providerPeer.exposeService(new VersionTwo());
    expect(f.gateway.services.has('ForwardedVersions')).toBe(false);
    expect(f.gateway.services.get('ForwardedVersions@1.0.0')!.definition.id).toBe(first.id);
    expect(f.gateway.services.get('ForwardedVersions@2.0.0')!.definition.id).toBe(second.id);
    await expect(f.providerPeer.exposeService(new VersionOne())).rejects.toMatchObject({ code: 409 });
    for (const [name, value] of [['ForwardedVersions@1.0.0', 'v1'], ['ForwardedVersions@2.0.0', 'v2'], ['ForwardedVersions', 'v2']]) {
      expect(await f.invoke('read', name)).toMatchObject({ status: 200, body: { success: true, data: value } });
    }
    await f.providerPeer.unexposeService('ForwardedVersions@2.0.0');
    expect(f.gateway.services.has('ForwardedVersions@2.0.0')).toBe(false);
    expect(f.gateway.peer.stubs.has(second.id)).toBe(false);
    expect(await f.invoke('read', 'ForwardedVersions@2.0.0')).toMatchObject({ status: 404, body: { success: false } });
    expect(await f.invoke('read', 'ForwardedVersions@1.0.0')).toMatchObject({ status: 200, body: { success: true, data: 'v1' } });
    expect(await f.invoke('read', 'ForwardedVersions')).toMatchObject({ status: 200, body: { success: true, data: 'v1' } });
    // Ordinary persistent discovery makes the same version choice after removal.
    const client = new Netron(createMockLogger()); cleanup.push(() => client.stop());
    const tcp = await client.connect(`tcp://127.0.0.1:${f.gateway.transportServers.get('tcp')!.port}`) as RemotePeer;
    await tcp.runTask('authenticate', { username: 'admin', password: 'fixture' });
    const latest = await tcp.queryInterface<{ read(): Promise<string> }>('ForwardedVersions');
    expect(await latest.read()).toBe('v1');
    await expect(tcp.queryInterface('ForwardedVersions@2.0.0')).rejects.toMatchObject({ code: 404 });
  });

  it('requires explicit gateway authority instead of borrowing privileged upstream credentials', async () => {
    const f = await fixture(true, false);
    // The provider already authenticated this gateway as admin. The actual
    // inbound caller still has no delegation grant, even if also authenticated.
    expect(await f.invoke('protected')).toMatchObject({ status: 403, body: { success: false } });
    expect(f.instance.calls).toEqual([]);
    const next = vi.fn(async () => {});
    const skipped = createAuthMiddleware({ logger: createMockLogger(), authorizationManager: f.authz,
      skipServices: ['ForwardedProvider'] });
    await expect(skipped({ peer: f.gateway.peer, serviceName: 'ForwardedProvider', methodName: 'protected', transport: 'http',
      metadata: new Map<string, unknown>([['serviceInstance', f.gateway.services.get('ForwardedProvider')!.instance]]),
      timing: { start: 0, middlewareTimes: new Map<string, number>() } }, next)).rejects.toMatchObject({ code: 403 });
    expect(next).not.toHaveBeenCalled();
    f.authz.registerACL({ service: 'Forwarded*', allowedRoles: ['admin'] });
    expect(await f.invoke('protected', 'ForwardedProvider', '')).toMatchObject({ status: 403, body: { success: false } });
    expect(await f.invoke('protected', 'ForwardedProvider', 'viewer')).toMatchObject({ status: 403, body: { success: false } });
    for (const parallel of [false, true]) for (const token of ['', 'viewer']) {
      const item = { service: 'ForwardedProvider', method: 'protected', input: [] };
      const response = await fetch(`http://127.0.0.1:${f.http.port}/netron/batch`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ id: 'delegation', options: { parallel }, requests: [{ ...item, id: 'a' }, { ...item, id: 'b' }] }),
      });
      const batch = await response.json() as { responses: Array<{ success: boolean; error: { code: string } }> };
      expect(batch.responses).toHaveLength(2);
      expect(batch.responses.every(item => !item.success && item.error.code === '403')).toBe(true);
    }
    expect(f.instance.calls).toEqual([]);
    expect(await f.invoke('protected')).toMatchObject({ status: 200, body: { success: true, data: 'protected' } });
    const client = new Netron(createMockLogger()); cleanup.push(() => client.stop());
    const tcp = await client.connect(`tcp://127.0.0.1:${f.gateway.transportServers.get('tcp')!.port}`) as RemotePeer;
    // Invoke a known definition ID directly: discovery is not the guard.
    tcp.definitions.set(f.published.id, f.published);
    await expect(tcp.call(f.published.id, 'protected', [])).rejects.toMatchObject({ code: 403 });
    await tcp.runTask('authenticate', { username: 'viewer', password: 'fixture' });
    await expect(tcp.call(f.published.id, 'protected', [])).rejects.toMatchObject({ code: 403 });
    await tcp.runTask('authenticate', { username: 'admin', password: 'fixture' });
    expect(await tcp.call(f.published.id, 'protected', [])).toBe('protected');
    f.authz.removeACL('Forwarded*');
    await expect(tcp.call(f.published.id, 'protected', [])).rejects.toMatchObject({ code: 403 });
    expect(f.instance.calls).toEqual(['protected', 'protected']);
  });

  it('projects nested remote definitions before exposing them to an HTTP caller', async () => {
    const f = await fixture();
    const nested = await f.invoke('child');
    expect(nested.status).toBe(200);
    expect(nested.body.success).toBe(true);
    expect(Object.keys(nested.body.data!.meta.methods)).toEqual(['shared']);
    expect(Object.keys(nested.body.data!.meta.properties)).toEqual(['sharedValue']);
    expect(nested.body.data!.meta.methods['shared']?.transports).toEqual(['tcp', 'http', 'websocket']);
    expect(nested.body.data!.meta.properties['sharedValue']?.transports).toEqual(['tcp', 'http', 'websocket']);
    expect(await f.invoke('privateChild')).toMatchObject({ status: 404, body: { success: false } });
    expect(f.instance.childInstance.calls).toEqual([]);
    expect([...f.gateway.peer.stubs.values()].some(stub => stub.definition.meta.name === 'ForwardedPrivateChild')).toBe(false);
  });

  it('round-trips allowed forwarded properties, awaits writes and confines nested property results', async () => {
    const f = await fixture();
    const client = new Netron(createMockLogger());
    cleanup.push(() => client.stop());
    const ws = await client.connect(`ws://127.0.0.1:${f.gateway.transportServers.get('websocket')!.port}`) as RemotePeer;
    await ws.runTask('authenticate', { username: 'admin', password: 'fixture' });
    const view = await ws.queryInterface<Interface>('ForwardedProvider');
    const id = view.$def!.id;
    expect(Object.keys(view.$def!.meta.properties).sort()).toEqual(['readonlyValue', 'sharedChild', 'sharedValue']);
    expect(await ws.get(id, 'sharedValue')).toBe('shared-value');
    await ws.set(id, 'sharedValue', 'committed');
    expect(f.instance.sharedValue).toBe('committed');
    expect(await ws.get(id, 'sharedValue')).toBe('committed');
    // The downstream acknowledgment must include the actual upstream outcome.
    await expect(ws.set(id, 'sharedValue', 'reject')).rejects.toMatchObject({ code: 409 });
    expect(f.instance.sharedValue).toBe('committed');
    await expect(ws.get(id, 'privateValue')).rejects.toMatchObject({ code: 404 });
    await expect(ws.set(id, 'privateValue', 'forbidden')).rejects.toMatchObject({ code: 404 });
    await expect(ws.set(id, 'readonlyValue', 'forbidden')).rejects.toMatchObject({ code: 403 });
    expect(f.instance.privateValue).toBe('private-value');
    expect(f.instance.readonlyValue).toBe('sealed');
    const nested = await ws.get(id, 'sharedChild') as Interface;
    expect(Object.keys(nested.$def!.meta.methods)).toEqual(['shared']);
    expect(await ws.call(nested.$def!.id, 'shared', [])).toBe('shared');
    await expect(ws.call(nested.$def!.id, 'privateHop', [])).rejects.toMatchObject({ code: 404 });
    expect(f.instance.childInstance.calls).toEqual(['shared']);
    f.authz.removeACL('Forwarded*');
    await expect(ws.get(id, 'sharedValue')).rejects.toMatchObject({ code: 403 });
    await expect(ws.set(id, 'sharedValue', 'no-grant')).rejects.toMatchObject({ code: 403 });
    expect(f.instance.sharedValue).toBe('committed');
  });
});
