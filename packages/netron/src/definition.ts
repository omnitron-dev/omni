import { randomUUID } from 'node:crypto';

import { ServiceMetadata } from './types';

/**
 * The Definition class represents a service definition with a unique identifier, peer identifier, and metadata.
 */
export class Definition {
  // The parentId property is initialized to 0 and can be used to track hierarchical relationships
  public parentId: string = '';

  /**
   * Constructs a new Definition instance.
   * @param {string} id - The unique identifier for the definition.
   * @param {string} peerId - The identifier of the peer associated with the definition.
   * @param {ServiceMetadata} meta - The metadata describing the service.
   */
  constructor(
    public id: string,
    public peerId: string,
    public meta: ServiceMetadata
  ) { }

  /**
   * Generates the next unique identifier.
   * @returns {number} - The next unique identifier.
   */
  static nextId(): string {
    return randomUUID();
  }
}
