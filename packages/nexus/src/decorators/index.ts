/**
 * Decorator support for Nexus DI Container
 * 
 * @module decorators
 * @packageDocumentation
 * 
 * This module provides decorator-based dependency injection for Nexus.
 * It requires reflect-metadata to be imported before use.
 * 
 * @example
 * ```typescript
 * // Import reflect-metadata first
 * import 'reflect-metadata';
 * import { Injectable, Inject } from '@omnitron-dev/nexus/decorators';
 * 
 * @Injectable()
 * class UserService {
 *   constructor(@Inject(DatabaseToken) private db: Database) {}
 * }
 * ```
 */

export * from './decorators';