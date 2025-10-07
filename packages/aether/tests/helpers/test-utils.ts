/**
 * Testing Utilities for Aether Components
 *
 * Provides helpers for rendering components and testing reactivity
 */

import { signal, type WritableSignal } from '../../src/core/reactivity/signal.js';
import { computed, type ComputedSignal } from '../../src/core/reactivity/computed.js';
import { effect } from '../../src/core/reactivity/effect.js';
import { createRoot } from '../../src/core/reactivity/context.js';

/**
 * Render result with cleanup
 */
export interface RenderResult {
  container: HTMLElement;
  cleanup: () => void;
}

/**
 * Render a component into a container
 *
 * @param component - Component to render
 * @returns Render result with cleanup
 *
 * @example
 * ```typescript
 * const { container, cleanup } = renderComponent(() => <MyComponent />);
 * expect(container.textContent).toBe('Hello');
 * cleanup();
 * ```
 */
export function renderComponent(component: () => any): RenderResult {
  const container = document.createElement('div');
  document.body.appendChild(container);

  let dispose: (() => void) | undefined;

  createRoot((d) => {
    dispose = d;
    const result = component();
    if (result instanceof Node) {
      container.appendChild(result);
    } else if (typeof result === 'string' || typeof result === 'number') {
      container.textContent = String(result);
    }
  });

  return {
    container,
    cleanup: () => {
      if (dispose) dispose();
      document.body.removeChild(container);
    },
  };
}

/**
 * Wait for next tick
 */
export function nextTick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Wait for condition to be true
 *
 * @param condition - Condition function
 * @param timeout - Timeout in ms (default: 1000)
 * @returns Promise that resolves when condition is true
 */
export async function waitFor(condition: () => boolean, timeout = 1000): Promise<void> {
  const start = Date.now();

  while (!condition()) {
    if (Date.now() - start > timeout) {
      throw new Error('waitFor timeout');
    }
    await nextTick();
  }
}

/**
 * Create a test signal
 */
export function testSignal<T>(initialValue: T): WritableSignal<T> {
  return signal(initialValue);
}

/**
 * Create a test computed
 */
export function testComputed<T>(fn: () => T): ComputedSignal<T> {
  return computed(fn);
}

/**
 * Track effect executions
 *
 * @param fn - Effect function
 * @returns Object with count and cleanup
 *
 * @example
 * ```typescript
 * const count = signal(0);
 * const tracker = trackEffect(() => count());
 * count.set(1);
 * expect(tracker.count).toBe(2); // Initial + 1 update
 * tracker.cleanup();
 * ```
 */
export function trackEffect(fn: () => void): { count: number; cleanup: () => void } {
  let count = 0;
  let cleanup: (() => void) | undefined;

  createRoot((dispose) => {
    cleanup = dispose;
    effect(() => {
      fn();
      count++;
    });
  });

  return {
    get count() {
      return count;
    },
    cleanup: () => {
      if (cleanup) cleanup();
    },
  };
}

/**
 * Mock fetch for testing
 *
 * @param responses - Map of URL patterns to responses
 * @returns Cleanup function
 *
 * @example
 * ```typescript
 * const cleanup = mockFetch({
 *   '/api/users': { data: [{ id: 1, name: 'Alice' }] }
 * });
 * const response = await fetch('/api/users');
 * const data = await response.json();
 * cleanup();
 * ```
 */
export function mockFetch(responses: Record<string, any>): () => void {
  const originalFetch = global.fetch;

  global.fetch = async (input: RequestInfo | URL): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;

    for (const [pattern, response] of Object.entries(responses)) {
      if (url.includes(pattern)) {
        return new Response(JSON.stringify(response), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    throw new Error(`No mock response for ${url}`);
  } as typeof fetch;

  return () => {
    global.fetch = originalFetch;
  };
}

/**
 * Create a spy function for testing
 */
export function createSpy<T extends (...args: any[]) => any>(): T & {
  calls: Array<Parameters<T>>;
  results: Array<ReturnType<T>>;
  callCount: number;
  reset: () => void;
} {
  const calls: any[][] = [];
  const results: any[] = [];

  const spy = ((...args: any[]) => {
    calls.push(args);
    const result = undefined;
    results.push(result);
    return result;
  }) as any;

  spy.calls = calls;
  spy.results = results;
  Object.defineProperty(spy, 'callCount', {
    get: () => calls.length,
  });
  spy.reset = () => {
    calls.length = 0;
    results.length = 0;
  };

  return spy;
}
