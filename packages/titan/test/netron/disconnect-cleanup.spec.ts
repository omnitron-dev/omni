/**
 * Bug Fix 1.1: Stale Services After Peer Disconnect
 *
 * Tests that when a peer disconnects, all services it exposed via
 * exposeRemoteService() are cleaned up from netron.services.
 *
 * The fix adds cleanupPeerServices() in netron.ts that iterates
 * netron.services when a peer disconnects and calls
 * localPeer.unexposeRemoteService() for any services whose
 * definition.peerId matches the disconnected peer.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type WebSocket from 'ws';
import { Netron } from '../../src/netron/netron.js';
import { RemotePeer } from '../../src/netron/remote-peer.js';
import { createMockLogger } from './test-utils.js';

function createMockSocket(): WebSocket {
  return {
    readyState: 1, // WebSocket.OPEN
    send: vi.fn((data: any, opts: any, cb?: (err?: Error) => void) => {
      if (cb) cb();
    }),
    on: vi.fn(),
    once: vi.fn(),
    close: vi.fn(),
    removeAllListeners: vi.fn(),
  } as unknown as WebSocket;
}

describe('Bug Fix 1.1: Stale Services After Peer Disconnect', () => {
  let netron: Netron;

  beforeEach(() => {
    netron = new Netron(createMockLogger(), { id: 'n1' });
  });

  afterEach(async () => {
    try {
      await netron.stop();
    } catch {
      // Ignore cleanup errors in tests
    }
  });

  it('should remove service from services map when owning peer disconnects', async () => {
    const mockSocket = createMockSocket();
    const remotePeer = new RemotePeer(mockSocket, netron, 'remote-peer-1');

    // Register the peer so disconnect() can find it
    netron.peers.set(remotePeer.id, remotePeer);

    const meta = { name: 'TestService', version: '1.0.0' };
    await netron.peer.exposeRemoteService(remotePeer, meta);

    expect(netron.services.has('TestService')).toBe(true);

    // Disconnect the peer -- this triggers cleanupPeerServices
    netron.disconnect(remotePeer.id);

    // Allow any pending async cleanup to complete
    await vi.waitFor(() => {
      expect(netron.services.has('TestService')).toBe(false);
    });
  });

  it('should only remove services belonging to the disconnected peer when multiple peers exist', async () => {
    const socket1 = createMockSocket();
    const socket2 = createMockSocket();
    const peer1 = new RemotePeer(socket1, netron, 'peer-1');
    const peer2 = new RemotePeer(socket2, netron, 'peer-2');

    netron.peers.set(peer1.id, peer1);
    netron.peers.set(peer2.id, peer2);

    await netron.peer.exposeRemoteService(peer1, { name: 'ServiceA', version: '1.0.0' });
    await netron.peer.exposeRemoteService(peer2, { name: 'ServiceB', version: '1.0.0' });

    expect(netron.services.has('ServiceA')).toBe(true);
    expect(netron.services.has('ServiceB')).toBe(true);

    // Disconnect only peer1
    netron.disconnect(peer1.id);

    await vi.waitFor(() => {
      expect(netron.services.has('ServiceA')).toBe(false);
    });

    // ServiceB from peer2 must still be present
    expect(netron.services.has('ServiceB')).toBe(true);
  });

  it('should remove all services when a peer with multiple services disconnects', async () => {
    const mockSocket = createMockSocket();
    const remotePeer = new RemotePeer(mockSocket, netron, 'multi-service-peer');

    netron.peers.set(remotePeer.id, remotePeer);

    await netron.peer.exposeRemoteService(remotePeer, { name: 'ServiceX', version: '1.0.0' });
    await netron.peer.exposeRemoteService(remotePeer, { name: 'ServiceY', version: '2.0.0' });

    expect(netron.services.has('ServiceX')).toBe(true);
    expect(netron.services.has('ServiceY')).toBe(true);

    netron.disconnect(remotePeer.id);

    await vi.waitFor(() => {
      expect(netron.services.has('ServiceX')).toBe(false);
      expect(netron.services.has('ServiceY')).toBe(false);
    });
  });

  it('should not throw when disconnecting a peer with no exposed services', async () => {
    const mockSocket = createMockSocket();
    const remotePeer = new RemotePeer(mockSocket, netron, 'no-services-peer');

    netron.peers.set(remotePeer.id, remotePeer);

    // No services exposed -- disconnect should be a safe no-op
    expect(() => netron.disconnect(remotePeer.id)).not.toThrow();

    // Peer should be removed from the peers map
    expect(netron.peers.has(remotePeer.id)).toBe(false);
  });

  it('should not throw when a service was already unexposed before peer disconnect', async () => {
    const mockSocket = createMockSocket();
    const remotePeer = new RemotePeer(mockSocket, netron, 'pre-unexposed-peer');

    netron.peers.set(remotePeer.id, remotePeer);

    await netron.peer.exposeRemoteService(remotePeer, { name: 'EphemeralService', version: '1.0.0' });
    expect(netron.services.has('EphemeralService')).toBe(true);

    // Manually unexpose the service before disconnect
    await netron.peer.unexposeRemoteService(remotePeer, 'EphemeralService');
    expect(netron.services.has('EphemeralService')).toBe(false);

    // Disconnect should not throw even though service is already gone
    expect(() => netron.disconnect(remotePeer.id)).not.toThrow();
  });
});
