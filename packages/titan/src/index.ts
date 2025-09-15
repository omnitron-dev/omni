/**
 * @devgrid/titan - Enterprise Backend Framework
 * 
 * A next-generation backend framework built on Nexus DI container,
 * designed for building scalable, maintainable, and high-performance server applications.
 */

// Core exports
export * from './core/application';
export * from './core/types';
export * from './core/constants';

// Decorators
export * from './decorators';

// Router
export * from './router';

// Middleware
export * from './middleware';

// Platform adapters
export * from './platforms';

// Utilities
export * from './utils';

// Main factory function
export { createApplication, Titan } from './core/factory';