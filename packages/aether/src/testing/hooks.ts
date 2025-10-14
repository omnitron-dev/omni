/**
 * Hook Testing Utilities
 */
import type { RenderHookOptions, RenderHookResult } from './types.js';
import { createRoot } from '../core/reactivity/batch.js';

export function renderHook<TResult, TProps = any>(
  hook: (props: TProps) => TResult,
  options: RenderHookOptions<TProps> = {}
): RenderHookResult<TResult, TProps> {
  const { initialProps, wrapper } = options;
  let dispose: (() => void) | undefined;

  const result: RenderHookResult<TResult, TProps>['result'] = {
    current: null as any,
  };

  const runHook = (props?: TProps) => {
    if (dispose) dispose();

    dispose = createRoot((disposeFn) => {
      try {
        result.current = hook(props || initialProps as TProps);
      } catch (error) {
        result.error = error as Error;
      }
      return disposeFn;
    });
  };

  runHook(initialProps);

  return {
    result,
    rerender: (props?: TProps) => runHook(props),
    unmount: () => { if (dispose) dispose(); },
  };
}
