/**
 * HTTP Middleware Types for Netron
 *
 * Contains both transport-agnostic base types and HTTP-specific extensions.
 * This is the single source of truth for all middleware types.
 */

import type { LocalPeer, RemotePeer } from '../../../index.js';
import type { Task } from '../../../task-manager.js';
import type { Packet } from '../../../packet/index.js';
import type { IncomingMessage, ServerResponse } from 'node:http';

// ============================================================================
// BASE MIDDLEWARE TYPES (Transport-Agnostic)
// ============================================================================

/**
 * Base middleware context (transport-agnostic)
 */
export interface NetronMiddlewareContext {
  // Core Netron entities
  peer: LocalPeer | RemotePeer;
  task?: Task;
  packet?: Packet;

  // Service invocation
  serviceName?: string;
  methodName?: string;
  input?: unknown;
  result?: unknown;
  error?: Error;

  // Metadata & timing
  metadata: Map<string, unknown>;
  timing: {
    start: number;
    middlewareTimes: Map<string, number>;
  };

  // Control flow
  skipRemaining?: boolean;
}

/**
 * Middleware function signature
 */
export type MiddlewareFunction<T extends NetronMiddlewareContext = NetronMiddlewareContext> = (
  ctx: T,
  next: () => Promise<void>
) => Promise<void> | void;

/**
 * Middleware configuration
 */
export interface MiddlewareConfig {
  /** Middleware name for debugging */
  name: string;
  /** Order priority (lower = earlier) */
  priority?: number;
  /** Skip on certain conditions */
  condition?: (ctx: NetronMiddlewareContext) => boolean;
  /** Error handler for this middleware */
  onError?: (error: Error, ctx: NetronMiddlewareContext) => void;
  /** Apply only to specific services */
  services?: string[] | RegExp;
  /** Apply only to specific methods */
  methods?: string[] | RegExp;
}

/**
 * Middleware pipeline stage
 */
export enum MiddlewareStage {
  /** Before packet processing */
  PRE_PROCESS = 'pre-process',
  /** Before service invocation */
  PRE_INVOKE = 'pre-invoke',
  /** After service invocation */
  POST_INVOKE = 'post-invoke',
  /** After packet processing */
  POST_PROCESS = 'post-process',
  /** Error handling */
  ERROR = 'error',
}

/**
 * Middleware registration options
 */
export interface MiddlewareRegistration {
  middleware: MiddlewareFunction;
  config: MiddlewareConfig;
  stage: MiddlewareStage;
}

/**
 * Transport context type parameter for adapters
 * Represents a transport-specific context object
 */
export type TransportContext = Record<string, unknown>;

/**
 * Transport middleware adapter interface
 */
export interface ITransportMiddlewareAdapter<
  T extends NetronMiddlewareContext = NetronMiddlewareContext,
  TTransportCtx extends TransportContext = TransportContext,
> {
  /** Transform transport-specific context to Netron context */
  toNetronContext(transportCtx: TTransportCtx): T;

  /** Apply Netron context changes back to transport context */
  fromNetronContext(netronCtx: T, transportCtx: TTransportCtx): void;

  /** Get transport-specific middleware */
  getTransportMiddleware(): MiddlewareFunction<T>[];
}

/**
 * Middleware manager interface
 */
export interface IMiddlewareManager {
  /** Register middleware globally */
  use(middleware: MiddlewareFunction, config?: Partial<MiddlewareConfig>, stage?: MiddlewareStage): void;

  /** Register service-specific middleware */
  useForService(serviceName: string, middleware: MiddlewareFunction, config?: Partial<MiddlewareConfig>): void;

  /** Register method-specific middleware */
  useForMethod(
    serviceName: string,
    methodName: string,
    middleware: MiddlewareFunction,
    config?: Partial<MiddlewareConfig>
  ): void;

  /** Execute middleware pipeline */
  execute(ctx: NetronMiddlewareContext, stage: MiddlewareStage): Promise<void>;

  /** Clear all middleware */
  clear(): void;

  /** Get middleware for specific service/method */
  getMiddleware(serviceName?: string, methodName?: string, stage?: MiddlewareStage): MiddlewareRegistration[];
}

/**
 * Per-middleware metrics
 */
export interface PerMiddlewareMetrics {
  executions: number;
  avgTime: number;
  errors: number;
}

/**
 * Middleware metrics
 */
export interface MiddlewareMetrics {
  /** Total middleware executions */
  executions: number;
  /** Average execution time */
  avgTime: number;
  /** Errors count */
  errors: number;
  /** Skip count */
  skips: number;
  /** Per-middleware metrics */
  byMiddleware: Map<string, PerMiddlewareMetrics>;
}

// ============================================================================
// HTTP-SPECIFIC MIDDLEWARE TYPES
// ============================================================================

/**
 * Extended context for HTTP-specific middleware
 */
export interface HttpMiddlewareContext extends NetronMiddlewareContext {
  request: IncomingMessage;
  response: ServerResponse;
  route?: string;
  params?: Record<string, string>;
  query?: Record<string, string>;
  body?: unknown;
  cookies?: Record<string, string>;
}

/**
 * HTTP transport context
 */
export interface HttpTransportContext extends TransportContext {
  peer?: unknown;
  metadata?: Map<string, unknown>;
  timing?: {
    start: number;
    middlewareTimes: Map<string, number>;
  };
  request?: IncomingMessage;
  response?: ServerResponse;
  route?: string;
  body?: unknown;
  result?: unknown;
}

/**
 * CORS configuration options
 */
export interface CorsOptions {
  origin?: string | string[] | boolean | ((origin: string | undefined) => boolean | string);
  methods?: string[];
  headers?: string[];
  credentials?: boolean;
  maxAge?: number;
  preflightContinue?: boolean;
  optionsSuccessStatus?: number;
}

/**
 * Compression options
 */
export interface CompressionOptions {
  threshold?: number;
  level?: number;
}

/**
 * Security headers options
 */
export interface SecurityHeadersOptions {
  contentSecurityPolicy?: string;
  xFrameOptions?: 'DENY' | 'SAMEORIGIN';
  xContentTypeOptions?: boolean;
  xXssProtection?: boolean;
  strictTransportSecurity?: {
    maxAge: number;
    includeSubDomains?: boolean;
    preload?: boolean;
  };
}
