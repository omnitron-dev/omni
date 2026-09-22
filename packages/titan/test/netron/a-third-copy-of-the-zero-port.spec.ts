/**
 * The third copy of one mistake, in the transport nobody had checked.
 *
 * `port: 0` is how a caller asks the OS for a free port. Three transports
 * parse a port, and the same `||` was written in all three:
 *
 *     http/server.ts   fixed earlier — its comment records the symptom:
 *                      «EADDRINUSE ::1:3000», a port the caller never named
 *     websocket        fixed today (e73c218e), on two layers, after nine
 *                      test files failed against OrbStack's 8080
 *     tcp-transport    still `parsed.port || 9000` on the STRING path,
 *                      while the options path beside it already used `??`
 *
 * The TCP one is the interesting shape: half of it was already correct.
 * `createServer({ port: 0 })` honoured the zero and `createServer(
 * 'tcp://127.0.0.1:0')` did not, so the same request answered differently
 * depending on which way it was spelled — and the string form is what an
 * address in a config file produces.
 *
 * So this court is not «tcp is fixed». It asserts the rule across every
 * transport that binds a port, by both spellings, because a rule proved on
 * one implementation is how the second and third copies survived this long.
 */

import { describe, it, expect, afterEach } from 'vitest';

import { TcpTransport } from '../../src/netron/transport/tcp-transport.js';
import { WebSocketTransport } from '../../src/netron/transport/websocket/transport.js';
import type { ITransportServer } from '../../src/netron/transport/types.js';

/** The default each transport falls back to when no port is named. */
const DEFAULTS = { tcp: 9000, ws: 8080 } as const;

describe('a third copy of the zero port', () => {
  const started: ITransportServer[] = [];

  afterEach(async () => {
    for (const s of started.splice(0)) await s.close().catch(() => undefined);
  });

  const portOf = (s: ITransportServer): number | undefined =>
    (s as unknown as { port?: number }).port;

  it('tcp honours a zero given as options', async () => {
    const server = await new TcpTransport().createServer({ host: '127.0.0.1', port: 0 });
    started.push(server);

    expect(portOf(server)).toBeGreaterThan(0);
    expect(portOf(server), 'not the default the caller declined').not.toBe(DEFAULTS.tcp);
  });

  it('tcp honours a zero given in the address', async () => {
    // The half that was still wrong. An address string is what a config file
    // produces, so this is the spelling most likely to carry a 0 in anger.
    const server = await new TcpTransport().createServer('tcp://127.0.0.1:0');
    started.push(server);

    expect(portOf(server)).toBeGreaterThan(0);
    expect(portOf(server), 'not the default the caller declined').not.toBe(DEFAULTS.tcp);
  });

  it('websocket honours a zero by both spellings', async () => {
    const byOptions = await new WebSocketTransport().createServer({ host: '127.0.0.1', port: 0 });
    started.push(byOptions);
    expect(portOf(byOptions)).toBeGreaterThan(0);
    expect(portOf(byOptions)).not.toBe(DEFAULTS.ws);

    const byAddress = await new WebSocketTransport().createServer('ws://127.0.0.1:0');
    started.push(byAddress);
    expect(portOf(byAddress)).toBeGreaterThan(0);
    expect(portOf(byAddress)).not.toBe(DEFAULTS.ws);
  });

  it('two servers asking for any port never collide', async () => {
    // The point of asking for 0, and what the defect destroyed: under it
    // both wanted the same well-known port.
    const a = await new TcpTransport().createServer('tcp://127.0.0.1:0');
    started.push(a);
    const b = await new TcpTransport().createServer('tcp://127.0.0.1:0');
    started.push(b);

    expect(portOf(a)).not.toBe(portOf(b));
  });

  it('a named port is still honoured, by both spellings', async () => {
    // Control: the fallback exists for callers who name nothing, and a
    // caller who names a port must land on it.
    const scout = await new TcpTransport().createServer('tcp://127.0.0.1:0');
    const chosen = portOf(scout) as number;
    await scout.close();

    const byAddress = await new TcpTransport().createServer(`tcp://127.0.0.1:${chosen}`);
    started.push(byAddress);
    expect(portOf(byAddress)).toBe(chosen);
  });
});
