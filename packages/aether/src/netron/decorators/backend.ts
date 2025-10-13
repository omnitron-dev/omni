/**
 * @fileoverview Backend decorator for NetronService classes
 * @module @omnitron-dev/aether/netron
 */

import 'reflect-metadata';
import { NETRON_METADATA } from '../tokens.js';

/**
 * Decorator to specify which backend a service should use
 *
 * @param name - Name of the backend to use
 * @returns Class decorator
 *
 * @example
 * ```typescript
 * @Injectable()
 * @Backend('main')
 * class UserService extends NetronService<IUserService> {}
 * ```
 */
export function Backend(name: string): ClassDecorator {
  return (target: any) => {
    // Store backend name in metadata
    if (typeof Reflect !== 'undefined' && Reflect !== null && Reflect.defineMetadata) {
      Reflect.defineMetadata(NETRON_METADATA.BACKEND, name, target);
    } else {
      // Fallback to property storage
      (target as any).__netron_backend__ = name;
    }
    return target;
  };
}

/**
 * Get backend name from class
 *
 * @param target - Class constructor
 * @returns Backend name or 'main' as default
 */
export function getBackendName(target: any): string {
  // Handle null/undefined
  if (target == null) return 'main';

  if (typeof Reflect !== 'undefined' && Reflect !== null && Reflect.getOwnMetadata) {
    // Use getOwnMetadata to prevent inheritance
    const backend = Reflect.getOwnMetadata(NETRON_METADATA.BACKEND, target);
    if (backend !== undefined) return backend;
  }

  // Fallback to property
  if (target.__netron_backend__ !== undefined) {
    return target.__netron_backend__;
  }

  // Check prototype
  if (target.prototype?.__netron_backend__ !== undefined) {
    return target.prototype.__netron_backend__;
  }

  // Check constructor
  if (target.constructor?.__netron_backend__ !== undefined) {
    return target.constructor.__netron_backend__;
  }

  // Default to 'main'
  return 'main';
}