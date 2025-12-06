/**
 * Core authentication and authorization types for Netron
 * @module @omnitron-dev/titan/netron/auth
 */

/**
 * Authentication credentials
 */
export interface AuthCredentials {
  /** Username or email */
  username?: string;

  /** Password (for password-based auth) */
  password?: string;

  /** Token (for token-based auth) */
  token?: string;

  /** Custom credentials */
  [key: string]: any;
}

/**
 * Authentication context
 * Contains user identity and authorization data
 */
export interface AuthContext {
  /** Unique user identifier */
  userId: string;

  /** User roles for RBAC */
  roles: string[];

  /** User permissions */
  permissions: string[];

  /** OAuth2/OIDC scopes */
  scopes?: string[];

  /** Token metadata */
  token?: {
    type: 'bearer' | 'mac' | 'custom';
    expiresAt?: Date;
    issuer?: string;
    audience?: string[];
  };

  /** Custom metadata */
  metadata?: Record<string, any>;
}

/**
 * Authentication result
 */
export interface AuthResult {
  /** Whether authentication was successful */
  success: boolean;

  /** Auth context if successful */
  context?: AuthContext;

  /** Error message if failed */
  error?: string;

  /** Additional metadata */
  metadata?: Record<string, any>;
}

/**
 * Execution context for policy evaluation
 * Contains all information needed to make authorization decisions
 */
export interface ExecutionContext {
  /** Authentication context (user info) */
  auth?: AuthContext;

  /** Service being accessed */
  service: {
    name: string;
    version: string;
  };

  /** Method being called */
  method?: {
    name: string;
    args: any[];
  };

  /** Resource attributes (for resource-based auth) */
  resource?: {
    id?: string;
    type?: string;
    owner?: string;
    attributes?: Record<string, any>;
  };

  /** Environment attributes */
  environment?: {
    ip?: string;
    timestamp?: Date;
    transport?: string;
    [key: string]: any;
  };

  /** Request metadata */
  request?: {
    headers?: Record<string, string>;
    metadata?: Record<string, any>;
  };
}

/**
 * Policy decision result
 */
export interface PolicyDecision {
  /** Whether access is allowed */
  allowed: boolean;

  /** Reason for decision (for debugging/auditing) */
  reason?: string;

  /** Additional metadata */
  metadata?: Record<string, any>;
}

/**
 * Enhanced policy decision with timing and debug info
 */
export interface EnhancedPolicyDecision extends PolicyDecision {
  /** Evaluation time in milliseconds */
  evaluationTime?: number;

  /** Policy name that was evaluated */
  policyName?: string;

  /** Debug trace (only in debug mode) */
  trace?: Array<{
    step: string;
    timestamp: number;
    data?: any;
  }>;
}

/**
 * Policy function type
 * Takes execution context and returns decision
 */
export type Policy = (context: ExecutionContext) => Promise<PolicyDecision> | PolicyDecision;

/**
 * Policy definition with metadata
 */
export interface PolicyDefinition {
  /** Unique policy name */
  name: string;

  /** Human-readable description */
  description?: string;

  /** Policy implementation */
  evaluate: Policy;

  /** Policy tags (for organization) */
  tags?: string[];

  /** Optional cleanup function called when policy is destroyed */
  onDestroy?: () => void;
}

/**
 * Policy expression type for complex combinations
 */
export type PolicyExpression =
  | string
  | { and: PolicyExpression[] }
  | { or: PolicyExpression[] }
  | { not: PolicyExpression };

/**
 * Policy evaluation options
 */
export interface PolicyEvaluationOptions {
  /** Timeout for policy evaluation (ms) */
  timeout?: number;

  /** Cache policy decision for this duration (ms) */
  cacheTTL?: number;

  /** Skip caching for this evaluation */
  skipCache?: boolean;

  /** Abort signal for cancellation */
  signal?: AbortSignal;
}

/**
 * Policy engine configuration
 */
export interface PolicyEngineConfig {
  /** Enable debug mode */
  debug?: boolean;

  /** Default timeout for policy evaluation (ms) */
  defaultTimeout?: number;

  /** Default cache TTL (ms) */
  defaultCacheTTL?: number;
}

/**
 * Type-safe policy reference
 */
export type PolicyRef<T extends string = string> = symbol & { __brand: T };

/**
 * Service ACL (Access Control List)
 */
export interface ServiceACL {
  /** Service name pattern (supports wildcards) */
  service: string;

  /** Roles allowed to access this service */
  allowedRoles?: string[];

  /** Permissions required to access this service */
  requiredPermissions?: string[];

  /** Custom policy names to evaluate */
  policies?: string[];

  /** Method-specific ACLs */
  methods?: {
    [methodName: string]: {
      allowedRoles?: string[];
      requiredPermissions?: string[];
      policies?: string[];
      /** Override service-level ACL instead of merging */
      __override?: boolean;
    };
  };
}

/**
 * Auth configuration for Netron
 */
export interface NetronAuthConfig {
  /** Authentication function */
  authenticate: (credentials: AuthCredentials) => Promise<AuthContext> | AuthContext;

  /** Token validation function (optional) */
  validateToken?: (token: string) => Promise<AuthContext> | AuthContext;

  /** Service ACLs */
  acls?: ServiceACL[];
}

// Rate limit types moved to rate-limiter.ts to avoid circular dependencies
// Re-exported here for convenience
// export type { RateLimitTier, RateLimitConfig, RateLimitStrategy } from './rate-limiter.js';

/**
 * Cache configuration for method results
 */
export interface CacheConfig {
  /** Cache TTL in milliseconds */
  ttl?: number;

  /** Cache key generator */
  keyGenerator?: (args: any[]) => string;

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
  fetcher?: (ids: string[]) => Promise<Map<string, any>>;

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
 * Audit event
 */
export interface AuditEvent {
  /** Timestamp */
  timestamp: Date;

  /** User ID */
  userId?: string;

  /** Service name */
  service: string;

  /** Method name */
  method: string;

  /** Method arguments (if includeArgs is true) */
  args?: any[];

  /** Method result (if includeResult is true) */
  result?: any;

  /** Auth decision */
  authDecision?: PolicyDecision;

  /** Success status */
  success: boolean;

  /** Error message (if failed) */
  error?: string;

  /** Request metadata */
  metadata?: Record<string, any>;
}

/**
 * Method options for @Method decorator
 */
export interface MethodOptions {
  /** Read-only property (for properties only) */
  readonly?: boolean;

  /** Transport protocols (legacy support) */
  transports?: string[];

  /** Authentication and authorization configuration */
  auth?:
    | boolean
    | {
        /** Required roles (RBAC) */
        roles?: string[];

        /** Required permissions (RBAC) */
        permissions?: string[];

        /** Required OAuth2 scopes */
        scopes?: string[];

        /** Policy names or expressions to evaluate */
        policies?: string[] | { all: string[] } | { any: string[] } | PolicyExpression;

        /** Allow anonymous access */
        allowAnonymous?: boolean;

        /** Inherit class-level policies */
        inherit?: boolean;

        /** Override class-level policies */
        override?: boolean;
      };

  /** Rate limiting configuration */
  rateLimit?: any; // RateLimitConfig from rate-limiter.ts

  /** Cache configuration */
  cache?: CacheConfig;

  /** Resource prefetch configuration */
  prefetch?: PrefetchConfig;

  /** Audit configuration */
  audit?: AuditConfig;
}
