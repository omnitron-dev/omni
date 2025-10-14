/**
 * Aether Testing Library
 *
 * Comprehensive testing utilities for Aether components
 *
 * Note: Custom matchers are not automatically imported to avoid bundling vitest.
 * Import them separately with: import '@omnitron-dev/aether/testing/matchers'
 */

export { render, cleanup } from './render.js';
export { fireEvent } from './events.js';
export { userEvent } from './user-event.js';
export { waitFor, waitForElementToBeRemoved, act } from './async.js';
export { renderHook } from './hooks.js';
export * from './types.js';
