/**
 * Tests for unref-service core task
 */

import { WebSocket } from 'ws';
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { unref_service } from '../../../src/netron/core-tasks/unref-service.js';
import { RemotePeer } from '../../../src/netron/remote-peer.js';
import { Netron } from '../../../src/netron/netron.js';
import { createMockLogger } from '../test-utils.js';

describe('unref-service core task', () => {
  let netron: Netron;
  let remotePeer: RemotePeer;

  beforeEach(async () => {
    // Create Netron instance with mock logger
    netron = await Netron.create(createMockLogger(), { id: 'test-netron' });

    // Create a mock WebSocket for testing
    const mockSocket = {
      readyState: WebSocket.OPEN,
      send: jest.fn((data: any, opts: any, cb?: (err?: Error) => void) => {
        if (cb) cb();
      }),
      on: jest.fn(),
      close: jest.fn(),
    } as unknown as WebSocket;

    // Create remote peer with mock socket
    remotePeer = new RemotePeer(mockSocket, netron, 'remote-peer-id');
  });

  afterEach(async () => {
    if (netron) {
      await netron.stop();
    }
  });

  it('should delegate to peer.netron.peer.unrefService', () => {
    const defId = 'service-def-123';

    const unrefServiceSpy = jest.spyOn(netron.peer, 'unrefService').mockReturnValue(undefined);

    unref_service(remotePeer, defId);

    expect(unrefServiceSpy).toHaveBeenCalledWith(defId);
    expect(unrefServiceSpy).toHaveBeenCalledTimes(1);
  });

  it('should not return a value', () => {
    const defId = 'service-def-123';

    jest.spyOn(netron.peer, 'unrefService').mockReturnValue(undefined);

    const result = unref_service(remotePeer, defId);

    expect(result).toBeUndefined();
  });

  it('should handle different service definition IDs', () => {
    const unrefServiceSpy = jest.spyOn(netron.peer, 'unrefService').mockReturnValue(undefined);

    const defId1 = 'auth-service-def-456';
    const defId2 = 'data-service-def-789';

    unref_service(remotePeer, defId1);
    unref_service(remotePeer, defId2);

    expect(unrefServiceSpy).toHaveBeenNthCalledWith(1, defId1);
    expect(unrefServiceSpy).toHaveBeenNthCalledWith(2, defId2);
    expect(unrefServiceSpy).toHaveBeenCalledTimes(2);
  });

  it('should be idempotent when called multiple times for the same defId', () => {
    const defId = 'service-def-123';

    const unrefServiceSpy = jest.spyOn(netron.peer, 'unrefService').mockReturnValue(undefined);

    unref_service(remotePeer, defId);
    unref_service(remotePeer, defId);

    expect(unrefServiceSpy).toHaveBeenCalledTimes(2);
    expect(unrefServiceSpy).toHaveBeenNthCalledWith(1, defId);
    expect(unrefServiceSpy).toHaveBeenNthCalledWith(2, defId);
  });

  it('should handle UUIDs and complex IDs', () => {
    const unrefServiceSpy = jest.spyOn(netron.peer, 'unrefService').mockReturnValue(undefined);

    const uuid = '550e8400-e29b-41d4-a716-446655440000';
    const complexId = 'auth@1.0.0:user-service:prod';

    unref_service(remotePeer, uuid);
    unref_service(remotePeer, complexId);

    expect(unrefServiceSpy).toHaveBeenNthCalledWith(1, uuid);
    expect(unrefServiceSpy).toHaveBeenNthCalledWith(2, complexId);
    expect(unrefServiceSpy).toHaveBeenCalledTimes(2);
  });

  it('should handle empty string as defId', () => {
    const unrefServiceSpy = jest.spyOn(netron.peer, 'unrefService').mockReturnValue(undefined);

    unref_service(remotePeer, '');

    expect(unrefServiceSpy).toHaveBeenCalledWith('');
    expect(unrefServiceSpy).toHaveBeenCalledTimes(1);
  });
});
