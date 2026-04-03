/**
 * Core Netron components for browser
 * Exports all essential classes and utilities for browser-based Netron clients
 */

// Core classes
export { AbstractPeer, isNetronPeer, DEFAULT_DEFINITION_CACHE_OPTIONS } from './abstract-peer.js';
export type { DefinitionCacheOptions } from './abstract-peer.js';
export { Definition } from './definition.js';
export { Reference } from './reference.js';
export { Interface } from './interface.js';
export { StreamReference } from './stream-reference.js';
export type { StreamReferenceType } from './stream-reference.js';

// Task Manager
export { TaskManager, DEFAULT_TASK_MANAGER_OPTIONS } from './task-manager.js';
export type { Task, OverwriteStrategy, TaskManagerOptions } from './task-manager.js';

// Stream classes
export { NetronReadableStream, StreamState as ReadableStreamState, ErrorSeverity } from './readable-stream.js';
export type { NetronReadableStreamOptions, StreamMetrics as ReadableStreamMetrics } from './readable-stream.js';
export { NetronWritableStream, StreamState as WritableStreamState } from './writable-stream.js';
export type {
  NetronWritableStreamOptions,
  StreamMetrics as WritableStreamMetrics,
  RetryConfig,
} from './writable-stream.js';

// Constants
export {
  MAX_UID_VALUE,
  CONTEXTIFY_SYMBOL,
  NETRON_EVENT_SERVICE_EXPOSE,
  NETRON_EVENT_SERVICE_UNEXPOSE,
  NETRON_EVENT_PEER_CONNECT,
  NETRON_EVENT_PEER_DISCONNECT,
  CONNECT_TIMEOUT,
  REQUEST_TIMEOUT,
} from './constants.js';

// Predicates
export { isServiceDefinition, isServiceReference, isNetronStreamReference, isNetronService } from './predicates.js';

// Stream utilities
export { isNetronStream, isNetronReadableStream, isNetronWritableStream } from './stream-utils.js';

// Types
export type { IPeer, EventSubscriber, ArgumentInfo, MethodInfo, PropertyInfo, ServiceMetadata } from './types.js';

// Utilities
export {
  getServiceEventName,
  getPeerEventName,
  getQualifiedName,
  detectRuntime,
  generateRequestId,
  parseCommonHeaders,
} from './utils.js';
export type { RuntimeEnvironment, CommonHeaders } from './utils.js';
