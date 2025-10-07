/**
 * Service utility functions
 * This file contains predicates for service type checking
 * Separated to avoid circular dependencies
 */

import { SERVICE_ANNOTATION } from './decorators.js';

/**
 * Determines if an object is a Netron service
 * Checks for the presence of SERVICE_ANNOTATION metadata
 *
 * @param obj - The object to check
 * @returns true if the object is a Netron service
 */
export const isNetronService = (obj: any): boolean => {
  if (obj && typeof obj === 'object' && obj.constructor) {
    return Reflect.hasMetadata(SERVICE_ANNOTATION, obj.constructor);
  }
  return false;
};
