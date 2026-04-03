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
 * Token cache configuration for authentication
 */
export interface TokenCacheConfig {
  /** Enable token caching (default: true) */
  enabled?: boolean;

  /** Cache TTL in milliseconds (default: 60000 = 1 minute) */
  ttl?: number;

  /** Maximum cache size (default: 10000) */
  maxSize?: number;
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

  /** Token validation cache configuration (improves performance for repeated requests) */
  tokenCache?: TokenCacheConfig;

  /** Whether to use non-blocking audit logging (default: true for performance) */
  asyncAudit?: boolean;
}

/**
 * Audit event for security logging
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
  args?: unknown[];

  /** Method result (if includeResult is true) */
  result?: unknown;

  /** Auth decision */
  authDecision?: PolicyDecision;

  /** Success status */
  success: boolean;

  /** Error message (if failed) */
  error?: string;

  /** Request metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Access validation result
 */
export interface AccessValidationResult {
  /** Whether access is allowed */
  allowed: boolean;

  /** Reason for denial (if not allowed) */
  reason?: string;

  /** Detailed information about missing requirements */
  details?: {
    missingRoles?: string[];
    missingPermissions?: string[];
    missingScopes?: string[];
  };
}
