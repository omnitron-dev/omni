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

/**
 * Type guard to check if an object implements ILifecycle
 */
export function isLifecycle(obj: unknown): obj is ILifecycle {
  return obj !== null && typeof obj === 'object';
}

/**
 * Type guard for specific lifecycle methods
 */
export function hasOnInit(obj: unknown): obj is { onInit(): Promise<void> | void } {
  return obj !== null && typeof obj === 'object' && typeof (obj as any).onInit === 'function';
}

export function hasOnStart(obj: unknown): obj is { onStart(): Promise<void> | void } {
  return obj !== null && typeof obj === 'object' && typeof (obj as any).onStart === 'function';
}

export function hasOnStop(obj: unknown): obj is { onStop(): Promise<void> | void } {
  return obj !== null && typeof obj === 'object' && typeof (obj as any).onStop === 'function';
}

export function hasOnDestroy(obj: unknown): obj is { onDestroy(): Promise<void> | void } {
  return obj !== null && typeof obj === 'object' && typeof (obj as any).onDestroy === 'function';
}

/**
 * Lifecycle state enum for tracking service state
 */
export enum ServiceLifecycleState {
  Created = 'created',
  Initializing = 'initializing',
  Initialized = 'initialized',
  Starting = 'starting',
  Started = 'started',
  Stopping = 'stopping',
  Stopped = 'stopped',
  Destroying = 'destroying',
  Destroyed = 'destroyed',
  Failed = 'failed',
}
