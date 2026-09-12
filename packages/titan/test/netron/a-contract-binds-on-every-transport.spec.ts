/**
 * A service's declared input contract must hold on every transport.
 *
 * Contract validation lived in the HTTP transport alone. The packet path —
 * `RemotePeer`'s `TYPE_CALL`, which is how WebSocket, TCP and Unix-socket
 * clients invoke a method — called `enforceMethodAccess` and then went
 * straight into `stub.call(method, args)`. It checked WHO may call the method
 * and never WHAT they sent, so a contract was a guarantee only for clients
 * that happened to speak HTTP, and a client got to choose whether it was
 * validated by choosing how it connected.
 *
 * These run over a real WebSocket pair.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { z } from 'zod';
import { Netron } from '../../src/netron/netron.js';
import { Service, Public } from '../../src/decorators/core.js';
import { Contract } from '../../src/decorators/validation.js';
import { contract } from '../../src/validation/contract.js';
import { WebSocketTransport } from '../../src/netron/transport/websocket/index.js';
import { createMockLogger } from './test-utils.js';
import { getFreePort } from '../utils/index.js';

const vaultContract = contract({
  store: {
    input: z.object({ label: z.string().max(8) }),
    output: z.any(),
  },
});

/** Records what the method body actually received. */
const seen: unknown[] = [];

@Contract(vaultContract)
@Service('vault@1.0.0')
class VaultService {
  @Public()
  async store(dto: unknown): Promise<{ ok: true }> {
    seen.push(dto);
    return { ok: true };
  }
}

describe('a contract binds on every transport', () => {
  let server: Netron;
  let client: Netron;

  async function startPair() {
    seen.length = 0;
    const port = await getFreePort();

    server = new Netron(createMockLogger(), { id: 'contract-server' });
    server.registerTransport('ws', () => new WebSocketTransport());
    server.registerTransportServer('ws', { name: 'ws', options: { host: 'localhost', port } });
    await server.start();
    await server.peer.exposeService(new VaultService());

    client = new Netron(createMockLogger(), { id: 'contract-client' });
    client.registerTransport('ws', () => new WebSocketTransport());
    const peer = await client.connect(`ws://localhost:${port}`);
    return peer;
  }

  afterEach(async () => {
    await new Promise((r) => setTimeout(r, 80));
    await client?.stop();
    await server?.stop();
    await new Promise((r) => setTimeout(r, 150));
  });

  it('lets a conforming payload through, unchanged', async () => {
    const peer = await startPair();
    const vault = await peer.queryInterface<any>('vault@1.0.0');

    await expect(vault.store({ label: 'ok' })).resolves.toEqual({ ok: true });
    expect(seen).toEqual([{ label: 'ok' }]);
  });

  it('refuses a payload the contract rejects, over WebSocket', async () => {
    const peer = await startPair();
    const vault = await peer.queryInterface<any>('vault@1.0.0');

    await expect(vault.store({ label: 'far-too-long-to-pass' })).rejects.toThrow();
    expect(seen, 'the method body ran on input its own contract rejects').toEqual([]);
  });

  it('refuses a payload of entirely the wrong shape', async () => {
    const peer = await startPair();
    const vault = await peer.queryInterface<any>('vault@1.0.0');

    await expect(vault.store({ notTheField: 1 })).rejects.toThrow();
    expect(seen).toEqual([]);
  });
});
