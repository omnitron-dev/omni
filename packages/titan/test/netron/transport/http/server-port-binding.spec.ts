/**
 * HttpServer port binding.
 *
 * `get port()` was `this.options?.port || 3000`, so `port: 0` — the standard
 * way to ask the OS for any free port — was treated as absent and replaced
 * with a fixed well-known one. Two servers that both asked for an ephemeral
 * port collided, and the failure named a port the caller never mentioned
 * (`EADDRINUSE ::1:3000`). It also meant the getter reported the REQUEST
 * rather than the result: callers had to reach into the private Node server's
 * `address()` to learn where they were actually listening.
 */
import { describe, it, expect, afterEach } from 'vitest';

import { HttpServer } from '../../../../src/netron/transport/http/server.js';

describe('HttpServer port binding', () => {
  const servers: HttpServer[] = [];
  const start = async (options: Record<string, unknown>) => {
    const server = new HttpServer(options as never);
    servers.push(server);
    await server.listen();
    return server;
  };

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((s) => s.close().catch(() => undefined)));
  });

  it('binds an OS-assigned port when asked for 0, and reports the real one', async () => {
    const server = await start({ host: '127.0.0.1', port: 0 });

    expect(server.port).toBeGreaterThan(0);
    expect(server.port).not.toBe(3000);
    expect(server.port).not.toBe(0);
  });

  it('gives two servers that both ask for 0 different ports', async () => {
    // The collision the old code produced: both were silently redirected to
    // 3000, so the second failed to listen at all.
    const first = await start({ host: '127.0.0.1', port: 0 });
    const second = await start({ host: '127.0.0.1', port: 0 });

    expect(first.port).not.toBe(second.port);
  });

  it('still honours an explicit port', async () => {
    const probe = await start({ host: '127.0.0.1', port: 0 });
    const chosen = probe.port!;
    await probe.close();
    servers.pop();

    const server = await start({ host: '127.0.0.1', port: chosen });
    expect(server.port).toBe(chosen);
  });

  it('reports no port once closed', async () => {
    const server = await start({ host: '127.0.0.1', port: 0 });
    const bound = server.port;
    expect(bound).toBeGreaterThan(0);

    await server.close();
    servers.pop();

    // Not the stale bound port — nothing is listening on it any more.
    expect(server.port).not.toBe(bound);
  });

  it('announces the bound port in its listening event', async () => {
    const server = new HttpServer({ host: '127.0.0.1', port: 0 } as never);
    servers.push(server);
    const announced = new Promise<number>((resolve) => {
      server.once('listening', (info: { port: number }) => resolve(info.port));
    });

    await server.listen();

    expect(await announced).toBe(server.port);
  });
});
