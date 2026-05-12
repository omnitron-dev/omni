/**
 * Unified lifecycle interface for all Titan services and modules.
 *
 * Lifecycle order:
 * 1. Constructor (sync)
 * 2. onInit() (async) - called after DI resolution
 * 3. onStart() (async) - called when application starts
 * 4. onStop() (async) - called during graceful shutdown
 * 5. onDestroy() (async) - called for cleanup
 *
 * The companion type guards (`isLifecycle`, `hasOnInit`, `hasOnStart`,
 * `hasOnStop`, `hasOnDestroy`) and `ServiceLifecycleState` enum that
 * previously lived in this file were removed in the T#77 cleanup —
 * they had zero consumers across the entire monorepo. Call sites that
 * need shape detection can use a direct `typeof svc.onInit === 'function'`
 * check.
 *
 * @stable
 * @since 0.5.0
 */
export interface ILifecycle {
  /**
   * Called after the service is resolved from the DI container.
   * Use for async initialization that depends on injected dependencies.
   * @returns Promise that resolves when initialization is complete
   */
  onInit?(): Promise<void> | void;

  /**
   * Called when the application starts.
   * Use for starting background tasks, connections, etc.
   * @returns Promise that resolves when service is ready
   */
  onStart?(): Promise<void> | void;

  /**
   * Called during graceful shutdown, before onDestroy.
   * Use for stopping background tasks, closing connections gracefully.
   * @returns Promise that resolves when service has stopped
   */
  onStop?(): Promise<void> | void;

  /**
   * Called for final cleanup during disposal.
   * Use for releasing resources, closing file handles, etc.
   * @returns Promise that resolves when cleanup is complete
   */
  onDestroy?(): Promise<void> | void;
}
