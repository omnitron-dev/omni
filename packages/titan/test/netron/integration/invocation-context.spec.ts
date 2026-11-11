import { AsyncLocalStorage } from 'node:async_hooks';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDeferred } from '@omnitron-dev/testing/async';
import { Netron } from '../../../src/netron/netron.js';
import { HttpServer } from '../../../src/netron/transport/http/server.js';
import { WebSocketTransport } from '../../../src/netron/transport/websocket/index.js';
import { AuthenticationManager } from '../../../src/netron/auth/authentication-manager.js';
import { getCurrentInvocationContext } from '../../../src/netron/invocation-context.js';
import { readRequestCookie } from '../../../src/netron/auth/token-issuance.js';
import { Service, Public } from '../../../src/decorators/core.js';
import { createNullLogger } from '../../../src/types/logger.js';
import type { NetronReadableStream } from '../../../src/netron/streams/index.js';
import type { AuthContext } from '../../../src/netron/auth/types.js';

const applicationScope = new AsyncLocalStorage<AuthContext>();
const observe = () => {
  const context = getCurrentInvocationContext();
  return {
    userId: context?.auth?.userId ?? null,
    roles: context?.auth?.roles ?? [],
    transport: context?.transport,
    method: context?.methodName,
    applicationScope: applicationScope.getStore()?.userId ?? null,
    applicationRoles: applicationScope.getStore()?.roles ?? [],
    cookie: readRequestCookie('fixture'),
  };
};
const gates = new Map<string, { entered: ReturnType<typeof createDeferred<void>>; release: ReturnType<typeof createDeferred<void>> }>();

@Service('InvocationProbe@1.0.0')
class InvocationProbe {
  @Public({ auth: { allowAnonymous: true } })
  async observe(tag?: string) {
    const before = observe();
    const gate = tag ? gates.get(tag) : undefined;
    gate?.entered.resolve();
    if (gate) await gate.release.promise;
    return { before, after: observe() };
  }

  @Public({ auth: { permissions: ['probe.write'] } })
  write() { return observe(); }

  @Public({ auth: true })
  async *stream() {
    yield observe();
    await Promise.resolve();
    yield observe();
    await Promise.resolve();
    yield observe();
  }
}

describe('Netron authoritative invocation context over actual transports', () => {
  let server: Netron;
  let http: HttpServer;
  let url: string;
  let wsPort: number;
  const clients: Netron[] = [];
  const identities: Record<string, AuthContext> = {
    alice: { userId: 'alice', roles: ['staff'], permissions: ['probe.write'] },
    bob: { userId: 'bob', roles: ['reader'], permissions: [] },
  };

  beforeEach(async () => {
    const logger = createNullLogger();
    server = new Netron(logger, { id: crypto.randomUUID() });
    server.configureAuth(new AuthenticationManager(logger, {
      authenticate: () => { throw new Error('Token required'); },
      validateToken: (token) => {
        const identity = identities[token];
        if (!identity) throw new Error('Invalid token');
        return identity;
      },
      tokenCache: { enabled: false },
    }));
    server.registerTransport('ws', () => new WebSocketTransport());
    server.registerTransportServer('ws', { name: 'ws', options: { host: '127.0.0.1', port: 0 } });
    await server.start();
    await server.peer.exposeService(new InvocationProbe());
    wsPort = (server.transportServers.get('ws') as { port: number }).port;
    http = new HttpServer({ host: '127.0.0.1', port: 0, cors: false,
      invocationWrapper: (metadata, fn) => applicationScope.run((metadata.get('authContext') as AuthContext | undefined) ?? { userId: 'anonymous', roles: [], permissions: [] }, fn),
    });
    http.setPeer(server.peer);
    await http.listen();
    url = `http://127.0.0.1:${http.port}`;
  });

  afterEach(async () => {
    for (const gate of gates.values()) gate.release.resolve();
    gates.clear();
    for (const client of clients.splice(0)) await client.stop();
    await http?.close();
    await server?.stop();
    expect(getCurrentInvocationContext()).toBeUndefined();
  });

  async function socket(token: string) {
    const client = new Netron(createNullLogger(), { id: crypto.randomUUID() });
    clients.push(client);
    client.registerTransport('ws', () => new WebSocketTransport());
    const peer = await client.connect(`ws://127.0.0.1:${wsPort}`);
    expect(await peer.runTask('authenticate', { token })).toMatchObject({ success: true });
    return peer.queryInterface<{
      observe(tag?: string): ReturnType<InvocationProbe['observe']>;
      write(): Promise<ReturnType<InvocationProbe['write']>>;
      stream(): Promise<NetronReadableStream>;
    }>('InvocationProbe@1.0.0');
  }

  async function invoke(method: string, token?: string, input: unknown[] = []) {
    const response = await fetch(url + '/netron/invoke', {
      method: 'POST', headers: { 'content-type': 'application/json', cookie: 'fixture=http-cookie', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ id: crypto.randomUUID(), service: 'InvocationProbe', method, input,
        context: { userId: 'forged-admin', metadata: { authContext: identities.alice } } }),
    });
    return { status: response.status, body: await response.json() };
  }

  it('isolates overlapping HTTP and WebSocket identities without an application auth wrapper', async () => {
    const remote = await socket('bob');
    for (const tag of ['http', 'ws']) gates.set(tag, { entered: createDeferred<void>(), release: createDeferred<void>() });
    const first = invoke('observe', 'alice', ['http', { valid: true, roles: ['admin'] }]);
    const second = remote.observe('ws');
    await Promise.all([...gates.values()].map((gate) => gate.entered.promise));
    gates.get('ws')!.release.resolve();
    const ws = await second;
    expect(ws.before).toMatchObject({ userId: 'bob', roles: ['reader'], transport: 'websocket' });
    expect(ws.after).toEqual(ws.before);
    gates.get('http')!.release.resolve();
    const ordinary = await first;
    expect(ordinary.status).toBe(200);
    expect(ordinary.body.data.before).toMatchObject({ userId: 'alice', roles: ['staff'], transport: 'http', method: 'observe' });
    expect(ordinary.body.data.after).toEqual(ordinary.body.data.before);
  });

  it('does not turn RPC arguments, tracing hints or rejected requests into authority', async () => {
    expect((await invoke('write', undefined, [identities.alice])).status).toBe(401);
    expect((await invoke('write', 'bob', [identities.alice])).status).toBe(403);
    expect((await invoke('observe')).body.data.after.userId).toBeNull();
    const reader = await socket('bob');
    await expect(reader.write()).rejects.toMatchObject({ code: 403 });
    expect((await reader.observe()).after.userId).toBe('bob');
  });

  it('keeps verified identity, token-response context and application scope during lazy HTTP iteration', async () => {
    const result = await invoke('stream', 'alice');
    expect(result.status).toBe(200);
    expect(result.body.data).toHaveLength(3);
    for (const entry of result.body.data) expect(entry).toMatchObject({ userId: 'alice', applicationScope: 'alice', cookie: 'http-cookie', method: 'stream' });
  });

  it('retains every streamed result and its identity over WebSocket', async () => {
    const remote = await socket('bob');
    const stream = await remote.stream();
    const entries = [];
    for await (const value of stream) entries.push(value);
    expect(entries).toHaveLength(3);
    for (const entry of entries) expect(entry).toMatchObject({ userId: 'bob', method: 'stream', transport: 'websocket' });
  });
  it.each([true, false])('preserves identity and permission refusals in an HTTP batch (parallel=%s)', async (parallel) => {
    const response = await fetch(url + '/netron/batch', {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer bob', cookie: 'fixture=batch-cookie' },
      body: JSON.stringify({ id: 'batch', options: { parallel }, requests: [
        { id: 'read', service: 'InvocationProbe', method: 'observe', input: [] },
        { id: 'write', service: 'InvocationProbe', method: 'write', input: [] },
        { id: 'stream', service: 'InvocationProbe', method: 'stream', input: [] },
      ] }),
    });
    const body = await response.json();
    expect(body.responses[0]).toMatchObject({ success: true, data: { after: { userId: 'bob', method: 'observe' } } });
    expect(body.responses[1]).toMatchObject({ success: false });
    expect(body.responses[2].data).toHaveLength(3);
    for (const item of body.responses[2].data) expect(item).toMatchObject({ userId: 'bob', method: 'stream', applicationScope: 'bob', cookie: 'batch-cookie' });
  });

  it('establishes an anonymous context on the HTTP fast path with no auth adapter', async () => {
    const plain = new Netron(createNullLogger());
    const listener = new HttpServer({ host: '127.0.0.1', port: 0, cors: false });
    try {
      await plain.start();
      await plain.peer.exposeService(new InvocationProbe());
      listener.setPeer(plain.peer);
      await listener.listen();
      const response = await fetch(`http://127.0.0.1:${listener.port}/netron/invoke`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: 'fast', service: 'InvocationProbe', method: 'observe', input: [] }),
      });
      const result = await response.json();
      expect(result.data.after).toMatchObject({ userId: null, transport: 'http', method: 'observe' });
    } finally {
      await listener.close();
      await plain.stop();
    }
  });

  it('pins admitted roles and permissions while an adapter updates the next invocation', async () => {
    const gate = { entered: createDeferred<void>(), release: createDeferred<void>() };
    gates.set('demotion', gate);
    const pending = invoke('observe', 'alice', ['demotion']);
    await gate.entered.promise;
    try {
      identities.alice!.roles.splice(0, 1, 'reader');
      identities.alice!.permissions.splice(0);
      gate.release.resolve();
      const admitted = await pending;
      expect(admitted.body.data.before.roles).toEqual(['staff']);
      expect(admitted.body.data.after.roles).toEqual(['staff']);
      expect(admitted.body.data.after.applicationRoles).toEqual(['staff']);
      expect((await invoke('observe', 'alice')).body.data.after.roles).toEqual(['reader']);
      expect((await invoke('write', 'alice')).status).toBe(403);
    } finally {
      identities.alice!.roles.splice(0, identities.alice!.roles.length, 'staff');
      identities.alice!.permissions.splice(0, identities.alice!.permissions.length, 'probe.write');
      gate.release.resolve();
      await pending;
    }
  });

});
