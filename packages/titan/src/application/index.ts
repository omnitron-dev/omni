/**
 * Titan Application Layer
 *
 * This module provides the core application framework for Titan applications,
 * including the main Application class and simplified API functions.
 */

// Export main Application class and related types
export {
  Application,
  APPLICATION_TOKEN,
  NETRON_TOKEN,
  startApp,
  createApp
} from './application.js';

// Export simplified API
export {
  createModule,
  createToken,
  defineModule,
  titan,
  service,
  module,
  configure,
  env,
  inject,
  controller,
  Module,
  Injectable,
  Inject,
  type OnStart,
  type OnStop,
  type OnInit,
  type OnDestroy
} from './simple.js';

// Default export
export { default } from './simple.js';