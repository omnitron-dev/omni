/**
 * A restart that answered nothing.
 *
 * `Application.restart()` is `stop()` then `start()` on the same instance, and
 * the README declares Stopped → Starting a supported move. Measured by omni-3f
 * on main 2d071f93: after `app.restart()` the HTTP server did not listen —
 * ECONNREFUSED. `Netron.stop()` ended with `clearServerConfigs()`, so the
 * next `start()` found no server to bind and came up «client-only».
 * `netron-start-stop-interleaving.spec.ts` had named it latent.
 *
 * And a second layer waited behind the first: stopping closes the inbound
 * gate (`netron/inbound-gate.ts`), and nothing opened it again, so a
 * restarted process would have refused every call it was asked.
 *
 * What is pinned, over a real HTTP and a real WebSocket transport: after a
 * restart the same service answers on both, the gate is open, and it counts
 * only what it refuses from then on.
 */

import { afterEach, describe, expect, it } from 'vitest';

import { Application, NETRON_TOKEN } from '../../src/application.js';
import { Public, Service } from '../../src/decorators/core.js';
import { Netron } from '../../src/netron/netron.js';
import { HttpTransport } from '../../src/netron/transport/http/http-transport.js';
import { WebSocketTransport } from '../../src/netron/transport/websocket/index.js';
import type { RemotePeer } from '../../src/netron/remote-peer.js';
import { createMockLogger } from '../netron/test-utils.js';
import { getFreePort } from '../utils/index.js';

let release: () => void = () => undefined;

@Service('echo@1.0.0')
class EchoService {
  @Public()
  async echo(word: string): Promise<string> {
    return `echo:${word}`;
  }

  /** Holds a stop in its drain until released. */
  @Public()
  async hold(): Promise<string> {
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    return 'held';
  }
}

async function until(what: () => boolean, ms = 3000): Promise<void> {
  const end = Date.now() + ms;
  while (!what()) {
    if (Date.now() > end) throw new Error('condition not reached');
    await new Promise((r) => setTimeout(r, 5));
  }
}

let app: Application | undefined;
let client: Netron | undefined;

afterEach(async () => {
  release();
  await client?.stop().catch(() => undefined);
  client = undefined;
  if (app) await app.stop({ force: true }).catch(() => undefined);
  app = undefined;
});

async function serve() {
  const [http, ws] = [await getFreePort(), await getFreePort()];
  const netron = new Netron(createMockLogger(), { id: 'restart-server' });
  netron.registerTransport('http', () => new HttpTransport());
  netron.registerTransportServer('http', { name: 'http', options: { host: 'localhost', port: http } });
  netron.registerTransport('ws', () => new WebSocketTransport());
  netron.registerTransportServer('ws', { name: 'ws', options: { host: 'localhost', port: ws } });
  app = await Application.create({
    disableGracefulShutdown: true,
    disableCoreModules: true,
    providers: [[NETRON_TOKEN, { useValue: netron }]],
  });
  await app.start();
  await netron.peer.exposeService(new EchoService());
  return { netron, http, ws };
}

async function overHttp(port: number, word: string, method = 'echo'): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`http://localhost:${port}/netron/invoke`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: `restart-${word}`, service: 'echo@1.0.0', method, input: [word] }),
  });
  return { status: res.status, body: await res.json() };
}

async function overWebSocket(port: number, word: string): Promise<string> {
  const c = new Netron(createMockLogger(), { id: `restart-client-${word}` });
  client = c;
  c.registerTransport('ws', () => new WebSocketTransport());
  const peer = (await c.connect(`ws://localhost:${port}`)) as RemotePeer;
  const echo = await peer.queryInterface<{ echo(word: string): Promise<string> }>('echo@1.0.0');
  const answer = await echo.echo(word);
  await c.stop();
  client = undefined;
  return answer;
}

describe('an application restarted in its process', () => {
  it('answers on HTTP after the restart as it did before', async () => {
    const { http } = await serve();
    expect((await overHttp(http, 'before')).status).toBe(200);
    await app!.restart();
    const after = await overHttp(http, 'after');
    expect(after.status).toBe(200);
    expect(after.body).toMatchObject({ success: true, data: 'echo:after' });
  });

  it('answers on a WebSocket after the restart as it did before', async () => {
    const { ws } = await serve();
    expect(await overWebSocket(ws, 'before')).toBe('echo:before');
    await app!.restart();
    expect(await overWebSocket(ws, 'after')).toBe('echo:after');
  });

  it('opens the inbound gate again, and counts only the refusals after it', async () => {
    const { netron, http } = await serve();
    // A call holds the stop in its drain; one arriving meanwhile is refused.
    const held = overHttp(http, 'held', 'hold');
    await until(() => netron.inbound.inflight === 1);
    const stopping = app!.stop({ drainTimeout: 5000 });
    await until(() => netron.inbound.isDraining);
    expect((await overHttp(http, 'late')).status).toBe(503);
    expect(netron.inbound.refused).toBe(1);
    release();
    await held;
    await stopping;

    await app!.start();
    expect(netron.inbound.isDraining).toBe(false);
    expect(netron.inbound.refused).toBe(0);
    expect((await overHttp(http, 'again')).status).toBe(200);
  });
});
