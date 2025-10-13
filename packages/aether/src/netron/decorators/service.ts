/**
 * @fileoverview Service decorator for NetronService classes
 * @module @omnitron-dev/aether/netron
 */

import 'reflect-metadata';
import { NETRON_METADATA } from '../tokens.js';

/**
 * Decorator to specify the service name for RPC
 *
 * @param name - Service name (e.g., 'users', 'users@1.0.0')
 * @returns Class decorator
 *
 * @example
 * ```typescript
 * @Injectable()
 * @Service('users@1.0.0')
 * class UserService extends NetronService<IUserService> {}
 * ```
 */
export function Service(name: string): ClassDecorator {
  return (target: any) => {
    // Store service name in metadata
    if (typeof Reflect !== 'undefined' && Reflect !== null && Reflect.defineMetadata) {
      Reflect.defineMetadata(NETRON_METADATA.SERVICE, name, target);
    } else {
      // Fallback to property storage
      (target as any).__netron_service__ = name;
    }
    return target;
  };
}

/**
 * Get service name from class
 *
 * @param target - Class constructor
 * @returns Service name or derived from class name
 */
export function getServiceName(target: any): string {
  // Handle null/undefined
  if (target == null) return 'unknown';

  // Check for explicit metadata (use getOwnMetadata to prevent inheritance)
  if (typeof Reflect !== 'undefined' && Reflect !== null && Reflect.getOwnMetadata) {
    const service = Reflect.getOwnMetadata(NETRON_METADATA.SERVICE, target);
    if (service !== undefined) return service;
  }

  // Fallback to property
  if (target.__netron_service__ !== undefined) {
    return target.__netron_service__;
  }

  // Check prototype
  if (target.prototype?.__netron_service__ !== undefined) {
    return target.prototype.__netron_service__;
  }

  // Check constructor
  if (target.constructor?.__netron_service__ !== undefined) {
    return target.constructor.__netron_service__;
  }

  // Extract from class name (UserService → users)
  const className = target.name || target.constructor?.name;
  if (!className || className === 'Object') return 'unknown';

  // Convert PascalCase to kebab-case and remove "Service" and/or "Store" suffixes
  // Remove both suffixes in one pass to handle cases like "UserServiceStore"
  return className
    .replace(/(Service)?(Store)?$/, '')
    .replace(/([A-Z])/g, (_match: string, p1: string, offset: number) =>
      offset > 0 ? '-' + p1.toLowerCase() : p1.toLowerCase()
    );
}
