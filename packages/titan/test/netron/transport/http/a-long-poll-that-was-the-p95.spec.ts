/**
 * A long poll that was the p95 of a whole application.
 *
 * daos main's `Notifications.poll` holds each client for up to 25 s waiting
 * for a notification. Every one of those waits went into the server's
 * latency window, so `omnitron metrics` showed main with a p95 of 25 s — an
 * application that answered its other calls in milliseconds, read as slow.
 *
 * A method now says it holds its caller (`@Public({ holds: true })`); the
 * server counts those requests (`held`), counts their errors like any
 * other, and keeps their duration out of `latency` — on the fast path, the
 * middleware path and in a batch alike.
 */
import 'reflect-metadata';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { HttpServer } from '../../../../src/netron/transport/http/server.js';
import { Public } from '../../../../src/decorators/core.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

class Notifications {
  @Public({ holds: true })
  async poll(): Promise<unknown[]> {
    await sleep(80);
    return [];
  }

  @Public({ holds: true })
  async pollBroken(): Promise<unknown[]> {
    await sleep(5);
    throw new Error('redis went away');
  }

  @Public()
  async list(): Promise<unknown[]> {
    await sleep(2);
    return [];
  }
}

const invoke = (method: string, headers: Record<string, string> = {}) =>
  new Request('http://localhost:3458/netron/invoke', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ id: method, service: 'Notifications@1.0.0', method, input: {} }),
  });

describe('a method that holds its caller is counted, not timed', () => {
  let server: HttpServer;

  beforeEach(() => {
    const instance = new Notifications();
    const stub = {
      definition: {
        meta: { name: 'Notifications@1.0.0', version: '1.0.0', methods: { poll: {}, pollBroken: {}, list: {} } },
      },
      instance,
      call: vi.fn(async (method: string) => (instance as unknown as Record<string, () => Promise<unknown>>)[method]!()),
    };
    server = new HttpServer({ port: 3458, host: 'localhost' });
    (server as any).setPeer({ stubs: new Map([['stub-1', stub]]) });
  });

  afterEach(async () => {
    await server.close();
  });

  it('keeps a long poll out of the latency window and counts it as held', async () => {
    expect((await server.handleRequest(invoke('poll'))).status).toBe(200);
    expect((await server.handleRequest(invoke('list'))).status).toBe(200);

    const traffic = server.getTrafficSnapshot();
    expect(traffic.requests).toBe(2);
    expect(traffic.held).toBe(1);
    // Only `list` was timed: 2 ms of work, not 80 ms of waiting.
    expect(traffic.latency!.count).toBe(1);
    expect(traffic.latency!.max).toBeLessThan(50);
  });

  it('does the same on the middleware path', async () => {
    // A request with credentials cannot take the fast path.
    await server.handleRequest(invoke('poll', { Authorization: 'Bearer anything' }));

    const traffic = server.getTrafficSnapshot();
    expect(traffic.held).toBe(1);
    expect(traffic.latency).toBeNull();
  });

  it('does the same for a batch that carries one', async () => {
    const response = await server.handleRequest(
      new Request('http://localhost:3458/netron/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'b1',
          requests: [
            { id: 'a', service: 'Notifications@1.0.0', method: 'poll', input: {} },
            { id: 'b', service: 'Notifications@1.0.0', method: 'list', input: {} },
          ],
        }),
      }),
    );
    expect(response.status).toBe(200);

    expect(server.getTrafficSnapshot()).toMatchObject({ requests: 1, held: 1, latency: null });
  });

  it('still counts a long poll that failed as a server error', async () => {
    const response = await server.handleRequest(invoke('pollBroken'));
    expect(response.status).toBeGreaterThanOrEqual(500);

    expect(server.getTrafficSnapshot()).toMatchObject({ requests: 1, held: 1, serverErrors: 1 });
  });

  it('times a method that does not say it holds, however long it takes', async () => {
    await server.handleRequest(invoke('list'));
    expect(server.getTrafficSnapshot()).toMatchObject({ held: 0 });
    expect(server.getTrafficSnapshot().latency!.count).toBe(1);
  });
});
