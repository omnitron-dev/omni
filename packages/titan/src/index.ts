/**
 * Titan - Minimal yet powerful application framework built on Nexus DI
 *
 * @packageDocumentation
 *
 * ## API Stability Markers
 *
 * This package uses JSDoc annotations to indicate API stability:
 *
 * - `@stable` - Part of the public API, follows semantic versioning. Breaking changes only in major versions.
 * - `@experimental` - API may change in minor versions. Use with caution in production.
 * - `@internal` - Not intended for public use. May change without notice.
 * - `@deprecated` - Will be removed in a future version. Migration path is provided.
 *
 * @since 0.1.0
 */

// ============================================================================
// Core Application
// ============================================================================

/**
 * Core application exports including the main Application class and helper functions.
 *
 * @stable
 * @since 0.1.0
 */
export {
  startApp,
  createApp,
  createModule,
  createToken,
  defineModule,
  Application,
  APPLICATION_TOKEN as ApplicationToken,
  NETRON_TOKEN as NetronToken,
} from './application/index.js';

/**
 * Legacy alias for Application class.
 *
 * @deprecated Use `Application` instead. This alias will be removed in v1.0.0.
 * @since 0.1.0
 */
export { Application as TitanApplication } from './application/index.js';

// ============================================================================
// Decorators and Core DI
// ============================================================================

/**
 * Core dependency injection decorators for marking classes as injectable,
 * defining services, and configuring scopes.
 *
 * @stable
 * @since 0.1.0
 */
export {
  Service,
  Injectable,
  Inject,
  Optional,
  Singleton,
  Transient,
  Module,
  PostConstruct,
  PreDestroy,
} from './decorators/index.js';

// ============================================================================
// Lifecycle Interfaces
// ============================================================================

/**
 * Lifecycle hook interfaces for module and service initialization and cleanup.
 *
 * @stable
 * @since 0.1.0
 */
export type { OnInit, OnDestroy } from './application/simple.js';

// ============================================================================
// Module Base Class (for testing and simple module creation)
// ============================================================================

/**
 * Base class for creating enhanced application modules.
 * Provides common module patterns and lifecycle hooks.
 *
 * @stable
 * @since 0.1.0
 */
export class EnhancedApplicationModule {
  readonly name: string;
  readonly version?: string;
  readonly dependencies?: any[];
  readonly providers?: any[];
  readonly exports?: string[];

  constructor(config: {
    name: string;
    version?: string;
    dependencies?: any[];
    providers?: any[];
    exports?: string[];
  }) {
    this.name = config.name;
    this.version = config.version;
    this.dependencies = config.dependencies;
    this.providers = config.providers;
    this.exports = config.exports;
  }

  protected async onModuleStart?(): Promise<void>;
  protected async onModuleStop?(): Promise<void>;

  async onStart?(): Promise<void>;
  async onStop?(): Promise<void>;
  async onRegister?(): Promise<void>;
  async onDestroy?(): Promise<void>;
}

// ============================================================================
// Helper Functions
// ============================================================================

import type { IModule, IApplication } from './types.js';
import { createApp } from './application/index.js';

/**
 * Quick start helper to create and start an application in a single call.
 *
 * @stable
 * @since 0.1.0
 *
 * @param options - Configuration options for the application
 * @returns A promise that resolves to the started application instance
 *
 * @example
 * ```typescript
 * const app = await createAndStartApp({
 *   name: 'MyApp',
 *   modules: [MyModule]
 * });
 * ```
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
    config: options?.config,
  });

  if (options?.modules) {
    for (const module of options.modules) {
      app.use(module);
    }
  }

  await app.start();
  return app;
}

// defineModule is now exported from application module

/**
 * Legacy lifecycle interface for initialization.
 *
 * @deprecated Use `OnInit` from the same import instead. Will be removed in v1.0.0.
 * @since 0.1.0
 */
export interface IOnInit {
  onInit?(): void | Promise<void>;
}

/**
 * Legacy lifecycle interface for cleanup.
 *
 * @deprecated Use `OnDestroy` from the same import instead. Will be removed in v1.0.0.
 * @since 0.1.0
 */
export interface IOnDestroy {
  onDestroy?(): void | Promise<void>;
}

export * from './types.js';

// ============================================================================
// Built-in Modules
// ============================================================================
// DO NOT RE-EXPORT MODULES HERE!
// Modules should be imported directly via package.json exports:
// This ensures proper tree-shaking and avoids circular dependencies

/**
 * Application-level feature flags indicating available functionality.
 *
 * @stable
 * @since 0.1.0
 */
export const APP_FEATURES = {
  CONFIG_MODULE: true,
  LOGGER_MODULE: true,
  EVENT_SYSTEM: true,
  LIFECYCLE_HOOKS: true,
  GRACEFUL_SHUTDOWN: true,
  HEALTH_CHECKS: true,
  MODULE_DEPENDENCIES: true,
  ERROR_HANDLING: true,
  ENHANCED_MODULES: true,
  DISCOVERY_MODULE: true,
} as const;

/**
 * Legacy alias for APP_FEATURES.
 *
 * @deprecated Use `APP_FEATURES` instead. Will be removed in v1.0.0.
 * @since 0.1.0
 */
export const FEATURES = APP_FEATURES;
