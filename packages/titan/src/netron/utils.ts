import { ServiceMetadata } from './types.js';
import { SERVICE_ANNOTATION, ExtendedServiceMetadata } from '../decorators/core.js';

/**
 * Generates a standardized event name for service-related events.
 * This function creates a predictable naming pattern for service events
 * by prefixing the service name with 'svc:'.
 *
 * @param {string} serviceName - The name of the service to generate an event name for
 * @returns {string} A formatted event name in the format 'svc:serviceName'
 * @example
 * getServiceEventName('auth') // returns 'svc:auth'
 */
export const getServiceEventName = (serviceName: string) => `svc:${serviceName}`;

/**
 * Generates a standardized event name for peer-related events.
 * This function creates a predictable naming pattern for peer events
 * by prefixing the peer ID with 'peer:'.
 *
 * @param {string} peerId - The unique identifier of the peer
 * @returns {string} A formatted event name in the format 'peer:peerId'
 * @example
 * getPeerEventName('peer-123') // returns 'peer:peer-123'
 */
export const getPeerEventName = (peerId: string) => `peer:${peerId}`;

/**
 * Retrieves the service metadata associated with a service instance.
 * This function uses reflection to access metadata that was previously
 * attached to the service's constructor using decorators.
 *
 * @param {any} instance - The service instance to retrieve metadata for
 * @returns {ServiceMetadata} The metadata associated with the service
 * @throws {Error} If the metadata cannot be retrieved or is invalid
 */
export const getServiceMetadata = (instance: any): ExtendedServiceMetadata | undefined =>
  Reflect.getMetadata(SERVICE_ANNOTATION, instance.constructor) as ExtendedServiceMetadata;

/**
 * Constructs a qualified name by combining a base name with an optional version.
 * This function is used to create unique identifiers for services and other
 * components that support versioning.
 *
 * @param {string} name - The base name to qualify
 * @param {string} [version] - Optional version string to append
 * @returns {string} A qualified name in the format 'name' or 'name@version'
 * @example
 * getQualifiedName('auth', '1.0.0') // returns 'auth@1.0.0'
 * getQualifiedName('auth') // returns 'auth'
 */
export const getQualifiedName = (name: string, version?: string) => `${name}${version ? `@${version}` : ''}`;
