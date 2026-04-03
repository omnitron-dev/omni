/**
 * Auth Module
 *
 * Unified JWT authentication for distributed systems with multi-algorithm support,
 * token caching, and Netron HTTP middleware integration.
 *
 * @module titan/modules/auth
 *
 * @example
 * Module registration:
 * ```typescript
 * import { TitanAuthModule, JWT_SERVICE_TOKEN } from '@omnitron-dev/titan/module/auth';
 *
 * @Module({
 *   imports: [
 *     TitanAuthModule.forRoot({
 *       algorithm: 'HS256',
 *       jwtSecret: process.env.JWT_SECRET,
 *       serviceKey: process.env.SERVICE_KEY,
 *       cacheEnabled: true,
 *       cacheMaxSize: 1000,
 *       cacheTTL: 300000,
 *     }),
 *   ],
 * })
 * export class AppModule {}
 * ```
 *
 * @example
 * Using JWT service:
 * ```typescript
 * import { JWT_SERVICE_TOKEN, type IJWTService } from '@omnitron-dev/titan/module/auth';
 *
 * @Injectable()
 * class AuthService {
 *   constructor(
 *     @Inject(JWT_SERVICE_TOKEN)
 *     private readonly jwtService: IJWTService
 *   ) {}
 *
 *   async verifyToken(token: string) {
 *     const payload = await this.jwtService.verify(token);
 *     console.log(`User: ${payload.sub}, Role: ${payload.role}`);
 *   }
 * }
 * ```
 *
 * @example
 * Using auth middleware:
 * ```typescript
 * import { AUTH_MIDDLEWARE_TOKEN, type IAuthMiddleware } from '@omnitron-dev/titan/module/auth';
 *
 * @Injectable()
 * class ApiHandler {
 *   constructor(
 *     @Inject(AUTH_MIDDLEWARE_TOKEN)
 *     private readonly authMiddleware: IAuthMiddleware
 *   ) {}
 *
 *   async handleRequest(request: Request) {
 *     const context = await this.authMiddleware.authenticateRequired(request);
 *     console.log(`Authenticated user: ${context.userId}`);
 *   }
 * }
 * ```
 *
 * @example
 * Using decorators:
 * ```typescript
 * import { RequireAuth, AUTH_MIDDLEWARE_TOKEN } from '@omnitron-dev/titan/module/auth';
 *
 * @Injectable()
 * class UserService {
 *   constructor(
 *     @Inject(AUTH_MIDDLEWARE_TOKEN)
 *     private readonly __authMiddleware__: IAuthMiddleware
 *   ) {}
 *
 *   @RequireAuth({ roles: ['admin'] })
 *   async deleteUser(request: Request, userId: string) {
 *     // Only admins can access this method
 *   }
 * }
 * ```
 */

// Types
export * from './auth.types.js';

// Tokens
export * from './auth.tokens.js';

// Utilities
export * from './auth.utils.js';

// Services
export { JWTService, InvalidTokenError, TokenExpiredError } from './auth.jwt.service.js';
export { AuthMiddleware, UnauthorizedError, createHttpAuthMiddleware } from './auth.middleware.js';

// Decorators
export * from './auth.decorators.js';

// Guards
export * from './auth.guards.js';

// Module
export * from './auth.module.js';
