/**
 * HTTP handlers module exports
 */

// Types
export type {
  MethodHandlerContext,
  ServiceDescriptor,
  MethodDescriptor,
  HttpServerContext,
  HttpServerMetrics,
} from './types.js';

// OpenAPI
export { OpenApiGenerator, handleOpenAPIRequest } from './openapi.js';

// Health and Metrics
export { handleHealthCheck, handleMetricsRequest } from './health.js';

// Response utilities
export {
  createHttpErrorResponse,
  handleError,
  applyCorsHeaders,
  handleCorsPreflightRequest,
} from './response.js';

// Validation
export { validateMethodInput } from './validation.js';
