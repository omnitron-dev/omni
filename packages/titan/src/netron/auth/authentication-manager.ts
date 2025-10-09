/**
 * Authentication Manager for Netron
 * Handles user authentication and token validation
 * @module @omnitron-dev/titan/netron/auth
 */

import { Injectable, Optional } from '../../decorators/index.js';
import type { ILogger } from '../../modules/logger/logger.types.js';
import type {
  AuthCredentials,
  AuthContext,
  AuthResult,
  NetronAuthConfig,
} from './types.js';
import type { AuditLogger } from './audit-logger.js';

/**
 * Default timeout for authentication operations (10 seconds)
 */
const DEFAULT_AUTH_TIMEOUT = 10_000;

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

  constructor(
    private logger: ILogger,
    @Optional() config?: NetronAuthConfig,
    @Optional() auditLogger?: AuditLogger,
  ) {
    this.logger = logger.child({ component: 'AuthenticationManager' });
    this.auditLogger = auditLogger;

    if (config) {
      this.configure(config);
    }
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
  private async withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    operation: string,
  ): Promise<T> {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        setTimeout(() => {
          reject(new Error(`${operation} timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      }),
    ]);
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

      // Audit failed authentication
      if (this.auditLogger) {
        await this.auditLogger.logAuth({
          timestamp: new Date(),
          service: 'authentication',
          method: 'authenticate',
          args: [{ username: credentials.username }],
          success: false,
          error: validationError,
        });
      }

      return {
        success: false,
        error: validationError,
      };
    }

    if (!this.authenticateFn) {
      this.logger.error('No authentication function configured');

      // Audit configuration error
      if (this.auditLogger) {
        await this.auditLogger.logAuth({
          timestamp: new Date(),
          service: 'authentication',
          method: 'authenticate',
          success: false,
          error: 'Authentication not configured',
        });
      }

      return {
        success: false,
        error: 'Authentication not configured',
      };
    }

    try {
      this.logger.debug(
        { username: credentials.username },
        'Authenticating user...',
      );

      // Execute authentication with timeout
      const authPromise = Promise.resolve(this.authenticateFn(credentials));
      const context = await this.withTimeout(
        authPromise,
        this.authTimeout,
        'Authentication',
      );

      // Validate that context was returned
      if (!context) {
        this.logger.error('Authentication function returned null or undefined');

        // Audit failed authentication
        if (this.auditLogger) {
          await this.auditLogger.logAuth({
            timestamp: new Date(),
            service: 'authentication',
            method: 'authenticate',
            args: [{ username: credentials.username }],
            success: false,
            error: 'Authentication failed: no context returned',
            metadata: { duration: Date.now() - startTime },
          });
        }

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
        'User authenticated successfully',
      );

      // Audit successful authentication
      if (this.auditLogger) {
        await this.auditLogger.logAuth({
          timestamp: new Date(),
          userId: context.userId,
          service: 'authentication',
          method: 'authenticate',
          args: [{ username: credentials.username }],
          success: true,
          metadata: {
            duration: Date.now() - startTime,
            roles: context.roles,
            permissions: context.permissions,
          },
        });
      }

      return {
        success: true,
        context,
      };
    } catch (error: any) {
      this.logger.error(
        {
          error: error.message,
          username: credentials.username,
        },
        'Authentication failed',
      );

      // Audit failed authentication
      if (this.auditLogger) {
        await this.auditLogger.logAuth({
          timestamp: new Date(),
          service: 'authentication',
          method: 'authenticate',
          args: [{ username: credentials.username }],
          success: false,
          error: error.message || 'Authentication failed',
          metadata: { duration: Date.now() - startTime },
        });
      }

      return {
        success: false,
        error: error.message || 'Authentication failed',
      };
    }
  }

  /**
   * Validate authentication token
   * @param token Authentication token
   * @returns Authentication result
   */
  async validateToken(token: string): Promise<AuthResult> {
    const startTime = Date.now();

    // Validate token input
    if (!token || typeof token !== 'string') {
      this.logger.error({ error: 'Invalid token format' }, 'Token validation failed');

      // Audit failed validation
      if (this.auditLogger) {
        await this.auditLogger.logAuth({
          timestamp: new Date(),
          service: 'authentication',
          method: 'validateToken',
          success: false,
          error: 'Token must be a non-empty string',
        });
      }

      return {
        success: false,
        error: 'Token must be a non-empty string',
      };
    }

    if (token.trim() === '') {
      this.logger.error({ error: 'Empty token' }, 'Token validation failed');

      // Audit failed validation
      if (this.auditLogger) {
        await this.auditLogger.logAuth({
          timestamp: new Date(),
          service: 'authentication',
          method: 'validateToken',
          success: false,
          error: 'Token cannot be empty',
        });
      }

      return {
        success: false,
        error: 'Token cannot be empty',
      };
    }

    if (!this.validateTokenFn) {
      // If no token validator configured, try authenticate function with token
      if (this.authenticateFn) {
        return this.authenticate({ token });
      }

      this.logger.error('No token validation function configured');

      // Audit configuration error
      if (this.auditLogger) {
        await this.auditLogger.logAuth({
          timestamp: new Date(),
          service: 'authentication',
          method: 'validateToken',
          success: false,
          error: 'Token validation not configured',
        });
      }

      return {
        success: false,
        error: 'Token validation not configured',
      };
    }

    try {
      this.logger.debug('Validating token...');

      // Execute token validation with timeout
      const validationPromise = Promise.resolve(this.validateTokenFn(token));
      const context = await this.withTimeout(
        validationPromise,
        this.authTimeout,
        'Token validation',
      );

      // Validate that context was returned
      if (!context) {
        this.logger.error('Token validation function returned null or undefined');

        // Audit failed validation
        if (this.auditLogger) {
          await this.auditLogger.logAuth({
            timestamp: new Date(),
            service: 'authentication',
            method: 'validateToken',
            success: false,
            error: 'Token validation failed: no context returned',
            metadata: { duration: Date.now() - startTime },
          });
        }

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
        'Token validated successfully',
      );

      // Audit successful validation
      if (this.auditLogger) {
        await this.auditLogger.logAuth({
          timestamp: new Date(),
          userId: context.userId,
          service: 'authentication',
          method: 'validateToken',
          success: true,
          metadata: {
            duration: Date.now() - startTime,
            roles: context.roles,
            permissions: context.permissions,
          },
        });
      }

      return {
        success: true,
        context,
      };
    } catch (error: any) {
      this.logger.error(
        {
          error: error.message,
        },
        'Token validation failed',
      );

      // Audit failed validation
      if (this.auditLogger) {
        await this.auditLogger.logAuth({
          timestamp: new Date(),
          service: 'authentication',
          method: 'validateToken',
          success: false,
          error: error.message || 'Token validation failed',
          metadata: { duration: Date.now() - startTime },
        });
      }

      return {
        success: false,
        error: error.message || 'Token validation failed',
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
