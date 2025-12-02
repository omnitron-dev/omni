/**
 * Shared types for HTTP handlers
 */

import type { NetronMiddlewareContext } from '../../../middleware/index.js';
import type { HttpRequestContext, HttpRequestHints } from '../types.js';

/**
 * Context passed to method handlers
 * Provides access to request context, hints, and middleware state
 */
export interface MethodHandlerContext {
  /** Request context for tracing and multi-tenancy */
  context?: HttpRequestContext;
  /** Client hints for optimization */
  hints?: HttpRequestHints;
  /** Original HTTP request */
  request: Request;
  /** Middleware context with metadata and timing */
  middleware: NetronMiddlewareContext & { output?: unknown };
}

/**
 * Service descriptor for native HTTP handling
 */
export interface ServiceDescriptor {
  name: string;
  version: string;
  methods: Map<string, MethodDescriptor>;
  description?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Method descriptor with enhanced HTTP integration
 * Generic parameters allow for type-safe input/output when known
 */
export interface MethodDescriptor<TInput = unknown, TOutput = unknown> {
  name: string;
  handler: (input: TInput, context: MethodHandlerContext) => Promise<TOutput>;
  contract?: import('../../../../validation/contract.js').MethodContract;
  cacheable?: boolean;
  cacheMaxAge?: number;
  cacheTags?: string[];
  description?: string;
  deprecated?: boolean;
}

/**
 * Server context containing shared dependencies
 */
export interface HttpServerContext {
  services: Map<string, ServiceDescriptor>;
  netronPeer?: import('../../../local-peer.js').LocalPeer;
  options: import('../../types.js').TransportOptions;
  metrics: HttpServerMetrics;
  globalPipeline: import('../../../middleware/index.js').MiddlewarePipeline;
}

/**
 * HTTP server metrics
 */
export interface HttpServerMetrics {
  totalRequests: number;
  activeRequests: number;
  totalErrors: number;
  totalBytesSent: number;
  totalBytesReceived: number;
  avgResponseTime: number;
  responseTimes: number[];
  statusCounts: Map<number, number>;
  methodCounts: Map<string, number>;
  protocolVersions: Map<string, number>;
  startTime: number;
}
