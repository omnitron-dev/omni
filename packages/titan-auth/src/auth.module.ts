/**
 * Auth Module
 *
 * Titan DI module for unified JWT authentication.
 *
 * @module titan/modules/auth
 */

import { Module } from '@omnitron-dev/titan/decorators';
import type { DynamicModule, ProviderDefinition, InjectionToken, Provider } from '@omnitron-dev/titan/nexus';
import { JWTService } from './auth.jwt.service.js';
import { AuthMiddleware } from './auth.middleware.js';
import {
  JWT_SERVICE_TOKEN,
  AUTH_MIDDLEWARE_TOKEN,
  SIGNED_URL_SERVICE_TOKEN,
  AUTH_OPTIONS_TOKEN,
} from './auth.tokens.js';
import type { IAuthModuleOptions, IAuthModuleAsyncOptions } from './auth.types.js';

/**
 * Default auth module options.
 */
const DEFAULT_OPTIONS: IAuthModuleOptions = {
  algorithm: 'HS256',
  defaultTenantId: 'default',
  cacheEnabled: true,
  cacheMaxSize: 1000,
  cacheTTL: 300000, // 5 minutes
  isGlobal: false,
};

/**
 * Titan Auth Module
 *
 * Provides unified JWT authentication with:
 * - Multi-algorithm support (HS256, RS256, ES256)
 * - Remote JWKS for asymmetric key verification
 * - Token caching with configurable TTL
 * - HTTP middleware for request authentication
 * - API key validation with constant-time comparison
 * - Signed URL token support
 *
 * @example
 * Static configuration with HS256:
 * ```typescript
 * @Module({
 *   imports: [
 *     TitanAuthModule.forRoot({
 *       algorithm: 'HS256',
 *       jwtSecret: process.env.JWT_SECRET,
 *       serviceKey: process.env.SERVICE_KEY,
 *       anonKey: process.env.ANON_KEY,
 *     }),
 *   ],
 * })
 * export class AppModule {}
 * ```
 *
 * @example
 * Async configuration with JWKS:
 * ```typescript
 * @Module({
 *   imports: [
 *     TitanAuthModule.forRootAsync({
 *       imports: [ConfigModule],
 *       useFactory: (config: ConfigService) => ({
 *         algorithm: 'RS256',
 *         jwksUrl: config.get('auth.jwksUrl'),
 *         issuer: config.get('auth.issuer'),
 *         audience: config.get('auth.audience'),
 *       }),
 *       inject: [CONFIG_SERVICE_TOKEN],
 *     }),
 *   ],
 * })
 * export class AppModule {}
 * ```
 *
 * @example
 * Using in services:
 * ```typescript
 * @Injectable()
 * class UserService {
 *   constructor(
 *     @Inject(JWT_SERVICE_TOKEN)
 *     private readonly jwtService: IJWTService,
 *     @Inject(AUTH_MIDDLEWARE_TOKEN)
 *     private readonly authMiddleware: IAuthMiddleware
 *   ) {}
 *
 *   async verifyToken(token: string) {
 *     const payload = await this.jwtService.verify(token);
 *     return payload;
 *   }
 *
 *   async handleRequest(request: IRequestLike) {
 *     const context = await this.authMiddleware.authenticate(request);
 *     // Use context.userId, context.role, etc.
 *   }
 * }
 * ```
 *
 * @example
 * Using decorators:
 * ```typescript
 * @Injectable()
 * class AdminService {
 *   constructor(
 *     @Inject(AUTH_MIDDLEWARE_TOKEN)
 *     private readonly __authMiddleware__: IAuthMiddleware
 *   ) {}
 *
 *   @RequireAuth({ roles: ['admin'] })
 *   async deleteUser(request: IRequestLike, userId: string) {
 *     // Only admins can access this
 *     const context = this.__authContext__; // Available after authentication
 *     console.log(`Admin ${context.userId} deleting user ${userId}`);
 *   }
 * }
 * ```
 */
@Module({})
export class TitanAuthModule {
  /**
   * Configure auth module with static options.
   */
  static forRoot(options: IAuthModuleOptions = {}): DynamicModule {
    const mergedOptions = { ...DEFAULT_OPTIONS, ...options };

    const providers: Array<[InjectionToken<unknown>, ProviderDefinition<unknown>] | Provider<unknown>> = [
      [
        AUTH_OPTIONS_TOKEN,
        {
          useValue: mergedOptions,
        },
      ],
      [
        JWT_SERVICE_TOKEN,
        {
          useClass: JWTService,
        },
      ],
      [
        AUTH_MIDDLEWARE_TOKEN,
        {
          useClass: AuthMiddleware,
        },
      ],
      // SignedUrlService uses the same instance as JWTService (implements both interfaces)
      [
        SIGNED_URL_SERVICE_TOKEN,
        {
          useToken: JWT_SERVICE_TOKEN,
        },
      ],
    ];

    const exports: InjectionToken<unknown>[] = [
      JWT_SERVICE_TOKEN,
      AUTH_MIDDLEWARE_TOKEN,
      SIGNED_URL_SERVICE_TOKEN,
      AUTH_OPTIONS_TOKEN,
    ];

    const result: DynamicModule = {
      module: TitanAuthModule,
      providers,
      exports,
    };

    if (mergedOptions.isGlobal) {
      result.global = true;
    }

    return result;
  }

  /**
   * Configure auth module with async options factory.
   */
  static forRootAsync(options: IAuthModuleAsyncOptions): DynamicModule {
    const providers: Array<[InjectionToken<unknown>, ProviderDefinition<unknown>] | Provider<unknown>> = [
      [
        AUTH_OPTIONS_TOKEN,
        {
          useFactory: async (...args: unknown[]): Promise<IAuthModuleOptions> => {
            if (options.useFactory) {
              const result = await options.useFactory(...args);
              return { ...DEFAULT_OPTIONS, ...result };
            }
            return DEFAULT_OPTIONS;
          },
          inject: (options.inject ?? []) as InjectionToken<unknown>[],
        },
      ],
      [
        JWT_SERVICE_TOKEN,
        {
          useClass: JWTService,
        },
      ],
      [
        AUTH_MIDDLEWARE_TOKEN,
        {
          useClass: AuthMiddleware,
        },
      ],
      [
        SIGNED_URL_SERVICE_TOKEN,
        {
          useToken: JWT_SERVICE_TOKEN,
        },
      ],
    ];

    const exports: InjectionToken<unknown>[] = [
      JWT_SERVICE_TOKEN,
      AUTH_MIDDLEWARE_TOKEN,
      SIGNED_URL_SERVICE_TOKEN,
      AUTH_OPTIONS_TOKEN,
    ];

    const result: DynamicModule = {
      module: TitanAuthModule,
      imports: (options.imports as DynamicModule['imports']) ?? [],
      providers,
      exports,
    };

    if (options.isGlobal) {
      result.global = true;
    }

    return result;
  }
}

/**
 * Alias for backward compatibility and shorter name.
 */
export const AuthModule = TitanAuthModule;
