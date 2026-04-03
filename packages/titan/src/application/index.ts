/**
 * Titan Application Layer
 *
 * This module provides the core application framework for Titan applications,
 * including the main Application class and simplified API functions.
 */

// Export main Application class and related types
export { Application, APPLICATION_TOKEN, NETRON_TOKEN, startApp, createApp } from './application.js';

// Export application-related types from types.ts for narrow imports
export type { IApplicationConfig, IApplicationOptions, IApplication, IModuleMetadata } from '../types.js';

// Export enums (re-export as values, not types)
export { ApplicationState, ApplicationEvent } from '../types.js';

// Export simplified API
export {
  createModule,
  createToken,
  defineModule,
  titan,
  service,
  module,
  inject,
  Module,
  Injectable,
  Inject,
  type OnStart,
  type OnStop,
  type OnInit,
  type OnDestroy,
} from './simple.js';

// Default export
export { default } from './simple.js';
