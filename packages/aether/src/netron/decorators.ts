/**
 * Temporary decorators types for compilation
 * These will be removed in Week 2 when server-side code is deleted
 *
 * Browser client does NOT publish services, so these are only for compilation
 */

import type { ServiceMetadata } from './types.js';

/**
 * Service annotation symbol for metadata storage
 * Used by Reflect.getMetadata to retrieve service metadata
 */
export const SERVICE_ANNOTATION = Symbol('service');

/**
 * Extended service metadata with transport information
 * This is a temporary type for compatibility
 */
export interface ExtendedServiceMetadata extends ServiceMetadata {
  /**
   * Internal transport instances (server-side only)
   * Not used in browser client
   */
  _transports?: any[];
}

/**
 * Stub decorators for compatibility
 * These are NOT functional in browser client - only for TypeScript compilation
 */

/**
 * Service decorator stub
 * @param _nameOrVersion - Service name or options
 */
export function Service(_nameOrVersion?: string | any): ClassDecorator {
  return (_target: any) => {
    // Stub - does nothing in browser
    console.warn('[Netron] Service decorator is not functional in browser client');
  };
}

/**
 * Public decorator stub
 */
export function Public(): MethodDecorator & PropertyDecorator {
  return (_target: any, _propertyKey: string | symbol, _descriptor?: PropertyDescriptor) => {
    // Stub - does nothing in browser
  };
}

/**
 * Method decorator stub
 * @param _options - Method options
 */
export function Method(_options?: any): MethodDecorator {
  return (_target: any, _propertyKey: string | symbol, _descriptor: PropertyDescriptor) => {
    // Stub - does nothing in browser
  };
}
