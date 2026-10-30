import { describe, expect, it, vi } from 'vitest';
import { ControllerFencedError, ControllerHandoff, HandoffBusyError } from '../src/controller-handoff.js';
import type { ControllerGrant } from '../src/controller-handoff.js';

const owner = { id: 'owner-a', pid: 42, startedAt: '2026-01-01T00:00:00.000Z' };
const first: ControllerGrant = { ownerId: owner.id, controllerId: 'controller-a', epoch: 1 };
function fixture(limits?: { maxReceipts?: number; maxInFlight?: number }) {
  let durable = { ...first };
  const persist = vi.fn(async (grant: ControllerGrant) => { durable = grant; });
  return { host: new ControllerHandoff(owner, first, persist, limits), persist, durable: () => durable };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

describe('resident execution owner controller handoff', () => {
  it('drains admitted work, then fences the former controller before accepting the new one', async () => {
    const { host, durable } = fixture();
    const work = deferred<number>();
    const admitted = host.run(first, 1, 'start-app', () => work.promise);
    const preparing = host.prepare(first, 'controller-b');
    expect(host.status().phase).toBe('draining');
    expect(() => host.run(first, 2, 'stop-app', async () => 1)).toThrow(HandoffBusyError);
    const pending = host.status().pending!;
    expect(() => host.commit(pending)).toThrow(HandoffBusyError);
    work.resolve(12);
    expect(await admitted).toBe(12);
    const ticket = await preparing;
    const next = await host.commit(ticket);
    expect(durable()).toEqual(next);
    expect(host.status().inFlight).toBe(0);
    expect(() => host.run(first, 2, 'stop-app', async () => 1)).toThrow(ControllerFencedError);
    expect(await host.run(next, 1, 'inspect', async () => 42)).toBe(42);
  });

  it('deduplicates a lost response, including a rejected operation', async () => {
    const { host } = fixture();
    const work = vi.fn(async () => { throw new Error('application rejected the request'); });
    const one = host.run(first, 1, 'restart-app', work);
    expect(host.run(first, 1, 'restart-app', work)).toBe(one);
    await expect(one).rejects.toThrow('application rejected');
    await expect(host.run(first, 1, 'restart-app', work)).rejects.toThrow('application rejected');
    expect(work).toHaveBeenCalledTimes(1);
    expect(() => host.run(first, 1, 'different-app', work)).toThrow('different work');
  });

  it('does not re-execute an evicted operation receipt', async () => {
    const { host } = fixture({ maxReceipts: 2 });
    const work = vi.fn(async () => 1);
    for (let n = 1; n <= 20; n++) await host.run(first, n, `operation-${n}`, work);
    expect(() => host.run(first, 1, 'operation-1', work)).toThrow('receipt expired');
    expect(work).toHaveBeenCalledTimes(20);
    expect(await host.run(first, 20, 'operation-20', work)).toBe(1);
  });

  it('bounds in-flight mutations without allocating an unbounded wait queue', async () => {
    const { host } = fixture({ maxInFlight: 1 });
    const work = deferred<number>();
    const admitted = host.run(first, 1, 'slow', () => work.promise);
    expect(() => host.run(first, 2, 'excess', async () => 0)).toThrow('capacity');
    work.resolve(1);
    await admitted;
    expect(await host.run(first, 2, 'retry-unadmitted', async () => 2)).toBe(2);
  });

  it('keeps a hung admitted mutation fenced instead of declaring a timed-out transfer successful', async () => {
    const { host } = fixture();
    const work = deferred<number>();
    const admitted = host.run(first, 1, 'slow', () => work.promise);
    const preparing = host.prepare(first, 'controller-b');
    await Promise.resolve();
    expect(host.status()).toMatchObject({ phase: 'draining', inFlight: 1 });
    const ticket = host.status().pending!;
    host.abort(first, ticket);
    work.resolve(1);
    await admitted;
    await expect(preparing).rejects.toThrow('aborted');
    expect(host.status().phase).toBe('active');
    expect(await host.run(first, 2, 'continue', async () => 2)).toBe(2);
  });

  it('acknowledges repeated prepare/commit and rejects another candidate', async () => {
    const { host, persist } = fixture();
    const preparing = host.prepare(first, 'controller-b');
    expect(host.prepare(first, 'controller-b')).toBe(preparing);
    expect(() => host.prepare(first, 'controller-c')).toThrow(HandoffBusyError);
    const ticket = await preparing;
    const committing = host.commit(ticket);
    expect(host.commit(ticket)).toBe(committing);
    const next = await committing;
    expect(await host.commit(ticket)).toEqual(next);
    expect(persist).toHaveBeenCalledTimes(1);
    expect(() => host.abort(first, ticket)).toThrow(ControllerFencedError);
  });

  it('does not restore the old writer when a journal write has an ambiguous result', async () => {
    let durable = first;
    const host = new ControllerHandoff(owner, first, async (grant) => {
      durable = grant; // e.g. rename succeeded, directory fsync failed
      throw new Error('journal acknowledgement lost');
    });
    const ticket = await host.prepare(first, 'controller-b');
    await expect(host.commit(ticket)).rejects.toThrow('acknowledgement lost');
    expect(host.status().phase).toBe('uncertain');
    expect(() => host.abort(first, ticket)).toThrow(HandoffBusyError);
    expect(() => host.run(first, 1, 'mutate', async () => 1)).toThrow(HandoffBusyError);
    const next = host.resolveCommit(durable);
    expect(next).toEqual(ticket.to);
    expect(() => host.run(first, 1, 'mutate', async () => 1)).toThrow(ControllerFencedError);
    expect(await host.run(next, 1, 'mutate', async () => 2)).toBe(2);
  });

  it('allows abort after a failed journal write is proven uncommitted', async () => {
    const host = new ControllerHandoff(owner, first, async () => { throw new Error('disk full'); });
    const ticket = await host.prepare(first, 'controller-b');
    await expect(host.commit(ticket)).rejects.toThrow('disk full');
    expect(() => host.resolveCommit({ ...first, epoch: 100 })).toThrow(ControllerFencedError);
    expect(host.resolveCommit(first)).toEqual(first);
    host.abort(first, ticket);
    expect(host.status().phase).toBe('active');
  });

  it('rejects another owner even when the OS pid was reused', () => {
    const host = new ControllerHandoff({ ...owner, id: 'owner-b' }, { ...first, ownerId: 'owner-b' }, async () => {});
    expect(() => host.run(first, 1, 'stop-all', async () => 1)).toThrow(ControllerFencedError);
  });

  it('rejects a forged ticket and does not expose mutable internal identities', async () => {
    const { host } = fixture();
    const ticket = await host.prepare(first, 'controller-b');
    expect(() => host.commit({ ...ticket, to: { ...ticket.to, epoch: 100 } })).toThrow(ControllerFencedError);
    host.status().pending!.to.controllerId = 'attacker';
    ticket.from.controllerId = 'mutated-copy';
    expect(host.status().pending!.from.controllerId).toBe(first.controllerId);
    expect(host.status().pending!.to.controllerId).toBe('controller-b');
  });

  it('handles 50 successive controllers without restarting resident work', async () => {
    const { host } = fixture();
    let grant = first;
    const resident = { pid: 123, counter: 0 };
    for (let n = 0; n < 50; n++) {
      await host.run(grant, 1, 'advance', async () => { resident.counter++; });
      const old = grant;
      const ticket = await host.prepare(grant, `controller-${n}`);
      grant = await host.commit(ticket);
      expect(() => host.run(old, 2, 'late-write', async () => 1)).toThrow(ControllerFencedError);
    }
    expect(resident).toEqual({ pid: 123, counter: 50 });
    expect(grant.epoch).toBe(51);
  });
});
