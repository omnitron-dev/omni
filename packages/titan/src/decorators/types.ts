/**
 * Decorator Types - Configuration interfaces for @Public and related decorators
 * @module @omnitron-dev/titan/decorators
 */

import type { PolicyExpression, AuditEvent } from '../netron/auth/types.js';

// Re-export AuditEvent for convenience
export type { AuditEvent } from '../netron/auth/types.js';

/**
 * Cache configuration for method results
 */
export interface CacheConfig {
  /** Cache TTL in milliseconds */
  ttl?: number;

  /** Cache key generator */
  keyGenerator?: (args: unknown[]) => string;

  /** Invalidate cache on these events */
  invalidateOn?: string[];

  /** Max cache size */
  maxSize?: number;
}

/**
 * Resource prefetch configuration
 */
export interface PrefetchConfig {
  /** Enable prefetching */
  enabled?: boolean;

  /** Resource fetcher function */
  fetcher?: (ids: string[]) => Promise<Map<string, unknown>>;

  /** Cache TTL for prefetched resources */
  cacheTTL?: number;
}

/**
 * Audit configuration
 */
export interface AuditConfig {
  /** Include method arguments in audit log */
  includeArgs?: boolean;

  /** Include method result in audit log */
  includeResult?: boolean;

  /** Include user context in audit log */
  includeUser?: boolean;

  /** Custom audit logger */
  logger?: (event: AuditEvent) => void;
}

/**
 * Authentication and authorization configuration for @Public decorator
 */
export interface AuthConfig {
  /** Required roles (RBAC) - ANY of these roles grants access */
  roles?: string[];

  /** Required permissions (RBAC) - ALL required */
  permissions?: string[];

  /** Required OAuth2 scopes - ALL required */
  scopes?: string[];

  /** Policy names or expressions to evaluate */
  policies?: string[] | { all: string[] } | { any: string[] } | PolicyExpression;

  /** Allow anonymous access */
  allowAnonymous?: boolean;

  /** Inherit class-level policies */
  inherit?: boolean;

  /** Override class-level policies */
  override?: boolean;
}

/**
 * Method options for @Public decorator
 */
export interface MethodOptions {
  /** Read-only property (for properties only) */
  readonly?: boolean;

  /** Transport protocols (legacy support) */
  transports?: string[];

  /** Authentication and authorization configuration */
  auth?: boolean | AuthConfig;

  /** Rate limiting configuration */
  rateLimit?: unknown; // RateLimitConfig from rate-limiter.ts

  /** Cache configuration */
  cache?: CacheConfig;

  /** Resource prefetch configuration */
  prefetch?: PrefetchConfig;

  /** Audit configuration */
  audit?: AuditConfig;
}
