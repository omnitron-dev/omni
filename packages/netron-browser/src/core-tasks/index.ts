/**
 * Core tasks for Netron Browser Client
 *
 * Provides tasks for:
 * - Authentication (authenticate)
 * - Cache management (invalidate_cache)
 * - Service discovery (query_interface)
 * - Event handling (emit, subscribe, unsubscribe)
 * - Service lifecycle (unexpose_service, unref_service)
 */

export {
  CORE_TASK_AUTHENTICATE,
  createAuthenticateRequest,
  isAuthenticateResponse,
  type AuthenticateRequest,
  type AuthenticateResponse,
} from './authenticate.js';

export {
  CORE_TASK_INVALIDATE_CACHE,
  createInvalidateCacheRequest,
  isInvalidateCacheResponse,
  matchesPattern,
  type InvalidateCacheRequest,
  type InvalidateCacheResponse,
} from './invalidate-cache.js';

export {
  CORE_TASK_QUERY_INTERFACE,
  createQueryInterfaceRequest,
  isQueryInterfaceResponse,
  resolveServiceName,
  filterDefinition,
  processQueryInterfaceResponse,
  extractMetadata,
  isFilteredDefinition,
  validateQueryInterfaceRequest,
  buildQueryInterfaceTaskData,
  parseServiceName,
  formatServiceName,
  type QueryInterfaceRequest,
  type QueryInterfaceResponse,
} from './query-interface.js';

// Event handling tasks
export { CORE_TASK_EMIT, emit, isEmitCapablePeer, type EmitCapablePeer } from './emit.js';

export {
  CORE_TASK_SUBSCRIBE,
  CORE_TASK_UNSUBSCRIBE,
  subscribe,
  unsubscribe,
  cleanupSubscriptions,
  createSubscribeRequest,
  isSubscribeResponse,
  type SubscribableLocalPeer,
  type TaskRunnablePeer,
  type SubscriptionContext,
  type SubscribeRequest,
  type SubscribeResponse,
} from './subscribe.js';

// Service management tasks
export {
  CORE_TASK_UNEXPOSE_SERVICE,
  CORE_TASK_UNREF_SERVICE,
  CORE_TASK_EXPOSE_SERVICE,
  unexpose_service,
  unref_service,
  isServiceExposed,
  getExposedServiceNames,
  createUnexposeServiceRequest,
  isUnexposeServiceResponse,
  createUnrefServiceRequest,
  isUnrefServiceResponse,
  type ServiceManagingPeer,
  type UnexposeServiceRequest,
  type UnexposeServiceResponse,
  type UnrefServiceRequest,
  type UnrefServiceResponse,
} from './service.js';
