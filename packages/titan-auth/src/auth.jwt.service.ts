/**
 * JWT Service
 *
 * Core JWT verification service with caching and multi-algorithm support.
 *
 * @module titan/modules/auth
 */

import { jwtVerify, createRemoteJWKSet, SignJWT } from 'jose';
import { JWTExpired } from 'jose/errors';
import type { JWTVerifyResult, JWTPayload as JoseJWTPayload } from 'jose';
import { Injectable, Inject } from '@omnitron-dev/titan/decorators';
import { LOGGER_TOKEN } from '@omnitron-dev/titan/module/logger';
import type { ILogger } from '@omnitron-dev/titan/types';
import { AUTH_OPTIONS_TOKEN } from './auth.tokens.js';
import type {
  IJWTService,
  ISignedUrlService,
  IJWTPayload,
  IAuthContext,
  ITokenCacheStats,
  ITokenCacheEntry,
  ISignedTokenPayload,
  IAuthModuleOptions,
} from './auth.types.js';
import { createContextFromPayload } from './auth.utils.js';

/**
 * Invalid token error.
 */
export class InvalidTokenError extends Error {
  /** Error code for serialization to clients. */
  readonly code: string;

  constructor(message: string = 'Invalid or expired token', code: string = 'INVALID_TOKEN') {
    super(message);
    this.name = 'InvalidTokenError';
    this.code = code;
  }
}

/**
 * Token expired error — distinct from invalid token.
 * Frontend uses this to decide: refresh vs force-logout.
 */
export class TokenExpiredError extends InvalidTokenError {
  constructor() {
    super('Access token has expired', 'TOKEN_EXPIRED');
    this.name = 'TokenExpiredError';
  }
}

/**
 * Default module options.
 */
const DEFAULT_OPTIONS: Required<
  Omit<IAuthModuleOptions, 'jwtSecret' | 'jwksUrl' | 'issuer' | 'audience' | 'serviceKey' | 'anonKey' | 'urlSigningKey'>
> = {
  algorithm: 'HS256',
  defaultTenantId: 'default',
  cacheEnabled: true,
  cacheMaxSize: 1000,
  cacheTTL: 300000, // 5 minutes
  isGlobal: false,
};

/**
 * JWT Service Implementation
 *
 * Features:
 * - Multi-algorithm support (HS256, RS256, ES256)
 * - Remote JWKS support for asymmetric algorithms
 * - LRU token caching with configurable TTL and max size
 * - Automatic cache eviction on expiry
 * - Cache statistics for monitoring
 *
 * @example
 * ```typescript
 * // Verify a token
 * const payload = await jwtService.verify(token);
 *
 * // Create auth context
 * const context = await jwtService.createContext(token);
 *
 * // Check cache stats
 * const stats = jwtService.getCacheStats();
 * console.log(`Cache hit rate: ${stats.hitRate * 100}%`);
 * ```
 */
@Injectable()
export class JWTService implements IJWTService, ISignedUrlService {
  private readonly options: IAuthModuleOptions & typeof DEFAULT_OPTIONS;
  private jwks: ReturnType<typeof createRemoteJWKSet> | null = null;
  private secret: Uint8Array | null = null;
  private urlSigningSecret: Uint8Array | null = null;

  // Token cache with LRU eviction
  private readonly tokenCache: Map<string, ITokenCacheEntry> = new Map();
  private cacheHits = 0;
  private cacheMisses = 0;

  constructor(
    @Inject(AUTH_OPTIONS_TOKEN) options: IAuthModuleOptions,
    @Inject(LOGGER_TOKEN) private readonly logger: ILogger
  ) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.initializeKeys();
  }

  /**
   * Initialize cryptographic keys based on configuration.
   */
  private initializeKeys(): void {
    const { algorithm, jwtSecret, jwksUrl, urlSigningKey } = this.options;

    // Initialize JWT secret for HS256
    if (algorithm === 'HS256' && jwtSecret) {
      this.secret = new TextEncoder().encode(jwtSecret);
    }

    // Initialize JWKS for RS256/ES256
    if ((algorithm === 'RS256' || algorithm === 'ES256') && jwksUrl) {
      try {
        this.jwks = createRemoteJWKSet(new URL(jwksUrl));
        this.logger.debug({ algorithm, jwksUrl }, 'Initialized JWKS for JWT verification');
      } catch (error) {
        this.logger.error({ error, jwksUrl }, 'Failed to initialize JWKS');
        throw new Error(`Failed to initialize JWKS: ${jwksUrl}`, { cause: error });
      }
    }

    // Initialize URL signing secret
    const signingKey = urlSigningKey ?? jwtSecret;
    if (signingKey) {
      this.urlSigningSecret = new TextEncoder().encode(signingKey);
    }

    // Validate configuration
    if (!this.secret && !this.jwks) {
      this.logger.warn('No JWT verification key configured. JWT verification will fail.');
    }
  }

  /**
   * Verify and decode a JWT token.
   */
  async verify(token: string): Promise<IJWTPayload> {
    // Check cache first
    if (this.options.cacheEnabled) {
      const cached = this.getCachedToken(token);
      if (cached) {
        this.cacheHits++;
        return cached;
      }
      this.cacheMisses++;
    }

    try {
      const result = await this.verifyWithKey(token);
      const payload = this.validateAndMapPayload(result.payload);

      // Cache the result
      if (this.options.cacheEnabled) {
        this.cacheToken(token, payload);
      }

      return payload;
    } catch (error) {
      if (error instanceof InvalidTokenError) {
        throw error;
      }
      // Distinguish expired JWT from other validation failures.
      // Frontend uses TOKEN_EXPIRED to trigger token refresh,
      // while INVALID_TOKEN triggers force-logout.
      if (error instanceof JWTExpired) {
        this.logger.debug({ error }, 'JWT expired');
        throw new TokenExpiredError();
      }
      this.logger.debug({ error }, 'JWT verification failed');
      throw new InvalidTokenError();
    }
  }

  /**
   * Verify token with configured key.
   */
  private async verifyWithKey(token: string): Promise<JWTVerifyResult<JoseJWTPayload>> {
    const { algorithm, issuer, audience } = this.options;

    const verifyOptions: { algorithms: string[]; issuer?: string; audience?: string } = {
      algorithms: [algorithm],
    };

    if (issuer) {
      verifyOptions.issuer = issuer;
    }

    if (audience) {
      verifyOptions.audience = audience;
    }

    if (this.jwks) {
      return jwtVerify(token, this.jwks, verifyOptions);
    }

    if (this.secret) {
      return jwtVerify(token, this.secret, verifyOptions);
    }

    throw new InvalidTokenError('JWT verification not configured');
  }

  /**
   * Validate and map jose payload to our interface.
   */
  private validateAndMapPayload(josePayload: JoseJWTPayload): IJWTPayload {
    if (!josePayload.sub) {
      throw new InvalidTokenError('Missing required claim: sub');
    }

    const payload: IJWTPayload = {
      sub: josePayload.sub,
      role: (josePayload['role'] as string) ?? 'user',
      aud: josePayload.aud as string | undefined,
      iss: josePayload.iss,
      tenant_id: josePayload['tenant_id'] as string | undefined,
      exp: josePayload.exp,
      iat: josePayload.iat,
      email: josePayload['email'] as string | undefined,
      username: josePayload['username'] as string | undefined,
      display_name: josePayload['display_name'] as string | undefined,
      avatar_url: josePayload['avatar_url'] as string | undefined,
      app_metadata: josePayload['app_metadata'] as Record<string, unknown> | undefined,
      user_metadata: josePayload['user_metadata'] as Record<string, unknown> | undefined,
    };

    // Copy any additional claims
    for (const [key, value] of Object.entries(josePayload)) {
      if (!(key in payload)) {
        payload[key] = value;
      }
    }

    return payload;
  }

  /**
   * Get cached token if valid.
   */
  private getCachedToken(token: string): IJWTPayload | null {
    const entry = this.tokenCache.get(token);
    if (entry && entry.expiresAt > Date.now()) {
      // Move to end of map for LRU behavior
      this.tokenCache.delete(token);
      this.tokenCache.set(token, entry);
      return entry.payload;
    }

    // Remove expired entry
    if (entry) {
      this.tokenCache.delete(token);
    }

    return null;
  }

  /**
   * Cache token with LRU eviction.
   */
  private cacheToken(token: string, payload: IJWTPayload): void {
    const { cacheMaxSize, cacheTTL } = this.options;

    // Evict expired entries if cache is full
    if (this.tokenCache.size >= cacheMaxSize) {
      this.evictExpiredEntries();
    }

    // Evict oldest entries if still full (LRU eviction)
    if (this.tokenCache.size >= cacheMaxSize) {
      const toEvict = Math.ceil(cacheMaxSize * 0.1); // Evict 10%
      const keys = Array.from(this.tokenCache.keys()).slice(0, toEvict);
      for (const key of keys) {
        this.tokenCache.delete(key);
      }
    }

    // Calculate expiry - use token exp or cache TTL, whichever is shorter
    const tokenExp = payload.exp ? payload.exp * 1000 : Date.now() + cacheTTL;
    const cacheExp = Date.now() + cacheTTL;
    const expiresAt = Math.min(tokenExp, cacheExp);

    this.tokenCache.set(token, { payload, expiresAt });
  }

  /**
   * Evict all expired entries from cache.
   */
  private evictExpiredEntries(): void {
    const now = Date.now();
    for (const [key, entry] of this.tokenCache) {
      if (entry.expiresAt <= now) {
        this.tokenCache.delete(key);
      }
    }
  }

  /**
   * Create auth context from token.
   */
  async createContext(token: string): Promise<IAuthContext> {
    const payload = await this.verify(token);
    return createContextFromPayload(payload, this.options.defaultTenantId);
  }

  /**
   * Clear token cache.
   */
  clearCache(): void {
    this.tokenCache.clear();
    this.cacheHits = 0;
    this.cacheMisses = 0;
  }

  /**
   * Get cache statistics.
   */
  getCacheStats(): ITokenCacheStats {
    const total = this.cacheHits + this.cacheMisses;
    return {
      size: this.tokenCache.size,
      maxSize: this.options.cacheMaxSize,
      hits: this.cacheHits,
      misses: this.cacheMisses,
      hitRate: total > 0 ? this.cacheHits / total : 0,
    };
  }

  // === Signed URL Service ===

  /**
   * Create a signed token for pre-signed URLs.
   */
  async createSignedToken(payload: ISignedTokenPayload, expiresIn: number): Promise<string> {
    if (!this.urlSigningSecret) {
      throw new Error('URL signing key not configured');
    }

    return new SignJWT({
      resource_id: payload.resourceId,
      resource_path: payload.resourcePath,
      operation: payload.operation,
      transform: payload.transform,
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime(`${expiresIn}s`)
      .setIssuedAt()
      .sign(this.urlSigningSecret);
  }

  /**
   * Verify a signed URL token.
   */
  async verifySignedToken(token: string): Promise<ISignedTokenPayload> {
    if (!this.urlSigningSecret) {
      throw new Error('URL signing key not configured');
    }

    try {
      const result = await jwtVerify(token, this.urlSigningSecret);
      return {
        resourceId: result.payload['resource_id'] as string,
        resourcePath: result.payload['resource_path'] as string,
        operation: result.payload['operation'] as 'read' | 'write',
        transform: result.payload['transform'] as Record<string, unknown> | undefined,
      };
    } catch {
      throw new InvalidTokenError('Invalid or expired signed URL token');
    }
  }
}
