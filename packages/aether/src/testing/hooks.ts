/**
 * Hook Testing Utilities
 */
import type { RenderHookOptions, RenderHookResult } from './types.js';
import { createRoot } from '../core/reactivity/batch.js';

export function renderHook<TResult, TProps = any>(
  hook: (props: TProps) => TResult,
  options: RenderHookOptions<TProps> = {}
): RenderHookResult<TResult, TProps> {
  const { initialProps } = options;
  let dispose: (() => void) | undefined;
  let unmounted = false;

  const result: RenderHookResult<TResult, TProps>['result'] = {
    current: null as any,
  };

  const runHook = (propsToUse: TProps) => {
    if (unmounted) return; // Don't run hook after unmount
    if (dispose) dispose();

    dispose = createRoot((disposeFn) => {
      try {
        result.current = hook(propsToUse);
        // Clear error on successful execution
        delete result.error;
      } catch (error) {
        result.error = error as Error;
      }
      return disposeFn;
    });
  };

  runHook(initialProps as TProps);

  return {
    result,
    // When rerender is called without arguments, pass an empty object
    // This matches React Testing Library behavior
    rerender(props?: TProps) {
      // Check if props were explicitly passed using arguments.length
      // This allows distinguishing between rerender() and rerender(undefined)
      const propsToUse = arguments.length > 0 ? (props ?? ({} as TProps)) : ({} as TProps);
      runHook(propsToUse);
    },
    unmount: () => {
      unmounted = true;
      if (dispose) dispose();
    },
  };
}
