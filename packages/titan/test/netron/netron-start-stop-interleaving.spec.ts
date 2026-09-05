/**
 * `Netron.start()` sets `isStarted` only after every transport server has
 * bound, and its "already started" guard reads that same late flag. Two
 * consequences, both reachable through the documented public API:
 *
 *   - concurrent `start()` calls both pass the guard and both bind the
 *     configured servers, instead of the second one raising the conflict the
 *     contract promises;
 *   - `stop()` runs its teardown against whatever exists at that moment, then
 *     the in-flight `start()` resumes and binds the servers it was in the
 *     middle of creating — so a resolved `stop()` can leave listening sockets
 *     behind, and the next boot meets EADDRINUSE.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

import { Netron } from '../../src/netron/netron.js';
import { createLogger } from '../utils/test-logger.js';

function gatedTransport(gate: Promise<void>) {
  const server = {
    on: vi.fn(),
    listen: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
  };
  const transport = {
    name: 'mock-ws',
    protocols: ['ws'],
    capabilities: { client: true, server: true },
    createServer: vi.fn(async () => {
      await gate;
      return server;
    }),
  };
  return { transport, server };
}

describe('Netron - start/stop interleaving', () => {
  let netron: Netron;

  beforeEach(() => {
    netron = new Netron(createLogger(), { id: 'test-netron', taskTimeout: 5000 });
  });

  it('rejects a second start() that arrives while the first is still binding', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { transport } = gatedTransport(gate);

    netron.registerTransport('mock-ws', () => transport);
    netron.registerTransportServer('mock-ws', { name: 'mock-ws', options: { host: 'localhost', port: 8080 } });

    const first = netron.start();
    const second = netron.start();
    release();

    await expect(second).rejects.toThrow(/already started/i);
    await first;

    // One bind, not two.
    expect(transport.createServer).toHaveBeenCalledTimes(1);
    await netron.stop();
  });

  it('does not leave a transport server listening after stop() resolves', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { transport, server } = gatedTransport(gate);

    netron.registerTransport('mock-ws', () => transport);
    netron.registerTransportServer('mock-ws', { name: 'mock-ws', options: { host: 'localhost', port: 8080 } });

    const starting = netron.start();
    const stopping = netron.stop();
    release();
    await Promise.all([starting, stopping]);

    // The server created during startup must have been closed by the shutdown
    // that overlapped it. Before the fix `stop()` ran its teardown while the
    // server did not yet exist, and `start()` then installed it.
    expect(server.close).toHaveBeenCalled();
    expect((netron as any).isStarted).toBe(false);
  });
});
