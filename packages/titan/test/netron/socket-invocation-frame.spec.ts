import { describe, expect, it } from 'vitest';
import { RemotePeer } from '../../src/netron/remote-peer.js';
import { getCurrentInvocationContext } from '../../src/netron/invocation-context.js';
import type { AuthContext } from '../../src/netron/auth/types.js';

// Unit seam for promise identity; actual HTTP/WS dispatch is exercised by
// integration/invocation-context.spec.ts and invocation-wrapper-transports.spec.ts.
interface InvocationPeer {
  withInvocationFrame<T>(service: string | undefined, method: string, call: () => Promise<T>, auth?: AuthContext): Promise<T>;
  setInvocationWrapper(wrapper: (metadata: Map<string, unknown>, fn: () => Promise<unknown>) => Promise<unknown>): void;
}

const createPeer = (): InvocationPeer => Object.create(RemotePeer.prototype) as InvocationPeer;
const identity = (): AuthContext => ({ userId: 'alice', roles: ['reader'], permissions: ['read'] });

describe('socket invocation frame', () => {
  it.each([false, true])('preserves the original promise and authoritative frame (wrapper=%s)', async (wrapped) => {
    const peer = createPeer();
    const auth = identity();
    if (wrapped) peer.setInvocationWrapper((metadata, fn) => {
      expect(metadata.get('authContext')).toEqual(auth);
      expect(metadata.get('serviceName')).toBe('Documents');
      expect(metadata.get('methodName')).toBe('read');
      return fn();
    });
    const original = Promise.resolve('delivered');
    const answer = peer.withInvocationFrame('Documents', 'read', () => {
      expect(getCurrentInvocationContext()).toMatchObject({ serviceName: 'Documents', methodName: 'read', auth });
      return original;
    }, auth);
    expect(answer).toBe(original);
    expect(getCurrentInvocationContext()).toBeUndefined();
    await expect(answer).resolves.toBe('delivered');
  });

  it('pins the same authority for the application wrapper and asynchronous service work', async () => {
    const peer = createPeer();
    const auth = identity();
    peer.setInvocationWrapper((metadata, fn) => {
      const admitted = metadata.get('authContext');
      expect(admitted).toBe(getCurrentInvocationContext()?.auth);
      expect(Object.isFrozen(admitted)).toBe(true);
      auth.roles.push('admin');
      return fn();
    });
    const observed = await peer.withInvocationFrame('Documents', 'read', async () => {
      await Promise.resolve();
      return getCurrentInvocationContext()?.auth?.roles;
    }, auth);
    expect(observed).toEqual(['reader']);
    expect(getCurrentInvocationContext()).toBeUndefined();
  });

  it('marks an anonymous invocation even without a named service', async () => {
    const peer = createPeer();
    peer.setInvocationWrapper((metadata, fn) => {
      expect(metadata.get('authenticated')).toBe(false);
      expect(metadata.has('authContext')).toBe(false);
      return fn();
    });
    const context = await peer.withInvocationFrame(undefined, 'read', async () => getCurrentInvocationContext());
    expect(context).toMatchObject({ methodName: 'read' });
    expect(context?.auth).toBeUndefined();
    expect(getCurrentInvocationContext()).toBeUndefined();
  });

  it('preserves a rejection and removes the ambient frame after failure', async () => {
    const peer = createPeer();
    const error = new Error('refused');
    const original = Promise.reject(error);
    const answer = peer.withInvocationFrame('Documents', 'read', () => original, identity());
    expect(answer).toBe(original);
    await expect(answer).rejects.toBe(error);
    expect(getCurrentInvocationContext()).toBeUndefined();
  });
});
