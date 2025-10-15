/**
 * Effect - Side effects that run when dependencies change
 *
 * Effects are the bridge between the reactive system and the outside world.
 * They run side effects (DOM updates, network requests, logging, etc.) in response
 * to reactive dependency changes. Effects run immediately on creation (unless deferred)
 * and automatically re-run when any tracked dependency changes.
 *
 * @module reactivity/effect
 *
 * Performance Characteristics:
 * - Creation: O(1) + O(f) where f = time to run effect function (unless deferred)
 * - Re-execution: O(f) where f = time to run effect function
 * - Cleanup: O(c) where c = time to run cleanup function
 * - Memory: O(1) + O(d) where d = number of dependencies tracked
 *
 * Features:
 * - Automatic dependency tracking: Tracks all signals/computed accessed during execution
 * - Cleanup support: Return a function to run cleanup before next execution
 * - Deferred execution: Can defer initial run with defer: true option
 * - Custom scheduler: Support custom scheduling (e.g., requestAnimationFrame)
 * - Circular dependency protection: Detects and handles circular dependencies
 * - Error handling: Errors in effects are caught and logged
 *
 * Best Practices:
 * - Use effects for side effects only (DOM updates, network, storage, etc.)
 * - Keep effect functions focused and minimal
 * - Return cleanup functions to prevent memory leaks
 * - Use untrack() for reads that shouldn't trigger re-runs
 * - Batch multiple signal updates to avoid redundant effect runs
 */

import { context, getOwner, OwnerImpl, UpdatePriority, ComputationImpl, ComputationType } from './context.js';
import {
  globalCircularResolver,
  CircularDependencyError,
  type ResolvableComputation,
} from './circular-dependency-resolver.js';

import type { Owner, Disposable, EffectOptions } from './types.js';

/**
 * Extended effect options for circular dependency handling
 */
export interface EffectOptionsExtended extends EffectOptions {
  /** Whether this effect is optional and can be skipped in cycles */
  isOptional?: boolean;
  /** Default behavior when circular dependency is detected */
  onCircularDependency?: 'skip' | 'warn' | 'error';
}

/**
 * Effect implementation using reactive context
 * With circular dependency detection and recovery
 */
export class EffectImpl implements Disposable, ResolvableComputation {
  private computation: ComputationImpl;
  private effectOwner: Owner | null = null;
  private cleanupFn?: () => void;
  private isDisposed = false;
  private scheduler: ((fn: () => void) => void) | undefined;
  private static idCounter = 0;

  // ResolvableComputation properties
  public readonly id: string;
  public readonly name?: string;
  public readonly isOptional?: boolean;
  public readonly defaultValue = undefined; // Effects don't have default values
  private onCircularDependency: 'skip' | 'warn' | 'error';

  constructor(
    private fn: () => void | (() => void),
    options?: EffectOptionsExtended
  ) {
    this.id = `effect_${EffectImpl.idCounter++}`;
    this.name = options?.name;
    this.isOptional = options?.isOptional ?? false;
    this.onCircularDependency = options?.onCircularDependency ?? 'warn';
    this.scheduler = options?.scheduler;

    // Create computation that will track dependencies
    this.computation = new ComputationImpl(
      () => {
        // Dispose previous effect owner (runs onCleanup handlers)
        if (this.effectOwner) {
          try {
            this.effectOwner.dispose();
          } catch (error) {
            console.error('Error in effect owner disposal:', error);
          }
          this.effectOwner = null;
        }

        // Clean up previous effect return value with error handling
        if (this.cleanupFn) {
          try {
            this.cleanupFn();
          } catch (error) {
            console.error('Error in effect cleanup function:', error);
          }
          this.cleanupFn = undefined;
        }

        // Create new owner for this effect run
        this.effectOwner = new OwnerImpl(getOwner());

        // Run the effect function with its own owner and circular dependency protection
        try {
          // Enter circular dependency tracking
          const canProceed = globalCircularResolver.enter(this as ResolvableComputation);

          if (!canProceed) {
            // Circular dependency detected and resolver decided to skip
            globalCircularResolver.exit(this as ResolvableComputation);

            if (this.onCircularDependency === 'error') {
              throw new CircularDependencyError([this]);
            } else if (this.onCircularDependency === 'warn') {
              console.warn(`Circular dependency detected in effect '${this.name || this.id}'`);
            }
            // Skip execution if circular dependency detected
            return;
          }

          try {
            const cleanup = context.runWithOwner(this.effectOwner, () => this.fn());
            if (typeof cleanup === 'function') {
              this.cleanupFn = cleanup;
            }
          } finally {
            // Exit circular dependency tracking
            globalCircularResolver.exit(this as ResolvableComputation);
          }
        } catch (error) {
          if (error instanceof CircularDependencyError) {
            if (this.onCircularDependency === 'error') {
              throw error;
            } else if (this.onCircularDependency === 'warn') {
              console.warn(`Circular dependency in effect '${this.name || this.id}':`, error.message);
            }
            // Skip execution on circular dependency
          } else if (error instanceof Promise) {
            // If it's a Promise (from lazy component/Suspense), re-throw it
            // so it can be caught by Suspense boundary
            throw error;
          } else {
            console.error('Error in effect:', error);
          }
        }
      },
      getOwner(),
      false,
      UpdatePriority.NORMAL,
      ComputationType.EFFECT
    );

    // Set the scheduler on the computation if provided
    if (this.scheduler) {
      (this.computation as any).scheduler = this.scheduler;
    }

    // Run immediately unless deferred
    if (!options?.defer) {
      if (this.scheduler) {
        this.scheduler(() => this.computation.run());
      } else {
        this.computation.run();
      }
    } else if (options?.defer && this.scheduler) {
      // If deferred with a scheduler, schedule the initial run
      this.scheduler(() => this.computation.run());
    }
    // If deferred without scheduler, don't run at all initially
  }

  // ResolvableComputation methods
  execute(): void {
    this.computation.run();
  }

  invalidate(): void {
    this.computation.invalidate();
  }

  skip(): void {
    // Effects can skip by not running
    if (this.isOptional) {
      console.debug(`Skipping optional effect '${this.name || this.id}' to break circular dependency`);
    }
  }

  dispose(): void {
    if (this.isDisposed) return;

    this.isDisposed = true;

    // Dispose effect owner (runs onCleanup handlers)
    if (this.effectOwner) {
      try {
        this.effectOwner.dispose();
      } catch (error) {
        console.error('Error in effect owner disposal:', error);
      }
      this.effectOwner = null;
    }

    // Run cleanup with error handling
    if (this.cleanupFn) {
      try {
        this.cleanupFn();
      } catch (error) {
        console.error('Error in effect cleanup function:', error);
      }
      this.cleanupFn = undefined;
    }

    // Dispose computation
    try {
      this.computation.dispose();
    } catch (error) {
      console.error('Error disposing computation:', error);
    }
  }
}

/**
 * Create an effect that runs when dependencies change
 *
 * Effects are used to perform side effects in response to reactive state changes.
 * They automatically track all signals/computed accessed during execution and
 * re-run when any of those dependencies change.
 *
 * @param fn - Effect function that may return a cleanup function
 * @param options - Configuration options
 * @param options.defer - If true, defer initial execution (default: false)
 * @param options.scheduler - Custom scheduler function for batching/timing control
 * @param options.name - Debug name for DevTools
 * @param options.isOptional - Whether effect is optional in circular dependency scenarios
 * @param options.onCircularDependency - How to handle circular dependencies: 'skip' | 'warn' | 'error'
 * @returns Disposable object with dispose() method to stop the effect
 *
 * @example
 * ```typescript
 * // Basic effect
 * const count = signal(0);
 * effect(() => {
 *   console.log('Count:', count());
 * }); // Logs immediately and on every count change
 *
 * // Effect with cleanup
 * const url = signal('/api/data');
 * effect(() => {
 *   const controller = new AbortController();
 *   fetch(url(), { signal: controller.signal })
 *     .then(res => res.json())
 *     .then(data => console.log(data));
 *
 *   // Cleanup function runs before next effect or on dispose
 *   return () => controller.abort();
 * });
 *
 * // Deferred effect (doesn't run immediately)
 * effect(() => {
 *   console.log('Deferred:', count());
 * }, { defer: true });
 *
 * // Effect with custom scheduler
 * effect(() => {
 *   updateDOM(count());
 * }, {
 *   scheduler: (run) => requestAnimationFrame(run)
 * });
 * ```
 *
 * Performance:
 * - Time Complexity: O(f) where f = effect function execution time
 * - Space Complexity: O(d) where d = number of dependencies
 * - Runs immediately on creation (unless deferred)
 * - Re-runs only when dependencies change (fine-grained reactivity)
 */
export function effect(fn: () => void | (() => void), options?: EffectOptionsExtended): Disposable {
  const effectImpl = new EffectImpl(fn, options);

  // Register the effect for cleanup with the current owner
  const owner = getOwner();
  if (owner) {
    owner.cleanups.push(() => effectImpl.dispose());
  }

  return effectImpl;
}
