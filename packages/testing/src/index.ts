/**
 * @devgrid/testing - Cross-runtime testing utilities
 */

export * from './runtime/test-adapter.js';

// Re-export specific runtime adapters based on environment
export { RUNTIME } from './runtime/test-adapter.js';

// Export utility types
export type MockFunction<T extends (...args: any[]) => any> = T & {
  mock: {
    calls: Parameters<T>[];
    results: ReturnType<T>[];
    lastCall: () => Parameters<T> | undefined;
  };
  mockImplementation: (impl: T) => MockFunction<T>;
  mockReturnValue: (value: ReturnType<T>) => MockFunction<T>;
  mockResolvedValue: (value: Awaited<ReturnType<T>>) => MockFunction<T>;
  mockRejectedValue: (value: any) => MockFunction<T>;
  mockClear: () => void;
  mockReset: () => void;
};

// Helper function to import the correct adapter based on runtime
export function loadRuntimeAdapter() {
  const runtime = (() => {
    if (typeof (globalThis as any).Bun !== 'undefined') return 'bun';
    if (typeof (globalThis as any).Deno !== 'undefined') return 'deno';
    return 'node';
  })();

  switch (runtime) {
    case 'bun':
      return import('./runtime/bun-adapter.js');
    case 'deno':
      return import('./runtime/deno-adapter.js');
    default:
      return import('./runtime/node-adapter.js');
  }
}