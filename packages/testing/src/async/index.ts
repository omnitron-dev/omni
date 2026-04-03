/**
 * Async testing utilities
 *
 * This module provides comprehensive utilities for testing asynchronous code,
 * including promises, events, timers, and retry logic.
 *
 * @module async
 */

// Deferred promises
export { DeferredPromise, createDeferred, defer, type Deferred } from './deferred.js';

// Retry and timeout
export { retry, withTimeout, type RetryOptions } from './retry.js';

// Wait utilities
export { waitFor, waitForCondition, delay, nextTick, flushPromises, type WaitOptions } from './wait.js';

// Event utilities
export { EventListenerTracker, EventCollector, waitForEvents, collectEvents, createEventSpy } from './events.js';

// Mock timers
export { MockTimerController, createMockTimer } from './mock-timer.js';
