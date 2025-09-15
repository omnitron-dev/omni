/**
 * Core types for Titan application framework
 */

import { Token, Container } from '@omnitron-dev/nexus';

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
export interface ApplicationConfig {
  name?: string;
  version?: string;
  environment?: string;
  debug?: boolean;
  [key: string]: any;
}

/**
 * Module metadata
 */
export interface ModuleMetadata {
  name: string;
  version?: string;
  dependencies?: Token<any>[];
  priority?: number;
}

/**
 * Module lifecycle hooks
 */
export interface ModuleLifecycle {
  onRegister?(app: IApplication): void | Promise<void>;
  onStart?(app: IApplication): void | Promise<void>;
  onStop?(app: IApplication): void | Promise<void>;
  onDestroy?(): void | Promise<void>;
}

/**
 * Health check status
 */
export interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  message?: string;
  details?: any;
}

/**
 * Module interface
 */
export interface Module extends ModuleLifecycle {
  readonly name: string;
  readonly version?: string;
  readonly dependencies?: Token<any>[];
  configure?(config: any): void;
  health?(): Promise<HealthStatus>;
}

/**
 * Application module base class
 */
export abstract class ApplicationModule implements Module {
  abstract readonly name: string;
  readonly version?: string;
  readonly dependencies?: Token<any>[] = [];

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

  async health(): Promise<HealthStatus> {
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
export type EventHandler<T = any> = (data: T, meta?: EventMeta) => void | Promise<void>;

/**
 * Event metadata
 */
export interface EventMeta {
  event: string;
  timestamp: number;
  source?: string;
  correlation?: string;
}

/**
 * Lifecycle hook
 */
export interface LifecycleHook {
  name?: string;
  priority?: number;
  timeout?: number;
  handler: () => void | Promise<void>;
}

/**
 * Shutdown options
 */
export interface ShutdownOptions {
  timeout?: number;
  force?: boolean;
  signal?: NodeJS.Signals;
}

/**
 * Application metrics
 */
export interface ApplicationMetrics {
  uptime: number;
  memoryUsage: NodeJS.MemoryUsage;
  cpuUsage?: NodeJS.CpuUsage;
  eventLoopUtilization?: any;
}

/**
 * Application environment
 */
export interface Environment {
  nodeVersion: string;
  platform: NodeJS.Platform;
  arch: string;
  hostname?: string;
  pid: number;
  ppid?: number;
}

/**
 * Module definition options
 */
export interface ModuleDefinition<T extends Module = Module> {
  name: string;
  version?: string;
  dependencies?: Token<any>[];
  providers?: any[];
  imports?: Token<Module>[];
  exports?: Token<any>[];
  onRegister?(app: IApplication): void | Promise<void>;
  onStart?(app: IApplication): void | Promise<void>;
  onStop?(app: IApplication): void | Promise<void>;
  onDestroy?(): void | Promise<void>;
  configure?(config: any): void;
  health?(): Promise<HealthStatus>;
}

/**
 * Application options
 */
export interface ApplicationOptions {
  name?: string;
  version?: string;
  container?: Container;
  config?: ApplicationConfig;
  debug?: boolean;
  gracefulShutdownTimeout?: number;
  disableCoreModules?: boolean; // Allow disabling automatic core module registration
  disableGracefulShutdown?: boolean; // Disable automatic graceful shutdown handlers (useful for tests)
}

/**
 * Main application interface
 */
export interface IApplication {
  // Lifecycle management
  start(): Promise<void>;
  stop(options?: ShutdownOptions): Promise<void>;
  restart(): Promise<void>;

  // Module management
  use<T extends Module>(module: T | Token<T>): this;
  get<T extends Module>(token: Token<T>): T;
  has(token: Token<any>): boolean;
  replaceModule<T extends Module>(token: Token<T>, module: T): this;

  // Configuration
  configure<T = any>(config: T): this;
  config<K extends keyof ApplicationConfig>(key: K): ApplicationConfig[K];

  // Event system
  on<E extends ApplicationEvent>(event: E, handler: EventHandler): void;
  off<E extends ApplicationEvent>(event: E, handler?: EventHandler): void;
  once<E extends ApplicationEvent>(event: E, handler: EventHandler): void;
  emit<E extends ApplicationEvent>(event: E, data?: any): void;

  // Lifecycle hooks
  onStart(hook: LifecycleHook | (() => void | Promise<void>)): this;
  onStop(hook: LifecycleHook | (() => void | Promise<void>)): this;
  onError(handler: (error: Error) => void): this;

  // Runtime information
  readonly state: ApplicationState;
  readonly uptime: number;
  readonly environment: Environment;
  readonly metrics: ApplicationMetrics;
  readonly container: Container;
}

/**
 * Module constructor type
 */
export type ModuleConstructor<T extends Module = Module> = new (...args: any[]) => T;

/**
 * Module factory function
 */
export type ModuleFactory<T extends Module = Module> = (app: IApplication) => T | Promise<T>;
