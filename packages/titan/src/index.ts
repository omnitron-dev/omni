/**
 * Titan - Minimal yet powerful application framework built on Nexus DI
 *
 * @packageDocumentation
 */

// ============================================================================
// Core Application
// ============================================================================

export {
  startApp,
  createApp,
  Application,
  ApplicationToken,
  NetronToken,
  Application as TitanApplication
} from './application.js';

// Common utilities
export {
  defer,
  delay,
  retry,
  timeout
} from '@omnitron-dev/common';

// Nexus DI essentials
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
  createModule,
  Module as NexusModule  // Export Nexus Module with different name
} from './nexus/index.js';

// ============================================================================
// Helper Functions
// ============================================================================

import type { IModule, IApplication } from './types.js';
import { createApp } from './application.js';

/**
 * Quick start helper to create and start an application
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
 */
export function defineModule<TService = {}>(
  definition: IModule & TService
): IModule & TService {
  return definition;
}


// Lifecycle interfaces
export interface IOnInit {
  onInit?(): void | Promise<void>;
}

export interface IOnDestroy {
  onDestroy?(): void | Promise<void>;
}

// Process Lifecycle Types
export {
  type IShutdownTask,
  type IProcessMetrics,
  type ILifecycleEvent,
  type ProcessSignal,
  ShutdownReason,
  ShutdownPriority,
  LifecycleState
} from './types.js';

// Core Types
export {
  IModule,
  IEventMeta,
  IEnvironment,
  IApplication,
  IHealthStatus,
  ILifecycleHook,
  IModuleMetadata,
  IShutdownOptions,
  ApplicationState,
  ApplicationEvent,
  AbstractModule,
  ModuleConstructor,
  IApplicationConfig,
  IApplicationOptions,
  IApplicationMetrics
} from './types.js';


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
  ENHANCED_MODULES: true,
  DISCOVERY_MODULE: true
} as const;