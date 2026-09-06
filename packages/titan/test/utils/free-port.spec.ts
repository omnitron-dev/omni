/**
 * `getFreePort` handed out ports that another test could already be using.
 *
 * It bound port 0, read what the kernel assigned, CLOSED the socket and
 * returned the number. Between the close and the caller's own `listen`, that
 * port is free for anyone — including the other seven vitest workers, which
 * were asking the same kernel from the same ephemeral range at the same
 * moment. Two workers could be handed the same number seconds apart.
 *
 * Observed in a full run of this package (296 files):
 *
 *     FAIL test/netron/transport/tcp-transport.spec.ts > should set timeout option on socket
 *     Error: listen EADDRINUSE: address already in use 127.0.0.1:60843
 *     FAIL test/netron/integration/full-auth-flow.spec.ts > ...
 *     Error: Unexpected server response: 404
 *
 * The 404 is the same collision seen from the other side: a WebSocket client
 * reached a server that was listening on that port and serving something else.
 *
 * A probe cannot close this window — anything that returns a port number has
 * released it by the time it returns. What CAN be closed is the part that made
 * the window matter: the workers were drawing from a shared pool. Each worker
 * now has its own disjoint band and walks it, so no two workers can be handed
 * the same number at all, and a repeat within one worker needs the whole band
 * to wrap. The kernel's ephemeral range is avoided entirely, so the ports are
 * not ones the kernel hands out on its own to unrelated sockets.
 */
import { describe, it, expect } from 'vitest';
import { createServer } from 'node:net';

import { getFreePort, getFreeHttpPort, portBandForWorker } from './transport-test-utils.js';

describe('getFreePort', () => {
  it('draws from this worker\'s own band', async () => {
    // The property that removes cross-worker collision. Kernel-assigned
    // ephemeral ports (49152+ on this platform) are outside every band.
    const band = portBandForWorker();
    const port = await getFreePort();

    expect(port).toBeGreaterThanOrEqual(band.start);
    expect(port).toBeLessThan(band.end);
  });

  it('shares one band with the HTTP variant', async () => {
    // Two counters over one band would collide with each other, which is the
    // same defect with the workers replaced by helpers.
    const band = portBandForWorker();
    const port = await getFreeHttpPort();

    expect(port).toBeGreaterThanOrEqual(band.start);
    expect(port).toBeLessThan(band.end);
  });

  it('never hands out the same port twice', async () => {
    const ports = await Promise.all(Array.from({ length: 40 }, () => getFreePort()));

    expect(new Set(ports).size, `repeats: ${ports.join(',')}`).toBe(ports.length);
  });

  it('skips a port that something else already holds', async () => {
    // The band is this worker's by convention, not by enforcement — a foreign
    // process can be sitting on any of it. Handing out a held port is exactly
    // the failure this is meant to prevent.
    const first = await getFreePort();
    const squatter = createServer();
    await new Promise<void>((resolve) => squatter.listen(first + 1, '127.0.0.1', resolve));

    try {
      const next = await getFreePort();
      expect(next).not.toBe(first + 1);
    } finally {
      await new Promise<void>((resolve) => squatter.close(() => resolve()));
    }
  });

  it('returns a port that can actually be bound', async () => {
    const port = await getFreePort();
    const server = createServer();

    await expect(
      new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, '127.0.0.1', resolve);
      })
    ).resolves.toBeUndefined();

    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
});
