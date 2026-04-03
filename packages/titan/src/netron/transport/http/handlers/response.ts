/**
 * HTTP response utilities for Netron server
 */

import { TitanError, toTitanError, mapToHttp } from '../../../../errors/index.js';
import { createErrorResponse } from '../types.js';
import type { TransportOptions } from '../../types.js';

/**
 * Create error response using consistent mapToHttp() helper
 */
export function createHttpErrorResponse(
  error: TitanError,
  requestId: string,
  request: Request,
  corsOptions?: TransportOptions['cors']
): Response {
  // Use consistent error mapping
  const httpError = mapToHttp(error);

  const errorCode = (error.details as any)?.errorCode ?? String(httpError.status);
  const errorResponse = createErrorResponse(requestId, {
    code: errorCode,
    message: error.message,
    details: error.details,
  });

  const headers = new Headers({
    'X-Netron-Version': '1.0',
    'Content-Type': 'application/json',
  });

  // Add headers from httpError
  if (httpError.headers) {
    for (const [key, value] of Object.entries(httpError.headers)) {
      headers.set(key, value);
    }
  }

  applyCorsHeaders(headers, request, corsOptions);

  return new Response(JSON.stringify(errorResponse), { status: httpError.status, headers });
}

/**
 * Handle errors and create response
 */
export function handleError(error: unknown, request: Request, corsOptions?: TransportOptions['cors']): Response {
  // Optimization: fast-path for TitanError instances - avoid double conversion
  const titanError = error instanceof TitanError ? error : toTitanError(error);

  // Map error to HTTP response format
  const httpError = mapToHttp(titanError);

  // Build headers with CORS support
  const headers = new Headers({
    'X-Netron-Version': '1.0',
    'Content-Type': 'application/json',
  });

  // Add headers from httpError
  if (httpError.headers) {
    for (const [key, value] of Object.entries(httpError.headers)) {
      headers.set(key, value);
    }
  }

  // Apply CORS headers using consolidated helper
  applyCorsHeaders(headers, request, corsOptions);

  return new Response(
    JSON.stringify({
      error: true,
      message: titanError.message,
      code: String(httpError.status),
      timestamp: Date.now(),
    }),
    { status: httpError.status, headers }
  );
}

/**
 * Apply CORS headers to response headers
 * Consolidated from multiple duplicate implementations
 */
export function applyCorsHeaders(headers: Headers, request: Request, corsOptions?: TransportOptions['cors']): void {
  const origin = request.headers.get('Origin');
  if (origin && corsOptions) {
    headers.set('Access-Control-Allow-Origin', origin);
    if ((corsOptions as { credentials?: boolean }).credentials) {
      headers.set('Access-Control-Allow-Credentials', 'true');
    }
  }
}

/**
 * Handle CORS preflight request
 */
export function handleCorsPreflightRequest(request: Request, corsOptions?: TransportOptions['cors']): Response {
  const headers = new Headers();
  const origin = request.headers.get('Origin');

  if (origin) {
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
    headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Netron-Version');
    headers.set('Access-Control-Max-Age', '86400');

    if (corsOptions && (corsOptions as { credentials?: boolean }).credentials) {
      headers.set('Access-Control-Allow-Credentials', 'true');
    }
  }

  return new Response(null, { status: 204, headers });
}
