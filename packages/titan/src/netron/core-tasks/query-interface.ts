/**
 * Query Interface core-task for Netron
 * Handles service discovery with authorization checks
 */

import type { RemotePeer } from '../remote-peer.js';
import type { Definition } from '../definition.js';
import { TitanError, ErrorCode } from '../../errors/index.js';

/**
 * Query interface of a service with authorization checks
 *
 * This core-task:
 * 1. Finds the requested service in the local registry
 * 2. Checks if the requesting peer has authorization to access it
 * 3. Filters the service definition based on user permissions
 * 4. Returns the filtered definition
 *
 * @param peer - The remote peer requesting the service interface
 * @param serviceName - Qualified service name (name@version)
 * @returns Service definition filtered by user permissions
 *
 * @throws {TitanError} When service not found, authorization fails, or auth not configured
 *
 * @example
 * // Query a service interface
 * const definition = await peer.runTask('query_interface', 'userService@1.0.0');
 *
 * @example
 * // Returns filtered definition based on user's roles/permissions
 * // If user lacks permissions for some methods, those methods are excluded
 */
export async function query_interface(
  peer: RemotePeer,
  serviceName: string,
): Promise<Definition | null> {
  // Get the local peer's services registry
  // netron.services is Map<string, ServiceStub> where key is qualified name
  const servicesMap = peer.netron.services;

  // Find the requested service stub
  const serviceStub = servicesMap.get(serviceName);

  if (!serviceStub) {
    throw new TitanError({
      code: ErrorCode.NOT_FOUND,
      message: `Service '${serviceName}' not found`,
      details: {
        serviceName,
        availableServices: Array.from(servicesMap.keys()),
      },
    });
  }

  // Get definition from stub
  const definition = serviceStub.definition;

  // Get AuthorizationManager from Netron
  const authzManager = (peer.netron as any).authorizationManager;

  // If no authorization manager configured, return full definition
  if (!authzManager) {
    peer.logger.debug(
      { serviceName },
      'No authorization configured, returning full definition',
    );
    return definition;
  }

  // Get auth context from peer
  const authContext = peer.getAuthContext();

  // Check if user has access to the service
  const canAccess = authzManager.canAccessService(serviceName, authContext);

  if (!canAccess) {
    peer.logger.warn(
      {
        serviceName,
        userId: authContext?.userId,
        roles: authContext?.roles,
      },
      'Access denied to service',
    );

    throw new TitanError({
      code: ErrorCode.FORBIDDEN,
      message: `Access denied to service '${serviceName}'`,
      details: {
        serviceName,
        reason: 'User lacks required roles or permissions',
      },
    });
  }

  // Filter the definition based on user permissions
  const filteredMeta = authzManager.filterDefinition(
    serviceName,
    definition.meta,
    authContext,
  );

  // If filtering resulted in null (no access at all), throw error
  if (filteredMeta === null) {
    throw new TitanError({
      code: ErrorCode.FORBIDDEN,
      message: `Access denied to service '${serviceName}'`,
      details: {
        serviceName,
        reason: 'User has no access to any methods',
      },
    });
  }

  peer.logger.info(
    {
      serviceName,
      userId: authContext?.userId,
      methodCount: Object.keys(filteredMeta.methods || {}).length,
      originalMethodCount: Object.keys(definition.meta.methods || {}).length,
    },
    'Service interface queried successfully',
  );

  // Return a new Definition with filtered metadata
  return {
    ...definition,
    meta: filteredMeta,
  };
}
