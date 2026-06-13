import type { ServiceMetadata } from './definition-types.js';
import { uuid } from './uuid.js';

/**
 * A service definition within Netron — its unique id, owning peer, and metadata
 * (name/version/methods/properties). The fundamental unit of service discovery,
 * registration, and remote invocation; marshalled across the wire, so the
 * server and the browser client share this one class.
 */
export class Definition {
  /**
   * Identifier of the parent definition when this service is part of a
   * hierarchy (enables service trees / composition). Empty when no parent.
   */
  public parentId: string = '';

  /**
   * @param id     Unique definition id — mint via {@link Definition.nextId}.
   * @param peerId Identifier of the peer that owns/provides this service.
   * @param meta   Service metadata (capabilities + interface).
   */
  constructor(
    public id: string,
    public peerId: string,
    public meta: ServiceMetadata,
  ) {}

  /**
   * Generate a fresh, time-ordered unique identifier (UUIDv7) for a definition.
   */
  static nextId(): string {
    return uuid();
  }
}
