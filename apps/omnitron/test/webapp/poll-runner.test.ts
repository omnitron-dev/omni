/**
 * The polling policy the console pages were each writing for themselves.
 *
 * Fourteen pages carried the same copied shape, and three faults were in
 * every copy: requests piled up when a fetch outlived its interval, a
 * background tab polled forever, and a single failed poll blanked the table
 * an operator was reading. This pins the policy that replaces them.
 */

import { describe, it, expect, vi } from 'vitest';

import { PollRunner, type PollState } from '../../webapp/src/utils/poll-runner.js';

/** Collects every state the runner emits. */
function collector<T>() {
  const states: PollState<T>[] = [];
  return { states, onState: (s: PollState<T>) => states.push(s) };
}

/** A fetcher whose resolution the test controls. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('PollRunner', () => {
  it('starts out loading, with nothing to show', () => {
    const { onState } = collector<string>();
    const runner = new PollRunner({ fetcher: async () => 'x', onState });

    expect(runner.current).toEqual({ data: null, error: null, loading: true });
  });

  it('publishes the result and stops loading', async () => {
    const { states, onState } = collector<string>();
    const runner = new PollRunner({ fetcher: async () => 'apps', onState });

    await runner.tick();

    expect(states).toEqual([{ data: 'apps', error: null, loading: false }]);
  });

  it('keeps the last good data when a poll fails', async () => {
    // The fault this exists for. Several pages set `[]` on error, so one
    // failed poll wiped the table being read — and the operator lost the view
    // precisely when something had started going wrong.
    let attempt = 0;
    const { onState } = collector<string>();
    const runner = new PollRunner({
      fetcher: async () => {
        attempt += 1;
        if (attempt === 2) throw new Error('daemon unreachable');
        return `result-${attempt}`;
      },
      onState,
    });

    await runner.tick();
    await runner.tick();

    expect(runner.current).toEqual({
      data: 'result-1',
      error: 'daemon unreachable',
      loading: false,
    });
  });

  it('clears the error on the next success', async () => {
    let fail = true;
    const { onState } = collector<string>();
    const runner = new PollRunner({
      fetcher: async () => {
        if (fail) throw new Error('boom');
        return 'ok';
      },
      onState,
    });

    await runner.tick();
    expect(runner.current.error).toBe('boom');

    fail = false;
    await runner.tick();
    expect(runner.current).toEqual({ data: 'ok', error: null, loading: false });
  });

  it('skips a tick while the previous fetch is still outstanding', async () => {
    // On a loaded machine a daemon round trip runs into seconds, which is
    // exactly when someone is watching the console. Without this the timer
    // keeps firing and the requests pile up on a daemon that is already slow.
    const first = deferred<string>();
    const fetcher = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue('second');
    const { onState } = collector<string>();
    const runner = new PollRunner({ fetcher, onState });

    const pending = runner.tick();
    expect(runner.busy).toBe(true);

    expect(await runner.tick()).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(1);

    first.resolve('first');
    await pending;

    expect(await runner.tick()).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('drops a result that arrives after it was stopped', async () => {
    // An unmounted page must not set state. The request cannot be recalled,
    // but its answer can be ignored.
    const pendingFetch = deferred<string>();
    const { states, onState } = collector<string>();
    const runner = new PollRunner({ fetcher: () => pendingFetch.promise, onState });

    const tick = runner.tick();
    runner.stop();
    pendingFetch.resolve('too late');
    await tick;

    expect(states).toEqual([]);
    expect(runner.current.loading).toBe(true);
  });

  it('drops a failure that arrives after it was stopped', async () => {
    const pendingFetch = deferred<string>();
    const { states, onState } = collector<string>();
    const runner = new PollRunner({ fetcher: () => pendingFetch.promise, onState });

    const tick = runner.tick();
    runner.stop();
    pendingFetch.reject(new Error('too late'));
    await tick;

    expect(states).toEqual([]);
  });

  it('refuses to start once stopped', async () => {
    const fetcher = vi.fn().mockResolvedValue('x');
    const { onState } = collector<string>();
    const runner = new PollRunner({ fetcher, onState });

    runner.stop();

    expect(await runner.tick()).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('describes a throw that carries no message', async () => {
    // Pages caught `err: any` and read `err?.message`, which is `undefined`
    // for anything thrown that is not an Error — rendering an empty alert.
    const { onState } = collector<string>();
    const runner = new PollRunner({
      fetcher: async () => {
        throw 'a bare string';
      },
      onState,
    });

    await runner.tick();

    expect(runner.current.error).toBe('Request failed');
  });

  it('lets the caller describe its own errors', async () => {
    const { onState } = collector<string>();
    const runner = new PollRunner({
      fetcher: async () => {
        throw { code: 'ECONNREFUSED' };
      },
      onState,
      describeError: (err) => `daemon: ${(err as { code?: string }).code}`,
    });

    await runner.tick();

    expect(runner.current.error).toBe('daemon: ECONNREFUSED');
  });
});

it('coalesces explicit refreshes into one read started after the outstanding poll', async () => {
  const old = deferred<string>(), fresh = deferred<string>();
  const fetcher = vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
  const runner = new PollRunner({ fetcher, onState: vi.fn() });
  const poll = runner.tick();
  const first = runner.refresh(), second = runner.refresh();
  expect(first).toBe(second);
  let settled = false;
  void first.then(() => { settled = true; });
  expect(await runner.tick()).toBe(false);
  old.resolve('before mutation');
  await poll;
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(settled).toBe(false);
  fresh.resolve('after mutation');
  expect(await first).toBe(true);
  expect(runner.current.data).toBe('after mutation');
  expect(runner.busy).toBe(false);
});

it('queues one later read for refreshes arriving during the follow-up without polling forever', async () => {
  const a = deferred<string>(), b = deferred<string>(), c = deferred<string>();
  const fetcher = vi.fn().mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise).mockReturnValueOnce(c.promise);
  const runner = new PollRunner({ fetcher, onState: vi.fn() });
  const initial = runner.tick(), first = runner.refresh();
  a.resolve('a'); await initial;
  const later = runner.refresh(), coalesced = runner.refresh();
  expect(later).toBe(coalesced);
  let settled = false; void later.then(() => { settled = true; });
  b.resolve('b'); await first;
  expect(settled).toBe(false);
  expect(fetcher).toHaveBeenCalledTimes(3);
  c.resolve('c'); await later;
  await Promise.resolve();
  expect(fetcher).toHaveBeenCalledTimes(3);
  expect(runner.busy).toBe(false);
});

it('cancels a queued refresh on stop and does not revive it on resume', async () => {
  const old = deferred<string>(), states = collector<string>();
  const fetcher = vi.fn().mockReturnValueOnce(old.promise).mockResolvedValue('new scope');
  const runner = new PollRunner({ fetcher, onState: states.onState });
  const poll = runner.tick(), queued = runner.refresh();
  runner.stop();
  expect(await queued).toBe(false);
  old.resolve('disposed scope'); await poll;
  expect(states.states).toEqual([]);
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(await runner.refresh()).toBe(false);
  runner.resume();
  expect(await runner.refresh()).toBe(true);
  expect(runner.current.data).toBe('new scope');
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it('settles a synchronous refresh failure and allows the next explicit retry', async () => {
  const old = deferred<string>();
  const fetcher = vi.fn().mockReturnValueOnce(old.promise)
    .mockImplementationOnce(() => { throw Error('connection refused'); }).mockResolvedValue('recovered');
  const runner = new PollRunner({ fetcher, onState: vi.fn() });
  const initial = runner.tick(), queued = runner.refresh();
  old.resolve('last good'); await initial; await queued;
  expect(runner.current).toEqual({ data: 'last good', error: 'connection refused', loading: false });
  expect(runner.busy).toBe(false);
  await runner.refresh();
  expect(runner.current).toEqual({ data: 'recovered', error: null, loading: false });
});
