/**
 * NET-2: releaseInterface child recursion.
 *
 * The recursive release of dependent (child) interfaces previously (a) did NOT
 * thread the `released` dedup set → cyclic parentId could recurse forever,
 * (b) was fire-and-forget (not awaited) → child cleanup raced / rejected
 * unobserved, and (c) iterated `this.interfaces` while the recursion mutated it.
 * Fixed by snapshotting children, threading the set, and awaiting each release.
 */

import { describe, it, expect } from 'vitest';
import { AbstractPeer } from '../../src/netron/abstract-peer.js';

class TestPeer extends AbstractPeer {
  releasedInternal: string[] = [];

  // --- abstract surface stubs ---
  async set(): Promise<void> {}
  async get(): Promise<any> {
    return undefined;
  }
  async call(): Promise<any> {
    return undefined;
  }
  subscribe(): void {}
  unsubscribe(): void {}
  async exposeService(): Promise<any> {
    return {};
  }
  async unexposeService(): Promise<void> {}
  getServiceNames(): string[] {
    return [];
  }
  protected async releaseInterfaceInternal(iInstance: any): Promise<void> {
    this.releasedInternal.push(iInstance.$def?.id);
  }

  // test helper: register an interface with an optional parent link
  addIface(id: string, parentId?: string, refCount = 1): any {
    const instance: any = { $def: { id, parentId } };
    this.interfaces.set(id, { instance, refCount });
    return instance;
  }
}

describe('NET-2: releaseInterface recursion', () => {
  it('releases a parent AND all its children, each internal-released exactly once (awaited)', async () => {
    const peer = new TestPeer({} as any, 'p1');
    const parent = peer.addIface('P');
    peer.addIface('C1', 'P');
    peer.addIface('C2', 'P');

    await peer.releaseInterface(parent);

    // With the old fire-and-forget recursion, children would not yet be released
    // when the await resolves. Now they are, deterministically.
    expect(peer.releasedInternal.sort()).toEqual(['C1', 'C2', 'P']);
    expect((peer as any).interfaces.size).toBe(0);
  });

  it('terminates on a cyclic parentId without infinite recursion (each released once)', async () => {
    const peer = new TestPeer({} as any, 'p2');
    const a = peer.addIface('A', 'B');
    peer.addIface('B', 'A'); // cycle: A↔B

    await peer.releaseInterface(a);

    expect(peer.releasedInternal.sort()).toEqual(['A', 'B']);
    expect(peer.releasedInternal.length).toBe(2); // no duplicate re-entry
  });

  it('releases a multi-level chain (grandparent → parent → child)', async () => {
    const peer = new TestPeer({} as any, 'p3');
    const gp = peer.addIface('GP');
    peer.addIface('P', 'GP');
    peer.addIface('C', 'P');

    await peer.releaseInterface(gp);

    expect(peer.releasedInternal.sort()).toEqual(['C', 'GP', 'P']);
  });
});
