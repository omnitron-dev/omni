// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServer, type RequestListener } from 'node:http';
import { HttpClient } from '../../../src/client/http-client.js';
import { NetronClient } from '../../../src/client/index.js';
import { MultiBackendClient } from '../../../src/client/multi-backend-client.js';
import { MiddlewareStage } from '../../../src/middleware/index.js';
const nativeFetch = globalThis.fetch;
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });
async function server(handler: RequestListener) {
  const server = createServer(handler);
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected TCP listener');
  return { url: `http://127.0.0.1:${address.port}`, close: async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  } };
}
function scriptedResponse(reply: (id: string) => unknown, status = 200) {
  const fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    const request = JSON.parse(String(init?.body));
    expect(new Headers(init?.headers).get('X-Request-ID')).toBe(request.id);
    expect(request).not.toHaveProperty('signal'); expect(request).not.toHaveProperty('idempotent');
    return new Response(JSON.stringify(reply(request.id)), { status });
  });
  vi.stubGlobal('fetch', fetch); return fetch;
}
describe('invocation lifetime', () => {
  it('times out after headers when a real HTTP server never finishes the body', async () => {
    vi.stubGlobal('fetch', nativeFetch); let closed = false;
    const host = await server((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' }); res.write('{"id":');
      res.once('close', () => { closed = true; });
    });
    try {
      const client = new HttpClient({ url: host.url, timeout: 100 });
      await expect(client.invoke('Knowledge', 'read', [])).rejects.toMatchObject({ code: 'TIMEOUT' });
      await expect.poll(() => closed).toBe(true); expect(client.getMetrics().requestsSent).toBe(1);
    } finally { await host.close(); }
  });
  it('propagates MultiBackend cancellation through the real HTTP body without replay', async () => {
    vi.stubGlobal('fetch', nativeFetch);
    let observedHeaders!: () => void; const headers = new Promise<void>(resolve => { observedHeaders = resolve; });
    let calls = 0;
    const host = await server((_req, res) => {
      calls++; res.writeHead(200, { 'Content-Type': 'application/json' }); res.write('{'); observedHeaders();
    });
    const client = new MultiBackendClient({ baseUrl: host.url, backends: { site: { path: '', http: { retry: true } } } });
    try {
      const controller = new AbortController(); const reason = new Error('query replaced');
      const rejected = expect(client.invoke('site', 'Knowledge', 'read', [], { signal: controller.signal, idempotent: true })).rejects.toBe(reason);
      await headers; controller.abort(reason); await rejected; expect(calls).toBe(1);
    } finally { await client.destroy(); await host.close(); }
  });
  it('does not send a pre-cancelled invocation through the public client', async () => {
    const fetch = scriptedResponse(id => ({ id, success: true, data: 1 }));
    const controller = new AbortController(); controller.abort();
    await expect(new NetronClient({ url: 'https://example.test' }).invoke('S', 'm', [], { signal: controller.signal }))
      .rejects.toMatchObject({ name: 'AbortError' });
    expect(fetch).not.toHaveBeenCalled();
  });
  it('cancels suspended middleware and never sends after it finishes', async () => {
    const fetch = scriptedResponse(id => ({ id, success: true })); const client = new HttpClient({ url: 'https://example.test' });
    let release!: () => void; client.use(async () => new Promise<void>(resolve => { release = resolve; }));
    const controller = new AbortController(); const call = client.invoke('S', 'write', [], { signal: controller.signal });
    controller.abort(); await expect(call).rejects.toMatchObject({ name: 'AbortError' });
    release(); await Promise.resolve(); expect(fetch).not.toHaveBeenCalled();
  });
  it('never refreshes authentication or retries after cancellation', async () => {
    const controller = new AbortController();
    vi.stubGlobal('fetch', vi.fn(async () => { controller.abort(); throw new TypeError('socket closed'); }));
    const client = new HttpClient({ url: 'https://example.test', retry: true });
    const refresh = vi.fn(async ctx => { ctx.metadata.set('auth:retry', true); }); client.use(refresh, {}, MiddlewareStage.ERROR);
    await expect(client.invoke('S', 'write', [], { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(refresh).not.toHaveBeenCalled(); expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('does not replay an ambiguous POST without an explicit idempotence assertion', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('connection lost after commit')));
    await expect(new HttpClient({ url: 'https://example.test', retry: true }).invoke('S', 'm', []))
      .rejects.toMatchObject({ code: 'NETWORK_ERROR' }); expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('allows explicitly safe replay with the same correlation id and no remaining timers', async () => {
    vi.useFakeTimers(); const ids: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
      const { id } = JSON.parse(init.body); ids.push(id); if (ids.length === 1) throw new TypeError('network failure');
      return new Response(JSON.stringify({ id, success: true, data: 7 }));
    }));
    const call = new HttpClient({ url: 'https://example.test', retry: true }).invoke('S', 'm', [], { idempotent: true });
    await vi.advanceTimersByTimeAsync(1000); await expect(call).resolves.toBe(7);
    expect(ids).toHaveLength(2); expect(ids[0]).toBe(ids[1]); expect(vi.getTimerCount()).toBe(0);
  });
  it('cancels backoff without another request or retained timers', async () => {
    vi.useFakeTimers(); vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('network failure')));
    const controller = new AbortController();
    const call = new HttpClient({ url: 'https://example.test', retry: true }).invoke('S', 'm', [], { idempotent: true, signal: controller.signal });
    const rejected = expect(call).rejects.toMatchObject({ name: 'AbortError' });
    await vi.advanceTimersByTimeAsync(10); controller.abort(); await rejected; await vi.advanceTimersByTimeAsync(30000);
    expect(fetch).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
  });
  it('uses one deadline across retry backoff, not a fresh deadline per attempt', async () => {
    vi.useFakeTimers(); vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('network failure')));
    const rejected = expect(new HttpClient({ url: 'https://example.test', timeout: 500, retry: true })
      .invoke('S', 'm', [], { idempotent: true })).rejects.toMatchObject({ code: 'TIMEOUT' });
    await vi.advanceTimersByTimeAsync(500); await rejected;
    expect(fetch).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
  });
});
describe('RPC envelope authority', () => {
  it.each([
    ['missing success', (id: string) => ({ id, data: 'must not escape' })],
    ['truthy success', (id: string) => ({ id, success: 'yes', data: 'must not escape' })],
    ['missing id', () => ({ success: true, data: 'must not escape' })],
    ['wrong id', () => ({ id: 'other', success: true, data: 'must not escape' })],
    ['wrong failed id', () => ({ id: 'other', success: false, error: { code: 401, message: 'wrong session' } })],
    ['malformed error', (id: string) => ({ id, success: false, error: true })],
  ])('rejects %s', async (_label, reply) => {
    scriptedResponse(reply);
    await expect(new HttpClient({ url: 'https://example.test', retry: true }).invoke('S', 'm', [], { idempotent: true }))
      .rejects.toMatchObject({ code: 'INVALID_RESPONSE' }); expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('rejects non-2xx success while preserving the HTTP status', async () => {
    scriptedResponse(id => ({ id, success: true, data: 'forbidden' }), 403);
    await expect(new HttpClient({ url: 'https://example.test' }).invoke('S', 'm', []))
      .rejects.toMatchObject({ code: 'INVALID_RESPONSE', status: 403 });
  });
  it('preserves pre-admission Titan transport failures without an RPC id', async () => {
    scriptedResponse(() => ({ error: true, code: '401', message: 'Authentication required' }), 401);
    await expect(new HttpClient({ url: 'https://example.test' }).invoke('S', 'm', []))
      .rejects.toMatchObject({ code: '401', status: 401, message: 'Authentication required' });
  });
  it('preserves correlated pre-admission shutdown/rate-limit details', async () => {
    scriptedResponse(id => ({ id, success: false, error: { code: 'SHUTTING_DOWN', message: 'Stopping', details: { retryAfter: 1 } } }), 503);
    await expect(new HttpClient({ url: 'https://example.test' }).invoke('S', 'm', []))
      .rejects.toMatchObject({ code: 'SHUTTING_DOWN', status: 503, details: { retryAfter: 1 } });
  });
  it('keeps bounded metrics with an exact arithmetic mean', async () => {
    let clock = 0; vi.spyOn(performance, 'now').mockImplementation(() => clock += 5);
    scriptedResponse(id => ({ id, success: true, data: 1 })); const client = new HttpClient({ url: 'https://example.test' });
    for (let i = 0; i < 1000; i++) await client.invoke('S', 'm', []);
    expect(client.getMetrics()).toMatchObject({ requestsSent: 1000, responsesReceived: 1000, avgLatency: 5, errors: 0 });
    // Resource invariant: instrumentation must not retain one sample per request.
    expect(JSON.stringify((client as unknown as { metrics: unknown }).metrics).length).toBeLessThan(256);
  });
});
