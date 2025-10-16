/**
 * DevTools for Development
 *
 * Re-exports all devtools functionality for use in development mode
 * This provides a consistent path for dev-related tools
 */

// Re-export everything from devtools
export * from '../devtools/index.js';

// Also export dev-specific error overlay
export {
  ErrorOverlay,
  initErrorOverlay,
  getErrorOverlay,
  showError,
  hideError,
} from './error/index.js';
