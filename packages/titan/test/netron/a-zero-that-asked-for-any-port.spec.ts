/**
 * «Give me any free port» was read as «give me 8080».
 *
 *     let port = 8080;
 *     …
 *     port = options.port || port;
 *
 * `0` is the number an application passes when it wants the OS to pick a
 * free port — the standard way a test, a sidecar or anything that must not
 * collide asks for a socket. `0 || 8080` is `8080`, so every such caller was
 * silently bound to the one port most likely to be taken by something else
 * on the same machine.
 *
 * Measured here on 2026-09-22: 8080 was held by OrbStack's port forwarding,
 * so nine test files in this package failed together with
 * `Connection timeout to ws://127.0.0.1:8080` — the client dialled 8080,
 * reached the container's forwarder, and waited for a netron handshake that
 * was never coming. Eight test files in this package ask for `port: 0`.
 *
 * The failure is worse than a collision, because there is no bind error to
 * read: when 8080 is free the server comes up ON IT and everything passes,
 * so the defect is invisible on any machine that happens not to be using
 * that port. It surfaces as a timeout somewhere else entirely.
 *
 * The same `||` sits on `host`, where an explicit empty string — which is
 * not a thing anyone passes — would fall back. Left as is; `0` is a real
 * value people pass on purpose, and that is the whole difference.
 */

import { describe, it, expect, afterEach } from 'vitest';

import { WebSocketTransport } from '../../src/netron/transport/websocket/transport.js';
import type { ITransportServer } from '../../src/netron/transport/types.js';

describe('a zero that asked for any port', () => {
  const started: ITransportServer[] = [];

  afterEach(async () => {
    for (const server of started.splice(0)) await server.close().catch(() => undefined);
  });

  it('lets the OS choose when asked for port 0', async () => {
    const transport = new WebSocketTransport();
    const server = await transport.createServer({ host: '127.0.0.1', port: 0 });
    started.push(server);

    const port = (server as unknown as { port?: number }).port;

    expect(port, 'the OS assigns a real port, never zero').toBeGreaterThan(0);
    expect(port, 'and never the default the caller declined').not.toBe(8080);
  });

  it('two servers asking for any port do not collide', async () => {
    // The point of asking for 0. Under the defect both would want 8080 and
    // the second would fail to bind — or, worse, the first would already be
    // somebody else's process.
    const transport = new WebSocketTransport();
    const first = await transport.createServer({ host: '127.0.0.1', port: 0 });
    started.push(first);
    const second = await transport.createServer({ host: '127.0.0.1', port: 0 });
    started.push(second);

    const a = (first as unknown as { port?: number }).port;
    const b = (second as unknown as { port?: number }).port;

    expect(a).toBeGreaterThan(0);
    expect(b).toBeGreaterThan(0);
    expect(a).not.toBe(b);
  });

  it('a server on an OS-chosen port knows it is listening', async () => {
    // The second half of the same mistake, one layer down: `listen()` read
    // `options.port || options.server || listening` and refused a server
    // created with `port: 0` as «not configured to listen» — while it was
    // listening. Fixing only the transport turned a silently wrong port into
    // a loud false refusal, which is why both halves are asserted here.
    const transport = new WebSocketTransport();
    const server = await transport.createServer({ host: '127.0.0.1', port: 0 });
    started.push(server);

    await expect(server.listen()).resolves.toBeUndefined();
  });

  it('still honours a port that was actually named', async () => {
    // Control: the fallback exists for callers who name nothing, and a
    // caller who names a port must land on it.
    const transport = new WebSocketTransport();
    const first = await transport.createServer({ host: '127.0.0.1', port: 0 });
    started.push(first);
    const chosen = (first as unknown as { port?: number }).port as number;
    await first.close();
    started.pop();

    const second = await transport.createServer({ host: '127.0.0.1', port: chosen });
    started.push(second);

    expect((second as unknown as { port?: number }).port).toBe(chosen);
  });
});
