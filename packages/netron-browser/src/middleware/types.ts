/**
 * Client-side Middleware System Types for Netron Browser
 *
 * Lightweight middleware system adapted from Titan's server-side middleware
 * Optimized for browser environments with minimal dependencies
 */

/**
 * Middleware execution stage
 */
export enum MiddlewareStage {
  /** Before request is sent */
  PRE_REQUEST = 'pre-request',
  /** After response is received */
  POST_RESPONSE = 'post-response',
  /** Error handling */
  ERROR = 'error',
}

/**
 * Client middleware context
 */
export interface ClientMiddlewareContext {
  // Request details
  service: string;
  method: string;
  args: any[];

  // Request/Response data
  request?: {
    headers?: Record<string, string>;
    timeout?: number;
    metadata?: Record<string, any>;
  };

  response?: {
    data?: any;
    headers?: Record<string, string>;
    metadata?: Record<string, any>;
  };

  // Error handling
  error?: Error;

  // Timing information
  timing: {
    start: number;
    end?: number;
    middlewareTimes: Map<string, number>;
  };

  // Metadata storage
  metadata: Map<string, any>;

  // Control flow
  skipRemaining?: boolean;

  // Transport type
  transport: 'http' | 'websocket';
}

/**
 * Middleware function signature
 */
export type MiddlewareFunction = (
  ctx: ClientMiddlewareContext,
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
  condition?: (ctx: ClientMiddlewareContext) => boolean;

  /** Error handler for this middleware */
  onError?: (error: Error, ctx: ClientMiddlewareContext) => void;

  /** Apply only to specific services */
  services?: string[] | RegExp;

  /** Apply only to specific methods */
  methods?: string[] | RegExp;
}

/**
 * Middleware registration
 */
export interface MiddlewareRegistration {
  middleware: MiddlewareFunction;
  config: MiddlewareConfig;
  stage: MiddlewareStage;
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

/**
 * Middleware manager interface
 */
export interface IMiddlewareManager {
  /** Register middleware globally */
  use(
    middleware: MiddlewareFunction,
    config?: Partial<MiddlewareConfig>,
    stage?: MiddlewareStage
  ): void;

  /** Register service-specific middleware */
  useForService(
    serviceName: string,
    middleware: MiddlewareFunction,
    config?: Partial<MiddlewareConfig>,
    stage?: MiddlewareStage
  ): void;

  /** Register method-specific middleware */
  useForMethod(
    serviceName: string,
    methodName: string,
    middleware: MiddlewareFunction,
    config?: Partial<MiddlewareConfig>,
    stage?: MiddlewareStage
  ): void;

  /** Execute middleware pipeline */
  execute(
    ctx: ClientMiddlewareContext,
    stage: MiddlewareStage
  ): Promise<void>;

  /** Clear all middleware */
  clear(): void;

  /** Get middleware for specific service/method */
  getMiddleware(
    serviceName?: string,
    methodName?: string,
    stage?: MiddlewareStage
  ): MiddlewareRegistration[];

  /** Get metrics */
  getMetrics(): MiddlewareMetrics;
}
