/**
 * @omnitron-dev/netron-browser
 *
 * Browser-optimized Netron RPC client for seamless backend communication
 */

// Core Netron components
export {
  AbstractPeer,
  isNetronPeer,
  Definition,
  Reference,
  Interface,
  StreamReference,
  isServiceDefinition,
  isServiceReference,
  isNetronStreamReference,
  isNetronStream,
  isNetronService,
  getServiceEventName,
  getPeerEventName,
  getQualifiedName,
  detectRuntime,
  parseCommonHeaders,
  MAX_UID_VALUE,
  CONTEXTIFY_SYMBOL,
  NETRON_EVENT_SERVICE_EXPOSE,
  NETRON_EVENT_SERVICE_UNEXPOSE,
  NETRON_EVENT_PEER_CONNECT,
  NETRON_EVENT_PEER_DISCONNECT,
  CONNECT_TIMEOUT,
  REQUEST_TIMEOUT,
} from './core/index.js';

export type {
  IPeer,
  EventSubscriber,
  ArgumentInfo,
  MethodInfo,
  PropertyInfo,
  ServiceMetadata,
  StreamReferenceType,
  RuntimeEnvironment,
  CommonHeaders,
} from './core/index.js';

// Main client exports
export { NetronClient, createClient, HttpClient, WebSocketClient } from './client/index.js';
export type { HttpClientOptions, WebSocketClientOptions } from './client/index.js';

// Transport exports
export { WebSocketPeer, WebSocketConnection, ConnectionState as WebSocketState } from './transport/ws/index.js';
export type { WebSocketPeerOptions, WebSocketConnectionOptions } from './transport/ws/index.js';

// Type exports
export type {
  NetronClientOptions,
  TransportType,
  RequestContext,
  RequestHints,
  HttpRequestMessage,
  HttpResponseMessage,
  Packet,
  PacketType,
  ConnectionState,
  ConnectionMetrics,
  ServiceDescriptor,
  MethodDescriptor,
  ParameterDescriptor,
} from './types/index.js';

// Error exports
export {
  NetronError,
  ConnectionError,
  TimeoutError,
  NetworkError,
  ProtocolError,
  ServiceError,
  MethodNotFoundError,
  InvalidArgumentsError,
  TransportError,
  SerializationError,
} from './errors/index.js';

// Utility exports
export {
  generateRequestId,
  createRequestMessage,
  validateUrl,
  normalizeUrl,
  httpToWsUrl,
  isBrowser,
  isWebSocketSupported,
  isFetchSupported,
  sleep,
  calculateBackoff,
  deepClone,
  deepMerge,
  debounce,
  throttle,
} from './utils/index.js';

// Constants
export { NETRON_VERSION } from './types/index.js';

// Utilities
export { uuid } from './utils/uuid.js';
export { Uid } from './utils/uid.js';
