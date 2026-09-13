/**
 * A pool's `requestTimeout` must govern the RPC, not only the queue.
 *
 * `ProcessPool.execute` races the call against `poolOptions.requestTimeout`.
 * The call itself went through `NetronClient`, which registered its unix
 * transport and set no options — so the `RemotePeer` it built took netron's
 * 5 s WIRE default. A pool declaring `requestTimeout: 120_000` therefore
 * failed at 5 s, and the number the operator set bounded the wrong half.
 *
 * Measured on the downstream stand: `OHLCV 5min aggregation failed / RPC request
 * timed out after 5000ms`, logged by pricing but RAISED on the daemon —
 * the giveaway is a stack that starts in `Decoder.decodeExtData`, an error
 * deserialised rather than thrown locally. Raising the caller's own topology
 * deadline to 60 s cut the rate 4.3x and could not remove it, because this
 * leg was never the caller's to set.
 */

import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';

import { NetronClient } from '../../src/netron-client.js';

const CLIENT = readFileSync(new URL('../../src/netron-client.ts', import.meta.url), 'utf8');
const SPAWNER = readFileSync(new URL('../../src/process-spawner.ts', import.meta.url), 'utf8');
const POOL = readFileSync(new URL('../../src/process-pool.ts', import.meta.url), 'utf8');

const noopLogger = {
  trace() {}, debug() {}, info() {}, warn() {}, error() {}, fatal() {},
  child() { return noopLogger; },
} as never;

/** Capture what `start()` tells the transport registry. */
async function transportOptionsFrom(client: NetronClient): Promise<unknown> {
  const netron = (client as unknown as { netron: Record<string, unknown> }).netron;
  let captured: unknown;
  netron['registerTransport'] = () => undefined;
  netron['setTransportOptions'] = (_name: string, opts: unknown) => {
    captured = opts;
  };
  netron['start'] = async () => undefined;
  await client.start();
  return captured;
}

describe('NetronClient', () => {
  it('tells the transport its request deadline', async () => {
    const client = new NetronClient('p1', noopLogger, { requestTimeout: 120_000 });
    await expect(transportOptionsFrom(client)).resolves.toEqual({ requestTimeout: 120_000 });
  });

  it('sets nothing when no deadline was given, leaving netron its default', async () => {
    const client = new NetronClient('p2', noopLogger);
    await expect(transportOptionsFrom(client)).resolves.toBeUndefined();
  });

  it('does the telling in start(), before any connect can build a peer', () => {
    const at = CLIENT.indexOf('setTransportOptions');
    const startAt = CLIENT.indexOf('async start()');
    const connectAt = CLIENT.indexOf('async connect(');
    expect(at).toBeGreaterThan(startAt);
    expect(at, 'the option must be registered before connect() reads it back').toBeLessThan(connectAt);
  });
});

describe('the deadline travels from the pool to the peer', () => {
  it('the pool puts its requestTimeout into the spawn options', () => {
    const at = POOL.indexOf('const proxy = await this.manager.spawn(');
    const call = POOL.slice(at, POOL.indexOf('});', at));
    expect(call).toContain('this.poolOptions.requestTimeout');
  });

  it('and lets a per-worker spawnOption override it', () => {
    const at = POOL.indexOf('const proxy = await this.manager.spawn(');
    const call = POOL.slice(at, POOL.indexOf('});', at));
    const poolAt = call.indexOf('this.poolOptions.requestTimeout');
    const baseAt = call.indexOf('...baseOptions');
    expect(poolAt, 'a later spread must be able to win').toBeLessThan(baseAt);
  });

  it('the spawner hands it to the client', () => {
    const at = SPAWNER.indexOf('new NetronClient(');
    const call = SPAWNER.slice(at, SPAWNER.indexOf('});', at));
    expect(call).toContain('options.requestTimeout');
  });

  it('the queue deadline is still applied — this adds a leg, it does not move one', () => {
    expect(POOL).toContain('this.poolOptions.requestTimeout;');
    expect(POOL).toMatch(/Errors\.timeout\('Request', timeout\)/);
  });
});
