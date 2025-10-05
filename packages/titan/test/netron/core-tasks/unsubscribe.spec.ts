/**
 * Tests for unsubscribe core task
 */

import { WebSocket } from 'ws';
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { unsubscribe } from '../../../src/netron/core-tasks/unsubscribe.js';
import { RemotePeer } from '../../../src/netron/remote-peer.js';
import { Netron } from '../../../src/netron/netron.js';
import { createMockLogger } from '../test-utils.js';

describe('unsubscribe core task', () => {
  let netron: Netron;
  let remotePeer: RemotePeer;
  let mockHandler: jest.Mock;

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

    // Create mock handler
    mockHandler = jest.fn();
  });

  afterEach(async () => {
    if (netron) {
      await netron.stop();
    }
  });

  it('should unsubscribe from event when subscription exists', () => {
    const eventName = 'test:event';

    // Manually add subscription to simulate previous subscribe
    remotePeer.remoteSubscriptions.set(eventName, mockHandler);

    // Spy on netron.peer.unsubscribe
    const unsubscribeSpy = jest.spyOn(netron.peer, 'unsubscribe');

    // Call unsubscribe
    unsubscribe(remotePeer, eventName);

    // Verify unsubscribe was called on netron peer
    expect(unsubscribeSpy).toHaveBeenCalledWith(eventName, mockHandler);

    // Verify subscription was removed from map
    expect(remotePeer.remoteSubscriptions.has(eventName)).toBe(false);
  });

  it('should be idempotent - calling unsubscribe multiple times should not error', () => {
    const eventName = 'test:event';

    // Add subscription
    remotePeer.remoteSubscriptions.set(eventName, mockHandler);

    // First unsubscribe
    unsubscribe(remotePeer, eventName);
    expect(remotePeer.remoteSubscriptions.has(eventName)).toBe(false);

    // Second unsubscribe - should not throw
    expect(() => unsubscribe(remotePeer, eventName)).not.toThrow();
    expect(remotePeer.remoteSubscriptions.has(eventName)).toBe(false);
  });

  it('should do nothing when no subscription exists', () => {
    const eventName = 'nonexistent:event';

    // Spy on netron.peer.unsubscribe
    const unsubscribeSpy = jest.spyOn(netron.peer, 'unsubscribe');

    // Call unsubscribe for non-existent subscription
    unsubscribe(remotePeer, eventName);

    // Verify unsubscribe was NOT called
    expect(unsubscribeSpy).not.toHaveBeenCalled();

    // Verify no subscription exists
    expect(remotePeer.remoteSubscriptions.has(eventName)).toBe(false);
  });

  it('should handle multiple different subscriptions independently', () => {
    const event1 = 'event:one';
    const event2 = 'event:two';
    const handler1 = jest.fn();
    const handler2 = jest.fn();

    // Add two subscriptions
    remotePeer.remoteSubscriptions.set(event1, handler1);
    remotePeer.remoteSubscriptions.set(event2, handler2);

    // Unsubscribe from first event only
    unsubscribe(remotePeer, event1);

    // Verify first subscription removed
    expect(remotePeer.remoteSubscriptions.has(event1)).toBe(false);

    // Verify second subscription still exists
    expect(remotePeer.remoteSubscriptions.has(event2)).toBe(true);
    expect(remotePeer.remoteSubscriptions.get(event2)).toBe(handler2);
  });

  it('should properly clean up handler reference', () => {
    const eventName = 'cleanup:test';

    // Add subscription
    remotePeer.remoteSubscriptions.set(eventName, mockHandler);
    expect(remotePeer.remoteSubscriptions.size).toBe(1);

    // Unsubscribe
    unsubscribe(remotePeer, eventName);

    // Verify map is empty
    expect(remotePeer.remoteSubscriptions.size).toBe(0);
  });
});
