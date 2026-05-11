/**
 * Regression test for T#41 — `query_interface` wildcard version
 * resolution sorted versions with `String.localeCompare`, which is
 * a lexical sort that ranks "9.0.0" above "10.0.0" (because the
 * first character '9' > '1'). Once a service crossed major version
 * 10, any client requesting the service WITHOUT a version qualifier
 * (`peer.queryInterface('foo')` → wildcard lookup) silently kept
 * being routed at the legacy 9.x build.
 *
 * Fix: switched the sort to `semver.rcompare`, the standard
 * descending semver comparator already used by the sibling lookup
 * path in `AbstractPeer`. This test pins the behaviour at the wire
 * boundary so future "performance optimisations" cannot regress it.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Netron } from '../../../src/netron/netron.js';
import { Service, Public } from '../../../src/decorators/core.js';
import { WebSocketTransport } from '../../../src/netron/transport/websocket/index.js';
import { createMockLogger } from '../test-utils.js';
import type { RemotePeer } from '../../../src/netron/remote-peer.js';

@Service('foo@9.0.0')
class FooNine {
  @Public()
  async whoami(): Promise<string> {
    return 'v9';
  }
}

@Service('foo@10.0.0')
class FooTen {
  @Public()
  async whoami(): Promise<string> {
    return 'v10';
  }
}

describe('query_interface — semver wildcard resolution (T#41)', () => {
  let server: Netron;
  let client: Netron;
  let port: number;

  beforeEach(async () => {
    const workerId = parseInt(process.env['JEST_WORKER_ID'] || '1', 10);
    port = 9800 + (workerId - 1) * 200 + Math.floor(Math.random() * 180);

    server = new Netron(createMockLogger(), { id: 'semver-server' });
    server.registerTransport('ws', () => new WebSocketTransport());
    server.registerTransportServer('ws', { name: 'ws', options: { host: 'localhost', port } });
    await server.start();
    await server.peer.exposeService(new FooNine());
    await server.peer.exposeService(new FooTen());

    client = new Netron(createMockLogger(), { id: 'semver-client' });
    client.registerTransport('ws', () => new WebSocketTransport());
  });

  afterEach(async () => {
    await new Promise((r) => setTimeout(r, 80));
    await client?.stop();
    await server?.stop();
    await new Promise((r) => setTimeout(r, 150));
  });

  it('resolves an unqualified service name to the highest SEMVER version, not the lexically-largest one', async () => {
    const peer = (await client.connect(`ws://localhost:${port}`)) as RemotePeer;

    // Unqualified — the server must pick foo@10.0.0, not foo@9.0.0.
    const svc = await peer.queryInterface<{ whoami(): Promise<string> }>('foo');
    const id = await svc.whoami();

    expect(id).toBe('v10');

    await peer.disconnect();
  });
});
