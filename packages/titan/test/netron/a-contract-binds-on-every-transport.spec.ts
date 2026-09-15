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

/**
 * A contract must not break a method that takes no arguments.
 *
 * `validateMethodInput` unwraps an argument list before validating: a
 * one-element list becomes its element, and an EMPTY list becomes `undefined`,
 * so a schema that accepts `undefined` lets a no-argument call through. The
 * re-wrap afterwards only ever handled the one-element case, so that call came
 * back as bare `undefined` and `ServiceStub.processArgs` ran `args.map(...)`
 * on it — declaring a contract turned every legal no-argument call into a 500.
 *
 * Found from the other side: daos' cookie-mode `refreshAccessToken` sends an
 * empty body on purpose, because the token it needs is in an HttpOnly cookie
 * the client cannot read.
 */
const greeterContract = contract({
  ping: { input: z.object({ loud: z.boolean() }).optional() },
  withDefault: { input: z.object({ n: z.number() }).default({ n: 7 }) },
});

const heard: unknown[] = [];

@Contract(greeterContract)
@Service('greeter@1.0.0')
class GreeterService {
  @Public()
  async ping(opts?: unknown): Promise<{ got: unknown }> {
    heard.push(opts);
    return { got: opts ?? null };
  }

  @Public()
  async withDefault(opts?: unknown): Promise<{ got: unknown }> {
    heard.push(opts);
    return { got: opts ?? null };
  }
}

describe('a contract on a method that takes no arguments', () => {
  let s2: Netron;
  let c2: Netron;

  async function pair() {
    heard.length = 0;
    const port = await getFreePort();
    s2 = new Netron(createMockLogger(), { id: 'zero-arg-server' });
    s2.registerTransport('ws', () => new WebSocketTransport());
    s2.registerTransportServer('ws', { name: 'ws', options: { host: 'localhost', port } });
    await s2.start();
    await s2.peer.exposeService(new GreeterService());

    c2 = new Netron(createMockLogger(), { id: 'zero-arg-client' });
    c2.registerTransport('ws', () => new WebSocketTransport());
    const peer = await c2.connect(`ws://localhost:${port}`);
    return peer.queryInterface<any>('greeter@1.0.0');
  }

  afterEach(async () => {
    await new Promise((r) => setTimeout(r, 80));
    await c2?.stop();
    await s2?.stop();
    await new Promise((r) => setTimeout(r, 150));
  });

  it('is callable with nothing at all', async () => {
    const greeter = await pair();
    await expect(greeter.ping()).resolves.toEqual({ got: null });
    expect(heard).toEqual([undefined]);
  });

  it('still carries an argument when one is given', async () => {
    const greeter = await pair();
    await expect(greeter.ping({ loud: true })).resolves.toEqual({ got: { loud: true } });
  });

  it('and still refuses one the contract rejects', async () => {
    // Non-vacuity: the two above must not be passing because validation is off.
    const greeter = await pair();
    await expect(greeter.ping({ loud: 'yes' })).rejects.toThrow();
    expect(heard).toEqual([]);
  });

  it('a schema default becomes the argument the handler receives', async () => {
    const greeter = await pair();
    await expect(greeter.withDefault()).resolves.toEqual({ got: { n: 7 } });
    expect(heard, 'zod turned the absent argument into a value; it must be delivered').toEqual([
      { n: 7 },
    ]);
  });
});
