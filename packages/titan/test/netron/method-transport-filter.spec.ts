import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Netron } from '../../src/netron/netron.js';
import { Public, Service } from '../../src/decorators/core.js';
import { AuthenticationManager } from '../../src/netron/auth/authentication-manager.js';
import { WebSocketTransport } from '../../src/netron/transport/websocket/index.js';
import { TcpTransport } from '../../src/netron/transport/tcp-transport.js';
import { canonicalTransportName, normalizeTransportPolicy, transportSurfaceAllowed } from '../../src/netron/transport-policy.js';
import type { RemotePeer } from '../../src/netron/remote-peer.js';
import { createMockLogger } from './test-utils.js';

@Service('WireTransportProbe')
class Probe {
  calls: string[] = [];
  reads = 0; writes = 0; value = 'initial';
  @Public({ transports: ['ws'] }) ws() { this.calls.push('ws'); return 'ws'; }
  @Public({ transports: ['unix'] }) unix() { this.calls.push('unix'); return 'unix'; }
  @Public({ transports: ['http'] }) http() { this.calls.push('http'); return 'http'; }
  @Public({ transports: [] }) nowhere() { this.calls.push('nowhere'); return 'nowhere'; }
  @Public() any() { this.calls.push('any'); return 'any'; }
  @Public({ transports: ['ws'], auth: { permissions: ['probe:admin'] } })
  protected() { this.calls.push('protected'); return 'protected'; }
  @Public({ transports: ['ws'] }) get setting() { this.reads++; return this.value; }
  set setting(value: string) { this.writes++; this.value = value; }
  @Public({ transports: ['tcp'] }) async *stream() { this.calls.push('stream'); yield 'secret'; }
  @Public() nested() { return new Nested(); }
  @Public() forbiddenNested() { return new TcpOnly(); }
}
@Service('NestedTransportProbe')
class Nested {
  @Public({ transports: ['ws'] }) ws() { return 'nested-ws'; }
  @Public({ transports: ['unix'] }) unix() { return 'nested-unix'; }
}
@Service({ name: 'TcpOnlyWire', transports: [new TcpTransport()] })
class TcpOnly {
  calls = 0;
  @Public({ transports: ['ws', 'unix'] }) widen() { this.calls++; return 'forbidden'; }
}
@Service({ name: 'WebsocketService', transports: [new WebSocketTransport()] })
class WebsocketService { @Public() open() { return 'websocket-service'; } }

const resources: Array<{ server: Netron; client: Netron; unixClient: Netron; directory: string }> = [];
afterEach(async () => {
  for (const r of resources.splice(0).reverse()) {
    await r.client.stop(); await r.unixClient.stop(); await r.server.stop(); await rm(r.directory, { recursive: true, force: true });
  }
});
async function fixture(initial: boolean) {
  const logger = createMockLogger();
  const directory = await mkdtemp(join(tmpdir(), 'netron-transport-'));
  const server = new Netron(logger); const client = new Netron(logger); const unixClient = new Netron(logger);
  resources.push({ server, client, unixClient, directory });
  server.configureAuth(new AuthenticationManager(logger, {
    authenticate: async creds => ({ userId: creds.username ?? '', roles: [], permissions: creds.username === 'admin' ? ['probe:admin'] : [] }),
  }));
  server.registerTransportServer('ws', { name: 'ws', options: { host: '127.0.0.1', port: 0 } });
  server.registerTransportServer('unix', { name: 'unix', options: { path: join(directory, 'socket') } });
  const probe = new Probe(); const restricted = new TcpOnly();
  const expose = async () => {
    const definition = await server.peer.exposeService(probe);
    const forbidden = await server.peer.exposeService(restricted);
    await server.peer.exposeService(new WebsocketService());
    return { definition, forbidden };
  };
  const early = initial ? await expose() : undefined;
  await server.start(); await client.start(); await unixClient.start();
  const defs = early ?? await expose();
  const ws = await client.connect(`ws://127.0.0.1:${server.transportServers.get('ws')!.port}`) as RemotePeer;
  const unix = await unixClient.connect(`unix://${join(directory, 'socket')}`) as RemotePeer;
  return { server, client, probe, restricted, ws, unix, ...defs };
}

describe('remote service/member transport intersection', () => {
  it.each([true, false])('enforces real WS and Unix ingress, initial=%s', async initial => {
    const f = await fixture(initial);
    for (const [peer, own, other] of [[f.ws, 'ws', 'unix'], [f.unix, 'unix', 'ws']] as const) {
      const proxy = await peer.queryInterface<Record<string, () => Promise<unknown>>>('WireTransportProbe');
      expect(await proxy[own]!()).toBe(own);
      expect(() => proxy[other]).toThrow(/Unknown member/);
      expect(() => proxy['http']).toThrow(/Unknown member/);
      expect(() => proxy['nowhere']).toThrow(/Unknown member/);
      expect(await proxy['any']!()).toBe('any');
      // Bypass interface projection with both a known definition ID and service name.
      peer.definitions.set('WireTransportProbe', f.definition);
      for (const id of [f.definition.id, 'WireTransportProbe']) {
        for (const method of [other, 'http', 'nowhere', 'stream'])
          await expect(peer.call(id, method, [])).rejects.toMatchObject({ code: 404 });
      }
      await expect(peer.queryInterface('TcpOnlyWire')).rejects.toMatchObject({ code: 404 });
      peer.definitions.set(f.forbidden.id, f.forbidden);
      await expect(peer.call(f.forbidden.id, 'widen', [])).rejects.toMatchObject({ code: 404 });
      const nested = await proxy['nested']!() as Record<string, () => Promise<string>>;
      expect(await nested[own]!()).toBe(`nested-${own}`);
      expect(() => nested[other]).toThrow(/Unknown member/);
      await expect(proxy['forbiddenNested']!()).rejects.toMatchObject({ code: 404 });
    }
    expect(f.restricted.calls).toBe(0);
    expect(f.probe.calls).toEqual(['ws', 'any', 'unix', 'any']);
    expect(Object.keys(f.definition.meta.methods)).toContain('http'); // Global definition was not narrowed.
    expect(await (await f.ws.queryInterface<{ open(): Promise<string> }>('WebsocketService')).open()).toBe('websocket-service');
    await expect(f.unix.queryInterface('WebsocketService')).rejects.toMatchObject({ code: 404 });
    // A real provider's trusted in-process call is still local, regardless of transport tags.
    expect(await f.server.peer.call(f.definition.id, 'nowhere', [])).toBe('nowhere');
  });

  it('guards property read/write, role checks and callbacks independently of discovery', async () => {
    const f = await fixture(false);
    await f.ws.queryInterface('WireTransportProbe'); await f.unix.queryInterface('WireTransportProbe');
    await expect(f.unix.get(f.definition.id, 'setting')).rejects.toMatchObject({ code: 404 });
    await expect(f.unix.set(f.definition.id, 'setting', 'attacker')).rejects.toMatchObject({ code: 404 });
    expect([f.probe.reads, f.probe.writes, f.probe.value]).toEqual([0, 0, 'initial']);
    expect(await f.ws.get(f.definition.id, 'setting')).toBe('initial');
    await f.ws.set(f.definition.id, 'setting', 'accepted');
    expect(f.probe.value).toBe('accepted');
    await expect(f.ws.call(f.definition.id, 'protected', [])).rejects.toMatchObject({ code: 401 });
    await f.ws.runTask('authenticate', { username: 'viewer', password: 'fixture' });
    await expect(f.ws.call(f.definition.id, 'protected', [])).rejects.toMatchObject({ code: 403 });
    await f.ws.runTask('authenticate', { username: 'admin', password: 'fixture' });
    expect(await f.ws.call(f.definition.id, 'protected', [])).toBe('protected');
    await f.unix.runTask('authenticate', { username: 'admin', password: 'fixture' });
    await expect(f.unix.call(f.definition.id, 'protected', [])).rejects.toMatchObject({ code: 404 });
    // Server invokes a service on the connection's initiating client.
    const callback = new Probe(); const callbackDef = await f.client.peer.exposeService(callback);
    const accepted = [...f.server.peers.values()].find(peer => (peer as RemotePeer).transportName === 'websocket') as RemotePeer;
    const callbackProxy = await accepted.queryInterface<Record<string, () => Promise<string>>>('WireTransportProbe');
    expect(await callbackProxy['ws']!()).toBe('ws');
    await expect(accepted.call(callbackDef.id, 'http', [])).rejects.toMatchObject({ code: 404 });
    expect(callback.calls).toEqual(['ws']);
  });

  it('validates declarations and preserves custom names without widening unknown identity', () => {
    expect(canonicalTransportName('ws')).toBe('websocket');
    expect(normalizeTransportPolicy(['ws', 'websocket', 'vendor+secure'])).toEqual(['websocket', 'vendor+secure']);
    expect(transportSurfaceAllowed(['vendor+secure'], ['vendor+secure'], 'vendor+secure')).toBe(true);
    expect(transportSurfaceAllowed(['tcp'], ['http'], 'http')).toBe(false);
    expect(transportSurfaceAllowed(undefined, [], 'http')).toBe(false);
    expect(transportSurfaceAllowed(undefined, ['http'], undefined)).toBe(false);
    expect(transportSurfaceAllowed(undefined, undefined, undefined)).toBe(true);
    expect(() => Service({ name: 'Invalid', transports: null as never })(class {})).toThrow();
    expect(() => Service({ name: 'Invalid', transports: [null] as never })(class {})).toThrow();
    for (const value of [null, 'http', [null], [''], [' '], ['http\n']]) {
      expect(() => normalizeTransportPolicy(value)).toThrow();
      expect(() => Public({ transports: value as string[] })({}, 'method')).toThrow();
    }
  });
});
