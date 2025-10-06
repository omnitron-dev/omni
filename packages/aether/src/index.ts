/**
 * Aether Framework
 *
 * Minimalist, high-performance frontend framework with fine-grained reactivity.
 *
 * @module @omnitron-dev/aether
 */

// Core reactivity exports (most commonly used)
export {
  // Core primitives
  signal,
  computed,
  effect,
  store,
  resource,
  // Batch operations
  batch,
  untrack,
  createRoot,
  // Lifecycle
  onCleanup,
  getOwner,
  // Advanced
  asyncComputed,
  // Type utilities
  isSignal,
  // Types
  type Signal,
  type WritableSignal,
  type ComputedSignal,
  type Store,
  type Resource,
  type Owner,
  type Computation,
  type Disposable,
  type EffectOptions,
  type ComputedOptions,
  type ResourceOptions,
  type StoreOptions,
  type BatchOptions,
  type AsyncComputed,
  type AsyncComputedState,
  type AsyncComputedOptions,
} from './core/index.js';

// Re-export everything from core for convenience
export * from './core/index.js';
