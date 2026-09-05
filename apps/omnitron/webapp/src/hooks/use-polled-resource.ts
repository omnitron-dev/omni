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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { PollRunner, type PollState } from 'src/utils/poll-runner';

export interface UsePolledResourceOptions {
  /** Milliseconds between polls. Changing it re-arms the timer. */
  intervalMs: number;
  /**
   * When false, nothing is fetched and any running timer stops — for a page
   * whose query has no subject yet, such as one waiting on a selected project.
   */
  enabled?: boolean;
  /** Turns an unknown throw into something worth showing. */
  describeError?: (err: unknown) => string;
}

export interface PolledResource<T> extends PollState<T> {
  /** Fetch now, outside the schedule. Skipped if one is already in flight. */
  refresh: () => Promise<void>;
}

/** True when the document is currently visible (or when there is no document). */
function documentVisible(): boolean {
  return typeof document === 'undefined' || document.visibilityState !== 'hidden';
}

export function usePolledResource<T>(
  fetcher: () => Promise<T>,
  { intervalMs, enabled = true, describeError }: UsePolledResourceOptions
): PolledResource<T> {
  const [state, setState] = useState<PollState<T>>({ data: null, error: null, loading: true });

  // The fetcher is read through a ref so a caller need not memoise it: an
  // inline arrow would otherwise re-arm the timer on every render, which is
  // the other way this pattern goes wrong.
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const describeRef = useRef(describeError);
  describeRef.current = describeError;

  const runner = useMemo(
    () =>
      new PollRunner<T>({
        fetcher: () => fetcherRef.current(),
        onState: setState,
        ...(describeRef.current && { describeError: (err) => describeRef.current!(err) }),
      }),
    // A new runner per mount; `enabled` and `intervalMs` drive the timer below.
    []
  );

  useEffect(() => () => runner.stop(), [runner]);

  useEffect(() => {
    if (!enabled) return undefined;

    let timer: ReturnType<typeof setInterval> | null = null;

    const start = () => {
      if (timer !== null) return;
      void runner.tick();
      timer = setInterval(() => void runner.tick(), intervalMs);
    };

    const stop = () => {
      if (timer === null) return;
      clearInterval(timer);
      timer = null;
    };

    const onVisibility = () => (documentVisible() ? start() : stop());

    if (documentVisible()) start();
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      stop();
    };
  }, [runner, intervalMs, enabled]);

  const refresh = useCallback(async () => {
    await runner.tick();
  }, [runner]);

  return { ...state, refresh };
}
