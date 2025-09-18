/**
 * Titan - Minimal yet powerful application framework built on Nexus DI
 * 
 * @packageDocumentation
 */


import { createApp } from './application.js';

// Import types for internal use
import type { IModule, IApplication } from './types.js';

// Re-export useful utilities from common
export {
  defer,
  delay,
  retry,
  timeout
} from '@omnitron-dev/common';

// Core Application
export {
  startApp,
  createApp,
  Application,
  ApplicationToken,
  Application as TitanApplication  // Alias for backward compatibility
} from './application.js';

// Enhanced Module System
export {
  Module as EnhancedModule,
  EnhancedApplicationModule,
  createModuleWithProviders,
  type IModuleMetadata as EnhancedModuleMetadata
} from './enhanced-module.js';

// Re-export essentials from Nexus
export {
  Token,
  Scope,
  Container,
  createToken,
  type Provider,
  type ClassProvider,
  type ValueProvider,
  type FactoryProvider,
  type DynamicModule,
  Global,
  Module as NexusModule,
  createModule as createNexusModule
} from '@omnitron-dev/nexus';


// Decorators
export {
  Log,
  Inject,
  OnEvent,
  Service,
  // Method interceptors
  Monitor,
  Timeout,

  Optional,
  OnceEvent,
  Singleton,
  RateLimit,
  Cacheable,
  Retryable,
  EmitEvent,
  OnAnyEvent,
  Injectable,
  Controller,
  Repository,

  PreDestroy,

  // Module decorator
  TitanModule,

  // Health check decorator
  HealthCheck,
  // Configuration decorators
  ConfigWatch,
  BatchEvents,
  // Lifecycle decorators
  AppLifecycle,
  ValidateArgs,
  // Event decorators
  EventEmitter,
  TimeoutError,
  OnModuleEvent,

  PostConstruct,
  ScheduleEvent,
  // Error classes
  RateLimitError,

  ValidationError,
  OnEvent as EventHandler,  // Alias for backward compatibility
  Module,
  Module as ModuleDecorator,  // Alias for backward compatibility

  // HTTP method decorators
  Get,
  Post,
  Put,
  Delete,
  Patch
} from './decorators.js';


/**
 * Quick start helper
 */
export async function createAndStartApp(options?: {
  name?: string;
  version?: string;
  config?: any;
  modules?: IModule[];
}): Promise<IApplication> {
  const app = createApp({
    name: options?.name,
    version: options?.version,
    config: options?.config
  });

  // Register additional modules
  if (options?.modules) {
    for (const module of options.modules) {
      app.use(module);
    }
  }

  await app.start();
  return app;
}

/**
 * Create a simple module with optional service methods
 * 
 * @template TService - Optional service interface for additional methods
 * @param definition - Module definition with lifecycle hooks and optional service methods
 * @returns Module instance with service methods
 * 
 * @example
 * // Simple module without service methods
 * const MyModule = defineModule({
 *   name: 'my-module',
 *   onStart(app) {
 *     console.log('Starting...');
 *   }
 * });
 * 
 * @example
 * // Module with service methods
 * interface MyService {
 *   doSomething(): void;
 * }
 * 
 * const MyModule = defineModule<MyService>({
 *   name: 'my-module',
 *   doSomething() {
 *     console.log('Doing something...');
 *   }
 * });
 */
export function defineModule<TService = {}>(
  definition: IModule & TService
): IModule & TService {
  return definition;
}

/**
 * Lifecycle interface markers
 */
export interface IOnInit {
  onInit?(): void | Promise<void>;
}

export interface IOnDestroy {
  onDestroy?(): void | Promise<void>;
}


// Process Lifecycle Module
export {
  ProcessLifecycleModule,
  ProcessLifecycleToken,
  onShutdown,
  // Types
  type IProcessLifecycleConfig,
  type IShutdownTask,
  type IProcessMetrics,
  type ILifecycleEvent,
  type IHealthCheckResult,
  type ILifecycleHook as IProcessLifecycleHook,
  type IProcessLifecycleManager,
  // Enums
  ShutdownReason,
  ShutdownPriority,
  LifecycleState,
  type ProcessSignal
} from './modules/process-lifecycle/index.js';

// Configuration Module
export {
  ConfigModule,
  ConfigService,
  ConfigModuleToken,
  ConfigServiceToken,
  Config,
  InjectConfig,
  ConfigSchema,
  config,  // Global config proxy for direct access
  type ConfigModuleOptions,
  type ConfigModuleAsyncOptions,
  type ConfigSource,
  type FileConfigSource,
  type EnvironmentConfigSource,
  type ObjectConfigSource,
  type RemoteConfigSource,
  type VaultConfigSource,
  type ConfigValidationResult,
  type ConfigChangeEvent,
  type ConfigMetadata,
  type TypedConfigAccessor,
  type IConfigProvider,
  type IConfigTransformer,
  type IConfigValidator,
  CONFIG_OPTIONS_TOKEN,
  CONFIG_SCHEMA_TOKEN,
  CONFIG_LOADER_TOKEN,
  CONFIG_VALIDATOR_TOKEN,
  CONFIG_DEFAULTS,
  // Utils
  createConfigToken,
  getValueByPath,
  setValueByPath,
  flattenObject,
  expandObject,
  detectEnvironment,
  findConfigFiles,
} from './modules/config/index.js';

// Core Types
export {
  IModule,
  IEventMeta,
  IEnvironment,
  IApplication,
  IHealthStatus,
  ModuleFactory,
  ILifecycleHook,
  IModuleMetadata,
  IModuleLifecycle,
  IShutdownOptions,
  ApplicationState,
  ApplicationEvent,
  IModuleDefinition,
  ApplicationModule,
  ModuleConstructor,
  // Backward compatibility aliases
  IApplicationConfig,
  IApplicationOptions,
  IApplicationMetrics,
  IEventMeta as EventMeta,
  IEnvironment as Environment,
  IHealthStatus as HealthStatus,
  ILifecycleHook as LifecycleHook,
  EventHandler as EventHandlerType,  // Rename to avoid conflict with decorator
  IModuleMetadata as ModuleMetadata,
  IShutdownOptions as ShutdownOptions,
  IModuleLifecycle as ModuleLifecycle,
  IModuleDefinition as ModuleDefinition,
  IApplicationConfig as ApplicationConfig,
  IApplicationOptions as ApplicationOptions,
  IApplicationMetrics as ApplicationMetrics
} from './types.js';

/**
 * Version information
 */
export const VERSION = '1.0.0';

/**
 * Feature flags
 */
export const FEATURES = {
  CONFIG_MODULE: true,
  LOGGER_MODULE: true,
  EVENT_SYSTEM: true,
  LIFECYCLE_HOOKS: true,
  GRACEFUL_SHUTDOWN: true,
  HEALTH_CHECKS: true,
  MODULE_DEPENDENCIES: true,
  ERROR_HANDLING: true,
  ENHANCED_MODULES: true
} as const;