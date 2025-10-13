/**
 * Reactive System Type Definitions
 * Core types for Aether's fine-grained reactivity system
 *
 * @module reactivity/types
 *
 * Performance Characteristics:
 * - Signal reads: O(1) time, triggers dependency tracking
 * - Signal writes: O(n) time where n = number of dependents
 * - Batched updates: O(n) time for n updates, but only triggers dependents once
 * - Memory: O(d) where d = number of dependencies per signal
 */

/**
 * Signal - Basic reactive primitive for read-only reactive values
 *
 * Signals are the core building blocks of the reactivity system. They provide
 * fine-grained reactivity with automatic dependency tracking.
 *
 * @template T - The type of value stored in the signal
 *
 * @example
 * ```typescript
 * const count = signal(0);
 * console.log(count()); // 0 - reads value with dependency tracking
 * console.log(count.peek()); // 0 - reads without tracking
 *
 * // Subscribe to changes
 * const unsubscribe = count.subscribe((value) => {
 *   console.log('Count changed:', value);
 * });
 * ```
 *
 * Performance:
 * - Read (call): O(1) time, registers current computation as dependent
 * - Peek: O(1) time, no dependency tracking overhead
 * - Subscribe: O(1) time to add subscriber, O(n) notification on change
 * - Memory: O(d + s) where d = dependents, s = subscribers
 */
export interface Signal<T> {
  /**
   * Get current value with automatic dependency tracking.
   * If called within a reactive context (computed/effect), this signal
   * will be tracked as a dependency.
   *
   * Time Complexity: O(1)
   * Space Complexity: O(1) additional per dependent
   */
  (): T;

  /**
   * Get current value without dependency tracking.
   * Use this when you need the value but don't want to create a reactive dependency.
   *
   * Time Complexity: O(1)
   * Space Complexity: O(1)
   */
  peek(): T;

  /**
   * Subscribe to value changes.
   * The callback will be invoked whenever the signal's value changes.
   *
   * @param fn - Callback function called with new value
   * @returns Unsubscribe function
   *
   * Time Complexity: O(1) to subscribe, O(1) per notification
   * Space Complexity: O(1) per subscriber
   */
  subscribe(fn: (value: T) => void): () => void;
}

/**
 * Computed - Type alias for Signal, used for semantic clarity
 *
 * Use this type when you want to indicate that a signal is derived/computed
 * rather than a base signal. Functionally identical to Signal<T>.
 *
 * @template T - The type of computed value
 *
 * @example
 * ```typescript
 * const count = signal(0);
 * const doubled: Computed<number> = computed(() => count() * 2);
 * ```
 */
export type Computed<T> = Signal<T>;

/**
 * WritableSignal - Mutable signal with update capabilities
 *
 * Extends Signal with methods to update the value. Provides three ways to update:
 * - set(): Replace value directly or via function
 * - update(): Update via function (convenience method)
 * - mutate(): Mutate in-place (for objects/arrays)
 *
 * @template T - The type of value stored in the signal
 *
 * @example
 * ```typescript
 * const count = signal(0);
 * count.set(5);                    // Direct set
 * count.set(n => n + 1);           // Functional update
 * count.update(n => n + 1);        // Same as above
 *
 * const obj = signal({ x: 1 });
 * obj.mutate(o => { o.x = 2; });   // In-place mutation
 * ```
 *
 * Performance:
 * - set(): O(1) equality check + O(n) notification where n = dependents
 * - update(): Same as set()
 * - mutate(): O(n) notification, no equality check (always notifies)
 */
export interface WritableSignal<T> extends Signal<T> {
  /**
   * Set new value directly or via update function.
   * Only triggers updates if value changed (uses equality check).
   *
   * @param value - New value or function to compute new value from previous
   *
   * Time Complexity: O(1) + O(n) where n = number of dependents
   * Space Complexity: O(1)
   */
  set(value: T | ((prev: T) => T)): void;

  /**
   * Update value via function. Convenience method equivalent to set(fn).
   * Only triggers updates if value changed.
   *
   * @param fn - Function that receives previous value and returns new value
   *
   * Time Complexity: O(1) + O(n) where n = number of dependents
   * Space Complexity: O(1)
   */
  update(fn: (prev: T) => T): void;

  /**
   * Mutate value in place (for objects/arrays).
   * ALWAYS triggers updates (no equality check).
   * Use for efficient in-place modifications.
   *
   * @param fn - Function that mutates the value in place
   *
   * Time Complexity: O(n) where n = number of dependents
   * Space Complexity: O(1)
   *
   * @example
   * ```typescript
   * const list = signal([1, 2, 3]);
   * list.mutate(arr => arr.push(4));  // Efficient in-place update
   * ```
   */
  mutate(fn: (value: T) => void): void;
}

/**
 * ComputedSignal - Derived reactive value (DEPRECATED)
 *
 * @deprecated Use Signal<T> or Computed<T> instead. This interface adds
 * no additional functionality and will be removed in a future version.
 * The readonly value property is redundant since signal() already returns the value.
 *
 * @template T - The type of computed value
 */
export interface ComputedSignal<T> extends Signal<T> {
  /** @deprecated Use signal() call instead */
  readonly value: T;
}

/**
 * Store - Reactive state container
 */
export interface Store<T extends object> {
  get(): T;
  get<K extends keyof T>(key: K): T[K];
  getState(): T;
  set<K extends keyof T>(key: K, value: T[K]): void;
  update(updates: Partial<T>): void;
  subscribe(fn: (state: T) => void): () => void;
  transaction(fn: (state: T) => void): void;
}

/**
 * Resource - Async data management
 */
export interface Resource<T> {
  /** Get current value */
  (): T | undefined;
  /** Loading state */
  readonly loading: Signal<boolean>;
  /** Error state */
  readonly error: Signal<Error | undefined>;
  /** Refetch data */
  refetch(): Promise<void>;
  /** Optimistic update */
  mutate(value: T | ((prev: T | undefined) => T)): void;
}

/**
 * Disposable - Cleanup interface
 */
export interface Disposable {
  dispose(): void;
}

/**
 * Computed options
 */
export interface ComputedOptions {
  /** Custom equality check */
  equals?: (a: any, b: any) => boolean;
  /** Debug name for DevTools */
  name?: string;
}

/**
 * Effect options
 */
export interface EffectOptions {
  /** Defer initial execution */
  defer?: boolean;
  /** Custom scheduler for batching */
  scheduler?: (fn: () => void) => void;
  /** Debug name for DevTools */
  name?: string;
}

/**
 * Store options
 */
export interface StoreOptions {
  /** Store name for DevTools */
  name?: string;
  /** Persistence configuration */
  persist?: boolean | PersistOptions;
  /** Middleware for store updates */
  middleware?: Middleware[];
}

/**
 * Persistence options for Store
 */
export interface PersistOptions {
  /** Storage key */
  key: string;
  /** Storage backend */
  storage?: Storage;
  /** Serialization */
  serialize?: (value: any) => string;
  /** Deserialization */
  deserialize?: (value: string) => any;
  /** Paths to persist */
  paths?: string[];
}

/**
 * Store middleware
 */
export interface Middleware {
  /** Called before state update */
  beforeUpdate?: (path: string[], oldValue: any, newValue: any) => any;
  /** Called after state update */
  afterUpdate?: (path: string[], oldValue: any, newValue: any) => void;
}

/**
 * Resource options
 */
export interface ResourceOptions<T> {
  /** Initial value */
  initialValue?: T;
  /** Retry configuration */
  retry?: number | RetryOptions;
  /** Cache time in ms */
  cacheTime?: number;
  /** Stale time in ms */
  staleTime?: number;
  /** On success callback */
  onSuccess?: (data: T) => void;
  /** On error callback */
  onError?: (error: Error) => void;
}

/**
 * Retry options for Resource
 */
export interface RetryOptions {
  /** Max retry attempts */
  count: number;
  /** Delay between retries */
  delay?: number | ((attempt: number) => number);
  /** Retry condition */
  when?: (error: Error) => boolean;
}

/**
 * Batch options
 */
export interface BatchOptions {
  /** Use sync flush instead of microtask */
  sync?: boolean;
  /** Custom scheduler */
  scheduler?: (fn: () => void) => void;
}

/**
 * Tracking context for dependency collection
 */
export interface TrackingContext {
  /** Currently executing computation */
  readonly computation: Computation | null;
  /** Track signal read */
  track<T>(signal: Signal<T>): void;
  /** Trigger signal update */
  trigger<T>(signal: Signal<T>): void;
  /** Run without tracking */
  untrack<T>(fn: () => T): T;
}

/**
 * Computation - Internal reactive node
 */
export interface Computation {
  /** Unique ID */
  readonly id: number;
  /** Execute computation */
  execute(): void;
  /** Mark as stale */
  invalidate(): void;
  /** Cleanup */
  dispose(): void;
}

/**
 * Owner - Computation ownership for cleanup
 */
export interface Owner {
  /** Parent owner */
  readonly parent: Owner | null;
  /** Child computations */
  readonly children: Set<Computation>;
  /** Cleanup handlers */
  readonly cleanups: (() => void)[];
  /** Dispose owner and children */
  dispose(): void;
}

/**
 * Global reactive context
 */
export interface ReactiveContext {
  /** Current tracking context */
  readonly tracking: TrackingContext;
  /** Current owner */
  readonly owner: Owner | null;
  /** Create new owner scope */
  createRoot<T>(fn: (dispose: () => void) => T): T;
  /** Run in owner context */
  runWithOwner<T>(owner: Owner | null, fn: () => T): T;
  /** Batch updates */
  batch(fn: () => void): void;
  /** Untrack execution */
  untrack<T>(fn: () => T): T;
}
