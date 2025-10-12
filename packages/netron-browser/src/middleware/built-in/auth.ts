/**
 * Authentication Token Injection Middleware
 *
 * Automatically injects authentication tokens into requests
 */

import type { MiddlewareFunction } from '../types.js';

/**
 * Token provider interface
 */
export interface TokenProvider {
  /**
   * Get the current authentication token
   */
  getToken(): string | null | Promise<string | null>;

  /**
   * Get token type (e.g., 'Bearer', 'Basic')
   */
  getTokenType?(): string;
}

/**
 * Auth middleware options
 */
export interface AuthMiddlewareOptions {
  /**
   * Token provider
   */
  tokenProvider: TokenProvider;

  /**
   * Header name for token
   * @default 'Authorization'
   */
  headerName?: string;

  /**
   * Token prefix (e.g., 'Bearer ')
   * @default 'Bearer '
   */
  tokenPrefix?: string;

  /**
   * Skip auth for specific services
   */
  skipServices?: string[];

  /**
   * Skip auth for specific methods
   */
  skipMethods?: string[];
}

/**
 * Create authentication token injection middleware
 */
export function createAuthMiddleware(options: AuthMiddlewareOptions): MiddlewareFunction {
  const { tokenProvider, headerName = 'Authorization', skipServices = [], skipMethods = [] } = options;

  // Use explicit tokenPrefix if provided, otherwise use getTokenType or default 'Bearer '
  const tokenPrefix =
    options.tokenPrefix !== undefined ? options.tokenPrefix : tokenProvider.getTokenType?.() || 'Bearer ';

  return async (ctx, next) => {
    // Skip if service or method is in skip list
    if (skipServices.includes(ctx.service) || skipMethods.includes(`${ctx.service}.${ctx.method}`)) {
      return next();
    }

    // Get token from provider
    const token = await tokenProvider.getToken();

    if (token) {
      // Initialize request object if not exists
      if (!ctx.request) {
        ctx.request = {};
      }
      if (!ctx.request.headers) {
        ctx.request.headers = {};
      }

      // Inject token into headers
      ctx.request.headers[headerName] = `${tokenPrefix}${token}`;

      // Store in metadata for debugging
      ctx.metadata.set('auth:injected', true);
      ctx.metadata.set('auth:headerName', headerName);
    }

    await next();
  };
}

/**
 * Simple token provider from string or function
 */
export class SimpleTokenProvider implements TokenProvider {
  constructor(private token: string | (() => string | null)) {}

  getToken(): string | null {
    return typeof this.token === 'function' ? this.token() : this.token;
  }

  getTokenType(): string {
    return 'Bearer ';
  }
}

/**
 * Storage-based token provider (localStorage/sessionStorage)
 */
export class StorageTokenProvider implements TokenProvider {
  constructor(
    private storage: Storage,
    private key: string
  ) {}

  getToken(): string | null {
    return this.storage.getItem(this.key);
  }

  getTokenType(): string {
    return 'Bearer ';
  }
}
