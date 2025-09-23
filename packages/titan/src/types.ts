/**
 * Core types for Titan application framework
 */

import { Token, Container, Provider, type InjectionToken } from './nexus/index.js';

/**
 * Application lifecycle state
 */
export enum ApplicationState {
  Created = 'created',
  Starting = 'starting',
  Started = 'started',
  Stopping = 'stopping',
  Stopped = 'stopped',
  Failed = 'failed'
}

/**
 * Application lifecycle events
 */
export enum ApplicationEvent {
  Starting = 'starting',
  Started = 'started',
  Stopping = 'stopping',
  Stopped = 'stopped',
  Error = 'error',
  ModuleRegistered = 'module:registered',
  ModuleStarted = 'module:started',
  ModuleStopped = 'module:stopped',
  ConfigChanged = 'config:changed',
  HealthCheck = 'health:check',
  Signal = 'signal',
  UncaughtException = 'uncaughtException',
  UnhandledRejection = 'unhandledRejection',
  StateSave = 'state:save',
  ShutdownStart = 'shutdown:start',
  ShutdownComplete = 'shutdown:complete',
  ShutdownError = 'shutdown:error',
  ShutdownTaskComplete = 'shutdown:task:complete',
  ShutdownTaskError = 'shutdown:task:error',
  ProcessExit = 'process:exit',
  Custom = 'custom'
}

/**
 * Application configuration
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
 * Module metadata
 */
export interface IModuleMetadata {
  name: string;
  version?: string;
  dependencies?: Token<any>[];
  priority?: number;
}


/**
 * Health check status
 */
export interface IHealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  message?: string;
  modules?: Record<string, IHealthStatus>;
  details?: any;
}

/**
 * Module interface
 */
export interface IModule {
  readonly name: string;
  readonly version?: string;
  readonly dependencies?: (Token<any> | string)[];
  configure?(config: any): void;
  health?(): Promise<IHealthStatus>;
  onRegister?(app: IApplication): void | Promise<void>;
  onStart?(app: IApplication): void | Promise<void>;
  onStop?(app: IApplication): void | Promise<void>;
  onDestroy?(): void | Promise<void>;
}

/**
 * Application module base class
 */
export abstract class AbstractModule implements IModule {
  abstract readonly name: string;
  readonly version?: string;
  readonly dependencies?: (Token<any> | string)[] = [];

  async onRegister(app: IApplication): Promise<void> {
    // Default implementation - can be overridden
  }

  async onStart(app: IApplication): Promise<void> {
    // Default implementation - can be overridden
  }

  async onStop(app: IApplication): Promise<void> {
    // Default implementation - can be overridden
  }

  async onDestroy(): Promise<void> {
    // Default implementation - can be overridden
  }

  configure(config: any): void {
    // Default implementation - can be overridden
  }

  async health(): Promise<IHealthStatus> {
    // Default implementation
    return {
      status: 'healthy',
      message: `Module ${this.name} is healthy`
    };
  }
}

/**
 * Event handler type
 */
export type EventHandler<T = any> = (data: T, meta?: IEventMeta) => void | Promise<void>;

/**
 * Event metadata
 */
export interface IEventMeta {
  event: string;
  timestamp: number;
  source?: string;
  correlation?: string;
}

/**
 * Lifecycle hook
 */
export interface ILifecycleHook {
  name?: string;
  priority?: number;
  timeout?: number;
  handler: () => void | Promise<void>;
}

/**
 * Shutdown options
 */
export interface IShutdownOptions {
  timeout?: number;
  force?: boolean;
  graceful?: boolean;
  signal?: NodeJS.Signals;
}

/**
 * Application metrics
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
 * Application environment
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
 * Application options
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
 * Main application interface
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
 * Module constructor type
 */
export type ModuleConstructor<T extends IModule = IModule> = new (...args: any[]) => T;


/**
 * Dynamic module interface - for modules with providers
 */
export interface IDynamicModule extends IModule {
  module: ModuleConstructor;
  providers?: Array<Provider | [InjectionToken<any>, Provider]>;
  imports?: ModuleInput[];
  exports?: Token<any>[];
  global?: boolean;
}

/**
 * Module input types - supports various module definition patterns
 */
export type ModuleInput =
  | IModule                        // Module instance
  | ModuleConstructor             // Module class
  | IDynamicModule               // Dynamic module with providers
  | (() => IModule)                // Module factory function
  | (() => Promise<IModule>)       // Async module factory
  | (() => IDynamicModule)         // Dynamic module factory
  | (() => Promise<IDynamicModule>); // Async dynamic module factory

/**
 * Shutdown task definition
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
 * Reasons for shutdown
 */
export enum ShutdownReason {
  Manual = 'manual',
  SIGTERM = 'SIGTERM',
  SIGINT = 'SIGINT',
  SIGHUP = 'SIGHUP',
  Signal = 'signal',
  UncaughtException = 'uncaughtException',
  UnhandledRejection = 'unhandledRejection',
  Timeout = 'timeout',
  Error = 'error',
  Reload = 'reload',
  Upgrade = 'upgrade',
  Maintenance = 'maintenance',
}

/**
 * Process signals
 */
export type ProcessSignal =
  | 'SIGTERM'
  | 'SIGINT'
  | 'SIGHUP'
  | 'SIGUSR1'
  | 'SIGUSR2'
  | 'SIGQUIT'
  | 'SIGABRT';

/**
 * Shutdown priority levels
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
 * Lifecycle states
 */
export enum LifecycleState {
  Created = 'created',
  Initializing = 'initializing',
  Initialized = 'initialized',
  Starting = 'starting',
  Running = 'running',
  Stopping = 'stopping',
  Stopped = 'stopped',
  ShuttingDown = 'shuttingDown',
  Error = 'error',
}

/**
 * Process metrics
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
 * Lifecycle event
 */
export interface ILifecycleEvent {
  type: string;
  timestamp: number;
  data?: any;
}

/**
 * Event handler function type
 */
export type ApplicationEventHandler<T = unknown> = (data?: T) => void | Promise<void>;

/**
 * Configuration value type
 */
export type ConfigValue = string | number | boolean | null | undefined | ConfigObject | ConfigArray;

export interface ConfigObject {
  [key: string]: ConfigValue;
}

export interface ConfigArray extends Array<ConfigValue> { }

/**
 * Signal handler function type
 */
export type SignalHandler = (signal: NodeJS.Signals) => void | Promise<void>;

/**
 * Module configuration for dynamic modules
 */
export interface IDynamicModuleConfig {
  module: Token<IModule>;
  imports?: Array<Token<IModule>>;
  providers?: Provider[];
  exports?: Array<Token<unknown>>;
}

/**
 * Unhandled rejection handler
 */
export type RejectionHandler = (reason: unknown, promise: Promise<unknown>) => void;

/**
 * Module export type
 */
export type ModuleExport = { name: string } | { toString(): string } | string;

/**
 * Deep merge function options
 */
export interface DeepMergeOptions {
  arrayMerge?: 'replace' | 'concat' | 'merge';
}
