/**
 * Lifecycle Decorators
 *
 * Multiple methods per class are supported — every decorated method is added to
 * a metadata-stored list and invoked in declaration order by the container.
 *
 * @module decorators/lifecycle
 */

import 'reflect-metadata';
import { METADATA_KEYS } from './core.js';

const POST_CONSTRUCT_KEYS = [METADATA_KEYS.POST_CONSTRUCT, 'post-construct'] as const;
const PRE_DESTROY_KEYS = [METADATA_KEYS.PRE_DESTROY, 'pre-destroy'] as const;

function appendMethod(target: any, propertyKey: string, key: string) {
  // Reflect.getOwnMetadata avoids inheriting parent-class lists, which would
  // otherwise duplicate each registration up the prototype chain.
  const existing: string[] = Reflect.getOwnMetadata(key, target) ?? [];
  if (!existing.includes(propertyKey)) {
    existing.push(propertyKey);
  }
  Reflect.defineMetadata(key, existing, target);
}

/**
 * Mark a method to be called after construction.
 *
 * Multiple methods can be decorated on the same class; they are invoked in the
 * order they appear (declaration order). Methods may be sync or async.
 */
export function PostConstruct() {
  return function postConstructDecorator(target: any, propertyKey: string, descriptor?: PropertyDescriptor) {
    for (const key of POST_CONSTRUCT_KEYS) appendMethod(target, propertyKey, key);
    return descriptor;
  };
}

/**
 * Mark a method to be called before destruction.
 *
 * Multiple methods are supported; they are invoked in declaration order. A
 * thrown error in one hook is logged and does not prevent later hooks from
 * running, mirroring the behavior of `dispose()` in the container.
 */
export function PreDestroy() {
  return function preDestroyDecorator(target: any, propertyKey: string, descriptor?: PropertyDescriptor) {
    for (const key of PRE_DESTROY_KEYS) appendMethod(target, propertyKey, key);
    return descriptor;
  };
}
