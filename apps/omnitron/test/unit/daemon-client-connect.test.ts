/**
 * Connecting the daemon client, once.
 *
 * Every method on both clients opens with `await this.ensureConnected()`,
 * and the `connected` flag it checked is set two awaits in. A flag set after
 * an await guards the second CALL, not the second CALLER — so two methods
 * started together each opened a socket, each queried the interface, and the
 * loser's peer was left open with nothing pointing at it: `disconnect()` can
 * only tear down the one the fields hold.
 *
 * The client is constructed at 43 sites in this package, so the shape
 * matters more than any one caller does today.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

/** A Netron stand-in that records how often a connection was opened. */
const netron = {
  connects: 0,
  stops: 0,
  release: null as null | ((peer: unknown) => void),
  registerTransport: vi.fn(),
  setTransportOptions: vi.fn(),
  connect: vi.fn(),
  stop: vi.fn(),
};

vi.mock('@omnitron-dev/titan/netron', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@omnitron-dev/titan/netron');
  return {
    ...actual,
    Netron: class {
      registerTransport = netron.registerTransport;
      setTransportOptions = netron.setTransportOptions;
      connect = (...args: unknown[]) => netron.connect(...args);
      stop = (...args: unknown[]) => netron.stop(...args);
    },
  };
});

const peer = {
  queryInterface: vi.fn(async () => ({ ping: vi.fn(async () => ({ uptime: 1, version: 'x', pid: 1 })) })),
};

beforeEach(() => {
  netron.connects = 0;
  netron.stops = 0;
  netron.connect.mockReset();
  netron.stop.mockReset();
  peer.queryInterface.mockClear();

  netron.connect.mockImplementation(
    () =>
      new Promise((resolve) => {
        netron.connects += 1;
        netron.release = () => resolve(peer);
      })
  );
  netron.stop.mockImplementation(async () => {
    netron.stops += 1;
  });
});

async function freshClients() {
  vi.resetModules();
  return import('../../src/daemon/daemon-client.js');
}

describe('DaemonClient.ensureConnected', () => {
  it('opens one connection for two concurrent callers', async () => {
    const { DaemonClient } = await freshClients();
    const client = new DaemonClient('/tmp/does-not-matter.sock');

    const a = client.service('A');
    const b = client.service('B');
    await Promise.resolve();

    // Both callers arrived before the first connect settled. Before the fix
    // this was 2, and the first socket had nothing left pointing at it.
    expect(netron.connects).toBe(1);

    netron.release!(peer);
    await Promise.all([a, b]);

    expect(netron.connects).toBe(1);
  });

  it('does not connect again once connected', async () => {
    const { DaemonClient } = await freshClients();
    const client = new DaemonClient('/tmp/does-not-matter.sock');

    const first = client.service('A');
    await Promise.resolve();
    netron.release!(peer);
    await first;

    await client.service('B');

    expect(netron.connects).toBe(1);
  });

  it('can try again after a failed attempt', async () => {
    // The shared promise has to be released however the attempt ends. A
    // rejected one left in place would replay the first failure forever —
    // against a daemon that was merely still starting, the client could
    // never reach it again.
    const { DaemonClient } = await freshClients();
    const client = new DaemonClient('/tmp/does-not-matter.sock');

    netron.connect.mockImplementationOnce(async () => {
      netron.connects += 1;
      throw new Error('ECONNREFUSED');
    });

    await expect(client.service('A')).rejects.toThrow('ECONNREFUSED');

    const retry = client.service('A');
    await Promise.resolve();
    netron.release!(peer);
    await retry;

    expect(netron.connects).toBe(2);
  });

  it('does not come back connected after disconnecting mid-connect', async () => {
    // `disconnect()` used to test only `connected`, which an in-flight
    // connect has not set yet — so it found nothing to tear down, returned,
    // and the connect then completed and set `connected` to true around a
    // live peer nothing pointed at. A socket surviving a clean shutdown
    // surfaces on the NEXT start, a lifetime away from its cause.
    const { DaemonClient } = await freshClients();
    const client = new DaemonClient('/tmp/does-not-matter.sock');

    const inFlight = client.service('A');
    await Promise.resolve();

    const closing = client.disconnect();
    netron.release!(peer);
    await inFlight.catch(() => undefined);
    await closing;

    expect(netron.stops).toBe(1);

    // And the next call reconnects rather than reusing a peer that was
    // supposed to be gone.
    const after = client.service('A');
    await Promise.resolve();
    netron.release!(peer);
    await after;

    expect(netron.connects).toBe(2);
  });

  it('reconnects after an explicit disconnect', async () => {
    const { DaemonClient } = await freshClients();
    const client = new DaemonClient('/tmp/does-not-matter.sock');

    const first = client.service('A');
    await Promise.resolve();
    netron.release!(peer);
    await first;

    await client.disconnect();
    expect(netron.stops).toBe(1);

    const second = client.service('A');
    await Promise.resolve();
    netron.release!(peer);
    await second;

    expect(netron.connects).toBe(2);
  });
});

describe('RemoteDaemonClient.ensureConnected', () => {
  it('opens one connection for two concurrent callers', async () => {
    // Same shape over TCP, in the same file, with the same defect — the kind
    // that gets fixed in one copy and left in the other.
    const { RemoteDaemonClient } = await freshClients();
    const client = new RemoteDaemonClient('10.0.0.5', 9700);

    const a = client.service('A');
    const b = client.service('B');
    await Promise.resolve();

    expect(netron.connects).toBe(1);

    netron.release!(peer);
    await Promise.all([a, b]);

    expect(netron.connects).toBe(1);
  });
});
