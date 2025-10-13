/**
 * Batch - Group multiple updates into a single render
 *
 * Batching is a critical performance optimization that groups multiple reactive
 * updates into a single update cycle. Without batching, each signal update triggers
 * immediate recomputation of all dependents. With batching, dependents are only
 * recomputed once after all updates complete.
 *
 * @module reactivity/batch
 *
 * Performance Impact:
 * - Without batch: N signal updates = N * D dependent recomputations (worst case)
 * - With batch: N signal updates = 1 * D dependent recomputations
 * - Time saved: O((N-1) * D) where N = updates, D = dependents
 *
 * Example:
 * ```typescript
 * const a = signal(1);
 * const b = signal(2);
 * const sum = computed(() => a() + b());
 *
 * // Without batch: sum computed twice
 * a.set(10);  // sum = 12
 * b.set(20);  // sum = 30
 *
 * // With batch: sum computed once
 * batch(() => {
 *   a.set(10);
 *   b.set(20);
 * }); // sum = 30
 * ```
 */

import { context } from './context.js';

/**
 * Batch multiple signal updates to prevent excessive re-renders
 *
 * Groups multiple signal updates into a single update cycle. All signal changes
 * made within the batch function are applied atomically, and dependent computations
 * and effects only run once after all updates complete.
 *
 * @param fn - Function containing signal updates to batch
 *
 * @example
 * ```typescript
 * const x = signal(0);
 * const y = signal(0);
 * const sum = computed(() => x() + y());
 *
 * let computeCount = 0;
 * effect(() => {
 *   sum();
 *   computeCount++;
 * });
 *
 * // Without batch: effect runs twice
 * x.set(1);  // computeCount = 2
 * y.set(1);  // computeCount = 3
 *
 * // With batch: effect runs once
 * batch(() => {
 *   x.set(2);
 *   y.set(2);
 * }); // computeCount = 4 (only +1)
 * ```
 *
 * Performance:
 * - Time Complexity: O(f + D) where f = function time, D = total dependents
 * - Space Complexity: O(D) to track batched updates
 * - Optimization: Reduces redundant recomputations by factor of N (number of updates)
 * - Use case: Essential for performance when updating multiple related signals
 */
export function batch(fn: () => void): void {
  context.batch(fn);
}

/**
 * Untrack execution - run without dependency tracking
 *
 * Runs a function without tracking any signal reads as dependencies.
 * Useful when you need to read signal values within a reactive context
 * but don't want those reads to trigger re-execution.
 *
 * @template T - Return type of the function
 * @param fn - Function to run without tracking
 * @returns The result of the function
 *
 * @example
 * ```typescript
 * const count = signal(0);
 * const doubled = signal(0);
 *
 * effect(() => {
 *   // This read IS tracked - effect re-runs when count changes
 *   const c = count();
 *
 *   // This read is NOT tracked - effect won't re-run when doubled changes
 *   const d = untrack(() => doubled());
 *
 *   console.log(c, d);
 * });
 * ```
 *
 * Performance:
 * - Time Complexity: O(f) where f = function execution time
 * - Space Complexity: O(1)
 * - Use case: Reading values without creating dependencies
 */
export function untrack<T>(fn: () => T): T {
  return context.untrack(fn);
}

/**
 * Create a root scope for reactive computations
 *
 * Creates an isolated reactive scope with its own ownership tree.
 * All reactive computations (effects, computed) created within the root
 * are tracked and can be disposed together via the dispose function.
 *
 * @template T - Return type of the function
 * @param fn - Function that receives a dispose callback and returns a value
 * @returns The result of the function
 *
 * @example
 * ```typescript
 * const cleanup = createRoot((dispose) => {
 *   const count = signal(0);
 *   effect(() => console.log(count()));
 *
 *   // Return the dispose function to cleanup later
 *   return dispose;
 * });
 *
 * // Later: cleanup all effects created in the root
 * cleanup();
 * ```
 *
 * Performance:
 * - Time Complexity: O(f) where f = function execution time
 * - Space Complexity: O(n) where n = number of child computations
 * - Use case: Creating isolated reactive scopes with manual lifecycle control
 */
export function createRoot<T>(fn: (dispose: () => void) => T): T {
  return context.createRoot(fn);
}
