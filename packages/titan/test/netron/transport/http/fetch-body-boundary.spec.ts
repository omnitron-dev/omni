import { describe, expect, it, vi } from 'vitest';
import { HttpServer } from '../../../../src/netron/transport/http/server.js';
import { FetchBodyBoundary } from '../../../../src/netron/transport/http/request-body.js';

function post(path: string, body: BodyInit, headers: Record<string, string> = {}) {
  return new Request('http://localhost' + path, {
    method: 'POST', headers: { 'x-request-id': 'fetch-boundary', ...headers }, body, duplex: 'half',
  } as RequestInit);
}

function upload(parts: Uint8Array[], cancel = vi.fn()) {
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      const part = parts.shift();
      if (part) controller.enqueue(part);
      else controller.close();
    },
    cancel,
  }, { highWaterMark: 0 });
}

describe('Fetch request body admission', () => {
  it.each(['/netron/invoke', '/netron/batch'])('preserves 413 and correlation for chunked %s', async path => {
    const server = new HttpServer({ maxRequestSize: '8b' });
    const cancelled = vi.fn();
    const body = upload([new Uint8Array(5), new Uint8Array(5), new Uint8Array(5)], cancelled);
    const response = await server.handleRequest(post(path, body, { 'content-length': '2' }));
    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({ id: 'fetch-boundary', error: { code: '413' } });
    await vi.waitFor(() => expect(cancelled).toHaveBeenCalledOnce());
  });

  it('refuses oversized declarations before pulling the body or dispatching a custom route', async () => {
    const pull = vi.fn();
    const cancel = vi.fn();
    const handler = vi.fn(async () => new Response('unexpected'));
    const server = new HttpServer({ maxRequestSize: '4b', customRoutes: [handler] });
    const source = new ReadableStream({ pull, cancel }, { highWaterMark: 0 });
    const response = await server.handleRequest(post('/upload', source, { 'content-length': '5' }));
    expect(response.status).toBe(413);
    expect(cancel).toHaveBeenCalledOnce();
    expect(pull).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
  });

  it('bounds the number and lifetime of slow rejected Bun uploads even if cancellation never settles', async () => {
    vi.useFakeTimers();
    try {
      const boundary = new FetchBodyBoundary(1);
      const uploadThatStalls = () => {
        const stalled = Promise.withResolvers<void>();
        const cancel = vi.fn(() => new Promise<void>(() => {}));
        const source = new ReadableStream<Uint8Array>({
          start(c) { c.enqueue(new Uint8Array(2)); },
          pull() { stalled.resolve(); return new Promise<void>(() => {}); },
          cancel,
        }, { highWaterMark: 0 });
        const response = boundary.bound(post('/upload', source), true).arrayBuffer();
        return { cancel, stalled: stalled.promise, refused: expect(response).rejects.toThrow('Request body too large') };
      };

      const pending = Array.from({ length: 8 }, uploadThatStalls);
      await Promise.all(pending.map(p => p.stalled));
      const ninth = uploadThatStalls();
      await ninth.refused;
      expect(ninth.cancel).toHaveBeenCalledOnce();
      expect(pending.every(p => !p.cancel.mock.calls.length)).toBe(true);
      await vi.advanceTimersByTimeAsync(100);
      await Promise.all(pending.map(p => p.refused));
      expect(pending.every(p => p.cancel.mock.calls.length === 1)).toBe(true);
    } finally { vi.useRealTimers(); }
  });

  it('preserves byte-accurate streaming to custom routes, response cancellation and GET without a body', async () => {
    const first = new Uint8Array([0, 255, 200, 10]);
    const cancelled = vi.fn();
    const server = new HttpServer({ maxRequestSize: '4b', customRoutes: [
      async request => new Response(request.body ?? 'no body'),
    ] });
    const exact = await server.handleRequest(post('/echo', upload([first])));
    expect(new Uint8Array(await exact.arrayBuffer())).toEqual(first);

    // A response may still consume the upload after the handler returns.
    const pending = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(first); }, cancel: cancelled });
    const response = await server.handleRequest(post('/echo', pending));
    const reader = response.body!.getReader();
    expect((await reader.read()).value).toEqual(first);
    await reader.cancel('consumer gone');
    await vi.waitFor(() => expect(cancelled).toHaveBeenCalledWith('consumer gone'));

    const get = await server.handleRequest(new Request('http://localhost/echo'));
    expect(await get.text()).toBe('no body');
  });
});
