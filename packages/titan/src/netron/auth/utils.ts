/**
 * Authentication utility functions for Netron
 * Consolidated from multiple implementations to eliminate duplication
 */

/**
 * Extract Bearer token from Authorization header
 * Consolidated from 3 different implementations across:
 * - server.ts (lines 179, 910)
 * - builtin.ts (line 218)
 *
 * @param authHeader - The Authorization header value
 * @returns The extracted token, or null if invalid/missing
 *
 * @example
 * extractBearerToken('Bearer abc123') // returns 'abc123'
 * extractBearerToken('Basic xyz') // returns null
 * extractBearerToken(undefined) // returns null
 */
export function extractBearerToken(authHeader: string | undefined): string | null {
  if (!authHeader || typeof authHeader !== 'string') {
    return null;
  }

  // Parse Bearer token
  const parts = authHeader.split(' ');
  if (parts.length === 2 && parts[0] === 'Bearer' && parts[1]) {
    return parts[1];
  }

  // Also support token without 'Bearer' prefix (for compatibility)
  if (authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    return token || null;
  }

  return null;
}

/**
 * Parse Authorization header into scheme and credentials
 * More flexible than extractBearerToken for handling multiple auth schemes
 *
 * @param authHeader - The Authorization header value
 * @returns Object with scheme and credentials, or null if invalid
 *
 * @example
 * parseAuthorizationHeader('Bearer abc123') // returns { scheme: 'Bearer', credentials: 'abc123' }
 * parseAuthorizationHeader('Basic xyz') // returns { scheme: 'Basic', credentials: 'xyz' }
 */
export function parseAuthorizationHeader(authHeader: string | undefined): { scheme: string; credentials: string } | null {
  if (!authHeader || typeof authHeader !== 'string') {
    return null;
  }

  const parts = authHeader.split(' ');
  if (parts.length === 2 && parts[0] && parts[1]) {
    return {
      scheme: parts[0],
      credentials: parts[1]
    };
  }

  return null;
}
