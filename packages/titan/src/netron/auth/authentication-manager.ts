/**
 * Authentication Manager for Netron
 * Handles user authentication and token validation
 * @module @omnitron-dev/titan/netron/auth
 */

import { Injectable, Optional } from '../../decorators/index.js';
import type { ILogger } from '../../types.js';
import type {
  AuthCredentials,
  AuthContext,
  AuthResult,
  NetronAuthConfig,
} from './types.js';

/**
 * Authentication Manager
 * Manages user authentication and token validation
 */
@Injectable()
export class AuthenticationManager {
  private authenticateFn?: (credentials: AuthCredentials) => Promise<AuthContext> | AuthContext;
  private validateTokenFn?: (token: string) => Promise<AuthContext> | AuthContext;

  constructor(
    private logger: ILogger,
    @Optional() config?: NetronAuthConfig,
  ) {
    this.logger = logger.child({ component: 'AuthenticationManager' });

    if (config) {
      this.configure(config);
    }
  }

  /**
   * Configure authentication functions
   */
  configure(config: NetronAuthConfig): void {
    this.authenticateFn = config.authenticate;
    this.validateTokenFn = config.validateToken;

    this.logger.debug('Authentication manager configured');
  }

  /**
   * Authenticate user with credentials
   * @param credentials User credentials
   * @returns Authentication result
   */
  async authenticate(credentials: AuthCredentials): Promise<AuthResult> {
    if (!this.authenticateFn) {
      this.logger.error('No authentication function configured');
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

      const context = await this.authenticateFn(credentials);

      this.logger.info(
        {
          userId: context.userId,
          roles: context.roles,
          permissions: context.permissions,
        },
        'User authenticated successfully',
      );

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
    if (!this.validateTokenFn) {
      // If no token validator configured, try authenticate function with token
      if (this.authenticateFn) {
        return this.authenticate({ token });
      }

      this.logger.error('No token validation function configured');
      return {
        success: false,
        error: 'Token validation not configured',
      };
    }

    try {
      this.logger.debug('Validating token...');

      const context = await this.validateTokenFn(token);

      this.logger.debug(
        {
          userId: context.userId,
          roles: context.roles,
        },
        'Token validated successfully',
      );

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
