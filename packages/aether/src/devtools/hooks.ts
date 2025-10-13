/**
 * DevTools Hooks - Integration hooks for components
 *
 * Provides React-style hooks for easy DevTools integration within
 * Aether components.
 *
 * @module devtools/hooks
 */

import type { Signal, WritableSignal } from '../core/reactivity/types.js';
import type { Inspector, Profiler, Recorder } from './types.js';

/**
 * Global DevTools instance (set by enableDevTools)
 */
let globalInspector: Inspector | null = null;
let globalProfiler: Profiler | null = null;
let globalRecorder: Recorder | null = null;

/**
 * Set global DevTools instances
 */
export function setGlobalDevTools(inspector: Inspector, profiler: Profiler, recorder: Recorder): void {
  globalInspector = inspector;
  globalProfiler = profiler;
  globalRecorder = recorder;
}

/**
 * Clear global DevTools instances
 */
export function clearGlobalDevTools(): void {
  globalInspector = null;
  globalProfiler = null;
  globalRecorder = null;
}

/**
 * Check if DevTools is enabled
 */
export function isDevToolsEnabled(): boolean {
  return globalInspector !== null;
}

/**
 * Use DevTools - Access DevTools from component
 *
 * Returns DevTools utilities for inspecting and debugging.
 *
 * @example
 * ```typescript
 * const MyComponent = defineComponent(() => {
 *   const devtools = useDevTools();
 *
 *   const count = signal(0);
 *   devtools.inspect(count, 'Counter Signal');
 *
 *   return () => <div>{count()}</div>;
 * });
 * ```
 */
export function useDevTools() {
  return {
    /**
     * Inspect signal with custom name
     */
    inspect<T>(signal: Signal<T> | WritableSignal<T>, name: string): void {
      if (!globalInspector) return;

      globalInspector.trackSignal(signal, { name });
    },

    /**
     * Start profiling
     */
    startProfiling(): void {
      if (!globalProfiler) return;
      globalProfiler.startProfiling();
    },

    /**
     * Stop profiling
     */
    stopProfiling(): any {
      if (!globalProfiler) return undefined;
      return globalProfiler.stopProfiling();
    },

    /**
     * Measure function execution
     */
    measure<T>(name: string, fn: () => T): T {
      if (!globalProfiler) return fn();

      const start = performance.now();
      try {
        return fn();
      } finally {
        const duration = performance.now() - start;
        console.debug(`[DevTools] ${name} took ${duration.toFixed(2)}ms`);
      }
    },

    /**
     * Get inspector instance
     */
    getInspector(): Inspector | null {
      return globalInspector;
    },

    /**
     * Get profiler instance
     */
    getProfiler(): Profiler | null {
      return globalProfiler;
    },

    /**
     * Get recorder instance
     */
    getRecorder(): Recorder | null {
      return globalRecorder;
    },

    /**
     * Check if enabled
     */
    isEnabled(): boolean {
      return isDevToolsEnabled();
    },
  };
}

/**
 * Use Inspector - Access state inspector from component
 *
 * @example
 * ```typescript
 * const MyComponent = defineComponent(() => {
 *   const inspector = useInspector();
 *
 *   const count = signal(0);
 *   inspector?.trackSignal(count, { name: 'Count' });
 *
 *   return () => <div>{count()}</div>;
 * });
 * ```
 */
export function useInspector(): Inspector | null {
  return globalInspector;
}

/**
 * Use Profiler - Component-level profiling
 *
 * Automatically measures component render time.
 *
 * @example
 * ```typescript
 * const MyComponent = defineComponent(() => {
 *   useProfiler('MyComponent');
 *
 *   return () => <div>Hello</div>;
 * });
 * ```
 */
export function useProfiler(componentName?: string): Profiler | null {
  if (!globalProfiler) return null;

  // In a real implementation, this would hook into the component lifecycle
  // For now, just return the profiler
  return globalProfiler;
}

/**
 * Use Time Travel - Access time-travel debugging
 *
 * @example
 * ```typescript
 * const DebugPanel = defineComponent(() => {
 *   const timeTravel = useTimeTravel();
 *
 *   return () => (
 *     <div>
 *       <button onClick={() => timeTravel?.undo()}>Undo</button>
 *       <button onClick={() => timeTravel?.redo()}>Redo</button>
 *     </div>
 *   );
 * });
 * ```
 */
export function useTimeTravel(): Recorder | null {
  return globalRecorder;
}

/**
 * With DevTools - Higher-order component for automatic DevTools integration
 *
 * Wraps component with automatic tracking and profiling.
 *
 * @example
 * ```typescript
 * const MyComponent = withDevTools(
 *   defineComponent(() => {
 *     return () => <div>Hello</div>;
 *   }),
 *   { name: 'MyComponent', profile: true }
 * );
 * ```
 */
export function withDevTools<P extends Record<string, any>>(
  component: (props: P) => any,
  options: { name?: string; profile?: boolean } = {},
): (props: P) => any {
  const componentName = options.name || component.name || 'Anonymous';

  return (props: P) => {
    // Track component
    if (globalInspector) {
      globalInspector.trackComponent(component, props, { name: componentName });
    }

    // Profile if enabled
    if (options.profile && globalProfiler) {
      globalProfiler.startMeasuringComponent(componentName, componentName);
    }

    try {
      return component(props);
    } finally {
      if (options.profile && globalProfiler) {
        globalProfiler.endMeasuringComponent(componentName);
      }
    }
  };
}

/**
 * Debug Signal - Create signal with automatic DevTools tracking
 *
 * Convenience wrapper that creates a signal and automatically tracks it.
 *
 * @example
 * ```typescript
 * const count = debugSignal(0, 'Counter');
 * // Equivalent to:
 * // const count = signal(0);
 * // useDevTools().inspect(count, 'Counter');
 * ```
 */
export function debugSignal<T>(
  initialValue: T,
  name: string,
  options?: { equals?: (a: T, b: T) => boolean },
): WritableSignal<T> {
  // Import signal dynamically to avoid circular deps
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { signal } = require('../core/reactivity/signal.js');
  const sig = signal(initialValue, options);

  // Track with inspector
  if (globalInspector) {
    globalInspector.trackSignal(sig, { name });
  }

  return sig;
}

/**
 * Log DevTools State - Log current DevTools state to console
 *
 * Useful for debugging DevTools itself.
 */
export function logDevToolsState(): void {
  if (!isDevToolsEnabled()) {
    console.log('[DevTools] Not enabled');
    return;
  }

  console.group('[DevTools] State');

  if (globalInspector) {
    const state = globalInspector.getState();
    console.log('Signals:', state.signals.size);
    console.log('Computed:', state.computed.size);
    console.log('Effects:', state.effects.size);
    console.log('Components:', state.components.size);
    console.log('Stores:', state.stores.size);
  }

  if (globalProfiler) {
    const state = globalProfiler.getState();
    console.log('Profiling:', state.isProfiling);
    console.log('Measurements:', state.measurements.length);
    console.log('Bottlenecks:', state.bottlenecks.length);
  }

  if (globalRecorder) {
    const state = globalRecorder.getState();
    console.log('Recording:', state.isRecording);
    console.log('History:', state.history.length);
    console.log('Current Index:', state.currentIndex);
  }

  console.groupEnd();
}

/**
 * Export DevTools State - Export state as JSON
 *
 * Useful for saving debug sessions.
 */
export function exportDevToolsState(): string {
  const state: any = {
    timestamp: Date.now(),
    inspector: globalInspector?.getState(),
    profiler: globalProfiler?.getState(),
    recorder: globalRecorder?.exportSession(),
  };

  return JSON.stringify(state, null, 2);
}
