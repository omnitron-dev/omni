/**
 * Core Netron components for browser
 * Exports all essential classes and utilities for browser-based Netron clients
 */

// Core classes
export { AbstractPeer, isNetronPeer } from './abstract-peer.js';
export { Definition } from './definition.js';
export { Reference } from './reference.js';
export { Interface } from './interface.js';
export { StreamReference } from './stream-reference.js';
export type { StreamReferenceType } from './stream-reference.js';

// Stream classes
export { NetronReadableStream } from './readable-stream.js';
export type { NetronReadableStreamOptions } from './readable-stream.js';
export { NetronWritableStream } from './writable-stream.js';
export type { NetronWritableStreamOptions } from './writable-stream.js';

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
export {
  isServiceDefinition,
  isServiceReference,
  isNetronStreamReference,
  isNetronService,
} from './predicates.js';

// Stream utilities
export {
  isNetronStream,
  isNetronReadableStream,
  isNetronWritableStream,
} from './stream-utils.js';

// Types
export type {
  IPeer,
  EventSubscriber,
  ArgumentInfo,
  MethodInfo,
  PropertyInfo,
  ServiceMetadata,
} from './types.js';

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
