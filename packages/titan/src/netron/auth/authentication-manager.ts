/**
 * Authentication Manager for Netron
 * Handles user authentication and token validation
 * @module @omnitron-dev/titan/netron/auth
 */

import { createHash } from 'node:crypto';
import { TimedMap } from '@omnitron-dev/common';
import { Injectable, Optional } from '../../decorators/index.js';
import type { ILogger } from '../../modules/logger/logger.types.js';
import type { AuthCredentials, AuthContext, AuthResult, NetronAuthConfig, TokenCacheConfig } from './types.js';
import type { AuditLogger } from './audit-logger.js';

/**
 * Default timeout for authentication operations (10 seconds)
 */
const DEFAULT_AUTH_TIMEOUT = 10_000;

/**
 * Default token cache TTL (1 minute)
 */
const DEFAULT_TOKEN_CACHE_TTL = 60_000;

/**
 * Default token cache max size
 */
const DEFAULT_TOKEN_CACHE_MAX_SIZE = 10_000;

/**
 * Authentication Manager
 * Manages user authentication and token validation with input validation,
 * timeout support, and enhanced error handling
 */
@Injectable()
export class AuthenticationManager {
  private authenticateFn?: (credentials: AuthCredentials) => Promise<AuthContext> | AuthContext;
  private validateTokenFn?: (token: string) => Promise<AuthContext> | AuthContext;
  private authTimeout: number = DEFAULT_AUTH_TIMEOUT;
  private auditLogger?: AuditLogger;

  /** Token validation cache for performance optimization */
  private tokenCache?: TimedMap<string, AuthResult>;
  private tokenCacheConfig: TokenCacheConfig = { enabled: true };
  private cacheHits = 0;
  private cacheMisses = 0;

  /** Whether to use non-blocking audit logging (default: true) */
  private asyncAudit = true;

  constructor(
    private logger: ILogger,
    @Optional() config?: NetronAuthConfig,
    @Optional() auditLogger?: AuditLogger
  ) {
    this.logger = logger.child({ component: 'AuthenticationManager' });
    this.auditLogger = auditLogger;

    if (config) {
      this.configure(config);
    }
  }

  /**
   * Log audit event for authentication operations
   * Uses non-blocking mode by default for better performance
   * @param method - Method name (required)
   * @param eventDetails - Additional audit event details
   */
  private logAudit(
    method: string,
    eventDetails: {
      userId?: string;
      args?: any[];
      success: boolean;
      error?: string;
      metadata?: Record<string, any>;
    }
  ): Promise<void> | void {
    if (!this.auditLogger) {
      return undefined;
    }

    const auditPromise = this.auditLogger.logAuth({
      timestamp: new Date(),
      service: 'authentication',
      method,
      ...eventDetails,
    });

    // Non-blocking: fire and forget with error logging
    if (this.asyncAudit) {
      auditPromise.catch((err) => {
        this.logger.error({ err, method }, 'Audit log failed');
      });
      return undefined;
    }

    // Blocking mode: wait for audit to complete
    return auditPromise;
  }

  /**
   * Hash a token for cache key (security: don't store raw tokens)
   */
  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { hits: number; misses: number; hitRate: number; size: number } {
    const total = this.cacheHits + this.cacheMisses;
    return {
      hits: this.cacheHits,
      misses: this.cacheMisses,
      hitRate: total > 0 ? this.cacheHits / total : 0,
      size: this.tokenCache?.size ?? 0,
    };
  }

  /**
   * Clear the token cache
   */
  clearCache(): void {
    this.tokenCache?.clear();
    this.cacheHits = 0;
    this.cacheMisses = 0;
  }

  /**
   * Configure authentication functions
   * @param config - Authentication configuration
   * @throws {TypeError} If authenticate function is not a function
   */
  configure(config: NetronAuthConfig): void {
    if (typeof config.authenticate !== 'function') {
      throw new TypeError('authenticate must be a function');
    }

    if (config.validateToken !== undefined && typeof config.validateToken !== 'function') {
      throw new TypeError('validateToken must be a function');
    }

    this.authenticateFn = config.authenticate;
    this.validateTokenFn = config.validateToken;

    // Configure token cache
    if (config.tokenCache) {
      this.tokenCacheConfig = { ...this.tokenCacheConfig, ...config.tokenCache };
    }

    // Initialize token cache if enabled
    if (this.tokenCacheConfig.enabled !== false) {
      const ttl = this.tokenCacheConfig.ttl ?? DEFAULT_TOKEN_CACHE_TTL;
      this.tokenCache = new TimedMap<string, AuthResult>(ttl);
      this.logger.debug({ ttl, maxSize: this.tokenCacheConfig.maxSize }, 'Token cache initialized');
    }

    // Configure async audit (default: true for performance)
    if (config.asyncAudit !== undefined) {
      this.asyncAudit = config.asyncAudit;
    }

    this.logger.debug('Authentication manager configured');
  }

  /**
   * Set timeout for authentication operations
   * @param timeout - Timeout in milliseconds
   */
  setTimeout(timeout: number): void {
    if (timeout <= 0) {
      throw new RangeError('Timeout must be greater than 0');
    }
    this.authTimeout = timeout;
  }

  /**
   * Validate credentials input
   * @param credentials - Credentials to validate
   * @returns Validation error message or null if valid
   */
  private validateCredentials(credentials: AuthCredentials): string | null {
    if (!credentials || typeof credentials !== 'object') {
      return 'Credentials must be an object';
    }

    // Check for empty username or password (if provided)
    if (credentials.username !== undefined) {
      if (typeof credentials.username !== 'string') {
        return 'Username must be a string';
      }
      if (credentials.username.trim() === '') {
        return 'Username cannot be empty';
      }
    }

    if (credentials.password !== undefined) {
      if (typeof credentials.password !== 'string') {
        return 'Password must be a string';
      }
      if (credentials.password.trim() === '') {
        return 'Password cannot be empty';
      }
    }

    return null;
  }

  /**
   * Execute a promise with timeout
   * @param promise - Promise to execute
   * @param timeoutMs - Timeout in milliseconds
   * @param operation - Operation name for error messages
   * @returns Promise result
   */
  private async withTimeout<T>(promise: Promise<T>, timeoutMs: number, operation: string): Promise<T> {
    let timer: NodeJS.Timeout;
    const timeoutPromise = new Promise<T>((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error(`${operation} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    });
    try {
      return await Promise.race([promise, timeoutPromise]);
    } finally {
      clearTimeout(timer!);
    }
  }

  /**
   * Authenticate user with credentials
   * @param credentials User credentials
   * @returns Authentication result
   */
  async authenticate(credentials: AuthCredentials): Promise<AuthResult> {
    const startTime = Date.now();

    // Validate credentials input
    const validationError = this.validateCredentials(credentials);
    if (validationError) {
      this.logger.error({ error: validationError }, 'Invalid credentials format');

      // Audit failed authentication (non-blocking by default)
      this.logAudit('authenticate', {
        args: [{ username: credentials?.username }],
        success: false,
        error: validationError,
      });

      return {
        success: false,
        error: validationError,
      };
    }

    if (!this.authenticateFn) {
      this.logger.error('No authentication function configured');

      // Audit configuration error (non-blocking by default)
      this.logAudit('authenticate', {
        success: false,
        error: 'Authentication not configured',
      });

      return {
        success: false,
        error: 'Authentication not configured',
      };
    }

    try {
      this.logger.debug({ username: credentials.username }, 'Authenticating user...');

      // Execute authentication with timeout
      const authPromise = Promise.resolve(this.authenticateFn(credentials));
      const context = await this.withTimeout(authPromise, this.authTimeout, 'Authentication');

      // Validate that context was returned
      if (!context) {
        this.logger.error('Authentication function returned null or undefined');

        // Audit failed authentication (non-blocking by default)
        this.logAudit('authenticate', {
          args: [{ username: credentials.username }],
          success: false,
          error: 'Authentication failed: no context returned',
          metadata: { duration: Date.now() - startTime },
        });

        return {
          success: false,
          error: 'Authentication failed: no context returned',
        };
      }

      this.logger.info(
        {
          userId: context.userId,
          roles: context.roles,
          permissions: context.permissions,
        },
        'User authenticated successfully'
      );

      // Audit successful authentication (non-blocking by default)
      this.logAudit('authenticate', {
        userId: context.userId,
        args: [{ username: credentials.username }],
        success: true,
        metadata: {
          duration: Date.now() - startTime,
          roles: context.roles,
          permissions: context.permissions,
        },
      });

      return {
        success: true,
        context,
      };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Authentication failed';
      this.logger.error(
        {
          error: errorMessage,
          username: credentials.username,
        },
        'Authentication failed'
      );

      // Audit failed authentication (non-blocking by default)
      this.logAudit('authenticate', {
        args: [{ username: credentials.username }],
        success: false,
        error: errorMessage,
        metadata: { duration: Date.now() - startTime },
      });

      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Validate authentication token
   * Uses caching for improved performance on repeated requests
   * @param token Authentication token
   * @returns Authentication result
   */
  async validateToken(token: string): Promise<AuthResult> {
    const startTime = Date.now();

    // Validate token input
    if (!token || typeof token !== 'string') {
      this.logger.debug({ error: 'Invalid token format' }, 'Token validation failed');

      // Audit failed validation (non-blocking by default)
      this.logAudit('validateToken', {
        success: false,
        error: 'Token must be a non-empty string',
      });

      return {
        success: false,
        error: 'Token must be a non-empty string',
      };
    }

    if (token.trim() === '') {
      this.logger.debug({ error: 'Empty token' }, 'Token validation failed');

      // Audit failed validation (non-blocking by default)
      this.logAudit('validateToken', {
        success: false,
        error: 'Token cannot be empty',
      });

      return {
        success: false,
        error: 'Token cannot be empty',
      };
    }

    // Check cache first (performance optimization)
    if (this.tokenCache) {
      const cacheKey = this.hashToken(token);
      const cached = this.tokenCache.get(cacheKey);
      if (cached) {
        this.cacheHits++;
        this.logger.debug('Token validated from cache');
        return cached;
      }
      this.cacheMisses++;
    }

    if (!this.validateTokenFn) {
      // If no token validator configured, try authenticate function with token
      if (this.authenticateFn) {
        return this.authenticate({ token });
      }

      this.logger.error('No token validation function configured');

      // Audit configuration error (non-blocking by default)
      this.logAudit('validateToken', {
        success: false,
        error: 'Token validation not configured',
      });

      return {
        success: false,
        error: 'Token validation not configured',
      };
    }

    try {
      this.logger.debug('Validating token...');

      // Execute token validation with timeout
      const validationPromise = Promise.resolve(this.validateTokenFn(token));
      const context = await this.withTimeout(validationPromise, this.authTimeout, 'Token validation');

      // Validate that context was returned
      if (!context) {
        this.logger.error('Token validation function returned null or undefined');

        // Audit failed validation (non-blocking by default)
        this.logAudit('validateToken', {
          success: false,
          error: 'Token validation failed: no context returned',
          metadata: { duration: Date.now() - startTime },
        });

        return {
          success: false,
          error: 'Token validation failed: no context returned',
        };
      }

      this.logger.debug(
        {
          userId: context.userId,
          roles: context.roles,
        },
        'Token validated successfully'
      );

      // Audit successful validation (non-blocking by default)
      this.logAudit('validateToken', {
        userId: context.userId,
        success: true,
        metadata: {
          duration: Date.now() - startTime,
          roles: context.roles,
          permissions: context.permissions,
        },
      });

      // Build successful result
      const result: AuthResult = {
        success: true,
        context,
      };

      // Cache the successful result
      if (this.tokenCache) {
        const cacheKey = this.hashToken(token);
        const maxSize = this.tokenCacheConfig.maxSize ?? DEFAULT_TOKEN_CACHE_MAX_SIZE;

        // Enforce max size limit
        if (this.tokenCache.size < maxSize) {
          this.tokenCache.set(cacheKey, result);
        } else {
          this.logger.warn({ maxSize }, 'Token cache at max capacity, skipping cache');
        }
      }

      return result;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Token validation failed';
      this.logger.debug(
        {
          error: errorMessage,
        },
        'Token validation failed'
      );

      // Audit failed validation (non-blocking by default)
      this.logAudit('validateToken', {
        success: false,
        error: errorMessage,
        metadata: { duration: Date.now() - startTime },
      });

      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Check if authentication is configured
   */
  isConfigured(): boolean {
    return !!this.authenticateFn;
  }

  /**
   * Check if token validation is configured
   */
  isTokenValidationConfigured(): boolean {
    return !!this.validateTokenFn;
  }
}
