/**
 * Tests for subscribe core task
 */

import { WebSocket } from 'ws';
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { subscribe } from '../../../src/netron/core-tasks/subscribe.js';
import { RemotePeer } from '../../../src/netron/remote-peer.js';
import { Netron } from '../../../src/netron/netron.js';
import { createMockLogger } from '../test-utils.js';

describe('subscribe core task', () => {
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

  it('should create a subscription handler and store it in remoteSubscriptions', () => {
    const eventName = 'test:event';

    subscribe(remotePeer, eventName);

    expect(remotePeer.remoteSubscriptions.has(eventName)).toBe(true);
    expect(remotePeer.remoteSubscriptions.get(eventName)).toBeInstanceOf(Function);
  });

  it('should register the handler with netron.peer.subscribe', () => {
    const eventName = 'test:event';
    const subscribeSpy = jest.spyOn(netron.peer, 'subscribe');

    subscribe(remotePeer, eventName);

    expect(subscribeSpy).toHaveBeenCalledWith(eventName, expect.any(Function));
    expect(subscribeSpy).toHaveBeenCalledTimes(1);
  });

  it('should handle multiple independent subscriptions', () => {
    const event1 = 'event:one';
    const event2 = 'event:two';
    const subscribeSpy = jest.spyOn(netron.peer, 'subscribe');

    subscribe(remotePeer, event1);
    subscribe(remotePeer, event2);

    expect(remotePeer.remoteSubscriptions.has(event1)).toBe(true);
    expect(remotePeer.remoteSubscriptions.has(event2)).toBe(true);
    expect(remotePeer.remoteSubscriptions.size).toBe(2);
    expect(subscribeSpy).toHaveBeenCalledTimes(2);
  });

  it('should overwrite previous subscription when subscribing to the same event', () => {
    const eventName = 'duplicate:event';

    subscribe(remotePeer, eventName);
    const firstHandler = remotePeer.remoteSubscriptions.get(eventName);

    subscribe(remotePeer, eventName);
    const secondHandler = remotePeer.remoteSubscriptions.get(eventName);

    expect(firstHandler).not.toBe(secondHandler);
    expect(remotePeer.remoteSubscriptions.size).toBe(1);
  });

  it('should create a handler that calls runTask with correct arguments', () => {
    const eventName = 'run:task:event';
    const runTaskSpy = jest.spyOn(remotePeer, 'runTask').mockResolvedValue(undefined);

    subscribe(remotePeer, eventName);

    // Get the handler and call it
    const handler = remotePeer.remoteSubscriptions.get(eventName);
    expect(handler).toBeDefined();

    handler!('arg1', 'arg2', 'arg3');

    expect(runTaskSpy).toHaveBeenCalledWith('emit', eventName, 'arg1', 'arg2', 'arg3');
  });

  it('should create a handler that forwards all arguments to runTask', () => {
    const eventName = 'args:forward:event';
    const runTaskSpy = jest.spyOn(remotePeer, 'runTask').mockResolvedValue(undefined);

    subscribe(remotePeer, eventName);

    const handler = remotePeer.remoteSubscriptions.get(eventName);
    const complexArg = { nested: { data: 'value' } };
    const arrayArg = [1, 2, 3];

    handler!(complexArg, arrayArg, 'string', 123, true, null, undefined);

    expect(runTaskSpy).toHaveBeenCalledWith(
      'emit',
      eventName,
      complexArg,
      arrayArg,
      'string',
      123,
      true,
      null,
      undefined
    );
  });

  it('should create a handler that works with no arguments', () => {
    const eventName = 'no:args:event';
    const runTaskSpy = jest.spyOn(remotePeer, 'runTask').mockResolvedValue(undefined);

    subscribe(remotePeer, eventName);

    const handler = remotePeer.remoteSubscriptions.get(eventName);
    handler!();

    expect(runTaskSpy).toHaveBeenCalledWith('emit', eventName);
  });

  it('should maintain independent handlers for different events', () => {
    const event1 = 'independent:event:one';
    const event2 = 'independent:event:two';
    const runTaskSpy = jest.spyOn(remotePeer, 'runTask').mockResolvedValue(undefined);

    subscribe(remotePeer, event1);
    subscribe(remotePeer, event2);

    const handler1 = remotePeer.remoteSubscriptions.get(event1);
    const handler2 = remotePeer.remoteSubscriptions.get(event2);

    handler1!('data1');
    handler2!('data2');

    expect(runTaskSpy).toHaveBeenNthCalledWith(1, 'emit', event1, 'data1');
    expect(runTaskSpy).toHaveBeenNthCalledWith(2, 'emit', event2, 'data2');
    expect(runTaskSpy).toHaveBeenCalledTimes(2);
  });
});
