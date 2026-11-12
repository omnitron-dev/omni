import { describe, expect, it, vi } from 'vitest';
import { runExclusive } from '../src/promise.js';

describe('exclusive resource operations', () => {
  it('keeps a configuration and its asynchronous consumer in one FIFO operation', async () => {
    const engine = { theme: '' };
    const events: string[] = [];
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => { release = resolve; });
    const first = runExclusive(engine, async () => {
      engine.theme = 'dark';
      events.push('first started');
      await barrier;
      events.push(engine.theme);
      return 'first result';
    });
    const second = runExclusive(engine, async () => {
      engine.theme = 'light';
      events.push('second started');
      await Promise.resolve();
      events.push(engine.theme);
      return 'second result';
    });
    await Promise.resolve();
    expect(events).toEqual(['first started']);
    release();
    expect(await Promise.all([first, second])).toEqual(['first result', 'second result']);
    expect(events).toEqual(['first started', 'dark', 'second started', 'light']);
  });

  it('does not serialize independent resources', async () => {
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => { release = resolve; });
    const first = runExclusive({}, () => barrier);
    expect(await runExclusive({}, () => 42)).toBe(42);
    release();
    await first;
  });

  it('preserves synchronous and asynchronous errors without poisoning the queue', async () => {
    const resource = {};
    const error = new Error('invalid document');
    const first = runExclusive(resource, () => { throw error; });
    const second = runExclusive(resource, () => Promise.reject(error));
    const third = runExclusive(resource, () => 'recovered');
    const results = await Promise.allSettled([first, second, third]);
    expect(results).toEqual([
      { status: 'rejected', reason: error },
      { status: 'rejected', reason: error },
      { status: 'fulfilled', value: 'recovered' },
    ]);
    expect(await runExclusive(resource, () => 'next batch')).toBe('next batch');
  });

  it('keeps later queued work exclusive when an earlier tail is released', async () => {
    const resource = {};
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => { release = resolve; });
    const first = runExclusive(resource, () => 1);
    const second = runExclusive(resource, () => barrier);
    await first;
    await Promise.resolve();
    const operation = vi.fn(() => 3);
    const third = runExclusive(resource, operation);
    await Promise.resolve();
    expect(operation).not.toHaveBeenCalled();
    release();
    await second;
    expect(await third).toBe(3);
  });
});
