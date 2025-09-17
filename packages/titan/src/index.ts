/**
 * Titan - Minimal yet powerful application framework built on Nexus DI
 * 
 * @packageDocumentation
 */


import { createApp } from './application.js';
// Import ConfigModuleToken for ConfigValue decorator
import { ConfigModuleToken } from './modules/config.module.js';

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
  Module as NexusModule,
  createModule as createNexusModule
} from '@omnitron-dev/nexus';

// Core Modules
export {
  IFileSource,
  ConfigModule,
  ConfigSource,
  IObjectSource,
  IConfigModule,
  ConfigModuleToken,
  IEnvironmentSource,
  createConfigModule,
  // Backward compatibility aliases
  IFileSource as FileSource,
  IObjectSource as ObjectSource,
  IEnvironmentSource as EnvironmentSource
} from './modules/config.module.js';

export {
  ILogger,
  LogLevel,
  ITransport,
  LoggerModule,
  ILogProcessor,
  ILoggerModule,
  ILoggerOptions,
  ConsoleTransport,
  LoggerModuleToken,
  // Backward compatibility aliases
  ILogger as Logger,
  RedactionProcessor,
  createLoggerModule,
  ITransport as Transport,
  ILogger as LoggerService,  // Alias for service usage
  ILogProcessor as LogProcessor,
  ILoggerOptions as LoggerOptions
} from './modules/logger.module.js';

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
  Module as ModuleDecorator
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

/**
 * Config value decorator function
 */
export function ConfigValue(path: string): PropertyDecorator {
  return function (target: any, propertyKey: string | symbol) {
    // This will be replaced at runtime by dependency injection
    let value: any;
    Object.defineProperty(target, propertyKey, {
      get() {
        if (value === undefined) {
          // Get from DI container
          const container = (this as any).__container;
          if (container?.has(ConfigModuleToken)) {
            const config = container.get(ConfigModuleToken);
            value = config.get(path);
          }
        }
        return value;
      },
      set(newValue) {
        value = newValue;
      },
      enumerable: true,
      configurable: true
    });
  };
}

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
  IModule as Module,
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