/**
 * A request timed before it ran.
 *
 * `handleRequest` dispatched with `return this.handle…(request)` inside a
 * `try` whose `finally` recorded the metrics — without `await`. The `finally`
 * ran when the promise was RETURNED, not when it settled: every duration was
 * the time it takes to create a promise, `activeRequests` was back to zero
 * before the work began, a rejected invocation never reached the `catch` (so
 * not one error was counted for any call), and every status was recorded as
 * 200. `omnitron metrics` had nothing true to show even once it asked.
 *
 * This court drives the real server: a slow call must be measured slow, a
 * failed call counted as a server error, a refusal as a client error, and a
 * monitor's `/health` poll kept out of the traffic.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { HttpServer } from '../../../../src/netron/transport/http/server.js';
import { LatencyWindow } from '../../../../src/netron/transport/http/latency-window.js';

const invoke = (method: string, id = 'r1') =>
  new Request('http://localhost:3457/netron/invoke', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, service: 'Clock@1.0.0', method, input: {} }),
  });

describe('what the server measured', () => {
  let server: HttpServer;
  let stub: { definition: unknown; call: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    stub = {
      definition: {
        meta: { name: 'Clock@1.0.0', version: '1.0.0', methods: { slow: { name: 'slow' }, broken: { name: 'broken' } } },
      },
      call: vi.fn(async (method: string) => {
        if (method === 'slow') {
          await new Promise((r) => setTimeout(r, 60));
          return 'done';
        }
        throw new Error('the handler blew up');
      }),
    };
    server = new HttpServer({ port: 3457, host: 'localhost' });
    (server as any).setPeer({ stubs: new Map([['stub-1', stub]]) });
  });

  afterEach(async () => {
    await server.close();
  });

  it('times a call by when it finished, not by when its promise was made', async () => {
    const response = await server.handleRequest(invoke('slow'));
    expect(response.status).toBe(200);

    const traffic = server.getTrafficSnapshot();
    expect(traffic.requests).toBe(1);
    expect(traffic.latency!.count).toBe(1);
    // 60 ms of work: the old path measured the microseconds it took to
    // create the promise.
    expect(traffic.latency!.p50).toBeGreaterThanOrEqual(50);
    expect(traffic.active).toBe(0);
  });

  it('counts a call that failed as a server error', async () => {
    const response = await server.handleRequest(invoke('broken'));
    expect(response.status).toBeGreaterThanOrEqual(500);

    expect(server.getTrafficSnapshot()).toMatchObject({ requests: 1, serverErrors: 1, clientErrors: 0 });
    expect(server.getMetrics().statusCounts[response.status]).toBe(1);
  });

  it('counts a refusal as the caller\'s error, with its real status', async () => {
    const response = await server.handleRequest(
      new Request('http://localhost:3457/netron/invoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: 'r2', service: 'Nope@1.0.0', method: 'x', input: {} }),
      }),
    );
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);

    expect(server.getTrafficSnapshot()).toMatchObject({ requests: 1, serverErrors: 0, clientErrors: 1 });
    expect(server.getMetrics().statusCounts[200]).toBeUndefined();
  });

  it('keeps a monitor\'s /health poll out of the traffic', async () => {
    await server.handleRequest(new Request('http://localhost:3457/health'));
    await server.handleRequest(new Request('http://localhost:3457/health'));

    expect(server.getTrafficSnapshot()).toMatchObject({ requests: 0, probes: 2 });
    expect(server.getTrafficSnapshot().latency).toBeNull();
  });
});

describe('the latency window', () => {
  it('reads percentiles of what finished inside the window, and nothing older', () => {
    let now = 0;
    const w = new LatencyWindow(60_000, 100, () => now);
    for (let i = 1; i <= 100; i++) w.record(i);
    now = 1_000;
    const s = w.snapshot()!;
    expect(s).toMatchObject({ count: 100, p50: 50, p95: 95, p99: 99, max: 100 });
    expect(s.mean).toBeCloseTo(50.5);

    now = 61_001;
    expect(w.snapshot()).toBeNull();
  });

  it('says how much time a full ring covers instead of calling it a minute', () => {
    let now = 0;
    const w = new LatencyWindow(60_000, 10, () => now);
    for (let i = 0; i < 25; i++) {
      now = i * 100;
      w.record(5);
    }
    const s = w.snapshot()!;
    expect(s.count).toBe(10);
    expect(s.coveredMs).toBe(900);
  });
});
