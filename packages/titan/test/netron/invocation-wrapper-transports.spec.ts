/**
 * `invocationWrapper` must wrap socket calls, not only HTTP ones.
 *
 * `TransportOptions.invocationWrapper` is how an application establishes a
 * per-invocation AsyncLocalStorage frame — in the DAOS backends, the RLS
 * scope. Only `http/server.ts` read it. Every socket transport dispatches
 * through `RemotePeer`, whose CALL branch went straight into `stub.call()`,
 * so a method invoked over WebSocket, TCP or Unix ran with no frame at all.
 *
 * kysera fails CLOSED without a scope — an impossible predicate on SELECT,
 * zero rows touched on UPDATE/DELETE. So nothing leaked; the symptom was a
 * realtime page that came back empty. A wrong answer shaped like "no data"
 * rather than an error is why this could sit for a long time.
 */
import { describe, it, expect, afterEach } from 'vitest';

import { Netron } from '../../src/netron/netron.js';
import { WebSocketTransport } from '../../src/netron/transport/websocket/transport.js';
import { Service, Public } from '../../src/decorators/core.js';
import { createMockLogger } from './test-utils.js';

/** Stands in for the AsyncLocalStorage frame a real wrapper would open. */
const frame: { current: string | null } = { current: null };

@Service('scoped@1.0.0')
class ScopedService {
  @Public()
  whoAmI(): string {
    // Reads the ambient frame, exactly as a repository under RLS would.
    return frame.current ?? 'NO_FRAME';
  }
}

describe('invocationWrapper across transports', () => {
  const cleanup: Array<() => Promise<unknown>> = [];

  afterEach(async () => {
    for (const fn of cleanup.splice(0).reverse()) await fn().catch(() => undefined);
    frame.current = null;
  });

  const startServer = async (withWrapper: boolean) => {
    const server = new Netron(createMockLogger(), { id: `srv-${withWrapper}` });
    server.registerTransport('ws', () => new WebSocketTransport());
    server.registerTransportServer('ws', {
      name: 'ws',
      options: {
        host: '127.0.0.1',
        port: 0,
        ...(withWrapper && {
          invocationWrapper: async (metadata: Map<string, unknown>, fn: () => Promise<unknown>) => {
            frame.current = `wrapped:${String(metadata.get('methodName'))}`;
            try {
              return await fn();
            } finally {
              frame.current = null;
            }
          },
        }),
      },
    });
    await server.start();
    cleanup.push(() => server.stop());
    await server.peer.exposeService(new ScopedService());
    return (server.transportServers.get('ws') as unknown as { port: number }).port;
  };

  const callOverWebSocket = async (port: number): Promise<string> => {
    const client = new Netron(createMockLogger(), { id: `cli-${port}` });
    client.registerTransport('ws', () => new WebSocketTransport());
    await client.start();
    cleanup.push(() => client.stop());
    const peer = await client.connect(`ws://127.0.0.1:${port}`);
    cleanup.push(() => peer.disconnect());
    const svc = await peer.queryInterface<ScopedService>('scoped@1.0.0');
    return svc.whoAmI();
  };

  it('runs a WebSocket call inside the wrapper', async () => {
    const port = await startServer(true);

    expect(await callOverWebSocket(port)).toBe('wrapped:whoAmI');
  }, 30000);

  it('runs without a frame when no wrapper is configured', async () => {
    // The option is opt-in; nothing should be invented when it is absent.
    const port = await startServer(false);

    expect(await callOverWebSocket(port)).toBe('NO_FRAME');
  }, 30000);

  it('honours a requestTimeout set on the server config', async () => {
    // Same store confusion, one option over: the accept path read
    // `getOptions(name)` — the CLIENT connection-options map — so a
    // `requestTimeout` set where the server is registered was ignored, with no
    // error because the option is optional.
    const server = new Netron(createMockLogger(), { id: 'srv-timeout' });
    server.registerTransport('ws', () => new WebSocketTransport());
    server.registerTransportServer('ws', {
      name: 'ws',
      options: { host: '127.0.0.1', port: 0, requestTimeout: 4321 },
    });
    await server.start();
    cleanup.push(() => server.stop());

    const port = (server.transportServers.get('ws') as unknown as { port: number }).port;
    const client = new Netron(createMockLogger(), { id: 'cli-timeout' });
    client.registerTransport('ws', () => new WebSocketTransport());
    await client.start();
    cleanup.push(() => client.stop());
    const peer = await client.connect(`ws://127.0.0.1:${port}`);
    cleanup.push(() => peer.disconnect());

    // The peer the SERVER accepted, not the one the client created.
    const accepted = [...server.peers.values()][0] as unknown as { requestTimeout?: number };
    expect(accepted).toBeDefined();
    expect(accepted.requestTimeout).toBe(4321);
  }, 30000);

  it('closes the frame after the call returns', async () => {
    const port = await startServer(true);
    await callOverWebSocket(port);

    // A frame that outlives its invocation would leak one caller's scope into
    // the next — worse than having none.
    expect(frame.current).toBeNull();
  }, 30000);
});
