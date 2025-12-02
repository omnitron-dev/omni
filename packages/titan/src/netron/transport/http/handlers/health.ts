/**
 * Health check and metrics handlers for HTTP server
 */

import type { ServiceDescriptor, HttpServerMetrics } from './types.js';
import type { MiddlewarePipeline } from '../../../middleware/index.js';

/**
 * Handle health check request
 */
export function handleHealthCheck(
  status: string,
  startTime: number
): Response {
  const responseStatus = status === 'online' ? 200 : 503;
  // Basic health check without sensitive information
  return new Response(
    JSON.stringify({
      status,
      uptime: Date.now() - startTime,
      version: '2.0.0',
      // Removed services list - use authenticated /metrics instead
    }),
    {
      status: responseStatus,
      headers: { 'Content-Type': 'application/json' },
    }
  );
}

/**
 * Handle metrics request (requires authentication)
 */
export function handleMetricsRequest(
  request: Request,
  serverStatus: string,
  startTime: number,
  connectionsCount: number,
  metrics: HttpServerMetrics,
  services: Map<string, ServiceDescriptor>,
  globalPipeline: MiddlewarePipeline
): Response {
  // Extract and verify authentication
  const authHeader = request.headers.get('Authorization');

  // Require authentication for metrics endpoint
  if (!authHeader) {
    return new Response(
      JSON.stringify({
        error: {
          code: '401',
          message: 'Authentication required for metrics endpoint',
        },
      }),
      {
        status: 401,
        headers: {
          'Content-Type': 'application/json',
          'WWW-Authenticate': 'Bearer',
        },
      }
    );
  }

  // Return full metrics only for authenticated requests
  return new Response(
    JSON.stringify({
      server: {
        status: serverStatus,
        uptime: Date.now() - startTime,
        connections: connectionsCount,
      },
      requests: {
        total: metrics.totalRequests,
        active: metrics.activeRequests,
        errors: metrics.totalErrors,
        avgResponseTime: metrics.avgResponseTime,
      },
      services: Array.from(services.keys()), // OK for authenticated users
      protocolVersions: Object.fromEntries(metrics.protocolVersions),
      middleware: globalPipeline.getMetrics(),
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }
  );
}
