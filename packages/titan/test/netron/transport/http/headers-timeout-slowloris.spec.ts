/**
 * Regression test for T#46 — HTTP slowloris guard collapsed when
 * `requestTimeout` was disabled.
 *
 * The HTTP server computed:
 *
 *     headersTimeout = Math.min(userHeadersTimeout || 60_000, requestTimeout);
 *
 * That clamp is the right policy when `requestTimeout > 0` (Node.js
 * enforces `headersTimeout <= requestTimeout` internally), but when
 * an operator disables the per-request timeout (`requestTimeout: 0`,
 * a common choice for streaming or long-running endpoints) the
 * `Math.min(60000, 0)` returned 0 — silently zeroing out the
 * slowloris defence as well.
 *
 * Fix: only clamp when `requestTimeout > 0`. Verify here that the
 * boundary cases produce the right `headersTimeout`. The check
 * operates on the Node `http.Server` instance after `listen()`,
 * which exposes the resolved `headersTimeout` accessor.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { HttpServer } from '../../../../src/netron/transport/http/server.js';

describe('HttpServer headersTimeout — slowloris guard (T#46)', () => {
  const servers: HttpServer[] = [];

  afterEach(async () => {
    for (const s of servers) await s.close();
    servers.length = 0;
  });

  function basePort() {
    const w = parseInt(process.env['JEST_WORKER_ID'] || '1', 10);
    return 21000 + (w - 1) * 300 + Math.floor(Math.random() * 280);
  }

  it('keeps the configured headersTimeout when requestTimeout is disabled (0)', async () => {
    const s = new HttpServer({ port: basePort(), host: 'localhost', requestTimeout: 0, headersTimeout: 8000 } as any);
    servers.push(s);
    await s.listen();
    // Reach into the underlying http.Server.
    const node = (s as any).server;
    expect(node.headersTimeout).toBe(8000);
  });

  it('keeps the default headersTimeout when neither value is supplied', async () => {
    const s = new HttpServer({ port: basePort(), host: 'localhost', requestTimeout: 0 } as any);
    servers.push(s);
    await s.listen();
    const node = (s as any).server;
    // Default = 60s.
    expect(node.headersTimeout).toBe(60_000);
  });

  it('clamps headersTimeout down to requestTimeout when both are set', async () => {
    const s = new HttpServer({ port: basePort(), host: 'localhost', requestTimeout: 5000, headersTimeout: 30000 } as any);
    servers.push(s);
    await s.listen();
    const node = (s as any).server;
    expect(node.headersTimeout).toBe(5000);
  });
});
