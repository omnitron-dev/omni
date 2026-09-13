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

  describe('two concurrent stops', () => {
    /**
     * `start()` was guarded; `stop()` never was. Both callers walked
     * `transportServers` before either reached the `clear()` at the end, so
     * the first close succeeded and the second met `ERR_SERVER_NOT_RUNNING` —
     * reported at level 50, which is an operator chasing a shutdown that
     * worked. Seen five times over eight days on the downstream stand, always as
     * two `Closing unix transport server` lines in the same millisecond from
     * one netron id.
     */
    it('closes each transport server exactly once', async () => {
      const { transport, server } = gatedTransport(Promise.resolve());
      const n = new Netron(createLogger(), { id: 'concurrent-stop' });
      n.registerTransport('mock-ws', () => transport as never);
      n.registerTransportServer('mock-ws', { name: 'mock-ws', options: {} } as never);
      await n.start();

      await Promise.all([n.stop(), n.stop(), n.stop()]);

      expect(server.close, 'the teardown ran once per caller').toHaveBeenCalledTimes(1);
    });

    it('every caller waits for the teardown, not just the first', async () => {
      let release!: () => void;
      const closing = new Promise<void>((r) => {
        release = r;
      });
      const { transport, server } = gatedTransport(Promise.resolve());
      server.close.mockImplementation(() => closing);

      const n = new Netron(createLogger(), { id: 'concurrent-stop-await' });
      n.registerTransport('mock-ws', () => transport as never);
      n.registerTransportServer('mock-ws', { name: 'mock-ws', options: {} } as never);
      await n.start();

      let secondSettled = false;
      const first = n.stop();
      const second = n.stop().then(() => {
        secondSettled = true;
      });

      await Promise.resolve();
      expect(secondSettled, 'the second caller returned before the close finished').toBe(false);

      release();
      await Promise.all([first, second]);
      expect(secondSettled).toBe(true);
    });

    it('does not latch: a later stop tears down again', async () => {
      // The guard joins callers of ONE stop; it must not turn every stop
      // after the first into a no-op.
      //
      // The server config has to be re-registered between the two, and that
      // is not this test being awkward: `stop()` ends with
      // `transportRegistry.clearServerConfigs()`, so a Netron that is started
      // again comes back binding nothing. Latent rather than live —
      // `Application.restart()` has exactly one reference in the monorepo, a
      // README, and every real registration happens in per-process setup.
      const { transport, server } = gatedTransport(Promise.resolve());
      const n = new Netron(createLogger(), { id: 'stop-start-stop' });
      n.registerTransport('mock-ws', () => transport as never);

      n.registerTransportServer('mock-ws', { name: 'mock-ws', options: {} } as never);
      await n.start();
      await n.stop();
      expect(server.close).toHaveBeenCalledTimes(1);

      n.registerTransportServer('mock-ws', { name: 'mock-ws', options: {} } as never);
      await n.start();
      await n.stop();
      expect(server.close, 'the second stop was swallowed by a latched guard').toHaveBeenCalledTimes(2);
    });
  });
});