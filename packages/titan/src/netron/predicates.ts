import { Reference } from './reference.js';
import { Definition } from './definition.js';
import { ServiceStub } from './service-stub.js';
import { StreamReference } from './stream-reference.js';

/**
 * Validates if the given object is an instance of the Definition class.
 * This predicate is crucial for service definition validation and type checking
 * in the Netron service architecture.
 *
 * @param {any} obj - The object to be checked for Definition instance membership
 * @returns {boolean} Returns true if the object is a Definition instance, false otherwise
 * @see Definition
 */
export const isServiceDefinition = (obj: any) => obj instanceof Definition;

/**
 * Verifies if the provided object is an instance of the Reference class.
 * This predicate function is used to identify service references in the Netron
 * distributed system architecture.
 *
 * @param {any} obj - The object to be evaluated for Reference instance membership
 * @returns {boolean} Returns true if the object is a Reference instance, false otherwise
 * @see Reference
 */
export const isServiceReference = (obj: any) => obj instanceof Reference;

/**
 * Validates if the provided object is an instance of the ServiceStub class.
 * This predicate function is used to identify service stubs in the Netron
 * service proxy system.
 *
 * @param {any} obj - The object to be evaluated for ServiceStub instance membership
 * @returns {boolean} Returns true if the object is a ServiceStub instance, false otherwise
 * @see ServiceStub
 */
export const isServiceStub = (obj: any) => obj instanceof ServiceStub;

// isNetronService and isNetronStream moved to utility files to break circular dependencies
// They are re-exported below for backward compatibility

/**
 * Validates if the given object is an instance of the StreamReference class.
 * This predicate function is used to identify stream references in the Netron
 * streaming system.
 *
 * @param {any} obj - The object to be checked for StreamReference instance membership
 * @returns {boolean} Returns true if the object is a StreamReference instance, false otherwise
 * @see StreamReference
 */
export const isNetronStreamReference = (obj: any) => obj instanceof StreamReference;

// Re-export predicates from their source files to maintain API compatibility
// This avoids circular dependencies in the module graph
export { isNetronPeer } from './abstract-peer.js';
export { isNetronOwnPeer } from './local-peer.js';

// Re-export utility predicates to break circular dependencies
// These predicates are used by interface.ts and other core files
export { isNetronStream } from './stream-utils.js';
export { isNetronService } from './service-utils.js';
