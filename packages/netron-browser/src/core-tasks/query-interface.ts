/**
 * Query Interface core-task for Netron Browser Client
 * Handles auth-aware service discovery with permission filtering
 *
 * This implementation is adapted from Titan's server-side version but designed
 * for client-side use with browser-compatible features.
 */

import type { Definition } from '../core/definition.js';
import type { ServiceMetadata } from '../core/types.js';
import { TitanError, ErrorCode } from '../errors/index.js';

/**
 * Query interface request
 *
 * @property serviceName - Qualified service name (name@version or name for wildcard)
 */
export interface QueryInterfaceRequest {
  serviceName: string;
}

/**
 * Query interface response
 *
 * @property definition - Service definition (filtered by permissions if auth-aware)
 * @property filtered - Whether the definition was filtered based on permissions
 * @property resolvedName - Actual service name resolved (useful for wildcard queries)
 */
export interface QueryInterfaceResponse {
  definition: Definition;
  filtered?: boolean;
  resolvedName?: string;
}

/**
 * Core task name constant
 */
export const CORE_TASK_QUERY_INTERFACE = 'query_interface';

/**
 * Create a query interface request
 *
 * @param serviceName - Service name (with or without version)
 * @returns QueryInterfaceRequest object
 *
 * @example
 * ```typescript
 * // Query specific version
 * const request = createQueryInterfaceRequest('UserService@1.0.0');
 *
 * // Query latest version
 * const request = createQueryInterfaceRequest('UserService');
 * ```
 */
export function createQueryInterfaceRequest(serviceName: string): QueryInterfaceRequest {
  return { serviceName };
}

/**
 * Type guard for QueryInterfaceResponse
 *
 * @param obj - Object to check
 * @returns True if object is a valid QueryInterfaceResponse
 */
export function isQueryInterfaceResponse(obj: any): obj is QueryInterfaceResponse {
  return (
    obj &&
    typeof obj === 'object' &&
    'definition' in obj &&
    obj.definition &&
    typeof obj.definition === 'object' &&
    'id' in obj.definition &&
    'peerId' in obj.definition &&
    'meta' in obj.definition
  );
}

/**
 * Version comparison helper for browser (simplified semver)
 *
 * @param v1 - First version
 * @param v2 - Second version
 * @returns Comparison result (-1, 0, 1)
 */
function compareSemver(v1: string, v2: string): number {
  const parts1 = v1.split('.').map(Number);
  const parts2 = v2.split('.').map(Number);

  for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
    const p1 = parts1[i] || 0;
    const p2 = parts2[i] || 0;

    if (p1 > p2) return 1;
    if (p1 < p2) return -1;
  }

  return 0;
}

/**
 * Resolve service name with version wildcard support
 *
 * Supports:
 * - Exact match: 'UserService@1.0.0' → 'UserService@1.0.0'
 * - Wildcard: 'UserService' → 'UserService@latest'
 * - Latest version selection
 *
 * @param serviceName - Service name (with or without version)
 * @param availableServices - Map of available service names
 * @returns Resolved service name
 * @throws TitanError if service not found
 */
export function resolveServiceName(serviceName: string, availableServices: Map<string, any>): string {
  // Check for exact match first
  if (availableServices.has(serviceName)) {
    return serviceName;
  }

  // If no @ symbol, try wildcard version resolution
  if (!serviceName.includes('@')) {
    const regex = new RegExp(`^${serviceName}@([^@]+)$`);
    const candidates = Array.from(availableServices.keys())
      .map((key) => {
        const match = key.match(regex);
        if (match) return { version: match[1]!, key };
        return null;
      })
      .filter((item): item is { version: string; key: string } => item !== null)
      .sort((a, b) => compareSemver(b.version, a.version));

    if (candidates.length > 0) {
      return candidates[0]!.key;
    }
  }

  throw new TitanError({
    code: ErrorCode.NOT_FOUND,
    message: `Service '${serviceName}' not found`,
    details: { serviceName },
  });
}

/**
 * Filter service definition based on permissions
 *
 * This is a placeholder for client-side filtering logic.
 * In practice, the server should perform filtering and return filtered definitions.
 * This function is here for future client-side validation or mock scenarios.
 *
 * @param definition - Original service definition
 * @param authContext - Authentication context (if available)
 * @returns Filtered service metadata
 */
export function filterDefinition(
  definition: ServiceMetadata,
  authContext?: { userId?: string; roles?: string[]; permissions?: string[] }
): ServiceMetadata {
  // For browser client, we trust the server's filtering
  // This is a pass-through with optional client-side validation in the future

  if (!authContext) {
    // No auth context - return full definition (server should have filtered)
    return definition;
  }

  // In future, could add client-side validation:
  // - Check if methods have ACL metadata
  // - Validate returned definition matches expected permissions
  // - Log warnings if suspicious filtering detected

  return definition;
}

/**
 * Process query interface response
 *
 * Validates and processes the response from the server.
 * Handles filtered definitions and resolved names.
 *
 * @param response - Raw response from server
 * @returns Validated QueryInterfaceResponse
 * @throws TitanError if response is invalid
 */
export function processQueryInterfaceResponse(response: any): QueryInterfaceResponse {
  if (!isQueryInterfaceResponse(response)) {
    throw new TitanError({
      code: ErrorCode.UNPROCESSABLE_ENTITY,
      message: 'Invalid query interface response from server',
      details: { response },
    });
  }

  return response;
}

/**
 * Helper to extract service metadata from definition
 *
 * @param definition - Service definition
 * @returns Service metadata
 */
export function extractMetadata(definition: Definition): ServiceMetadata {
  return definition.meta;
}

/**
 * Check if a service definition has been filtered
 *
 * A definition is considered filtered if:
 * - Response explicitly marks it as filtered
 * - Metadata contains ACL indicators
 * - Method count is suspiciously low
 *
 * @param response - Query interface response
 * @returns True if definition appears filtered
 */
export function isFilteredDefinition(response: QueryInterfaceResponse): boolean {
  // Explicit filtering flag
  if (response.filtered === true) {
    return true;
  }

  // Check metadata for ACL indicators
  const meta = response.definition.meta;

  // If no methods, likely filtered (unless it's a property-only service)
  if (Object.keys(meta.methods || {}).length === 0 && Object.keys(meta.properties || {}).length === 0) {
    return true;
  }

  return false;
}

/**
 * Validate query interface request
 *
 * @param request - Request to validate
 * @throws TitanError if request is invalid
 */
export function validateQueryInterfaceRequest(request: QueryInterfaceRequest): void {
  if (!request || typeof request !== 'object') {
    throw new TitanError({
      code: ErrorCode.BAD_REQUEST,
      message: 'Invalid query interface request',
      details: { request },
    });
  }

  if (!request.serviceName || typeof request.serviceName !== 'string') {
    throw new TitanError({
      code: ErrorCode.BAD_REQUEST,
      message: 'Service name is required',
      details: { request },
    });
  }

  // Validate service name format
  const validNamePattern = /^[a-zA-Z0-9._-]+(@[a-zA-Z0-9._-]+)?$/;
  if (!validNamePattern.test(request.serviceName)) {
    throw new TitanError({
      code: ErrorCode.BAD_REQUEST,
      message: 'Invalid service name format',
      details: { serviceName: request.serviceName },
    });
  }
}

/**
 * Build query interface task data for WebSocket transport
 *
 * @param serviceName - Service name to query
 * @returns Task data object for WebSocket packet
 */
export function buildQueryInterfaceTaskData(serviceName: string): {
  task: string;
  serviceName: string;
} {
  return {
    task: CORE_TASK_QUERY_INTERFACE,
    serviceName,
  };
}

/**
 * Parse service name components
 *
 * @param qualifiedName - Service name (with or without version)
 * @returns Parsed components
 */
export function parseServiceName(qualifiedName: string): {
  name: string;
  version?: string;
  isWildcard: boolean;
} {
  if (qualifiedName.includes('@')) {
    const [name, version] = qualifiedName.split('@') as [string, string];
    return { name, version, isWildcard: false };
  }

  return { name: qualifiedName, version: undefined, isWildcard: true };
}

/**
 * Format service name for display
 *
 * @param name - Service name
 * @param version - Service version
 * @returns Formatted service name
 */
export function formatServiceName(name: string, version?: string): string {
  return version ? `${name}@${version}` : name;
}
