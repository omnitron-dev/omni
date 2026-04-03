/**
 * Netron types and interfaces
 *
 * This file re-exports all type definitions from the interfaces directory
 * and adds any additional types that depend on classes.
 *
 * For pure type definitions without class dependencies, see ./interfaces/core-types.ts
 */

// Re-export all pure types from interfaces
export type {
  // Service metadata types
  ArgumentInfo,
  MethodInfo,
  PropertyInfo,
  ServiceMetadata,
  ServiceContract,
  ServiceMetadataWithContract,
  ServiceMetadataExtended,
  // Event types
  EventSubscriber,
  // Definition interface
  IDefinition,
  // Transport interfaces
  ITransportServer,
  ITransportConnection,
  // Auth interfaces
  IAuthContext,
  IAuthorizationManager,
  // Peer interfaces
  IPeer,
  ILocalPeer,
  IRemotePeer,
  // Netron interface
  INetron,
  // Configuration types
  TransportConfig,
  INetronOptions,
  // Event types
  ServiceExposeEvent,
  ServiceUnexposeEvent,
  PeerConnectEvent,
  PeerDisconnectEvent,
  // Socket interface
  RemotePeerSocket,
  // Extended types
  ITransportServerWithServices,
  NetronOptionsExtended,
} from './interfaces/core-types.js';

// Import Definition class for backward compatibility
// NOTE: This import uses `import type` to avoid circular dependency
import type { Definition } from './definition.js';

// Import AuthContext for backward compatibility
import type { AuthContext } from './auth/types.js';

// ============================================================================
// Primary Type Aliases
// ============================================================================

/**
 * NetronOptions type alias - uses INetronOptions from interfaces
 */
export type { INetronOptions as NetronOptions } from './interfaces/core-types.js';

// ============================================================================
// Types that depend on Definition class
// (These are kept here for backward compatibility but use type-only imports)
// ============================================================================

/**
 * Event type emitted when a service is exposed.
 * Contains information about the exposed service and the peers involved.
 *
 * NOTE: This type uses the Definition class type. For pure interface-based
 * types, use ServiceExposeEvent from './interfaces/core-types.js'
 */
export type ServiceExposeEventWithDefinition = {
  /**
   * The name of the exposed service.
   */
  name: string;

  /**
   * The version of the exposed service.
   */
  version: string;

  /**
   * The qualified name of the service (name:version).
   */
  qualifiedName: string;

  /**
   * The ID of the peer exposing the service.
   */
  peerId: string;

  /**
   * The ID of the remote peer, if applicable.
   */
  remotePeerId?: string;

  /**
   * The service definition object.
   */
  definition: Definition;
};

// ============================================================================
// Re-export IAuthorizationManager with AuthContext for backward compatibility
// ============================================================================

/**
 * Interface for Authorization Manager used in INetron.
 * This version uses the AuthContext type from the auth module.
 * @internal
 */
export interface IAuthorizationManagerWithAuthContext {
  /** Check if user can access a service */
  canAccessService(serviceName: string, auth?: AuthContext): boolean;
  /** Filter a service definition based on user permissions */
  filterDefinition(
    serviceName: string,
    definition: import('./interfaces/core-types.js').ServiceMetadata,
    auth?: AuthContext
  ): import('./interfaces/core-types.js').ServiceMetadata | null;
}
