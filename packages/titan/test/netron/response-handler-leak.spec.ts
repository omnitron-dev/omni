/**
 * Regression test for T#44 — `sendRequest` registered a response
 * handler in `responseHandlers` BEFORE calling `sendPacket`. If
 * `sendPacket` rejected (socket closed mid-RPC, transport error,
 * etc.) the handler was never cleaned up: the response that would
 * trigger `deleteResponseHandler` could never arrive. A flaky
 * connection accumulated orphaned handlers until the TimedMap's
 * TTL expired — meanwhile the map grew unboundedly and the
 * Promise the caller awaited never resolved or rejected through
 * the normal response path.
 *
 * Fix: drop the handler synchronously on sendPacket rejection and
 * surface the error through the registered errorHandler. The
 * caller's awaited Promise rejects immediately rather than
 * hanging until cache eviction.
 */

import { describe, it, expect, vi } from 'vitest';
import { RemotePeer } from '../../src/netron/remote-peer.js';
import { Netron } from '../../src/netron/netron.js';
import { createMockLogger } from './test-utils.js';

describe('RemotePeer.sendRequest — response-handler cleanup on send failure (T#44)', () => {
  it('drops the registered handler when the underlying send rejects', async () => {
    const netron = new Netron(createMockLogger(), { id: 't44-handler-leak' });
    // Mock socket that synchronously fails every send.
    const mockSocket: any = {
      readyState: 1,
      send: vi.fn((_d: any, _o: any, cb?: (err?: Error) => void) => cb?.(new Error('transport-down'))),
      on: vi.fn(),
      close: vi.fn(),
    };
    const peer = new RemotePeer(mockSocket, netron, 'flaky-peer');
    // Prime the definitions map so `call` makes it past its own
    // notFound check and into the sendRequest path.
    (peer as any).definitions.set('def-1', { id: 'def-1', meta: {} });

    // Map starts empty.
    expect((peer as any).responseHandlers.size).toBe(0);

    await expect(peer.call('def-1', 'doIt', [])).rejects.toThrow(/transport-down/);

    // The bug we're guarding: even after the send failure, the
    // response handler was left behind. With the fix, it's gone.
    expect((peer as any).responseHandlers.size).toBe(0);

    // A second failed send must also leave the map empty.
    await expect(peer.call('def-1', 'doIt', [])).rejects.toThrow(/transport-down/);
    expect((peer as any).responseHandlers.size).toBe(0);

    await netron.stop();
  });
});
