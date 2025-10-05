/**
 * Tests for emit core task
 */

import { WebSocket } from 'ws';
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { emit } from '../../../src/netron/core-tasks/emit.js';
import { RemotePeer } from '../../../src/netron/remote-peer.js';
import { Netron } from '../../../src/netron/netron.js';
import { createMockLogger } from '../test-utils.js';

describe('emit core task', () => {
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

  it('should call registered handler when event is emitted', () => {
    const handler = jest.fn();
    const eventName = 'test:event';

    // Manually add handler to eventSubscribers
    remotePeer.eventSubscribers.set(eventName, new Set([handler]));

    emit(remotePeer, eventName, 'arg1', 'arg2');

    expect(handler).toHaveBeenCalledWith('arg1', 'arg2');
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('should do nothing when no handlers are registered for the event', () => {
    const eventName = 'nonexistent:event';

    // Should not throw and should handle gracefully
    expect(() => emit(remotePeer, eventName, 'arg1')).not.toThrow();
  });

  it('should call multiple handlers for the same event', () => {
    const handler1 = jest.fn();
    const handler2 = jest.fn();
    const handler3 = jest.fn();
    const eventName = 'multi:handler:event';

    remotePeer.eventSubscribers.set(eventName, new Set([handler1, handler2, handler3]));

    emit(remotePeer, eventName, 'data');

    expect(handler1).toHaveBeenCalledWith('data');
    expect(handler2).toHaveBeenCalledWith('data');
    expect(handler3).toHaveBeenCalledWith('data');
    expect(handler1).toHaveBeenCalledTimes(1);
    expect(handler2).toHaveBeenCalledTimes(1);
    expect(handler3).toHaveBeenCalledTimes(1);
  });

  it('should handle events with no arguments', () => {
    const handler = jest.fn();
    const eventName = 'no:args:event';

    remotePeer.eventSubscribers.set(eventName, new Set([handler]));

    emit(remotePeer, eventName);

    expect(handler).toHaveBeenCalledWith();
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('should handle events with complex argument types', () => {
    const handler = jest.fn();
    const eventName = 'complex:args:event';
    const complexData = {
      id: 123,
      nested: { key: 'value' },
      array: [1, 2, 3]
    };

    remotePeer.eventSubscribers.set(eventName, new Set([handler]));

    emit(remotePeer, eventName, complexData, 'string', 456, true);

    expect(handler).toHaveBeenCalledWith(complexData, 'string', 456, true);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('should only emit to handlers of the specific event', () => {
    const handler1 = jest.fn();
    const handler2 = jest.fn();
    const event1 = 'event:one';
    const event2 = 'event:two';

    remotePeer.eventSubscribers.set(event1, new Set([handler1]));
    remotePeer.eventSubscribers.set(event2, new Set([handler2]));

    emit(remotePeer, event1, 'data1');

    expect(handler1).toHaveBeenCalledWith('data1');
    expect(handler2).not.toHaveBeenCalled();
  });

  it('should handle emitting to empty handler set', () => {
    const eventName = 'empty:set:event';

    // Set an empty set of handlers
    remotePeer.eventSubscribers.set(eventName, new Set());

    // Should not throw
    expect(() => emit(remotePeer, eventName, 'data')).not.toThrow();
  });

  it('should propagate all arguments correctly to handlers', () => {
    const handler = jest.fn();
    const eventName = 'args:test:event';

    remotePeer.eventSubscribers.set(eventName, new Set([handler]));

    const arg1 = { type: 'object' };
    const arg2 = [1, 2, 3];
    const arg3 = 'string';
    const arg4 = 123;
    const arg5 = true;
    const arg6 = null;
    const arg7 = undefined;

    emit(remotePeer, eventName, arg1, arg2, arg3, arg4, arg5, arg6, arg7);

    expect(handler).toHaveBeenCalledWith(arg1, arg2, arg3, arg4, arg5, arg6, arg7);
  });
});
