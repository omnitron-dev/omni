/**
 * Netron's internal lifecycle events are not readable by an arbitrary peer.
 *
 * `subscribe` registers a forwarding handler on the local peer, and
 * `LocalPeer.subscribe` puts it directly on the Netron emitter — the same one
 * `emitSpecial(NETRON_EVENT_SERVICE_EXPOSE, ...)` publishes to. So any
 * connected peer could call `runTask('subscribe', 'service:expose')` and
 * thereafter receive every service the host exposed: name, version, and the
 * full definition including its method list.
 *
 * That is the metadata `query_interface` gates through the AuthorizationManager
 * — reachable on a path that never consulted it. `allowServiceEvents` was the
 * declared switch for exactly this and was read by nothing.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';

import { Netron } from '../../src/netron/netron.js';
import { WebSocketTransport } from '../../src/netron/transport/websocket/transport.js';
import { Service, Public } from '../../src/decorators/core.js';
import { AuthorizationManager } from '../../src/netron/auth/authorization-manager.js';
import { NETRON_EVENT_SERVICE_EXPOSE } from '../../src/netron/constants.js';
import { createMockLogger } from './test-utils.js';

@Service('secret@1.0.0')
class SecretService {
  @Public()
  classified(): string {
    return 'top secret';
  }
}

describe('Netron internal event exposure', () => {
  const cleanup: Array<() => Promise<unknown>> = [];

  afterEach(async () => {
    for (const fn of cleanup.splice(0).reverse()) await fn().catch(() => undefined);
  });

  /** A host with authorization configured, so query_interface would gate. */
  const startHost = async (allowServiceEvents: boolean) => {
    const logger = createMockLogger();
    const server = new Netron(logger, { id: `srv-${allowServiceEvents}`, allowServiceEvents });
    server.registerTransport('ws', () => new WebSocketTransport());
    server.registerTransportServer('ws', { name: 'ws', options: { host: '127.0.0.1', port: 0 } });
    server.authorizationManager = new AuthorizationManager(logger);
    await server.start();
    cleanup.push(() => server.stop());
    return { server, port: (server.transportServers.get('ws') as unknown as { port: number }).port };
  };

  const connectClient = async (port: number, id: string) => {
    const client = new Netron(createMockLogger(), { id });
    client.registerTransport('ws', () => new WebSocketTransport());
    await client.start();
    cleanup.push(() => client.stop());
    const peer = await client.connect(`ws://127.0.0.1:${port}`);
    cleanup.push(() => peer.disconnect());
    return peer;
  };

  it('refuses an unauthenticated peer a subscription to service:expose', async () => {
    const { port } = await startHost(false);
    const peer = await connectClient(port, 'cli-denied');

    await expect(peer.subscribe(NETRON_EVENT_SERVICE_EXPOSE, () => {})).rejects.toThrow(/internal to Netron/i);
  }, 30000);

  it('does not deliver service definitions to a peer that was refused', async () => {
    const { server, port } = await startHost(false);
    const peer = await connectClient(port, 'cli-silent');

    const seen: unknown[] = [];
    await peer.subscribe(NETRON_EVENT_SERVICE_EXPOSE, (data: unknown) => seen.push(data)).catch(() => undefined);

    // Exposed AFTER the attempted subscription — this is the payload that used
    // to arrive: { name, version, qualifiedName, definition.meta.methods }.
    await server.peer.exposeService(new SecretService());
    await new Promise((r) => setTimeout(r, 300));

    expect(seen).toEqual([]);
  }, 30000);

  it('delivers them when the host opts in with allowServiceEvents', async () => {
    // The gate must not break federation, which is what the option is for —
    // titan-pm sets it so a worker can watch its host's services.
    const { server, port } = await startHost(true);
    const peer = await connectClient(port, 'cli-allowed');

    const seen: Array<{ qualifiedName?: string }> = [];
    await peer.subscribe(NETRON_EVENT_SERVICE_EXPOSE, (data: { qualifiedName?: string }) => seen.push(data));

    await server.peer.exposeService(new SecretService());

    await vi.waitFor(() => expect(seen.length).toBeGreaterThan(0), { timeout: 5000, interval: 25 });
    expect(seen.some((e) => e.qualifiedName === 'secret@1.0.0')).toBe(true);
  }, 30000);

  it('still allows an application event of the peer\'s own choosing', async () => {
    // Only Netron's namespace is reserved; the mechanism itself is a feature.
    const { port } = await startHost(false);
    const peer = await connectClient(port, 'cli-app-event');

    await expect(peer.subscribe('app:something-happened', () => {})).resolves.toBeUndefined();
  }, 30000);
});
