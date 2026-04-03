/**
 * Auth Module Tokens
 *
 * DI tokens for the authentication module.
 *
 * @module titan/modules/auth
 */

import { createToken, type Token } from '@omnitron-dev/titan/nexus';
import type { IJWTService, IAuthMiddleware, ISignedUrlService, IAuthModuleOptions } from './auth.types.js';

/**
 * Token for the JWT service.
 */
export const JWT_SERVICE_TOKEN: Token<IJWTService> = createToken<IJWTService>('AuthModule:JWTService');

/**
 * Token for the auth middleware.
 */
export const AUTH_MIDDLEWARE_TOKEN: Token<IAuthMiddleware> = createToken<IAuthMiddleware>('AuthModule:AuthMiddleware');

/**
 * Token for the signed URL service.
 */
export const SIGNED_URL_SERVICE_TOKEN: Token<ISignedUrlService> = createToken<ISignedUrlService>('AuthModule:SignedUrlService');

/**
 * Token for auth module options.
 */
export const AUTH_OPTIONS_TOKEN: Token<IAuthModuleOptions> = createToken<IAuthModuleOptions>('AuthModule:Options');
