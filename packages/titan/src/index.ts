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
