/**
 * What a connection reports once reconnection has given up.
 *
 * Two defects, both found by instrumenting a real disconnect:
 *
 * 1. State never reached a terminal value. `scheduleReconnect()` sets
 *    RECONNECTING before each attempt and nothing sets anything after
 *    `reconnect_failed`, so `connection.state` stayed 'reconnecting' forever
 *    on a connection that had permanently given up. Anything that decides by
 *    polling state — the omnitron daemon does — waits for a recovery that is
 *    never coming, and a supervisor never recreates the peer.
 *
 * 2. The reason was thrown away. `doReconnect().catch((error) => ...)` never
 *    logged or emitted `error`, so why a reconnect failed was unobservable
 *    from both the logs and the event stream.
 */

import { describe, it, expect, afterEach } from 'vitest';

import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { TcpTransport } from '../../../src/netron/transport/tcp-transport.js';
import { UnixSocketTransport } from '../../../src/netron/transport/unix-transport.js';
import { ConnectionState } from '../../../src/netron/transport/types.js';
import type { ITransportConnection, ITransportServer } from '../../../src/netron/transport/types.js';
import { getFreePort } from '../../utils/index.js';

describe('reconnection give-up', () => {
  const cleanups: Array<() => Promise<unknown>> = [];

  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) {
      await cleanup().catch(() => {});
    }
  });

  async function connectThenKillServer(): Promise<{
    client: ITransportConnection;
    events: Array<{ name: string; payload: unknown }>;
  }> {
    const port = await getFreePort();
    const transport = new TcpTransport();

    const server: ITransportServer = await transport.createServer!({ port, host: '127.0.0.1' });
    await server.listen!();

    const client = await transport.connect(`tcp://127.0.0.1:${port}`, {
      reconnect: { enabled: true, maxAttempts: 2, delay: 50 },
    } as never);
    cleanups.push(() => client.close());

    const events: Array<{ name: string; payload: unknown }> = [];
    for (const name of ['disconnect', 'reconnect', 'reconnect_failed']) {
      client.on(name as never, (payload: unknown) => events.push({ name, payload }));
    }

    // Take the server away for good — every reconnect attempt must fail.
    await server.close();

    return { client, events };
  }

  async function waitForEvent(
    events: Array<{ name: string; payload: unknown }>,
    name: string,
    timeoutMs = 5000
  ): Promise<{ name: string; payload: unknown }> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const found = events.find((event) => event.name === name);
      if (found) return found;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error(`timed out waiting for '${name}'; saw ${JSON.stringify(events.map((e) => e.name))}`);
  }

  it('reaches a terminal state after giving up, not a permanent "reconnecting"', async () => {
    const { client, events } = await connectThenKillServer();

    await waitForEvent(events, 'reconnect_failed');
    // The state transition happens with the event, so read it right after.
    expect(client.state).not.toBe(ConnectionState.RECONNECTING);
    expect(client.state).toBe(ConnectionState.DISCONNECTED);
  }, 30_000);

  it('reports why the last attempt failed', async () => {
    const { events } = await connectThenKillServer();

    const failure = await waitForEvent(events, 'reconnect_failed');

    // Not `undefined` — a listener must be able to log or act on the cause.
    expect(failure.payload).toBeDefined();
    const { attempts, error } = failure.payload as { attempts: number; error: Error };
    expect(attempts).toBe(2);
    expect(error).toBeInstanceOf(Error);
    expect(String(error.message)).not.toBe('');
  }, 30_000);

  it('stops attempting once the budget is spent', async () => {
    const { events } = await connectThenKillServer();

    await waitForEvent(events, 'reconnect_failed');
    const before = events.filter((event) => event.name === 'reconnect').length;

    await new Promise((resolve) => setTimeout(resolve, 500));

    const after = events.filter((event) => event.name === 'reconnect').length;
    expect(after).toBe(before);
    expect(after).toBe(2);
  }, 30_000);

  it('reconnects when the server comes back', async () => {
    // The real recovery path. doReconnect() used to read its target from
    // `this.socket.remoteAddress`, and a socket torn down by a server-side
    // reset no longer carries one — so every attempt died with
    // "Failed to connect to unknown via tcp" no matter that the server was
    // listening again. TCP reconnection could not recover from the one event
    // it exists for.
    const port = await getFreePort();
    const transport = new TcpTransport();

    let server: ITransportServer = await transport.createServer!({ port, host: '127.0.0.1' });
    await server.listen!();

    const client = await transport.connect(`tcp://127.0.0.1:${port}`, {
      reconnect: { enabled: true, maxAttempts: 5, delay: 50 },
    } as never);
    cleanups.push(() => client.close());

    const events: Array<{ name: string; payload: unknown }> = [];
    for (const name of ['disconnect', 'reconnect', 'reconnect_failed', 'connect']) {
      client.on(name as never, (payload: unknown) => events.push({ name, payload }));
    }

    await server.close();
    server = await transport.createServer!({ port, host: '127.0.0.1' });
    await server.listen!();
    cleanups.push(() => server.close());

    await waitForEvent(events, 'connect', 8000);
    expect(client.state).toBe(ConnectionState.CONNECTED);
    expect(events.some((event) => event.name === 'reconnect_failed')).toBe(false);
  }, 30_000);

  it('reconnects a unix socket when the server comes back', async () => {
    // UnixSocketTransport declares `reconnection: true` and inherits
    // TcpConnection.doReconnect(), which dials host/port. A unix socket has
    // neither, so reconnection could never work here at all — the path just
    // failed with "Cannot reconnect: no remote address".
    const socketPath = join(tmpdir(), `reconnect-probe-${process.pid}-${Date.now()}.sock`);
    const transport = new UnixSocketTransport();

    let server: ITransportServer = await transport.createServer!({ path: socketPath } as never);
    await server.listen!();

    const client = await transport.connect(socketPath, {
      reconnect: { enabled: true, maxAttempts: 5, delay: 50 },
    } as never);
    cleanups.push(() => client.close());

    const events: Array<{ name: string; payload: unknown }> = [];
    for (const name of ['disconnect', 'reconnect', 'reconnect_failed', 'connect']) {
      client.on(name as never, (payload: unknown) => events.push({ name, payload }));
    }

    await server.close();
    server = await transport.createServer!({ path: socketPath } as never);
    await server.listen!();
    cleanups.push(() => server.close());

    await waitForEvent(events, 'connect', 8000);
    expect(client.state).toBe(ConnectionState.CONNECTED);
  }, 30_000);
});
