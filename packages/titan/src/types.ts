/**
 * Core types for Titan application framework
 */

import { Token, Container, Provider, type InjectionToken } from '@omnitron-dev/nexus';

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
export type ApplicationEvent =
  | 'starting'
  | 'started'
  | 'stopping'
  | 'stopped'
  | 'error'
  | 'module:registered'
  | 'module:started'
  | 'module:stopped'
  | 'config:changed'
  | 'health:check';

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
 * Module lifecycle hooks
 */
export interface IModuleLifecycle {
  onRegister?(app: IApplication): void | Promise<void>;
  onStart?(app: IApplication): void | Promise<void>;
  onStop?(app: IApplication): void | Promise<void>;
  onDestroy?(): void | Promise<void>;
}

/**
 * Health check status
 */
export interface IHealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  message?: string;
  details?: any;
}

/**
 * Module interface
 */
export interface IModule extends IModuleLifecycle {
  readonly name: string;
  readonly version?: string;
  readonly dependencies?: (Token<any> | string)[];
  configure?(config: any): void;
  health?(): Promise<IHealthStatus>;
}

/**
 * Application module base class
 */
export abstract class ApplicationModule implements IModule {
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

