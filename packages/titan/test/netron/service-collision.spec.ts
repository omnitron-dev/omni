/**
 * Tests for Bug Fix 1.2: Service Name Collision Protection in exposeRemoteService()
 *
 * Verifies that LocalPeer.exposeRemoteService() rejects attempts to expose a service
 * qualified name that is already exposed. A publisher must withdraw its previous
 * definition before replacing it, so existing proxies cannot silently change identity.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type WebSocket from 'ws';
import { Netron } from '../../src/netron/netron.js';
import { RemotePeer } from '../../src/netron/remote-peer.js';
import type { ServiceMetadata } from '../../src/netron/interfaces/core-types.js';
import { createMockLogger } from './test-utils.js';

function createMockSocket(): WebSocket {
  return {
    readyState: 1,
    send: vi.fn((data: any, opts: any, cb?: (err?: Error) => void) => {
      if (cb) cb();
    }),
    on: vi.fn(),
    once: vi.fn(),
    close: vi.fn(),
    removeAllListeners: vi.fn(),
  } as unknown as WebSocket;
}

function createServiceMeta(name: string, version = '1.0.0'): ServiceMetadata {
  return { name, version, properties: {}, methods: {} };
}

describe('Service Name Collision Protection (exposeRemoteService)', () => {
  let netron: Netron;

  beforeEach(async () => {
    netron = await Netron.create(createMockLogger(), { id: 'n1' });
  });

  afterEach(async () => {
    if (netron) {
      await netron.stop();
    }
  });

  it('should throw conflict error when two different peers expose the same service name', async () => {
    const peer1 = new RemotePeer(createMockSocket(), netron, 'peer-1');
    const peer2 = new RemotePeer(createMockSocket(), netron, 'peer-2');

    const meta = createServiceMeta('SameName');

    // First exposure by peer1 should succeed
    await netron.peer.exposeRemoteService(peer1, meta);

    // Second exposure by a different peer should throw a conflict error
    await expect(netron.peer.exposeRemoteService(peer2, meta)).rejects.toThrow(
      'Service already exposed: SameName@1.0.0',
    );
  });

  it('requires withdrawal before the same peer replaces its publication', async () => {
    const peer1 = new RemotePeer(createMockSocket(), netron, 'peer-1');
    const meta = createServiceMeta('TestService');

    // First exposure
    const def1 = await netron.peer.exposeRemoteService(peer1, meta);
    expect(def1).toBeDefined();

    // Replacing a live definition is an explicit withdrawal and publication.
    await expect(netron.peer.exposeRemoteService(peer1, meta)).rejects.toThrow('Service already exposed');
    expect(netron.services.get('TestService@1.0.0')?.definition.id).toBe(def1.id);
    await netron.peer.unexposeRemoteService(peer1, 'TestService@1.0.0');
    const def2 = await netron.peer.exposeRemoteService(peer1, meta);
    expect(def2).toBeDefined();
  });

  it('should allow different peers to expose different service names', async () => {
    const peer1 = new RemotePeer(createMockSocket(), netron, 'peer-1');
    const peer2 = new RemotePeer(createMockSocket(), netron, 'peer-2');

    await netron.peer.exposeRemoteService(peer1, createServiceMeta('ServiceA'));
    await netron.peer.exposeRemoteService(peer2, createServiceMeta('ServiceB'));

    // Both services should be registered in the services map
    expect(netron.services.has('ServiceA@1.0.0')).toBe(true);
    expect(netron.services.has('ServiceB@1.0.0')).toBe(true);
  });

  it('should allow another peer to expose a service name after the original peer unexposes it', async () => {
    const peer1 = new RemotePeer(createMockSocket(), netron, 'peer-1');
    const peer2 = new RemotePeer(createMockSocket(), netron, 'peer-2');
    const meta = createServiceMeta('TestService');

    // peer1 exposes the service
    await netron.peer.exposeRemoteService(peer1, meta);
    expect(netron.services.has('TestService@1.0.0')).toBe(true);

    // peer1 unexposes the service
    await netron.peer.unexposeRemoteService(peer1, 'TestService@1.0.0');
    expect(netron.services.has('TestService@1.0.0')).toBe(false);

    // peer2 should now be able to expose the same service name
    const def = await netron.peer.exposeRemoteService(peer2, meta);
    expect(def).toBeDefined();
    expect(netron.services.has('TestService@1.0.0')).toBe(true);
  });
});
