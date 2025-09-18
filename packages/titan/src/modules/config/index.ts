/**
 * Configuration Module for Titan Framework
 *
 * Provides comprehensive configuration management with:
 * - Type-safe configuration schemas
 * - Multiple configuration sources (files, environment, objects)
 * - Automatic environment-based loading
 * - Hot-reload capabilities
 * - Dependency injection support
 * - Built-in validation with Zod
 */

export * from './config.module.js';
export * from './config.service.js';
export * from './config.decorator.js';
export * from './config.schema.js';
export * from './config.types.js';
export * from './config.loader.js';
export * from './config.utils.js';