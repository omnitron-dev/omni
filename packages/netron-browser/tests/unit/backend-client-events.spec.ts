/**
 * NB-8: BackendClient must forward the underlying WebSocket transport's
 * lifecycle events (reconnect/disconnect/...) so the multi-backend client's
 * wireTransportEvents can attach (it skips any backend whose `.on` is not a
 * function) and React's refetchOnReconnect fires.
 */

import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from '@omnitron-dev/eventemitter';
import { BackendClient } from '../../src/client/backend-client.js';

function makeBackendClient(): BackendClient {
  return new BackendClient({
    name: 'b1',
    config: { transport: 'websocket', path: '/ws' },
    baseUrl: 'ws://localhost:9999',
    defaultTimeout: 1000,
    defaultHeaders: {},
  } as any);
}

describe('NB-8: BackendClient transport event forwarding', () => {
  it('exposes on() (so wireTransportEvents will attach, not skip)', () => {
    const bc = makeBackendClient();
    expect(typeof bc.on).toBe('function');
  });

  it('on() registers a handler and returns a working unsubscribe', () => {
    const bc = makeBackendClient();
    const handler = vi.fn();
    const unsub = bc.on('reconnect', handler);

    (bc as any).events.emit('reconnect', { attempt: 1 });
    expect(handler).toHaveBeenCalledTimes(1);

    unsub();
    (bc as any).events.emit('reconnect', { attempt: 2 });
    expect(handler).toHaveBeenCalledTimes(1); // unsubscribed
  });

  it('forwardTransportEvents re-emits the underlying client lifecycle events', () => {
    const bc = makeBackendClient();
    const mockClient = new EventEmitter();
    (bc as any).forwardTransportEvents(mockClient);

    const onReconnect = vi.fn();
    const onDisconnect = vi.fn();
    bc.on('reconnect', onReconnect);
    bc.on('disconnect', onDisconnect);

    mockClient.emit('reconnect', { attempt: 3 });
    mockClient.emit('disconnect', 'bye');

    expect(onReconnect).toHaveBeenCalledWith({ attempt: 3 });
    expect(onDisconnect).toHaveBeenCalledWith('bye');
  });
});
