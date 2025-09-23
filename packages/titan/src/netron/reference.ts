/**
 * Represents a reference to a service definition within the Netron distributed system.
 * This class serves as a lightweight proxy that maintains a connection to a service
 * definition by its unique identifier. It is used extensively in the service discovery
 * and dependency injection mechanisms of the Netron framework.
 *
 * @class Reference
 * @description A service definition reference that enables dynamic service resolution
 * and late binding in the Netron service architecture.
 *
 * @example
 * // Creating a reference to a service definition
 * const serviceRef = new Reference('user-service-v1');
 *
 * @see ServiceStub
 * @see Definition
 */
export class Reference {
  /**
   * Creates a new instance of Reference.
   * The constructor initializes a reference to a service definition using its unique identifier.
   * This identifier is used by the Netron framework to locate and resolve the actual service
   * definition when needed.
   *
   * @param {string} defId - The unique identifier of the service definition.
   * This identifier must match the ID of an existing service definition in the Netron network.
   *
   * @throws {Error} If the provided defId is not a valid string or is empty.
   *
   * @example
   * // Creating a reference to a specific service
   * const authServiceRef = new Reference('authentication-service');
   */
  constructor(public defId: string) {
    if (!defId || typeof defId !== 'string') {
      throw new Error('Service definition ID must be a non-empty string');
    }
  }
}
