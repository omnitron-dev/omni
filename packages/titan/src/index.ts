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
  createModule,
  createToken,
  defineModule,
  Application,
  APPLICATION_TOKEN as ApplicationToken,
  NETRON_TOKEN as NetronToken,
} from './application/index.js';

/**
 * @deprecated Use `Application` instead. This alias will be removed in a future version.
 */
export { Application as TitanApplication } from './application/index.js';

// ============================================================================
// Decorators and Core DI
// ============================================================================

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

export type { OnInit, OnDestroy } from './application/simple.js';

// ============================================================================
// Module Base Class (for testing and simple module creation)
// ============================================================================

/**
 * Base class for creating enhanced application modules
 * Provides common module patterns and lifecycle hooks
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

// Lifecycle interfaces - prefer OnInit/OnDestroy from simple.js
/**
 * @deprecated Use `OnInit` from the same import instead. Will be removed in future.
 */
export interface IOnInit {
  onInit?(): void | Promise<void>;
}

/**
 * @deprecated Use `OnDestroy` from the same import instead. Will be removed in future.
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
 * Application-level feature flags
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
 * @deprecated Use `APP_FEATURES` instead. Will be removed in future.
 */
export const FEATURES = APP_FEATURES;
