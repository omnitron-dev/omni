/**
 * Aether Store Pattern
 * @module store
 *
 * Structured state management for Aether framework with netron integration.
 * Provides stores, persistence, optimistic updates, and lifecycle management.
 *
 * @example
 * ```typescript
 * import { defineStore, signal, computed, persist, optimistic } from '@omnitron-dev/aether/store';
 *
 * // Define a store
 * export const useUserStore = defineStore('user', (netron) => {
 *   const users = signal<User[]>([]);
 *   const loading = signal(false);
 *
 *   const activeUsers = computed(() => users().filter(u => u.active));
 *
 *   const loadUsers = async () => {
 *     loading.set(true);
 *     const service = await netron.service<IUserService>('users');
 *     const data = await service.getUsers();
 *     users.set(data);
 *     loading.set(false);
 *   };
 *
 *   const updateUser = optimistic(
 *     async (id: string, data: Partial<User>) => {
 *       const service = await netron.service<IUserService>('users');
 *       return await service.updateUser(id, data);
 *     },
 *     {
 *       update: (id, data) => {
 *         users.set(users().map(u => u.id === id ? { ...u, ...data } : u));
 *       },
 *       rollback: (snapshot) => {
 *         users.set(snapshot);
 *       },
 *       snapshot: () => users.peek()
 *     }
 *   );
 *
 *   persist(users, { key: 'user-cache', storage: 'local' });
 *
 *   return {
 *     users: readonly(users),
 *     activeUsers,
 *     loadUsers,
 *     updateUser,
 *   };
 * });
 *
 * // Use in component
 * const MyComponent = defineComponent(() => {
 *   const userStore = useUserStore();
 *
 *   onMount(() => userStore.loadUsers());
 *
 *   return () => (
 *     <ul>
 *       {userStore.activeUsers().map(user => <li>{user.name}</li>)}
 *     </ul>
 *   );
 * });
 * ```
 */

// Core store definition
export {
  defineStore,
  defineStoreTyped,
  defineComputedStore,
  clearAllStoreInstances,
  getActiveStoreIds,
  isStoreActive,
} from './defineStore.js';

// Store composition helpers
export {
  useStore,
  readonly,
  batch,
  deriveStore,
  extendStore,
  resetStore,
  disposeStore,
  getStoreMetadata,
  isStoreInitialized,
  composeStores,
  registerStore,
  unregisterStore,
  getStoreFactory,
  hasStore,
  getAllStoreIds,
  clearAllStores,
} from './composition.js';

// Persistence
export { persist, createPersistManager, hydrateSignal, persistSignal, clearPersistedData } from './persist.js';

// Optimistic updates
export { optimistic, optimisticSignal, optimisticArray } from './optimistic.js';

// Lifecycle hooks
export {
  onStoreInit,
  onStoreDestroy,
  onStoreHydrate,
  LifecycleManager,
  getCurrentLifecycle,
  setCurrentLifecycle,
  runWithLifecycle,
  createLifecycleHandlers,
} from './lifecycle.js';

// Types
export type {
  // Core types
  StoreSetup,
  StoreFactory,
  StoreInstance,
  StoreOptions,
  UseStoreOptions,

  // Persistence types
  PersistOptions,
  StorageType,
  StorageBackend,
  PersistManager,

  // Optimistic types
  OptimisticOptions,
  OptimisticMutation,

  // Lifecycle types
  StoreLifecycleHook,
  StoreLifecycleHandlers,
} from './types.js';

// Re-export commonly used reactivity primitives for convenience
export { signal, readonly as makeReadonly } from '../core/reactivity/signal.js';
export { computed } from '../core/reactivity/computed.js';
export { effect } from '../core/reactivity/effect.js';
export { batch as batchUpdates, untrack, createRoot } from '../core/reactivity/batch.js';

// Re-export types
export type { Signal, WritableSignal, Computed } from '../core/reactivity/types.js';

// Module integration
export {
  ModuleScopedStoreManager,
  StoreLifecycleManager,
  StoreExportManager,
  defineModuleStore,
  useModuleStore,
  useIslandStore,
  getModuleScopedStoreManager,
  resetModuleScopedStoreManager,
  setModuleContext,
  setIslandContext,
  clearModuleContext,
  clearIslandContext,
} from './module-integration.js';
export type { StoreScope, ModuleScopedStoreOptions } from './module-integration.js';
