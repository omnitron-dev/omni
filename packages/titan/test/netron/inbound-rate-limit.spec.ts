/**
 * Regression tests for T#39 — per-peer inbound rate limit on
 * persistent transports (WS / TCP / Unix).
 *
 * Before this fix, RemotePeer.handlePacket processed every inbound
 * packet at line speed. A single misbehaving or malicious peer could
 * flood the server, multiplying every CPU-bound step of the packet
 * handler (decode, auth lookup, ACL filter, stub dispatch). That
 * turned a 1-connection client into a DoS / ReDoS amplifier.
 *
 * Fix: when the host opts in via `inboundRateLimit`, the Netron
 * instantiates a per-peer rate limiter. Every unsolicited inbound
 * packet on a RemotePeer goes through `limiter.consume(peer.id)`
 * BEFORE the expensive stub/auth path. Over-budget packets surface
 * a structured TOO_MANY_REQUESTS error to the caller and are
 * dropped.
 *
 * We exercise the wire path through a real WebSocket connection so
 * the rate-limit decision goes through every layer that matters:
 * decoder, peer hand-off, handlePacket().
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Netron } from '../../src/netron/netron.js';
import { Service, Public } from '../../src/decorators/core.js';
import { WebSocketTransport } from '../../src/netron/transport/websocket/index.js';
import { createMockLogger } from './test-utils.js';
import type { RemotePeer } from '../../src/netron/remote-peer.js';

@Service('echo@1.0.0')
class EchoService {
  @Public()
  async ping(): Promise<'pong'> {
    return 'pong';
  }
}

describe('Netron — inbound rate limit (T#39)', () => {
  let server: Netron;
  let client: Netron;
  let port: number;

  async function startPair(opts: { limit: number; window?: number }) {
    const workerId = parseInt(process.env['JEST_WORKER_ID'] || '1', 10);
    port = 9600 + (workerId - 1) * 300 + Math.floor(Math.random() * 250);

    server = new Netron(createMockLogger(), {
      id: 'rate-limit-server',
      inboundRateLimit: {
        strategy: 'fixed',
        window: opts.window ?? 60_000,
        defaultTier: { name: 'default', limit: opts.limit },
      },
    });
    server.registerTransport('ws', () => new WebSocketTransport());
    server.registerTransportServer('ws', { name: 'ws', options: { host: 'localhost', port } });
    await server.start();
    await server.peer.exposeService(new EchoService());

    client = new Netron(createMockLogger(), { id: 'rate-limit-client' });
    client.registerTransport('ws', () => new WebSocketTransport());
  }

  afterEach(async () => {
    await new Promise((r) => setTimeout(r, 80));
    await client?.stop();
    await server?.stop();
    await new Promise((r) => setTimeout(r, 150));
  });

  it('initializes inboundRateLimiter when the option is set', async () => {
    await startPair({ limit: 100 });
    expect(server.inboundRateLimiter).toBeDefined();
    expect(typeof server.inboundRateLimiter!.consume).toBe('function');
  });

  it('omits the limiter when the option is not set', async () => {
    const noLimitServer = new Netron(createMockLogger(), { id: 'no-rl' });
    await noLimitServer.start();
    expect(noLimitServer.inboundRateLimiter).toBeUndefined();
    await noLimitServer.stop();
  });

  it('rejects packets that exceed the configured budget', async () => {
    // Tight budget so we can exhaust it quickly.
    await startPair({ limit: 2, window: 60_000 });
    const peer = (await client.connect(`ws://localhost:${port}`)) as RemotePeer;
    const echo = await peer.queryInterface<{ ping(): Promise<string> }>('echo@1.0.0');

    // queryInterface already consumed a couple of tokens (definition
    // discovery uses TYPE_TASK packets). Burn whatever is left so the
    // next ping must throw.
    while ((server.inboundRateLimiter as any)) {
      try {
        await peer.runTask('query_interface', 'echo@1.0.0');
      } catch (err: any) {
        if (/Rate limit/i.test(err.message)) break;
        throw err;
      }
    }

    await expect(echo.ping()).rejects.toMatchObject({
      message: expect.stringMatching(/Rate limit/i),
    });

    await peer.disconnect();
  });

  it('lets normal traffic flow when the budget is generous', async () => {
    await startPair({ limit: 200 });
    const peer = (await client.connect(`ws://localhost:${port}`)) as RemotePeer;
    const echo = await peer.queryInterface<{ ping(): Promise<string> }>('echo@1.0.0');

    for (let i = 0; i < 10; i++) {
      const r = await echo.ping();
      expect(r).toBe('pong');
    }

    await peer.disconnect();
  });
});
