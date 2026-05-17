/**
 * Core types for Titan application framework
 *
 * @packageDocumentation
 *
 * ## API Stability Markers
 *
 * - `@stable` - Part of the public API, follows semantic versioning
 * - `@experimental` - API may change in minor versions
 * - `@internal` - Not intended for public use
 * - `@deprecated` - Will be removed in a future version
 *
 * @since 0.1.0
 */

import { Token, Container, Provider, type IModule, type DynamicModule } from './nexus/index.js';

/**
 * Application lifecycle state enumeration.
 * Tracks the current state of the application through its lifecycle.
 *
 * @stable
 * @since 0.1.0
 */
export const ApplicationState = {
  Created: 'created',
  Starting: 'starting',
  Started: 'started',
  Stopping: 'stopping',
  Stopped: 'stopped',
  Failed: 'failed',
} as const;
export type ApplicationState = (typeof ApplicationState)[keyof typeof ApplicationState];

/**
 * Application lifecycle events.
 * Events emitted during application lifecycle transitions.
 *
 * @stable
 * @since 0.1.0
 */
export const ApplicationEvent = {
  Starting: 'starting',
  Started: 'started',
  Stopping: 'stopping',
  Stopped: 'stopped',
  Error: 'error',
  ModuleRegistered: 'module:registered',
  ModuleStarted: 'module:started',
  ModuleStopped: 'module:stopped',
  ConfigChanged: 'config:changed',
  HealthCheck: 'health:check',
  Signal: 'signal',
  UncaughtException: 'uncaughtException',
  UnhandledRejection: 'unhandledRejection',
  StateSave: 'state:save',
  ShutdownStart: 'shutdown:start',
  ShutdownComplete: 'shutdown:complete',
  ShutdownError: 'shutdown:error',
  ShutdownTaskComplete: 'shutdown:task:complete',
  ShutdownTaskError: 'shutdown:task:error',
  /**
   * Lifecycle phase event from the underlying `LifecycleController`.
   * Payload shape: `LifecyclePhaseEvent` from `lifecycle/index.ts`.
   * Consumers (metrics exporters, structured loggers) subscribe to
   * this to populate phase-duration histograms and timeout counters.
   */
  LifecyclePhaseEvent: 'lifecycle:phase',
  ProcessExit: 'process:exit',
  Custom: 'custom',
} as const;
export type ApplicationEvent = (typeof ApplicationEvent)[keyof typeof ApplicationEvent];

/**
 * Application configuration interface.
 * Defines the structure of application-level configuration.
 *
 * @stable
 * @since 0.1.0
 */
export interface IApplicationConfig {
  name?: string;
  version?: string;
  environment?: string;
  debug?: boolean;
  config?: any; // Configuration for config module
  logging?: any; // Configuration for logger module
  logger?: any; // Alias for logging
  [key: string]: any;
}

/**
 * Module metadata interface.
 * Contains information about a module's identity and dependencies.
 *
 * @stable
 * @since 0.1.0
 */
export interface IModuleMetadata {
  name: string;
  version?: string;
  dependencies?: Token<any>[];
  priority?: number;
}

/**
 * Health check status interface.
 * Represents the health state of the application or a module.
 *
 * @stable
 * @since 0.1.0
 */
export interface IHealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  message?: string;
  modules?: Record<string, IHealthStatus>;
  details?: any;
}

// IModule and DynamicModule are now imported from nexus/index.js
// The unified module system is defined in nexus/types.ts

/**
 * Re-exported IModule interface for backward compatibility.
 *
 * @stable
 * @since 0.1.0
 */
export type { IModule, DynamicModule };

/**
 * Event handler function type.
 *
 * @stable
 * @since 0.1.0
 */
export type EventHandler<T = any> = (data: T, meta?: IEventMeta) => void | Promise<void>;

/**
 * Event metadata interface.
 * Contains contextual information about an event.
 *
 * @stable
 * @since 0.1.0
 */
export interface IEventMeta {
  event: string;
  timestamp: number;
  source?: string;
  correlation?: string;
}

/**
 * Lifecycle hook interface.
 * Defines a hook that can be registered for lifecycle events.
 *
 * @stable
 * @since 0.1.0
 */
export interface ILifecycleHook {
  name?: string;
  priority?: number;
  timeout?: number;
  handler: () => void | Promise<void>;
}

/**
 * Shutdown options interface.
 * Configuration for graceful shutdown behavior.
 *
 * @stable
 * @since 0.1.0
 */
export interface IShutdownOptions {
  timeout?: number;
  force?: boolean;
  graceful?: boolean;
  signal?: NodeJS.Signals;
}

/**
 * Application metrics interface.
 * Contains runtime metrics about the application.
 *
 * @stable
 * @since 0.1.0
 */
export interface IApplicationMetrics {
  uptime: number;
  memoryUsage: NodeJS.MemoryUsage;
  cpuUsage?: NodeJS.CpuUsage;
  eventLoopUtilization?: any;
  startupTime?: number;
  modules?: number;
}

/**
 * Application environment interface.
 * Contains information about the runtime environment.
 *
 * @stable
 * @since 0.1.0
 */
export interface IEnvironment {
  nodeVersion: string;
  platform: NodeJS.Platform;
  arch: string;
  hostname?: string;
  pid: number;
  ppid?: number;
}

/**
 * Application options interface.
 * Configuration options for creating an application.
 *
 * @stable
 * @since 0.1.0
 */
export interface IApplicationOptions {
  name?: string;
  version?: string;
  container?: Container;
  config?: IApplicationConfig;
  debug?: boolean;
  gracefulShutdownTimeout?: number;
  disableCoreModules?: boolean; // Allow disabling automatic core module registration
  disableGracefulShutdown?: boolean; // Disable automatic graceful shutdown handlers (useful for tests)
  // Additional options for logging (shorthand for config.logging)
  logging?: any;
  [key: string]: any; // Allow other options like config properties at root level
}

/**
 * Main application interface.
 * Defines the public API for interacting with a Titan application.
 *
 * @stable
 * @since 0.1.0
 */
export interface IApplication {
  // Lifecycle management
  start(): Promise<void>;
  stop(options?: IShutdownOptions): Promise<void>;
  restart(): Promise<void>;

  // Module management
  use<T extends IModule>(module: T | Token<T>): this;
  get<T extends IModule>(token: Token<T>): T;
  has(token: Token<any>): boolean;
  replaceModule<T extends IModule>(token: Token<T>, module: T): this;

  // Dependency Injection
  register<T>(token: Token<T>, provider: any, options?: { override?: boolean }): this;
  resolve<T>(token: Token<T>): T;
  hasProvider(token: Token<any>): boolean;

  // Configuration
  configure<T = any>(config: T): this;
  config<K extends keyof IApplicationConfig>(key: K): IApplicationConfig[K];

  // Event system
  on<E extends ApplicationEvent>(event: E, handler: EventHandler): void;
  off<E extends ApplicationEvent>(event: E, handler?: EventHandler): void;
  once<E extends ApplicationEvent>(event: E, handler: EventHandler): void;
  emit<E extends ApplicationEvent>(event: E, data?: any): void;

  // Lifecycle hooks
  onStart(hook: ILifecycleHook | (() => void | Promise<void>)): this;
  onStop(hook: ILifecycleHook | (() => void | Promise<void>)): this;
  onError(handler: (error: Error) => void): this;

  // Runtime information
  readonly state: ApplicationState;
  readonly uptime: number;
  readonly environment: IEnvironment;
  readonly metrics: IApplicationMetrics;
  readonly container: Container;
}

/**
 * Module constructor type.
 *
 * @stable
 * @since 0.1.0
 */
export type ModuleConstructor<T extends IModule = IModule> = new (...args: any[]) => T;

/**
 * Dynamic module type alias.
 *
 * @stable
 * @since 0.1.0
 */
export type IDynamicModule = DynamicModule;

/**
 * Module input types.
 * Supports various module definition patterns for flexibility.
 *
 * @stable
 * @since 0.1.0
 */
export type ModuleInput =
  | IModule // Module instance
  | ModuleConstructor // Module class
  | IDynamicModule // Dynamic module with providers
  | (() => IModule) // Module factory function
  | (() => Promise<IModule>) // Async module factory
  | (() => IDynamicModule) // Dynamic module factory
  | (() => Promise<IDynamicModule>); // Async dynamic module factory

/**
 * Shutdown task definition.
 *
 * @stable
 * @since 0.1.0
 */
export interface IShutdownTask {
  id?: string;
  name: string;
  priority?: number;
  handler: (reason: ShutdownReason, details?: any) => Promise<void> | void;
  timeout?: number;
  critical?: boolean;
  parallel?: boolean;
}

/**
 * Reasons for shutdown enumeration.
 *
 * @stable
 * @since 0.1.0
 */
export const ShutdownReason = {
  Manual: 'manual',
  SIGTERM: 'SIGTERM',
  SIGINT: 'SIGINT',
  SIGHUP: 'SIGHUP',
  Signal: 'signal',
  UncaughtException: 'uncaughtException',
  UnhandledRejection: 'unhandledRejection',
  Timeout: 'timeout',
  Error: 'error',
  Reload: 'reload',
  Upgrade: 'upgrade',
  Maintenance: 'maintenance',
} as const;
export type ShutdownReason = (typeof ShutdownReason)[keyof typeof ShutdownReason];

/**
 * Process signals type.
 *
 * @stable
 * @since 0.1.0
 */
export type ProcessSignal = 'SIGTERM' | 'SIGINT' | 'SIGHUP' | 'SIGUSR1' | 'SIGUSR2' | 'SIGQUIT' | 'SIGABRT';

/**
 * Shutdown priority levels.
 * Controls the order in which shutdown tasks are executed.
 *
 * @stable
 * @since 0.1.0
 */
export enum ShutdownPriority {
  First = 0,
  VeryHigh = 10,
  High = 20,
  AboveNormal = 30,
  Normal = 50,
  BelowNormal = 70,
  Low = 80,
  VeryLow = 90,
  Last = 100,
}

/**
 * Lifecycle states enumeration.
 *
 * @stable
 * @since 0.1.0
 */
export const LifecycleState = {
  Created: 'created',
  Initializing: 'initializing',
  Initialized: 'initialized',
  Starting: 'starting',
  Running: 'running',
  Stopping: 'stopping',
  Stopped: 'stopped',
  ShuttingDown: 'shuttingDown',
  Error: 'error',
} as const;
export type LifecycleState = (typeof LifecycleState)[keyof typeof LifecycleState];

/**
 * Process metrics interface.
 *
 * @stable
 * @since 0.1.0
 */
export interface IProcessMetrics {
  uptime: number;
  memoryUsage: NodeJS.MemoryUsage;
  cpuUsage: NodeJS.CpuUsage;
  pid: number;
  ppid: number;
  platform: NodeJS.Platform;
  nodeVersion: string;
  state: LifecycleState;
  shutdownTasksCount: number;
  cleanupHandlersCount: number;
}

/**
 * Configuration value type.
 * Represents valid configuration values.
 *
 * @stable
 * @since 0.1.0
 */
export type ConfigValue = string | number | boolean | null | undefined | ConfigObject | ConfigArray;

/**
 * Configuration object interface.
 *
 * @stable
 * @since 0.1.0
 */
export interface ConfigObject {
  [key: string]: ConfigValue;
}

/**
 * Configuration array interface.
 *
 * @stable
 * @since 0.1.0
 */
export interface ConfigArray extends Array<ConfigValue> {}

// ============================================================================
// Lifecycle Types
// ============================================================================

/**
 * Re-export the unified lifecycle interface used by every Titan service
 * and module. The five type guards (`isLifecycle`, `hasOnInit`,
 * `hasOnStart`, `hasOnStop`, `hasOnDestroy`) and the
 * `ServiceLifecycleState` enum that previously sat alongside this were
 * removed in the T#77 cleanup — they had zero consumers across the
 * entire monorepo. If runtime-shape detection becomes necessary again,
 * a simple `typeof svc.onInit === 'function'` check at the call site
 * is clearer than a re-export.
 *
 * @stable
 * @since 0.5.0
 */
export { type ILifecycle } from './types/lifecycle.js';
