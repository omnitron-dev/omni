/**
 * Auth Module Types
 *
 * Type definitions for the unified authentication module.
 *
 * @module titan/modules/auth
 */

/**
 * Supported JWT algorithms.
 *
 * - HS256: HMAC with SHA-256 (symmetric, requires shared secret)
 * - RS256: RSA with SHA-256 (asymmetric, uses public/private keys)
 * - ES256: ECDSA with SHA-256 (asymmetric, smaller keys)
 *
 * @public
 */
export type JWTAlgorithm = 'HS256' | 'RS256' | 'ES256';

/**
 * Standard JWT payload claims.
 *
 * @public
 */
export interface IJWTPayload {
  /** Subject (usually user ID) */
  sub: string;
  /** User role */
  role: string;
  /** Audience */
  aud?: string;
  /** Issuer */
  iss?: string;
  /** Tenant ID for multi-tenant systems */
  tenant_id?: string;
  /** Expiration time (Unix timestamp) */
  exp?: number;
  /** Issued at time (Unix timestamp) */
  iat?: number;
  /** Email address */
  email?: string;
  /** Username */
  username?: string;
  /** Display name */
  display_name?: string;
  /** Avatar URL */
  avatar_url?: string;
  /** Application metadata */
  app_metadata?: Record<string, unknown>;
  /** User metadata */
  user_metadata?: Record<string, unknown>;
  /** Additional custom claims */
  [key: string]: unknown;
}

/**
 * Authentication context representing the authenticated entity.
 *
 * @public
 */
export interface IAuthContext {
  /** User ID */
  userId: string;
  /** User role */
  role: string;
  /** Tenant ID */
  tenantId: string;
  /** Whether this is a service-level role */
  isServiceRole: boolean;
  /** Full JWT claims */
  claims: IJWTPayload;
}

/**
 * Token cache entry.
 *
 * @internal
 */
export interface ITokenCacheEntry {
  payload: IJWTPayload;
  expiresAt: number;
}

/**
 * Token cache statistics.
 *
 * @public
 */
export interface ITokenCacheStats {
  /** Current cache size */
  size: number;
  /** Maximum cache size */
  maxSize: number;
  /** Cache hit count */
  hits: number;
  /** Cache miss count */
  misses: number;
  /** Cache hit rate (0-1) */
  hitRate: number;
}

/**
 * JWT Service interface.
 *
 * @public
 */
export interface IJWTService {
  /**
   * Verify and decode a JWT token.
   *
   * @param token - JWT token string
   * @returns Decoded payload
   * @throws {InvalidTokenError} If token is invalid or expired
   */
  verify(token: string): Promise<IJWTPayload>;

  /**
   * Create an auth context from a token.
   *
   * @param token - JWT token string
   * @returns Authentication context
   */
  createContext(token: string): Promise<IAuthContext>;

  /**
   * Clear the token cache.
   */
  clearCache(): void;

  /**
   * Get token cache statistics.
   */
  getCacheStats(): ITokenCacheStats;
}

/**
 * Signed URL token payload (for pre-signed URLs).
 *
 * @public
 */
export interface ISignedTokenPayload {
  /** Resource identifier (e.g., bucket ID) */
  resourceId: string;
  /** Resource path (e.g., object name) */
  resourcePath: string;
  /** Allowed operation */
  operation: 'read' | 'write';
  /** Optional transformation parameters */
  transform?: Record<string, unknown>;
}

/**
 * Signed URL service interface.
 *
 * @public
 */
export interface ISignedUrlService {
  /**
   * Create a signed token for a resource.
   *
   * @param payload - Token payload
   * @param expiresIn - Expiration time in seconds
   * @returns Signed JWT token
   */
  createSignedToken(payload: ISignedTokenPayload, expiresIn: number): Promise<string>;

  /**
   * Verify a signed token.
   *
   * @param token - Signed token string
   * @returns Decoded payload
   * @throws {InvalidTokenError} If token is invalid or expired
   */
  verifySignedToken(token: string): Promise<ISignedTokenPayload>;
}

/**
 * API key validation result.
 *
 * @public
 */
export interface IApiKeyValidationResult {
  /** Whether the key is valid */
  valid: boolean;
  /** Key type if valid */
  type?: 'service' | 'anon';
  /** Associated context if valid */
  context?: IAuthContext;
}

/**
 * Auth middleware interface.
 *
 * @public
 */
export interface IAuthMiddleware {
  /**
   * Authenticate a request and return auth context.
   * Falls back to anonymous context if no credentials provided.
   *
   * @param request - Request-like object with headers
   * @returns Authentication context
   */
  authenticate(request: IRequestLike): Promise<IAuthContext>;

  /**
   * Authenticate a request, requiring valid credentials.
   *
   * @param request - Request-like object with headers
   * @returns Authentication context
   * @throws {UnauthorizedError} If no valid credentials provided
   */
  authenticateRequired(request: IRequestLike): Promise<IAuthContext>;

  /**
   * Extract token from request headers.
   *
   * @param request - Request-like object with headers
   * @returns Token string or null
   */
  extractToken(request: IRequestLike): string | null;

  /**
   * Validate an API key.
   *
   * @param apiKey - API key string
   * @returns Validation result
   */
  validateApiKey(apiKey: string): IApiKeyValidationResult;
}

/**
 * Request-like interface for middleware compatibility.
 *
 * @public
 */
export interface IRequestLike {
  headers:
    | {
        get(name: string): string | null;
      }
    | Record<string, string | string[] | undefined>;
}

/**
 * Auth module configuration options.
 *
 * @public
 */
export interface IAuthModuleOptions {
  /**
   * JWT algorithm to use.
   *
   * @defaultValue 'HS256'
   */
  algorithm?: JWTAlgorithm;

  /**
   * JWT secret for HS256 algorithm.
   */
  jwtSecret?: string;

  /**
   * JWKS URL for RS256/ES256 algorithms.
   */
  jwksUrl?: string;

  /**
   * JWT issuer for validation.
   */
  issuer?: string;

  /**
   * JWT audience for validation.
   */
  audience?: string;

  /**
   * Service API key for service-to-service auth.
   */
  serviceKey?: string;

  /**
   * Anonymous API key for unauthenticated access.
   */
  anonKey?: string;

  /**
   * Default tenant ID for multi-tenant systems.
   *
   * @defaultValue 'default'
   */
  defaultTenantId?: string;

  /**
   * Enable token caching.
   *
   * @defaultValue true
   */
  cacheEnabled?: boolean;

  /**
   * Maximum number of tokens to cache.
   *
   * @defaultValue 1000
   */
  cacheMaxSize?: number;

  /**
   * Token cache TTL in milliseconds.
   *
   * @defaultValue 300000 (5 minutes)
   */
  cacheTTL?: number;

  /**
   * Secret for signing URLs (defaults to jwtSecret).
   */
  urlSigningKey?: string;

  /**
   * Register the module globally.
   *
   * @defaultValue false
   */
  isGlobal?: boolean;
}

/**
 * Async configuration options for the auth module.
 *
 * @public
 */
export interface IAuthModuleAsyncOptions {
  /**
   * Modules to import for dependency injection.
   */
  imports?: any[];

  /**
   * Factory function to create module options.
   */
  useFactory?: (...args: any[]) => Promise<IAuthModuleOptions> | IAuthModuleOptions;

  /**
   * Tokens to inject into the factory function.
   */
  inject?: any[];

  /**
   * Register the module globally.
   *
   * @defaultValue false
   */
  isGlobal?: boolean;
}

/**
 * Decorator options for @RequireAuth().
 *
 * @public
 */
export interface IRequireAuthOptions {
  /**
   * Required roles (any of these roles is sufficient).
   */
  roles?: string[];

  /**
   * Allow anonymous access.
   *
   * @defaultValue false
   */
  allowAnonymous?: boolean;

  /**
   * Custom error message on unauthorized.
   */
  message?: string;
}
