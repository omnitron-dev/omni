import { randomUUID } from 'node:crypto';

import { ServiceMetadata } from './types';

/**
 * The Definition class represents a service definition within the Netron framework.
 * It encapsulates all necessary information about a service, including its unique identifier,
 * associated peer, and comprehensive metadata. This class serves as a fundamental building block
 * for service discovery, registration, and communication within the Netron ecosystem.
 * 
 * @class Definition
 * @property {string} parentId - Optional identifier of a parent service definition, used for
 *                              establishing hierarchical relationships between services.
 *                              Defaults to an empty string when no parent is specified.
 * @property {string} id - The unique identifier of this service definition, generated using
 *                        cryptographically secure random UUID generation.
 * @property {string} peerId - The identifier of the peer that owns or provides this service.
 * @property {ServiceMetadata} meta - Detailed metadata describing the service's capabilities,
 *                                   including its name, version, available methods, and properties.
 */
export class Definition {
  /**
   * The identifier of the parent service definition, if this service is part of a hierarchy.
   * This property enables the creation of service trees and facilitates service composition.
   * 
   * @type {string}
   * @default ''
   */
  public parentId: string = '';

  /**
   * Constructs a new Definition instance with the specified parameters.
   * 
   * @param {string} id - A unique identifier for the service definition. This should be
   *                      generated using the static nextId() method to ensure uniqueness.
   * @param {string} peerId - The identifier of the peer that owns or provides this service.
   *                          This links the service to its provider in the network.
   * @param {ServiceMetadata} meta - The service metadata object containing detailed
   *                                information about the service's capabilities and interface.
   * @throws {Error} If the provided id is not a valid UUID or if the metadata is incomplete.
   */
  constructor(
    public id: string,
    public peerId: string,
    public meta: ServiceMetadata
  ) { }

  /**
   * Generates a new cryptographically secure unique identifier using the Node.js crypto module.
   * This method uses the randomUUID() function to create a version 4 UUID that is suitable
   * for use as a service definition identifier.
   * 
   * @static
   * @returns {string} A new UUID v4 string that can be used as a unique identifier.
   * @example
   * const newId = Definition.nextId();
   * // Returns something like: '123e4567-e89b-12d3-a456-426614174000'
   */
  static nextId(): string {
    return randomUUID();
  }
}
