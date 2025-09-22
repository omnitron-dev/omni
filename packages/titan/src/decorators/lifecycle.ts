/**
 * Lifecycle Decorators
 *
 * @module decorators/lifecycle
 */

import 'reflect-metadata';
import { METADATA_KEYS } from './core.js';

/**
 * Mark a method to be called after construction
 */
export function PostConstruct() {
  return function (target: any, propertyKey: string, descriptor?: PropertyDescriptor) {
    Reflect.defineMetadata(METADATA_KEYS.POST_CONSTRUCT, propertyKey, target);
    Reflect.defineMetadata('post-construct', propertyKey, target);
    return descriptor;
  };
}

/**
 * Mark a method to be called before destruction
 */
export function PreDestroy() {
  return function (target: any, propertyKey: string, descriptor?: PropertyDescriptor) {
    Reflect.defineMetadata(METADATA_KEYS.PRE_DESTROY, propertyKey, target);
    Reflect.defineMetadata('pre-destroy', propertyKey, target);
    return descriptor;
  };
}