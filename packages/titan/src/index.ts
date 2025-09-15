/**
 * Titan - Minimal yet powerful application framework built on Nexus DI
 * 
 * @packageDocumentation
 */


import { createApp } from './application';

// Import types for internal use
import type { Module, IApplication } from './types';

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
  ApplicationToken
} from './application';

// Core Modules
export {
  FileSource,
  ConfigModule,
  ConfigSource,
  ObjectSource,
  IConfigModule,
  ConfigModuleToken,
  EnvironmentSource,
  createConfigModule
} from './modules/config.module';

export {
  Logger,
  LogLevel,
  Transport,
  LoggerModule,
  LogProcessor,
  ILoggerModule,
  LoggerOptions,
  ConsoleTransport,
  LoggerModuleToken,
  RedactionProcessor,
  createLoggerModule
} from './modules/logger.module';

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

// Core Types
export {
  Module,
  EventMeta,
  Environment,
  HealthStatus,
  EventHandler,
  ModuleFactory,
  LifecycleHook,
  ModuleMetadata,
  ModuleLifecycle,
  ShutdownOptions,
  ApplicationState,
  ApplicationEvent,
  ModuleDefinition,
  ApplicationConfig,
  ApplicationModule,
  ModuleConstructor,
  ApplicationOptions,
  ApplicationMetrics
} from './types';

/**
 * Quick start helper
 */
export async function createAndStartApp(options?: {
  name?: string;
  version?: string;
  config?: any;
  modules?: Module[];
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
  definition: Module & TService
): Module & TService {
  return definition;
}

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
  ERROR_HANDLING: true
} as const;