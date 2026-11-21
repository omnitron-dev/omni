import { describe, expect, it } from 'vitest';
import { RuntimeObservationConflict, RuntimeObservationPending, RuntimeObservationTimeout, observeRuntimeUntil, observeStartingController } from '../../src/daemon/runtime-observation.js';
import { CommandResultError } from '../../src/shared/command-result.js';

describe('runtime acceptance observation', () => {
  it.each(['stopped', 'stale', 'silent'])('waits for an asynchronously started controller reported as %s', async kind => {
    let calls = 0;
    const absence = new CommandResultError('status', 1, { ok: false, code: 'DAEMON_UNAVAILABLE', details: { absence: { kind, pid: 123 } } });
    const result = await observeRuntimeUntil(() => observeStartingController(async () => {
      if (++calls === 1) throw absence;
      return { ready: true };
    }), 1000, 'startup', 1);
    expect(result).toEqual({ ready: true });
    expect(calls).toBe(2);
  });

  it.each([
    { ok: false, code: 'DAEMON_UNAVAILABLE', details: { absence: { kind: 'unknown' } } },
    { ok: false, code: 'DAEMON_UNAVAILABLE', details: {} },
    { ok: false, error: 'Daemon is not running' },
    { ok: false, code: 'FOREIGN_OWNER', details: { absence: { kind: 'stopped' } } },
  ])('never infers startup progress from unknown or malformed evidence %#', async reply => {
    const error = new CommandResultError('status', 1, reply);
    await expect(observeStartingController(async () => { throw error; })).rejects.toBe(error);
  });

  it('retains the deadline when an explicitly unavailable controller never starts', async () => {
    const absence = new CommandResultError('status', 1, { ok: false, code: 'DAEMON_UNAVAILABLE', details: { absence: { kind: 'stopped' } } });
    await expect(observeRuntimeUntil(() => observeStartingController(async () => { throw absence; }),
      25, 'startup', 5)).rejects.toBeInstanceOf(RuntimeObservationTimeout);
  });
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
    await expect(attempt).rejects.toMatchObject({
      code: 'RUNTIME_OBSERVATION_TIMEOUT', details: { timeoutMs: 25 },
    });
    await expect(attempt).rejects.not.toHaveProperty('details.lastObservation');
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

  it('reports the last confirmed wait reason when the deadline interrupts a retry delay', async () => {
    let attempts = 0;
    const pending = new RuntimeObservationPending('console', 'Waiting for the reviewed Console startup observation', 73);
    const attempt = observeRuntimeUntil(async () => {
      attempts++;
      throw pending;
    }, 25, 'acceptance', 1000);
    await expect(attempt).rejects.toBeInstanceOf(RuntimeObservationTimeout);
    await expect(attempt).rejects.toMatchObject({
      cause: pending,
      message: expect.stringContaining('console (PID 73) — Waiting for the reviewed Console startup observation'),
      details: { timeoutMs: 25, lastObservation: { stage: 'console', pid: 73, reason: pending.message } },
    });
    expect(attempts).toBe(1);
  });
});
