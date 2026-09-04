/**
 * `createServer()` must accept an address string on every transport.
 *
 * TcpTransport and UnixSocketTransport take `string | options`; WebSocketTransport
 * took options only, so a `ws://host:port` string was silently ignored and the
 * server bound the default 0.0.0.0:8080 instead. Nothing threw — callers just
 * got a server on the wrong port and every client hit ECONNREFUSED.
 *
 * That is precisely the divergence the isomorphic suite exists to catch, and it
 * only surfaced once that suite was restored to the run.
 */

import { describe, it, expect, afterEach } from 'vitest';

import { TcpTransport } from '../../../src/netron/transport/tcp-transport.js';
import { WebSocketTransport } from '../../../src/netron/transport/websocket/index.js';
import type { ITransportServer } from '../../../src/netron/transport/types.js';
import { getFreePort, getFreeHttpPort } from '../../utils/index.js';

describe('createServer address handling', () => {
  const servers: ITransportServer[] = [];

  afterEach(async () => {
    for (const server of servers.splice(0)) {
      await server.close().catch(() => {});
    }
  });

  it('WebSocketTransport binds the port given as a ws:// address', async () => {
    const port = await getFreeHttpPort();
    const transport = new WebSocketTransport();

    const server = await transport.createServer!(`ws://127.0.0.1:${port}` as never);
    servers.push(server);
    if (server.listen) await server.listen();

    expect(server.port).toBe(port);

    // The round trip is the real proof: a client reaches the address we asked for.
    const connection = await transport.connect(`ws://127.0.0.1:${port}`);
    expect(connection).toBeDefined();
    await connection.close();
  });

  it('WebSocketTransport still accepts an options object', async () => {
    const port = await getFreeHttpPort();
    const transport = new WebSocketTransport();

    const server = await transport.createServer!({ host: '127.0.0.1', port });
    servers.push(server);
    if (server.listen) await server.listen();

    expect(server.port).toBe(port);
  });

  it('TcpTransport binds the port given as a tcp:// address', async () => {
    const port = await getFreePort();
    const transport = new TcpTransport();

    const server = await transport.createServer!(`tcp://127.0.0.1:${port}` as never);
    servers.push(server);
    if (server.listen) await server.listen();

    expect(server.port).toBe(port);
  });
});
