/**
 * Query Interface core-task for Netron
 * Handles service discovery with authorization checks
 */

import semver from 'semver';
import type { RemotePeer } from '../remote-peer.js';
import type { Definition } from '../definition.js';
import type { ServiceStub } from '../service-stub.js';
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
export async function query_interface(peer: RemotePeer, serviceName: string): Promise<Definition | null> {
  // Get the Netron services registry
  // netron.services is Map<string, ServiceStub> where key is qualified name
  const servicesMap = peer.netron.services as Map<string, ServiceStub>;

  // Find the requested service stub
  // Support wildcard version lookup (e.g., 'mathService' should find 'mathService@1.0.0')
  let serviceStub = servicesMap.get(serviceName);

  // If not found with exact match, try wildcard version resolution
  if (!serviceStub && !serviceName.includes('@')) {
    // Find all services matching the name pattern
    const regex = new RegExp(`^${serviceName}@([^@]+)$`);
    const candidates = Array.from(servicesMap.keys())
      .map((key) => {
        const match = key.match(regex);
        if (match) return { version: match[1], key };
        return null;
      })
      .filter((item): item is { version: string; key: string } => item !== null);

    if (candidates.length > 0) {
      // T#41: sort by semver (descending) and pick the latest.
      // The historical `localeCompare` was a lexical string sort that
      // ranked "9.0.0" above "10.0.0" because the first character
      // '9' > '1'. Once a service crossed major version 10 the
      // wildcard resolution silently kept routing to the legacy
      // 9.x build. `semver.rcompare` is the standard descending
      // semver comparator and already used by `AbstractPeer`'s
      // sibling lookup path — keep the two consistent.
      candidates.sort((a, b) => semver.rcompare(a.version, b.version));
      const latestKey = candidates[0]!.key;
      serviceStub = servicesMap.get(latestKey);

      peer.logger.debug(
        { serviceName, resolvedTo: latestKey, candidateCount: candidates.length },
        'Resolved service name to latest version'
      );
    }
  }

  if (!serviceStub) {
    // Log available services at warn level for diagnostics
    const availableKeys = Array.from(servicesMap.keys());
    peer.logger.warn(
      { serviceName, availableServices: availableKeys, mapSize: servicesMap.size },
      'query_interface: service not found in registry'
    );

    throw new TitanError({
      code: ErrorCode.NOT_FOUND,
      message: `Service '${serviceName}' not found`,
      details: {
        serviceName,
      },
    });
  }

  // Get definition from stub
  const definition = serviceStub.definition;

  // Get AuthorizationManager from Netron
  const authzManager = peer.netron.authorizationManager;

  // If no authorization manager configured, return full definition
  if (!authzManager) {
    peer.logger.debug({ serviceName }, 'No authorization configured, returning full definition');
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
      'Access denied to service'
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
  const filteredMeta = authzManager.filterDefinition(serviceName, definition.meta, authContext);

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
    'Service interface queried successfully'
  );

  // Return a new Definition with filtered metadata
  return {
    ...definition,
    meta: filteredMeta,
  };
}
