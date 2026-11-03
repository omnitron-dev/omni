import { WebSocket } from 'ws';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Public, Service } from '../../src/decorators/core.js';
import { ErrorCode } from '../../src/errors/index.js';
import { Netron, TransportRequestLimiter } from '../../src/netron/index.js';
import { HttpTransport } from '../../src/netron/transport/http/index.js';
import { createRequestMessage } from '../../src/netron/transport/http/types.js';
import { WebSocketTransport } from '../../src/netron/transport/websocket/index.js';
import { createMockLogger } from './test-utils.js';

const name = 'AdmissionProbe@1.0.0';

@Service(name)
class AdmissionProbe {
  calls = 0;

  @Public()
  async record(): Promise<number> {
    return ++this.calls;
  }
}

describe('shared Netron admission over live HTTP and WebSocket listeners', () => {
  const cleanup: (() => Promise<void>)[] = [];

  afterEach(async () => {
    for (const close of cleanup.splice(0).reverse()) await close();
  });

  async function start(maxRequests: number, globalMaxRequests: number, trustProxy = false) {
    const requestLimiter = new TransportRequestLimiter({ enabled: true, windowMs: 60_000,
      maxRequests, globalMaxRequests, trustProxy });
    const server = new Netron(createMockLogger());
    cleanup.push(() => server.stop());
    server.registerTransport('http', () => new HttpTransport());
    server.registerTransport('ws', () => new WebSocketTransport());
    for (const transport of ['http', 'ws']) {
      server.registerTransportServer(transport, { name: transport, options: { host: '127.0.0.1', port: 0, requestLimiter } });
    }
    await server.start();
    const service = new AdmissionProbe();
    await server.peer.exposeService(service);

    const address = (transport: string) => `${transport}://127.0.0.1:${server.transportServers.get(transport)!.port}`;
    const client = new Netron(createMockLogger());
    cleanup.push(() => client.stop());
    client.registerTransport('ws', () => new WebSocketTransport());
    const call = () => createRequestMessage(name, 'record', []);
    const post = async (endpoint: string, body: unknown, forwarded = '192.0.2.1') => {
      const response = await fetch(address('http') + '/netron/' + endpoint, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': forwarded },
        body: JSON.stringify(body), signal: AbortSignal.timeout(5000),
      });
      return { status: response.status, retryAfter: response.headers.get('Retry-After'), body: await response.json() };
    };
    return { server, service, requestLimiter, client, wsUrl: address('ws'),
      invoke: (forwarded?: string) => post('invoke', call(), forwarded),
      batch: (length: number) => post('batch', { id: crypto.randomUUID(), requests: Array.from({ length }, call) }),
    };
  }

  it('applies the remaining IP budget across both transports and ignores spoofed forwarding headers', async () => {
    const limit = 12;
    const { server, service, requestLimiter, client, wsUrl, invoke } = await start(limit, 100);
    const peer = await client.connect(wsUrl);
    client.addTask(async function receipt(_peer: unknown, id: string) { return id; });
    const probe = await peer.queryInterface<AdmissionProbe>(name);
    const reversePeer = server.peers.get(client.id)!;
    expect(await probe.record()).toBe(1);
    const first = await invoke();
    expect(first.body, JSON.stringify(first.body)).toMatchObject({ success: true, data: 2 });
    const remainder = limit - requestLimiter.getStats().globalCount;
    expect(remainder).toBeGreaterThan(0);
    for (let i = 0; i < remainder; i++) {
      expect((await invoke('198.51.100.' + (i + 1))).status).toBe(200);
    }
    await expect(probe.record()).rejects.toMatchObject({ code: ErrorCode.TOO_MANY_REQUESTS });
    const blocked = await invoke('203.0.113.1');
    expect(blocked.status).toBe(429);
    expect(Number(blocked.retryAfter)).toBeGreaterThan(0);
    // Replies to calls initiated by the other side must still reach the caller.
    expect(await reversePeer.runTask('receipt', 'accepted')).toBe('accepted');
    expect(service.calls).toBe(2 + remainder);

    const upgrade = await new Promise<{ status?: number; retry?: string }>((resolve, reject) => {
      const socket = new WebSocket(wsUrl, { handshakeTimeout: 3000, headers: { 'X-Forwarded-For': '198.51.100.42' } });
      socket.on('error', reject);
      socket.once('open', () => { socket.terminate(); reject(new Error('Exhausted budget accepted a new connection')); });
      socket.once('unexpected-response', (request, response) => {
        response.resume();
        resolve({ status: response.statusCode, retry: response.headers['retry-after'] });
        request.destroy();
      });
    });
    expect(upgrade.status).toBe(429);
    expect(Number(upgrade.retry)).toBeGreaterThan(0);
  });

  it('resumes calls on the existing WebSocket after the shared window expires', async () => {
    const { client, wsUrl, invoke, requestLimiter } = await start(10, 10);
    const peer = await client.connect(wsUrl);
    const service = await peer.queryInterface<AdmissionProbe>(name);
    expect(await service.record()).toBe(1);
    const remaining = 10 - requestLimiter.getStats().globalCount;
    for (let i = 0; i < remaining; i++) expect((await invoke()).status).toBe(200);
    await expect(service.record()).rejects.toMatchObject({ code: ErrorCode.TOO_MANY_REQUESTS });
    // Move only the wall clock across the window; socket deadlines keep their real timers.
    const now = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 60_001);
    try {
      expect(await service.record()).toBe(2 + remaining);
    } finally {
      now.mockRestore();
    }
  });

  it('charges each batch item before any handler runs and shares the global ceiling between clients', async () => {
    const { service, batch, invoke } = await start(3, 6, true);
    const accepted = await batch(2);
    expect(accepted.body, JSON.stringify(accepted.body)).toMatchObject({ responses: [{ success: true }, { success: true }] });
    expect((await batch(2)).status).toBe(429);
    expect(service.calls).toBe(2);
    for (let i = 1; i <= 3; i++) expect((await invoke('198.51.100.' + i)).status).toBe(200);
    expect((await invoke('203.0.113.5')).status).toBe(429);
    expect(service.calls).toBe(5);
  });
});
