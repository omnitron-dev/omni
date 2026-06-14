/**
 * ScopingService + ContainerStore (NX-9)
 *
 * Locks in the store-injection contract: the service reads the container's
 * shared caches/lifecycle from its injected ContainerStore rather than from
 * positional arguments, while keeping `createInstanceFn` and `context` per-call.
 */
import { describe, it, expect, vi } from 'vitest';
import { ScopingService } from '../../src/nexus/container/scoping.js';
import type { ContainerStore } from '../../src/nexus/container/store.js';
import type { Registration } from '../../src/nexus/container/types.js';
import { LifecycleManager } from '../../src/nexus/lifecycle.js';
import { createToken } from '../../src/nexus/token.js';
import { Scope } from '../../src/nexus/types.js';

function makeStore(): ContainerStore {
  return {
    instances: new Map(),
    scopedInstances: new Map(),
    lifecycleManager: new LifecycleManager(),
  };
}

function reg(scope: Scope, name: string): Registration {
  return {
    token: createToken(name),
    provider: { useFactory: () => ({}) } as any,
    options: {},
    scope,
  };
}

describe('ScopingService + ContainerStore (NX-9)', () => {
  it('caches a singleton in store.instances (created once)', () => {
    const store = makeStore();
    const svc = new ScopingService(store);
    const r = reg(Scope.Singleton, 'Svc');
    const create = vi.fn(() => ({ id: 1 }));

    const a = svc.resolveWithScope(r, {} as any, create);
    const b = svc.resolveWithScope(r, {} as any, create);

    expect(a).toBe(b);
    expect(create).toHaveBeenCalledTimes(1);
    expect(store.instances.get(r.token)).toBe(a);
  });

  it('creates a transient every time, never caching', () => {
    const store = makeStore();
    const svc = new ScopingService(store);
    const r = reg(Scope.Transient, 'T');
    const create = vi.fn(() => ({}));

    svc.resolveWithScope(r, {} as any, create);
    svc.resolveWithScope(r, {} as any, create);

    expect(create).toHaveBeenCalledTimes(2);
    expect(store.instances.size).toBe(0);
  });

  it('isolates scoped instances per scopeId in store.scopedInstances', () => {
    const store = makeStore();
    const svc = new ScopingService(store);
    const r = reg(Scope.Scoped, 'S');
    const create = vi.fn(() => ({}));

    const ctxA = { metadata: { scopeId: 'A' } } as any;
    const ctxB = { metadata: { scopeId: 'B' } } as any;

    const a1 = svc.resolveWithScope(r, ctxA, create);
    const a2 = svc.resolveWithScope(r, ctxA, create); // same scope → cached
    const b1 = svc.resolveWithScope(r, ctxB, create); // other scope → fresh

    expect(a1).toBe(a2);
    expect(b1).not.toBe(a1);
    expect(create).toHaveBeenCalledTimes(2);
    expect(store.scopedInstances.get('A')!.get(r.token)).toBe(a1);
    expect(store.scopedInstances.get('B')!.get(r.token)).toBe(b1);
  });

  it('request scope with no request context falls back to transient', () => {
    const store = makeStore();
    const svc = new ScopingService(store);
    const r = reg(Scope.Request, 'R');
    const create = vi.fn(() => ({}));

    svc.resolveWithScope(r, { metadata: {} } as any, create);
    svc.resolveWithScope(r, { metadata: {} } as any, create);

    expect(create).toHaveBeenCalledTimes(2);
    expect(store.scopedInstances.size).toBe(0);
  });

  it('resolveRegistration caches a singleton in store.instances', () => {
    const store = makeStore();
    const svc = new ScopingService(store);
    const r = reg(Scope.Singleton, 'RR');
    const create = vi.fn(() => ({}));

    const a = svc.resolveRegistration(r, { scope: Scope.Singleton } as any, create);
    const b = svc.resolveRegistration(r, { scope: Scope.Singleton } as any, create);

    expect(a).toBe(b);
    expect(create).toHaveBeenCalledTimes(1);
    expect(store.instances.get(r.token)).toBe(a);
  });
});
