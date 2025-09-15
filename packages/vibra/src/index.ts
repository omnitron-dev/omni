/**
 * Vibrancy - Next-generation reactive system
 * 
 * Fine-grained reactivity with advanced features:
 * - Diamond dependency resolution
 * - Async computed values
 * - Store middleware system
 * - Selective subscriptions
 * - Circular dependency detection
 */

export { effect } from './effect.js';
export { computed } from './computed.js';
// Resource management
export { resource } from './resource.js';
// Core reactive primitives
export { signal, isSignal } from './signal.js';

export { batch, untrack, createRoot } from './batch.js';

// Store with reactivity
export { store, selector, transaction, Transaction } from './store.js';

// Proxy registry for memory management
export { ProxyRegistry, globalProxyRegistry } from './proxy-registry.js';

// Dependency graph
export { DependencyGraph, globalDependencyGraph } from './dependency-graph.js';

// Context and reactive cleanup
export {
  getOwner,
  onCleanup  // This is the reactive system's onCleanup
} from './context.js';

// Diamond dependency resolution
export {
  isDiamondResolvable,
  getDiamondResolvable,
  type DiamondResolvable,
  calculateDependencyDepth,
  resolveDiamondDependencies
} from './diamond-resolver.js';

export {
  PathMatcher,
  derivedStore,
  storeComputed,
  StoreSubscriptionManager,
  type SubscriptionOptions,
  type SubscriptionCallback
} from './store-subscriptions.js';

export {
  type Middleware,
  commonMiddleware,
  type MiddlewareConfig,
  StoreMiddlewareManager,
  type MiddlewareContext,
  type MiddlewareFunction
} from './store-middleware.js';

// Advanced features
export {
  asyncComputed,
  asyncResource,
  asyncComputedGroup,
  type AsyncComputed,
  suspenseAsyncComputed,
  type AsyncComputedState,
  type AsyncComputedOptions
} from './async-computed.js';
export {
  optional,
  withDefault,
  globalCircularResolver,
  CircularDependencyError,
  CircularDependencyResolver,
  type ResolvableComputation,
  type CircularDependencyOptions
} from './circular-dependency-resolver.js';

// Re-export types from local types file
export type {
  Store,
  Owner,
  Signal,
  Resource,
  Disposable,
  Computation,
  StoreOptions,
  BatchOptions,
  EffectOptions,
  WritableSignal,
  ComputedSignal,
  ComputedOptions,
  ResourceOptions,
  ReactiveContext,
  TrackingContext
} from './types.js';

import { store } from './store.js';
// Default export for convenience
import { signal } from './signal.js';
import { effect } from './effect.js';
import { computed } from './computed.js';
import { resource } from './resource.js';
import { onCleanup } from './context.js';
import { asyncComputed } from './async-computed.js';
import { batch, untrack, createRoot } from './batch.js';

export default {
  signal,
  computed,
  effect,
  store,
  resource,
  batch,
  untrack,
  createRoot,
  onCleanup,
  asyncComputed
};