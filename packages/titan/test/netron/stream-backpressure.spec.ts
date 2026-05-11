/**
 * Regression test for T#43 — `sendPacket` short-circuited TYPE_STREAM
 * chunks, resolving immediately without awaiting the socket's send
 * callback. That defeated backpressure: a producer could call
 * `write()` faster than the socket could flush, and the underlying
 * socket's `bufferedAmount` grew without bound. `WritableStream`'s
 * `pipeFrom` even has an `await once('drain')` dance, but `drain`
 * never fired because the fast path resolved before the transport
 * reported the chunk as queued.
 *
 * Fix: every packet — including TYPE_STREAM — goes through the
 * callback path. The producer experiences real backpressure when
 * the socket is congested.
 *
 * This test exercises the wire-level behaviour with a controllable
 * mock socket. We verify that `sendStreamChunk` waits for the
 * underlying socket callback (i.e., does NOT resolve before the
 * socket signals the chunk has been queued).
 */

import { describe, it, expect, vi } from 'vitest';
import { RemotePeer } from '../../src/netron/remote-peer.js';
import { Netron } from '../../src/netron/netron.js';
import { createMockLogger } from './test-utils.js';

describe('RemotePeer.sendStreamChunk — honours backpressure (T#43)', () => {
  it('waits for the socket send-callback before resolving', async () => {
    const netron = new Netron(createMockLogger(), { id: 'bp-test' });
    let storedCb: ((err?: Error) => void) | undefined;
    const mockSocket: any = {
      readyState: 1,
      send: vi.fn((_data: any, _opts: any, cb?: (err?: Error) => void) => {
        // Capture the callback rather than invoking it — simulates a
        // congested socket that hasn't yet flushed the chunk. If
        // sendStreamChunk takes the old fast-path it'll resolve right
        // away; we check that it does NOT.
        storedCb = cb;
      }),
      on: vi.fn(),
      close: vi.fn(),
    };
    const peer = new RemotePeer(mockSocket, netron, 'producer');

    let resolved = false;
    const p = peer.sendStreamChunk(42, 'chunk', 0, false, false).then(() => {
      resolved = true;
    });

    // Give the event loop a tick — fast-path would have resolved already.
    await new Promise((r) => setImmediate(r));
    expect(resolved).toBe(false);
    expect(typeof storedCb).toBe('function');

    // Fire the callback. Now the promise must resolve.
    storedCb!();
    await p;
    expect(resolved).toBe(true);

    await netron.stop();
  });

  it('propagates socket-callback errors as a rejected promise', async () => {
    const netron = new Netron(createMockLogger(), { id: 'bp-test-err' });
    const mockSocket: any = {
      readyState: 1,
      send: vi.fn((_d: any, _o: any, cb?: (err?: Error) => void) => cb?.(new Error('queue-full'))),
      on: vi.fn(),
      close: vi.fn(),
    };
    const peer = new RemotePeer(mockSocket, netron, 'producer');

    await expect(peer.sendStreamChunk(7, 'x', 0, false, false)).rejects.toThrow(/queue-full/);

    await netron.stop();
  });
});
