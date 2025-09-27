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
  APPLICATION_TOKEN as ApplicationToken,
  NETRON_TOKEN as NetronToken,
  Application as TitanApplication
} from './application.js';

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

export * from './types.js';

// ============================================================================
// Built-in Modules
// ============================================================================
// DO NOT RE-EXPORT MODULES HERE!
// Modules should be imported directly via package.json exports:
// This ensures proper tree-shaking and avoids circular dependencies

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