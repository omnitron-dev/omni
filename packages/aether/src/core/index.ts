/**
 * Aether Core Module
 *
 * Core reactivity system, component architecture, and runtime utilities
 */

// Re-export everything from reactivity
export * from './reactivity/index.js';

// Re-export everything from component system
export * from './component/index.js';

// Application bootstrap
export {
  createApp,
  mount,
  quickStart,
  createTestApp,
  getApp,
  setApp,
} from './application.js';
export type { Application, ApplicationConfig } from './application.js';
