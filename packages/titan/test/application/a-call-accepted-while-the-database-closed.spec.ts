/**
 * A call accepted while the database closed.
 *
 * `stop()` tore the modules down — `destroyInstances()`, where a database
 * manager's `@PreDestroy` closes every connection, then each module's
 * `onStop`/`onDestroy` — and closed the transports LAST. Measured on daos main,
 * 2026-09-25, one process:
 *
 *   16:57:14.504  Closing all database connections
 *   16:57:16.343  Platform config unreadable …        ← a sign-up, still running
 *   16:57:16.350  Netron error                          ← «connection default not found»
 *   16:57:16.357  All database connections closed
 *   16:57:16.358  Closing http transport server         ← only now
 *
 * The sign-up had already CREATED the account, then answered the error. Every
 * restart and every deploy of every app, and of the omnitron daemon, has that
 * window. Now the first step of stopping drains the inbound gate. What is
 * pinned, over a real HTTP and a real WebSocket transport:
 *
 *   (a) a call that arrives after stopping began never reaches its handler and
 *       is answered 503 `SHUTTING_DOWN` — on HTTP, and on a WebSocket
 *       connection that was already open;
 *   (b) a call already running finishes before `@PreDestroy` runs;
 *   (c) a call that hangs does not hold stopping past the drain ceiling;
 *   (d) a forced stop does not wait at all;
 *   (e) the ceiling a supervised child's runtime states (`TITAN_DRAIN_TIMEOUT_MS`)
 *       holds on a stop that names none and on a shutdown — titan's own 10 s
 *       outwaits the 3500 ms a child has before SIGKILL;
 *   (f) with nothing stated, a drain takes half of the stop's `timeout`, not
 *       all of it: a shutdown hands `stop()` its WHOLE budget as `timeout`, and
 *       the first draft let one hung call spend the time `@PreDestroy` needed.
 */

import { afterEach, describe, expect, it } from 'vitest';

import { Application, NETRON_TOKEN } from '../../src/application.js';
import { Injectable, PreDestroy } from '../../src/decorators/index.js';
import { Public, Service } from '../../src/decorators/core.js';
import { ShutdownReason } from '../../src/types.js';
import { createToken } from '../../src/nexus/index.js';
import { Netron } from '../../src/netron/netron.js';
import { HttpTransport } from '../../src/netron/transport/http/http-transport.js';
import { WebSocketTransport } from '../../src/netron/transport/websocket/index.js';
import type { RemotePeer } from '../../src/netron/remote-peer.js';
import { createMockLogger } from '../netron/test-utils.js';
import { getFreePort } from '../utils/index.js';

const trace: string[] = [];
let entered = 0;
let release: () => void = () => undefined;

@Service('slow@1.0.0')
class SlowService {
  @Public()
  async slow(): Promise<string> {
    entered++;
    trace.push('call:start');
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    trace.push('call:end');
    return 'done';
  }

  @Public()
  async quick(): Promise<string> {
    entered++;
    trace.push('quick');
    return 'ok';
  }
}

/** Stands in for the database manager: what it closes in `@PreDestroy` is what a late call needs. */
const DB = createToken<Db>('DrainDb');
@Injectable()
class Db {
  @PreDestroy()
  async close(): Promise<void> {
    trace.push('db:close');
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
  trace.length = 0;
  entered = 0;
  const [http, ws] = [await getFreePort(), await getFreePort()];
  const netron = new Netron(createMockLogger(), { id: 'drain-server' });
  netron.registerTransport('http', () => new HttpTransport());
  netron.registerTransportServer('http', { name: 'http', options: { host: 'localhost', port: http } });
  netron.registerTransport('ws', () => new WebSocketTransport());
  netron.registerTransportServer('ws', { name: 'ws', options: { host: 'localhost', port: ws } });
  app = await Application.create({
    disableGracefulShutdown: true,
    disableCoreModules: true,
    providers: [
      [NETRON_TOKEN, { useValue: netron }],
      [DB, { useClass: Db }],
    ],
  });
  await app.start();
  app.get(DB); // an instance, so there is a @PreDestroy to run
  await netron.peer.exposeService(new SlowService());
  return { netron, http, ws };
}

const invoke = (port: number, method: string) =>
  fetch(`http://localhost:${port}/netron/invoke`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: `drain-${method}`, service: 'slow@1.0.0', method, input: [] }),
  });

/** Run with `TITAN_DRAIN_TIMEOUT_MS` as a supervised child's runtime would set it — or unset. */
async function withStatedDrain(value: string | undefined, run: () => Promise<void>): Promise<void> {
  const before = process.env['TITAN_DRAIN_TIMEOUT_MS'];
  if (value === undefined) delete process.env['TITAN_DRAIN_TIMEOUT_MS'];
  else process.env['TITAN_DRAIN_TIMEOUT_MS'] = value;
  try {
    await run();
  } finally {
    if (before === undefined) delete process.env['TITAN_DRAIN_TIMEOUT_MS'];
    else process.env['TITAN_DRAIN_TIMEOUT_MS'] = before;
  }
}

async function until(what: () => boolean, ms = 3000): Promise<void> {
  const end = Date.now() + ms;
  while (!what()) {
    if (Date.now() > end) throw new Error('condition not reached');
    await new Promise((r) => setTimeout(r, 5));
  }
}

describe('stopping with calls on the wire', () => {
  it('(a) answers a call that arrives after stopping began 503 SHUTTING_DOWN, and runs none of it — over HTTP', async () => {
    const { netron, http } = await serve();
    const running = invoke(http, 'slow');
    await until(() => trace.includes('call:start'));
    const stopping = app!.stop({ drainTimeout: 5000 });
    await until(() => netron.inbound.isDraining);

    const before = entered;
    const late = await invoke(http, 'quick');
    expect(late.status).toBe(503);
    expect(late.headers.get('retry-after')).toBe('1');
    const body = (await late.json()) as { error: { code: string; details: { errorCode: string } } };
    expect(body.error.code).toBe('SHUTTING_DOWN');
    expect(body.error.details.errorCode).toBe('SHUTTING_DOWN');
    expect(entered).toBe(before);

    release();
    expect((await running).status).toBe(200);
    await stopping;
    expect(netron.inbound.refused).toBe(1);
  });

  it('(a) refuses it on a WebSocket connection that was already open, too', async () => {
    const { netron, ws } = await serve();
    client = new Netron(createMockLogger(), { id: 'drain-client' });
    client.registerTransport('ws', () => new WebSocketTransport());
    const peer = (await client.connect(`ws://localhost:${ws}`)) as RemotePeer;
    const service = await peer.queryInterface<{ slow(): Promise<string>; quick(): Promise<string> }>('slow@1.0.0');

    const running = service.slow();
    await until(() => trace.includes('call:start'));
    const stopping = app!.stop({ drainTimeout: 5000 });
    await until(() => netron.inbound.isDraining);

    const before = entered;
    const late = await service.quick().then(
      () => null,
      (err: { details?: { errorCode?: string } }) => err,
    );
    expect(late?.details?.errorCode).toBe('SHUTTING_DOWN');
    expect(entered).toBe(before);

    release();
    expect(await running).toBe('done');
    await stopping;
  });

  it('(b) lets a running call finish before @PreDestroy runs', async () => {
    const { http } = await serve();
    const running = invoke(http, 'slow');
    await until(() => trace.includes('call:start'));
    const stopping = app!.stop({ drainTimeout: 5000 });
    await new Promise((r) => setTimeout(r, 50));
    expect(trace).not.toContain('db:close');
    release();
    await running;
    await stopping;
    expect(trace).toEqual(['call:start', 'call:end', 'db:close']);
  });

  it('(c) does not let a call that hangs hold stopping past the drain ceiling', async () => {
    const { http } = await serve();
    const running = invoke(http, 'slow').catch(() => null);
    await until(() => trace.includes('call:start'));
    const began = Date.now();
    await app!.stop({ drainTimeout: 200 });
    expect(Date.now() - began).toBeLessThan(2000);
    expect(trace).toContain('db:close');
    expect(trace).not.toContain('call:end');
    await running;
  });

  it('(d) does not wait at all when forced', async () => {
    const { netron, http } = await serve();
    const running = invoke(http, 'slow').catch(() => null);
    await until(() => trace.includes('call:start'));
    const began = Date.now();
    await app!.stop({ force: true, drainTimeout: 5000 });
    expect(Date.now() - began).toBeLessThan(1000);
    expect(netron.inbound.isDraining).toBe(true);
    await running;
  });

  it("(e) keeps to the ceiling a supervised child's runtime stated, on a bare stop and on a shutdown", async () => {
    await withStatedDrain('200', async () => {
      for (const stopping of [() => app!.stop(), () => app!.shutdown(ShutdownReason.Manual)]) {
        const { http } = await serve();
        const running = invoke(http, 'slow').catch(() => null);
        await until(() => trace.includes('call:start'));
        const began = Date.now();
        await stopping();
        // Unstated, the bare stop would wait 10 s and the shutdown — which
        // hands `stop()` a 30 s budget — 10 s as well.
        expect(Date.now() - began).toBeLessThan(2000);
        expect(trace).toContain('db:close');
        expect(trace).not.toContain('call:end');
        await running;
        app = undefined;
      }
    });
  });

  it("(f) leaves the teardown half of a stop's timeout when nothing states a ceiling", async () => {
    await withStatedDrain(undefined, async () => {
      const { http } = await serve();
      const running = invoke(http, 'slow').catch(() => null);
      await until(() => trace.includes('call:start'));
      const began = Date.now();
      await app!.stop({ timeout: 3000 });
      // 1500 ms of drain, then the teardown. Waiting all 3000 is the drain
      // spending the budget the teardown runs in.
      expect(Date.now() - began).toBeLessThan(2700);
      expect(trace).toContain('db:close');
      await running;
    });
  });
});
