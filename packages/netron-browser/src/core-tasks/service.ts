/**
 * Service Management Core Tasks
 *
 * Provides tasks for managing service exposure and references:
 * - unexpose_service: Remove a remote service proxy
 * - unref_service: Dereference a service definition
 *
 * These tasks are typically invoked by the server to notify clients
 * about service lifecycle changes.
 *
 * @module netron-browser/core-tasks/service
 */

/**
 * Core task names
 */
export const CORE_TASK_UNEXPOSE_SERVICE = 'unexpose_service';
export const CORE_TASK_UNREF_SERVICE = 'unref_service';
export const CORE_TASK_EXPOSE_SERVICE = 'expose_service';

/**
 * Interface for peers that can manage services
 */
export interface ServiceManagingPeer {
  services?: Map<string, any>;
  definitions?: Map<string, any>;
  invalidateDefinitionCache?(pattern?: string): number;
  clearDefinitionCache?(): number;
}

/**
 * Request type for unexpose_service
 */
export interface UnexposeServiceRequest {
  serviceName: string;
}

/**
 * Response type for unexpose_service
 */
export interface UnexposeServiceResponse {
  success: boolean;
  defId?: string;
}

/**
 * Request type for unref_service
 */
export interface UnrefServiceRequest {
  defId: string;
}

/**
 * Response type for unref_service
 */
export interface UnrefServiceResponse {
  success: boolean;
}

/**
 * Create an unexpose_service request
 */
export function createUnexposeServiceRequest(serviceName: string): UnexposeServiceRequest {
  return { serviceName };
}

/**
 * Check if response is a valid unexpose_service response
 */
export function isUnexposeServiceResponse(obj: unknown): obj is UnexposeServiceResponse {
  return obj !== null && typeof obj === 'object' && 'success' in obj && typeof (obj as any).success === 'boolean';
}

/**
 * Create an unref_service request
 */
export function createUnrefServiceRequest(defId: string): UnrefServiceRequest {
  return { defId };
}

/**
 * Check if response is a valid unref_service response
 */
export function isUnrefServiceResponse(obj: unknown): obj is UnrefServiceResponse {
  return obj !== null && typeof obj === 'object' && 'success' in obj && typeof (obj as any).success === 'boolean';
}

/**
 * Unexpose a service from the peer.
 *
 * Removes a service from the peer's service registry and invalidates
 * any cached definitions for that service.
 *
 * @param peer - The peer to unexpose the service from
 * @param serviceName - Name of the service to unexpose
 * @returns The definition ID of the removed service, or undefined if not found
 *
 * @example
 * ```typescript
 * // Server notifies client that service is no longer available
 * await peer.runTask('unexpose_service', 'userService@1.0.0');
 *
 * // Client's cached interface for this service is now invalid
 * ```
 */
export function unexpose_service(peer: ServiceManagingPeer, serviceName: string): string | undefined {
  const service = peer.services?.get(serviceName);
  if (!service) {
    return undefined;
  }

  const defId = service.definition?.id || service.id;

  // Remove from services registry
  peer.services?.delete(serviceName);

  // Remove from definitions if tracked separately
  if (defId && peer.definitions) {
    peer.definitions.delete(defId);
  }

  // Invalidate cached definitions for this service
  if (peer.invalidateDefinitionCache) {
    peer.invalidateDefinitionCache(serviceName);
  }

  return defId;
}

/**
 * Dereference a service definition.
 *
 * Removes a service definition from the peer's definition registry.
 * This is typically called when a nested service reference is no longer needed.
 *
 * @param peer - The peer to dereference the service from
 * @param defId - The definition ID to dereference
 *
 * @example
 * ```typescript
 * // Server notifies client that a definition is no longer valid
 * await peer.runTask('unref_service', '550e8400-e29b-41d4-a716-446655440000');
 * ```
 */
export function unref_service(peer: ServiceManagingPeer, defId: string): void {
  if (!defId) {
    return;
  }

  // Remove from definitions registry
  if (peer.definitions) {
    peer.definitions.delete(defId);
  }

  // Also check services for matching definition ID
  if (peer.services) {
    for (const [name, service] of peer.services) {
      if (service.definition?.id === defId || service.id === defId) {
        peer.services.delete(name);
        break;
      }
    }
  }
}

/**
 * Check if a service is exposed on the peer
 *
 * @param peer - The peer to check
 * @param serviceName - Name of the service to check
 * @returns true if the service is exposed
 */
export function isServiceExposed(peer: ServiceManagingPeer, serviceName: string): boolean {
  return peer.services?.has(serviceName) ?? false;
}

/**
 * Get all exposed service names
 *
 * @param peer - The peer to query
 * @returns Array of service names
 */
export function getExposedServiceNames(peer: ServiceManagingPeer): string[] {
  return peer.services ? Array.from(peer.services.keys()) : [];
}
