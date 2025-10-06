/**
 * Primitive Utilities
 *
 * Shared utilities for UI primitives
 */

// ID generation
export { generateId, useId, createIdGenerator } from './id.js';

// Focus management
export {
  getFocusableElements,
  getFocusableBounds,
  focusFirst,
  saveFocus,
  restoreFocus,
  trapFocus,
} from './focus.js';

// Scroll lock
export {
  disableBodyScroll,
  enableBodyScroll,
  isBodyScrollLocked,
  forceUnlockBodyScroll,
} from './scroll-lock.js';
