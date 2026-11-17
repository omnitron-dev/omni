import { describe, expect, it } from 'vitest';
import { RuntimeObservationConflict, RuntimeObservationPending, RuntimeObservationTimeout, observeRuntimeUntil } from '../../src/daemon/runtime-observation.js';

describe('runtime acceptance observation', () => {
  it('includes final infrastructure settlement in one observation before publishing acceptance', async () => {
    const events: string[] = [];
    let attempts = 0;
    const evidence = await observeRuntimeUntil(async observation => {
      attempts++;
      events.push('roles', 'applications', 'launches', 'infrastructure');
      if (attempts === 1) throw new RuntimeObservationPending('installation', 'owned startup lease', 123);
      expect(observation.remaining()).toBeGreaterThan(0);
      return { owner: 123, infrastructure: 'retained' };
    }, 1000, 'acceptance', 1);
    expect(evidence).toEqual({ owner: 123, infrastructure: 'retained' });
    expect(attempts).toBe(2);
    expect(events).toEqual(['roles', 'applications', 'launches', 'infrastructure', 'roles', 'applications', 'launches', 'infrastructure']);
  });

  it.each(['foreign artifact', 'container replaced', 'RPC outcome unknown'])('does not retry %s', async message => {
    let attempts = 0;
    const error = message === 'RPC outcome unknown' ? new Error(message) : new RuntimeObservationConflict(message);
    await expect(observeRuntimeUntil(async () => { attempts++; throw error; }, 1000, 'acceptance', 1)).rejects.toBe(error);
    expect(attempts).toBe(1);
  });

  it('bounds a stalled leaf and prevents late observation from becoming accepted', async () => {
    let complete!: () => void;
    let signal: AbortSignal | undefined;
    const attempt = observeRuntimeUntil(async observation => {
      signal = observation.signal;
      await new Promise<void>(resolve => { complete = resolve; });
      observation.remaining();
      return 'late success';
    }, 25, 'acceptance');
    await expect(attempt).rejects.toBeInstanceOf(RuntimeObservationTimeout);
    expect(signal?.aborted).toBe(true);
    complete();
    await new Promise(resolve => setTimeout(resolve, 0));
  });

  it('passes the remaining shared budget to a leaf instead of restarting its timeout', async () => {
    const budgets: number[] = [];
    await observeRuntimeUntil(async observation => {
      budgets.push(observation.remaining(5000));
      if (budgets.length === 1) throw new RuntimeObservationPending('controller', 'starting');
      return true;
    }, 1000, 'acceptance', 5);
    expect(budgets[0]).toBeLessThanOrEqual(1000);
    expect(budgets[1]).toBeLessThan(budgets[0]!);
  });

  it('keeps timeout identity when the deadline interrupts a pending delay', async () => {
    let attempts = 0;
    await expect(observeRuntimeUntil(async () => {
      attempts++;
      throw new RuntimeObservationPending('controller', 'startup has not settled');
    }, 25, 'acceptance', 1000)).rejects.toBeInstanceOf(RuntimeObservationTimeout);
    expect(attempts).toBe(1);
  });
});
