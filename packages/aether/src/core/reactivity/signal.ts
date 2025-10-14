/**
 * Signal - Basic reactive primitive
 *
 * Implements fine-grained reactivity for optimal rendering performance.
 * Signals use automatic dependency tracking to minimize unnecessary updates.
 *
 * @module reactivity/signal
 *
 * Performance Characteristics:
 * - Creation: O(1) time and space
 * - Read: O(1) time, O(1) space per dependent
 * - Write: O(1) equality check + O(n) notification where n = dependents
 * - Memory: O(d + s) where d = dependents (computed/effects), s = subscribers
 *
 * Best Practices:
 * - Use batch() when updating multiple signals to avoid redundant recomputations
 * - Use peek() when reading without creating dependencies
 * - Provide custom equals function for complex objects to optimize updates
 * - Keep signal values immutable for predictable behavior
 */

import type { Signal, WritableSignal } from './types.js';

export type { WritableSignal };
import { context, ComputationImpl, incrementUpdateVersion, queueSubscriberNotification } from './context.js';
import { resolveDiamondDependencies } from './diamond-resolver.js';

/**
 * Default equality check
 */
function defaultEquals(a: any, b: any): boolean {
  return Object.is(a, b);
}

/**
 * Signal implementation
 */
class SignalImpl<T> {
  private value: T;
  private subscribers = new Set<() => void>();
  private computations = new Set<ComputationImpl>();
  private version = 0;
  private equals: (a: T, b: T) => boolean;

  constructor(initial: T, options?: { equals?: (a: T, b: T) => boolean }) {
    this.value = initial;
    this.equals = options?.equals || defaultEquals;
  }

  // Getter - tracks dependencies
  call(): T {
    // Track dependency if we're in a computation
    context.tracking.track(this as any);

    // Add current computation as subscriber
    const computation = context.tracking.computation;
    if (computation instanceof ComputationImpl) {
      this.computations.add(computation);
      computation.addDependency(this as any);
    }

    return this.value;
  }

  // Make the signal callable
  [Symbol.for('nodejs.util.inspect.custom')]() {
    return `Signal(${JSON.stringify(this.value)})`;
  }

  // Peek at value without tracking
  peek(): T {
    return this.value;
  }

  // Subscribe to changes
  subscribe(fn: (value: T) => void): () => void {
    const wrapper = () => fn(this.value);
    this.subscribers.add(wrapper);

    // Return unsubscribe function
    return () => {
      this.subscribers.delete(wrapper);
    };
  }

  // Set value
  set(value: T | ((prev: T) => T)): void {
    const newValue = typeof value === 'function' ? (value as (prev: T) => T)(this.value) : value;

    if (!this.equals(this.value, newValue)) {
      this.value = newValue;
      this.version++;
      // Increment update version for new update cycle
      incrementUpdateVersion();
      this.notify();
    }
  }

  // Update with function
  update(fn: (prev: T) => T): void {
    this.set(fn(this.value));
  }

  // Mutate for objects/arrays
  mutate(fn: (value: T) => void): void {
    fn(this.value);
    this.version++;
    // Increment update version for new update cycle
    incrementUpdateVersion();
    this.notify();
  }

  // Notify all subscribers
  private notify(): void {
    // Use the new diamond resolver for clean dependency resolution
    const computations = Array.from(this.computations);
    resolveDiamondDependencies(computations);

    // Then notify regular subscribers
    for (const subscriber of this.subscribers) {
      queueSubscriberNotification(subscriber);
    }
  }

  // Remove computation from subscribers
  removeComputation(computation: ComputationImpl): void {
    this.computations.delete(computation);
  }

  // Get computations for debugging
  getComputations(): Set<ComputationImpl> {
    return this.computations;
  }
}

/**
 * Create a writable signal
 *
 * Signals are the foundation of the reactivity system. They store values and
 * automatically track dependencies when accessed within reactive contexts.
 *
 * @template T - The type of value stored in the signal
 * @param initial - Initial value for the signal
 * @param options - Configuration options
 * @param options.equals - Custom equality function (default: Object.is)
 * @returns A writable signal with get/set/update/mutate capabilities
 *
 * @example
 * ```typescript
 * // Basic usage
 * const count = signal(0);
 * console.log(count()); // 0
 * count.set(1);
 * count.update(n => n + 1); // 2
 *
 * // With custom equality
 * const user = signal({ name: 'John' }, {
 *   equals: (a, b) => a.name === b.name
 * });
 *
 * // In-place mutation for arrays
 * const items = signal([1, 2, 3]);
 * items.mutate(arr => arr.push(4)); // Efficient
 * ```
 *
 * Performance:
 * - Time Complexity: O(1) creation
 * - Space Complexity: O(1) + O(d) where d = number of dependents
 * - Read: O(1) with dependency tracking
 * - Write: O(1) + O(n) where n = number of dependents to notify
 */
export function signal<T>(initial: T, options?: { equals?: (a: T, b: T) => boolean }): WritableSignal<T> {
  const s = new SignalImpl(initial, options);

  // Create callable interface
  const callable = Object.assign(() => s.call(), {
    peek: () => s.peek(),
    subscribe: (fn: (value: T) => void) => s.subscribe(fn),
    set: (value: T | ((prev: T) => T)) => s.set(value),
    update: (fn: (prev: T) => T) => s.update(fn),
    mutate: (fn: (value: T) => void) => s.mutate(fn),
  });

  // Store the internal signal instance for cleanup purposes
  (callable as any).__internal = s;

  // Add debug representation
  Object.defineProperty(callable, Symbol.for('nodejs.util.inspect.custom'), {
    value: () => `Signal(${JSON.stringify(s.peek())})`,
  });

  return callable as WritableSignal<T>;
}

/**
 * Create a read-only signal from a writable signal
 */
export function readonly<T>(writable: WritableSignal<T>): Signal<T> {
  const readonlySignal = Object.assign(() => writable(), {
    peek: () => writable.peek(),
    subscribe: (fn: (value: T) => void) => writable.subscribe(fn),
  });

  return readonlySignal as Signal<T>;
}

/**
 * Check if a value is a Signal
 */
export function isSignal<T = any>(value: any): value is Signal<T> {
  return (
    value != null &&
    typeof value === 'function' &&
    typeof value.peek === 'function' &&
    typeof value.subscribe === 'function'
  );
}

// Export for internal use by other reactive primitives
export { SignalImpl };

/**
 * Create a signal with SolidJS-compatible API
 * Returns [getter, setter] tuple instead of a callable signal
 */
export function createSignal<T>(
  initial: T,
  options?: { equals?: (a: T, b: T) => boolean }
): [() => T, (value: T | ((prev: T) => T)) => void] {
  const s = signal(initial, options);

  // Create getter function with signal methods for detection
  const getter = () => s();
  // Attach signal methods to the getter for isSignal detection
  (getter as any).peek = () => s.peek();
  (getter as any).subscribe = (fn: any) => s.subscribe(fn);

  return [getter as any, (value: T | ((prev: T) => T)) => s.set(value)];
}
