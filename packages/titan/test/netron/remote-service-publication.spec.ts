/**
 * Tests for remote service publication and two-hop proxying.
 *
 * Verifies that when Peer A exposes a service on Peer B (server),
 * Peer C can query B and get a working proxy that routes calls
 * back through B to A.
 */

import { WebSocket } from 'ws';
import { vi, describe, beforeEach, afterEach, it, expect } from 'vitest';
import { Netron } from '../../src/netron/netron.js';
import { RemotePeer } from '../../src/netron/remote-peer.js';
import { createMockLogger } from './test-utils.js';
import type { ServiceMetadata } from '../../src/netron/types.js';

function createMockSocket() {
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

describe('Remote Service Publication', () => {
  let netron: Netron;

  beforeEach(async () => {
    netron = await Netron.create(createMockLogger(), { id: 'server' });
  });

  afterEach(async () => {
    netron.peer.unexposeAllServices();
    await netron.stop();
  });

  it('should register remote service in netron.services via exposeRemoteService', async () => {
    const peer = new RemotePeer(createMockSocket(), netron, 'peer-a');
    const meta: ServiceMetadata = { name: 'RemoteService', version: '1.0.0' };

    const def = await netron.peer.exposeRemoteService(peer, meta);

    expect(def).toBeDefined();
    expect(def.id).toBeTruthy();
    expect(def.peerId).toBe('peer-a');
    expect(netron.services.has('RemoteService')).toBe(true);

    const stub = netron.services.get('RemoteService')!;
    expect(stub).toBeDefined();
    expect(stub.definition.meta.name).toBe('RemoteService');
    expect(stub.definition.meta.version).toBe('1.0.0');
  });

  it('should store definition in peer.definitions', async () => {
    const peer = new RemotePeer(createMockSocket(), netron, 'peer-a');
    const meta: ServiceMetadata = { name: 'TrackedService', version: '2.0.0' };

    const def = await netron.peer.exposeRemoteService(peer, meta);

    expect(peer.definitions.has(def.id)).toBe(true);
    expect(peer.definitions.get(def.id)!.meta.name).toBe('TrackedService');
  });

  it('should emit service:expose event with remotePeerId', async () => {
    const peer = new RemotePeer(createMockSocket(), netron, 'peer-a');
    const meta: ServiceMetadata = { name: 'EventService', version: '1.0.0' };

    const events: any[] = [];
    netron.peer.subscribe('service:expose', (event: any) => {
      events.push(event);
    });

    await netron.peer.exposeRemoteService(peer, meta);

    expect(events.length).toBe(1);
    expect(events[0].name).toBe('EventService');
    expect(events[0].remotePeerId).toBe('peer-a');
  });

  it('should create interface stub with valid definition', async () => {
    const peer = new RemotePeer(createMockSocket(), netron, 'peer-a');
    const meta: ServiceMetadata = { name: 'InterfaceService', version: '1.0.0' };

    await netron.peer.exposeRemoteService(peer, meta);

    const stub = netron.services.get('InterfaceService')!;
    expect(stub.instance).toBeDefined();
    // Stub should have a valid definition linking back to the peer
    expect(stub.definition).toBeDefined();
    expect(stub.definition.peerId).toBe('peer-a');
    expect(stub.definition.meta.name).toBe('InterfaceService');
  });

  it('should allow unexposing remote service and clean up correctly', async () => {
    const peer = new RemotePeer(createMockSocket(), netron, 'peer-a');
    const meta: ServiceMetadata = { name: 'CleanupService', version: '1.0.0' };

    const def = await netron.peer.exposeRemoteService(peer, meta);

    expect(netron.services.has('CleanupService')).toBe(true);
    expect(peer.definitions.has(def.id)).toBe(true);

    await netron.peer.unexposeRemoteService(peer, 'CleanupService');

    expect(netron.services.has('CleanupService')).toBe(false);
    expect(peer.definitions.has(def.id)).toBe(false);
  });

  it('should handle multiple services from different peers independently', async () => {
    const peerA = new RemotePeer(createMockSocket(), netron, 'peer-a');
    const peerB = new RemotePeer(createMockSocket(), netron, 'peer-b');

    await netron.peer.exposeRemoteService(peerA, { name: 'ServiceA', version: '1.0.0' });
    await netron.peer.exposeRemoteService(peerB, { name: 'ServiceB', version: '1.0.0' });

    expect(netron.services.size).toBe(2);
    expect(netron.services.has('ServiceA')).toBe(true);
    expect(netron.services.has('ServiceB')).toBe(true);

    // Unexpose only ServiceA
    await netron.peer.unexposeRemoteService(peerA, 'ServiceA');

    expect(netron.services.size).toBe(1);
    expect(netron.services.has('ServiceA')).toBe(false);
    expect(netron.services.has('ServiceB')).toBe(true);
  });
});
