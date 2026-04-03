/**
 * Browser-compatible utility functions for Netron
 * Adapted from server version, removing Node.js dependencies
 */

/**
 * Generates a standardized event name for service-related events.
 * This function creates a predictable naming pattern for service events
 * by prefixing the service name with 'svc:'.
 *
 * @param {string} serviceName - The name of the service to generate an event name for
 * @returns {string} A formatted event name in the format 'svc:serviceName'
 * @example
 * getServiceEventName('auth') // returns 'svc:auth'
 */
export const getServiceEventName = (serviceName: string) => `svc:${serviceName}`;

/**
 * Generates a standardized event name for peer-related events.
 * This function creates a predictable naming pattern for peer events
 * by prefixing the peer ID with 'peer:'.
 *
 * @param {string} peerId - The unique identifier of the peer
 * @returns {string} A formatted event name in the format 'peer:peerId'
 * @example
 * getPeerEventName('peer-123') // returns 'peer:peer-123'
 */
export const getPeerEventName = (peerId: string) => `peer:${peerId}`;

/**
 * Constructs a qualified name by combining a base name with an optional version.
 * This function is used to create unique identifiers for services and other
 * components that support versioning.
 *
 * @param {string} name - The base name to qualify
 * @param {string} [version] - Optional version string to append
 * @returns {string} A qualified name in the format 'name' or 'name@version'
 * @example
 * getQualifiedName('auth', '1.0.0') // returns 'auth@1.0.0'
 * getQualifiedName('auth') // returns 'auth'
 */
export const getQualifiedName = (name: string, version?: string) => `${name}${version ? `@${version}` : ''}`;

/**
 * Runtime environment types
 */
export type RuntimeEnvironment = 'browser' | 'node' | 'bun' | 'deno';

/**
 * Detect the current runtime environment
 * Browser-optimized version always returns 'browser'
 */
export function detectRuntime(): RuntimeEnvironment {
  if (typeof window !== 'undefined') {
    return 'browser';
  }
  // Fallback checks for other environments (e.g., in tests)
  if (typeof (globalThis as any).Bun !== 'undefined') {
    return 'bun';
  }
  if (typeof (global as any)?.Deno !== 'undefined') {
    return 'deno';
  }
  return 'node';
}

/**
 * Generate a unique request ID
 * Uses Web Crypto API for better uniqueness and performance
 */
export function generateRequestId(): string {
  // Use crypto.randomUUID if available (all modern browsers)
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }

  // Fallback for older environments
  return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Parse common HTTP headers from a Headers object or Request
 * Browser-compatible version
 */
export interface CommonHeaders {
  contentType?: string | null;
  authorization?: string | null;
  origin?: string | null;
  requestId?: string | null;
  traceId?: string | null;
  correlationId?: string | null;
  spanId?: string | null;
  netronVersion?: string | null;
}

/**
 * Extract commonly used headers from a Headers object or Request
 */
export function parseCommonHeaders(source: Headers | Request): CommonHeaders {
  const headers = source instanceof Request ? source.headers : source;

  return {
    contentType: headers.get('Content-Type'),
    authorization: headers.get('Authorization'),
    origin: headers.get('Origin'),
    requestId: headers.get('X-Request-ID'),
    traceId: headers.get('X-Trace-ID'),
    correlationId: headers.get('X-Correlation-ID'),
    spanId: headers.get('X-Span-ID'),
    netronVersion: headers.get('X-Netron-Version'),
  };
}
