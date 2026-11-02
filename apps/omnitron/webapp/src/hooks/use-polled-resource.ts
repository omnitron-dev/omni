/**
 * One polling loop for the console, in place of fourteen.
 *
 * The scheduling lives here; the policy — overlap, retention, error shape —
 * lives in `PollRunner`, apart from React so it can be tested with fake
 * timers rather than a renderer. See that file for what each copy was
 * missing.
 *
 * The one thing added here that the copies could not have shared: polling
 * stops while the tab is hidden and resumes with an immediate fetch when it
 * comes back. Fourteen pages polling a daemon every five seconds from a
 * background tab is load nobody asked for and nobody sees.
 */

import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';

import { PollRunner, type PollState } from 'src/utils/poll-runner';

export interface UsePolledResourceOptions {
  /** Milliseconds between polls. Changing it re-arms the timer. */
  intervalMs: number;
  /**
   * When false, nothing is fetched and any running timer stops — for a page
   * whose query has no subject yet, such as one waiting on a selected project.
   */
  enabled?: boolean;
  /** Read an enabled scope once, then retain it until manual refresh or a scope change. */
  paused?: boolean;
  /** Identity of the requested resource. A new identity starts with no previous readings. */
  resourceKey?: string | number | null;
  /** Turns an unknown throw into something worth showing. */
  describeError?: (err: unknown) => string;
  /**
   * False keeps polling in a background tab — for a reader who is not
   * looking at it. Alert notifications exist for exactly that operator: a
   * loop that paused with the tab would announce an alert only once they had
   * come back to see it. Everything else pauses (see the header).
   */
  pauseWhileHidden?: boolean;
}

export interface PolledResource<T> extends PollState<T> {
  /** Fetch now, outside the schedule. Skipped if one is already in flight. */
  refresh: () => Promise<void>;
}

/** True when the document is currently visible (or when there is no document). */
function documentVisible(): boolean {
  return typeof document === 'undefined' || document.visibilityState !== 'hidden';
}

/**
 * The schedule on its own, for callers whose state lives somewhere else.
 *
 * The projects page polls a Zustand action; the topology page polls into its
 * own store. Wrapping those in `usePolledResource` would give them a second
 * copy of state they already hold, so they take the timer and skip the rest —
 * and still get the pause on a hidden tab, which is the part that was missing
 * everywhere.
 *
 * `tick` is read through a ref, so an inline arrow does not re-arm the timer
 * on every render.
 */
export function usePollingEffect(
  tick: () => void,
  {
    intervalMs,
    enabled = true,
    pauseWhileHidden = true,
    resourceKey,
  }: Pick<UsePolledResourceOptions, 'intervalMs' | 'enabled' | 'pauseWhileHidden' | 'resourceKey'>
): void {
  const tickRef = useRef(tick);
  tickRef.current = tick;

  useEffect(() => {
    if (!enabled) return undefined;

    let timer: ReturnType<typeof setInterval> | null = null;

    const start = () => {
      if (timer !== null) return;
      tickRef.current();
      timer = setInterval(() => tickRef.current(), intervalMs);
    };

    const stop = () => {
      if (timer === null) return;
      clearInterval(timer);
      timer = null;
    };

    if (!pauseWhileHidden) {
      start();
      return stop;
    }

    const onVisibility = () => (documentVisible() ? start() : stop());

    if (documentVisible()) start();

    // Guarded on the same condition `documentVisible` already contemplates.
    // Testing for a missing `document` on one line and dereferencing it on
    // the next is how a defence ends up covering the half that was never at
    // risk.
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisibility);
    }

    return () => {
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisibility);
      }
      stop();
    };
  }, [intervalMs, enabled, pauseWhileHidden, resourceKey]);
}

export function usePolledResource<T>(
  fetcher: () => Promise<T>,
  { intervalMs, enabled = true, paused = false, describeError, pauseWhileHidden = true, resourceKey = null }: UsePolledResourceOptions
): PolledResource<T> {
  // The fetcher is read through a ref so a caller need not memoise it: an
  // inline arrow would otherwise re-arm the timer on every render, which is
  // the other way this pattern goes wrong.
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const describeRef = useRef(describeError);
  describeRef.current = describeError;

  const resource = useMemo(() => {
    let notify: (() => void) | undefined;
    const runner = new PollRunner<T>({
      fetcher: () => fetcherRef.current(),
      onState: () => notify?.(),
      ...(describeRef.current && { describeError: (err) => describeRef.current!(err) }),
    });
    return {
      key: resourceKey,
      runner,
      snapshot: () => runner.current,
      subscribe(listener: () => void) {
        notify = listener;
        return () => { notify = undefined; };
      },
    };
  }, [resourceKey]);
  const { runner } = resource;
  const state = useSyncExternalStore(resource.subscribe, resource.snapshot, resource.snapshot);

  // Paired, not one-way: see `PollRunner.resume`. A cleanup runs on every
  // `StrictMode` remount, not only at unmount, so a runner stopped here has
  // to be usable again.
  useEffect(() => {
    runner.resume();
    return () => runner.stop();
  }, [runner]);

  usePollingEffect(() => void runner.tick(), { intervalMs, enabled: enabled && !paused, pauseWhileHidden, resourceKey: resource.key });
  useEffect(() => {
    if (enabled && paused && runner.current.loading) void runner.tick();
  }, [runner, enabled, paused]);

  const refresh = useCallback(async () => {
    await runner.tick();
  }, [runner]);

  return { ...state, refresh };
}
