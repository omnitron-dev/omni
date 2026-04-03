/**
 * Type predicates for Netron framework.
 *
 * These predicates use runtime checks to determine object types
 * without creating circular dependencies.
 *
 * @since 0.1.0
 */

import { Reference } from './reference.js';
import { Definition } from './definition.js';
import { StreamReference } from './streams/index.js';

/**
 * Validates if the given object is an instance of the Definition class.
 * This predicate is crucial for service definition validation and type checking
 * in the Netron service architecture.
 *
 * @param {any} obj - The object to be checked for Definition instance membership
 * @returns {boolean} Returns true if the object is a Definition instance, false otherwise
 * @see Definition
 */
export const isServiceDefinition = (obj: any): obj is Definition => obj instanceof Definition;

/**
 * Verifies if the provided object is an instance of the Reference class.
 * This predicate function is used to identify service references in the Netron
 * distributed system architecture.
 *
 * @param {any} obj - The object to be evaluated for Reference instance membership
 * @returns {boolean} Returns true if the object is a Reference instance, false otherwise
 * @see Reference
 */
export const isServiceReference = (obj: any): obj is Reference => obj instanceof Reference;

/**
 * Validates if the provided object is an instance of the ServiceStub class.
 * This predicate function uses duck-typing to avoid circular dependencies.
 *
 * @param {any} obj - The object to be evaluated for ServiceStub instance membership
 * @returns {boolean} Returns true if the object looks like a ServiceStub, false otherwise
 */
export const isServiceStub = (obj: any): boolean =>
  // Duck-type check to avoid importing ServiceStub
  obj !== null &&
  typeof obj === 'object' &&
  'definition' in obj &&
  'peer' in obj &&
  'instance' in obj &&
  typeof obj.call === 'function' &&
  typeof obj.get === 'function' &&
  typeof obj.set === 'function';

/**
 * Validates if the given object is an instance of the StreamReference class.
 * This predicate function is used to identify stream references in the Netron
 * streaming system.
 *
 * @param {any} obj - The object to be checked for StreamReference instance membership
 * @returns {boolean} Returns true if the object is a StreamReference instance, false otherwise
 * @see StreamReference
 */
export const isNetronStreamReference = (obj: any): obj is StreamReference => obj instanceof StreamReference;

// ============================================================================
// Re-exports using dynamic imports to break circular dependencies
// ============================================================================

// Re-export utility predicates to break circular dependencies
// These predicates are used by interface.ts and other core files
export { isNetronStream } from './streams/index.js';
export { isNetronService } from './service-utils.js';

// ============================================================================
// Peer predicates - use duck-typing to avoid circular imports
// ============================================================================

/**
 * Checks if the given object is an instance of the AbstractPeer class.
 * Uses duck-typing to avoid circular dependencies.
 *
 * @param {any} obj - The object to be checked for AbstractPeer instance membership
 * @returns {boolean} Returns true if the object is an AbstractPeer instance, false otherwise
 */
export const isNetronPeer = (obj: any): boolean =>
  // Duck-type check to avoid importing AbstractPeer
  obj !== null &&
  typeof obj === 'object' &&
  'netron' in obj &&
  'id' in obj &&
  typeof obj.id === 'string' &&
  typeof obj.queryInterface === 'function' &&
  typeof obj.subscribe === 'function' &&
  typeof obj.unsubscribe === 'function';

/**
 * Determines whether the provided object is an instance of the LocalPeer class.
 * Uses duck-typing to avoid circular dependencies.
 *
 * @param {any} obj - The object to be evaluated for LocalPeer instance membership
 * @returns {boolean} Returns true if the object is a LocalPeer instance, false otherwise
 */
export const isNetronOwnPeer = (obj: any): boolean =>
  // Duck-type check - LocalPeer has stubs and serviceInstances
  isNetronPeer(obj) &&
  'stubs' in obj &&
  obj.stubs instanceof Map &&
  'serviceInstances' in obj &&
  obj.serviceInstances instanceof Map;
