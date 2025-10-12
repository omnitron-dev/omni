/**
 * Netron Middleware System Types
 *
 * Transport-agnostic middleware system for Netron
 * Supports both common middleware and transport-specific extensions
 */

import type { LocalPeer, RemotePeer } from '../index.js';
import type { Task } from '../task-manager.js';
import type { Packet } from '../packet/index.js';

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
  input?: any;
  result?: any;
  error?: Error;

  // Metadata & timing
  metadata: Map<string, any>;
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
 * Transport middleware adapter interface
 */
export interface ITransportMiddlewareAdapter<T extends NetronMiddlewareContext> {
  /** Transform transport-specific context to Netron context */
  toNetronContext(transportCtx: any): T;

  /** Apply Netron context changes back to transport context */
  fromNetronContext(netronCtx: T, transportCtx: any): void;

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
  byMiddleware: Map<
    string,
    {
      executions: number;
      avgTime: number;
      errors: number;
    }
  >;
}
