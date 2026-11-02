import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';

const useCommitEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

/** Let an observer react to a logical key while reading options from the latest committed render. */
export function useCommittedCallback<Args extends unknown[], Result>(callback: (...args: Args) => Result) {
  const current = useRef(callback);
  useCommitEffect(() => { current.current = callback; }, [callback]);
  return useCallback((...args: Args) => current.current(...args), []);
}
