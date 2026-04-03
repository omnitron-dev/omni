/**
 * Comprehensive tests for HTTP-specific error classes
 */

import { describe, it, expect } from 'vitest';
import { HttpError, AuthError, PermissionError, RateLimitError } from '../../src/errors/http.js';

describe('HTTP Errors', () => {
  describe('HttpError', () => {
    it('should create with status code and message', () => {
      const error = new HttpError(404, 'Not found');

      expect(error.code).toBe(404);
      expect(error.message).toBe('Not found');
      expect(error.httpStatus).toBe(404);
    });

    it('should include details', () => {
      const error = new HttpError(400, 'Bad request', { field: 'email' });

      expect(error.details).toEqual({ field: 'email' });
    });

    it('should create badRequest error', () => {
      const error = HttpError.badRequest();

      expect(error.code).toBe(400);
      expect(error.message).toBe('Bad Request');
    });

    it('should create unauthorized error', () => {
      const error = HttpError.unauthorized();

      expect(error.code).toBe(401);
      expect(error.message).toBe('Unauthorized');
    });

    it('should create forbidden error', () => {
      const error = HttpError.forbidden();

      expect(error.code).toBe(403);
      expect(error.message).toBe('Forbidden');
    });

    it('should create notFound error', () => {
      const error = HttpError.notFound();

      expect(error.code).toBe(404);
      expect(error.message).toBe('Not Found');
    });

    it('should create methodNotAllowed error', () => {
      const error = HttpError.methodNotAllowed();

      expect(error.code).toBe(405);
      expect(error.message).toBe('Method Not Allowed');
    });

    it('should create conflict error', () => {
      const error = HttpError.conflict();

      expect(error.code).toBe(409);
      expect(error.message).toBe('Conflict');
    });

    it('should create unprocessableEntity error', () => {
      const error = HttpError.unprocessableEntity();

      expect(error.code).toBe(422);
      expect(error.message).toBe('Unprocessable Entity');
    });

    it('should create tooManyRequests error', () => {
      const error = HttpError.tooManyRequests();

      expect(error.code).toBe(429);
      expect(error.message).toBe('Too Many Requests');
    });

    it('should create internalServerError', () => {
      const error = HttpError.internalServerError();

      expect(error.code).toBe(500);
      expect(error.message).toBe('Internal Server Error');
    });

    it('should create notImplemented error', () => {
      const error = HttpError.notImplemented();

      expect(error.code).toBe(501);
      expect(error.message).toBe('Not Implemented');
    });

    it('should create badGateway error', () => {
      const error = HttpError.badGateway();

      expect(error.code).toBe(502);
      expect(error.message).toBe('Bad Gateway');
    });

    it('should create serviceUnavailable error', () => {
      const error = HttpError.serviceUnavailable();

      expect(error.code).toBe(503);
      expect(error.message).toBe('Service Unavailable');
    });

    it('should create gatewayTimeout error', () => {
      const error = HttpError.gatewayTimeout();

      expect(error.code).toBe(504);
      expect(error.message).toBe('Gateway Timeout');
    });

    it('should create from status code', () => {
      const error = HttpError.fromStatus(404);

      expect(error.code).toBe(404);
      expect(error.message).toBe('Not Found');
    });

    it('should use custom message with fromStatus', () => {
      const error = HttpError.fromStatus(404, 'Custom not found');

      expect(error.code).toBe(404);
      expect(error.message).toBe('Custom not found');
    });

    it('should handle unmapped status codes', () => {
      const error = HttpError.fromStatus(418);

      expect(error.code).toBe(418);
      expect(error.message).toBe('HTTP 418');
    });

    it('should support custom messages', () => {
      const error = HttpError.notFound('User not found', { userId: '123' });

      expect(error.message).toBe('User not found');
      expect(error.details).toEqual({ userId: '123' });
    });
  });

  describe('AuthError', () => {
    it('should create auth error', () => {
      const error = new AuthError();

      expect(error.code).toBe(401);
      expect(error.message).toBe('Authentication required');
    });

    it('should create with custom message', () => {
      const error = new AuthError('Invalid credentials');

      expect(error.message).toBe('Invalid credentials');
    });

    it('should create bearerTokenRequired error', () => {
      const error = AuthError.bearerTokenRequired();

      expect(error.code).toBe(401);
      expect(error.message).toBe('Bearer token required');
      expect(error.authType).toBe('Bearer');
      expect(error.realm).toBe('api');
    });

    it('should create bearerTokenRequired with custom realm', () => {
      const error = AuthError.bearerTokenRequired('admin');

      expect(error.realm).toBe('admin');
    });

    it('should create invalidToken error', () => {
      const error = AuthError.invalidToken();

      expect(error.message).toBe('Invalid token');
    });

    it('should create invalidToken with reason', () => {
      const error = AuthError.invalidToken('Token signature mismatch');

      expect(error.message).toBe('Token signature mismatch');
      expect(error.details.reason).toBe('Token signature mismatch');
    });

    it('should create tokenExpired error', () => {
      const error = AuthError.tokenExpired();

      expect(error.message).toBe('Token has expired');
      expect(error.details.expired).toBe(true);
    });

    it('should get authenticate header for Bearer', () => {
      const error = new AuthError('Auth required', undefined, {
        authType: 'Bearer',
        realm: 'api',
      });

      const header = error.getAuthenticateHeader();

      expect(header).toBe('Bearer realm="api"');
    });

    it('should get authenticate header for Basic', () => {
      const error = new AuthError('Auth required', undefined, {
        authType: 'Basic',
        realm: 'admin',
      });

      const header = error.getAuthenticateHeader();

      expect(header).toBe('Basic realm="admin"');
    });

    it('should get default authenticate header', () => {
      const error = new AuthError();

      const header = error.getAuthenticateHeader();

      expect(header).toBe('Bearer');
    });

    it('should get authenticate header with authType only', () => {
      const error = new AuthError('Auth required', undefined, {
        authType: 'Custom',
      });

      const header = error.getAuthenticateHeader();

      expect(header).toBe('Custom');
    });
  });

  describe('PermissionError', () => {
    it('should create permission error', () => {
      const error = new PermissionError();

      expect(error.code).toBe(403);
      expect(error.message).toBe('Permission denied');
    });

    it('should create with custom message', () => {
      const error = new PermissionError('Access denied');

      expect(error.message).toBe('Access denied');
    });

    it('should create insufficientPermissions error', () => {
      const error = PermissionError.insufficientPermissions('admin');

      expect(error.code).toBe(403);
      expect(error.message).toContain('Insufficient permissions');
      expect(error.message).toContain('admin');
      expect(error.requiredPermission).toBe('admin');
    });

    it('should create insufficientPermissions with user permissions', () => {
      const error = PermissionError.insufficientPermissions('admin', ['read', 'write']);

      expect(error.requiredPermission).toBe('admin');
      expect(error.userPermissions).toEqual(['read', 'write']);
      expect(error.details.userPermissions).toEqual(['read', 'write']);
    });

    it('should serialize with permission fields', () => {
      const error = new PermissionError('No access', undefined, {
        requiredPermission: 'delete',
        userPermissions: ['read'],
      });

      const json = error.toJSON();

      expect(json.requiredPermission).toBe('delete');
      expect(json.userPermissions).toEqual(['read']);
    });
  });

  describe('RateLimitError', () => {
    it('should create rate limit error', () => {
      const error = new RateLimitError();

      expect(error.code).toBe(429);
      expect(error.message).toBe('Rate limit exceeded');
    });

    it('should create with rate limit info', () => {
      const resetTime = new Date(Date.now() + 3600000);
      const error = new RateLimitError('Too many requests', undefined, {
        limit: 100,
        remaining: 0,
        resetTime,
        retryAfter: 3600,
      });

      expect(error.limit).toBe(100);
      expect(error.remaining).toBe(0);
      expect(error.resetTime).toBe(resetTime);
      expect(error.retryAfter).toBe(3600);
    });

    it('should get rate limit headers', () => {
      const resetTime = new Date('2024-01-01T12:00:00Z');
      const error = new RateLimitError('Rate limited', undefined, {
        limit: 1000,
        remaining: 10,
        resetTime,
        retryAfter: 60,
      });

      const headers = error.getRateLimitHeaders();

      expect(headers['X-RateLimit-Limit']).toBe('1000');
      expect(headers['X-RateLimit-Remaining']).toBe('10');
      expect(headers['X-RateLimit-Reset']).toBe(String(Math.floor(resetTime.getTime() / 1000)));
      expect(headers['Retry-After']).toBe('60');
    });

    it('should handle missing rate limit fields', () => {
      const error = new RateLimitError();

      const headers = error.getRateLimitHeaders();

      expect(headers['X-RateLimit-Limit']).toBeUndefined();
      expect(headers['X-RateLimit-Remaining']).toBeUndefined();
      expect(headers['X-RateLimit-Reset']).toBeUndefined();
      expect(headers['Retry-After']).toBeUndefined();
    });

    it('should serialize with rate limit fields', () => {
      const resetTime = new Date('2024-01-01T12:00:00Z');
      const error = new RateLimitError('Rate limited', undefined, {
        limit: 100,
        remaining: 0,
        resetTime,
        retryAfter: 60,
      });

      const json = error.toJSON();

      expect(json.limit).toBe(100);
      expect(json.remaining).toBe(0);
      expect(json.resetTime).toBe(resetTime.toISOString());
      expect(json.retryAfter).toBe(60);
    });

    it('should include retryAfter in details', () => {
      const error = new RateLimitError('Too many requests', undefined, {
        retryAfter: 120,
      });

      expect(error.details.retryAfter).toBe(120);
    });
  });
});
