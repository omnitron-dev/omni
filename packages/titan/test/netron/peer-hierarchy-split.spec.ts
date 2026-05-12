/**
 * Regression test for T#51 — `IPeer` split into `IRpcPeer` /
 * `IStatefulPeer`.
 *
 * The monolithic `IPeer` interface forced HttpRemotePeer to
 * advertise `subscribe()` / `unsubscribe()` / `emit()` / `close()`
 * even though those methods just threw `notImplemented` at
 * runtime. Callers had no way to statically detect the mismatch
 * — they'd write `peer.subscribe(...)` thinking the types
 * vouched for it, then catch a runtime error in production.
 *
 * The fix splits the interface and introduces a runtime brand
 * (`STATEFUL_PEER` symbol) set only by transports that actually
 * support the stateful operations. The `isStatefulPeer(peer)`
 * type guard narrows `IRpcPeer` to `IStatefulPeer` at both
 * compile and runtime.
 */

import { describe, it, expect, vi } from 'vitest';
import { WebSocket } from 'ws';
import { Netron } from '../../src/netron/netron.js';
import { RemotePeer } from '../../src/netron/remote-peer.js';
import { HttpRemotePeer } from '../../src/netron/transport/http/peer.js';
import { isStatefulPeer, STATEFUL_PEER } from '../../src/netron/interfaces/core-types.js';
import { createMockLogger } from './test-utils.js';

describe('Netron peer hierarchy split (T#51)', () => {
  it("LocalPeer is branded stateful", async () => {
    const n = await Netron.create(createMockLogger(), { id: 'n1' });
    try {
      expect(isStatefulPeer(n.peer)).toBe(true);
      // The brand is the same symbol exported from core-types.
      expect((n.peer as any)[STATEFUL_PEER]).toBe(true);
    } finally {
      await n.stop();
    }
  });

  it('RemotePeer (WS/TCP/Unix transports) is branded stateful', async () => {
    const n = await Netron.create(createMockLogger(), { id: 'n2' });
    try {
      const mockSocket = {
        readyState: WebSocket.OPEN,
        send: vi.fn(),
        on: vi.fn(),
        close: vi.fn(),
      } as unknown as WebSocket;
      const peer = new RemotePeer(mockSocket, n, 'remote-1');
      expect(isStatefulPeer(peer)).toBe(true);
    } finally {
      await n.stop();
    }
  });

  it('HttpRemotePeer is NOT branded stateful — narrows to IRpcPeer only', () => {
    const n = new Netron(createMockLogger(), { id: 'n3' });
    const fakeConnection = {} as any;
    const peer = new HttpRemotePeer(fakeConnection, n, 'http://example.test:8080');
    // Brand is absent.
    expect(isStatefulPeer(peer)).toBe(false);
    expect((peer as any)[STATEFUL_PEER]).toBeUndefined();
  });

  it('isStatefulPeer is a useful runtime gate against subscribe-on-HTTP misuse', () => {
    // Construct one of each peer flavour and verify the narrowing
    // catches the historical bug class: a generic code path that
    // accepts `IRpcPeer` can OPPORTUNISTICALLY use subscribe ONLY
    // when the runtime brand is set. Without this gate, calling
    // `subscribe` on an HttpRemotePeer threw at runtime.
    const n = new Netron(createMockLogger(), { id: 'n4' });
    const fakeConnection = {} as any;
    const http = new HttpRemotePeer(fakeConnection, n, 'http://example.test:8080');
    const mockSocket = {
      readyState: WebSocket.OPEN,
      send: vi.fn(),
      on: vi.fn(),
      close: vi.fn(),
    } as unknown as WebSocket;
    const ws = new RemotePeer(mockSocket, n, 'remote-2');

    const peers = [http, ws];
    const stateful = peers.filter(isStatefulPeer);
    expect(stateful).toHaveLength(1);
    expect(stateful[0]).toBe(ws);
  });
});
