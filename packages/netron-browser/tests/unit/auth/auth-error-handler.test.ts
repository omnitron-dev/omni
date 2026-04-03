/**
 * Error Handler Tests
 *
 * Tests for authentication error handling including:
 * - 401 triggers token refresh
 * - 401 with failed refresh clears auth
 * - 403 emits access denied event
 * - 429 emits rate limited event
 * - Retry after refresh works
 */

import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import type { AuthContext, TokenStorage, AuthResult } from '../../../src/auth/types.js';
import { MemoryTokenStorage } from '../../../src/auth/storage.js';

/**
 * HTTP error with status code
 */
class HttpError extends Error {
  constructor(
    message: string,
    public status: number,
    public retryAfter?: number
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

/**
 * Request configuration for retry
 */
interface RequestConfig {
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: any;
}

/**
 * Auth error handler with automatic token refresh
 */
class AuthErrorHandler {
  private storage: TokenStorage;
  private token: string | null = null;
  private refreshToken: string | null = null;
  private context: AuthContext | undefined;
  private authenticated = false;
  private eventHandlers = new Map<string, Set<(data: any) => void>>();

  // Refresh state
  private refreshPromise: Promise<AuthResult> | null = null;
  private refreshFn: (() => Promise<AuthResult>) | null = null;

  // Request retry queue
  private pendingRequests: Array<{
    config: RequestConfig;
    resolve: (value: any) => void;
    reject: (reason: any) => void;
  }> = [];

  constructor(storage: TokenStorage) {
    this.storage = storage;
    this.restoreFromStorage();
  }

  private restoreFromStorage(): void {
    const token = this.storage.getToken();
    if (token) {
      this.token = token;
      this.authenticated = true;
    }
  }

  setAuth(token: string, refreshToken: string, context?: AuthContext): void {
    this.token = token;
    this.refreshToken = refreshToken;
    this.context = context;
    this.authenticated = true;
    this.storage.setToken(token);
    this.emit('authenticated', { context });
  }

  clearAuth(): void {
    this.token = null;
    this.refreshToken = null;
    this.context = undefined;
    this.authenticated = false;
    this.storage.removeToken();
    this.emit('unauthenticated', {});
  }

  getToken(): string | null {
    return this.token;
  }

  getRefreshToken(): string | null {
    return this.refreshToken;
  }

  isAuthenticated(): boolean {
    return this.authenticated;
  }

  setRefreshFunction(fn: () => Promise<AuthResult>): void {
    this.refreshFn = fn;
  }

  /**
   * Handle HTTP error response
   */
  async handleError(error: HttpError, originalRequest?: RequestConfig): Promise<any> {
    switch (error.status) {
      case 401:
        return this.handle401(error, originalRequest);
      case 403:
        return this.handle403(error);
      case 429:
        return this.handle429(error);
      default:
        throw error;
    }
  }

  /**
   * Handle 401 Unauthorized - attempt token refresh
   */
  private async handle401(error: HttpError, originalRequest?: RequestConfig): Promise<any> {
    if (!this.refreshToken || !this.refreshFn) {
      // No refresh token or function - clear auth
      this.clearAuth();
      this.emit('auth-error', { status: 401, error: 'No refresh token available' });
      throw error;
    }

    try {
      // Attempt refresh
      const result = await this.refresh();

      if (result.success && originalRequest) {
        // Retry original request with new token
        return this.retryRequest(originalRequest);
      } else if (!result.success) {
        this.clearAuth();
        this.emit('auth-error', { status: 401, error: result.error });
        throw error;
      }
    } catch (refreshError) {
      this.clearAuth();
      this.emit('auth-error', { status: 401, error: 'Token refresh failed' });
      throw error;
    }
  }

  /**
   * Handle 403 Forbidden - access denied
   */
  private handle403(error: HttpError): never {
    this.emit('access-denied', {
      status: 403,
      message: error.message,
    });
    throw error;
  }

  /**
   * Handle 429 Too Many Requests - rate limited
   */
  private handle429(error: HttpError): never {
    this.emit('rate-limited', {
      status: 429,
      message: error.message,
      retryAfter: error.retryAfter,
    });
    throw error;
  }

  /**
   * Refresh token with coalescing
   */
  async refresh(): Promise<AuthResult> {
    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    if (!this.refreshFn) {
      return { success: false, error: 'No refresh function configured' };
    }

    this.refreshPromise = this.refreshFn()
      .then((result) => {
        if (result.success && result.metadata?.token) {
          this.token = result.metadata.token;
          this.refreshToken = result.metadata.refreshToken || this.refreshToken;
          this.context = result.context;
          this.storage.setToken(this.token);
          this.emit('token-refreshed', { success: true });
        }
        return result;
      })
      .finally(() => {
        this.refreshPromise = null;
      });

    return this.refreshPromise;
  }

  /**
   * Retry a request with updated token
   */
  private async retryRequest(config: RequestConfig): Promise<any> {
    // Update authorization header
    const headers = {
      ...config.headers,
      Authorization: `Bearer ${this.token}`,
    };

    this.emit('request-retry', {
      method: config.method,
      url: config.url,
    });

    // Return the updated config for the caller to execute
    return { ...config, headers };
  }

  /**
   * Queue a request for retry after refresh
   */
  queueRequest(config: RequestConfig): Promise<any> {
    return new Promise((resolve, reject) => {
      this.pendingRequests.push({ config, resolve, reject });
    });
  }

  /**
   * Process queued requests after successful refresh
   */
  async processQueue(): Promise<void> {
    const requests = [...this.pendingRequests];
    this.pendingRequests = [];

    for (const { config, resolve, reject } of requests) {
      try {
        const result = await this.retryRequest(config);
        resolve(result);
      } catch (error) {
        reject(error);
      }
    }
  }

  /**
   * Clear queued requests on auth failure
   */
  clearQueue(error: Error): void {
    const requests = [...this.pendingRequests];
    this.pendingRequests = [];

    for (const { reject } of requests) {
      reject(error);
    }
  }

  on(event: string, handler: (data: any) => void): void {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, new Set());
    }
    this.eventHandlers.get(event)!.add(handler);
  }

  off(event: string, handler: (data: any) => void): void {
    this.eventHandlers.get(event)?.delete(handler);
  }

  private emit(event: string, data: any): void {
    this.eventHandlers.get(event)?.forEach((handler) => {
      try {
        handler(data);
      } catch (error) {
        console.error(`Error in ${event} handler:`, error);
      }
    });
  }

  destroy(): void {
    this.eventHandlers.clear();
    this.clearQueue(new Error('Handler destroyed'));
  }
}

describe('Auth Error Handler', () => {
  let storage: MemoryTokenStorage;
  let handler: AuthErrorHandler;
  let mockRefresh: Mock<() => Promise<AuthResult>>;

  beforeEach(() => {
    storage = new MemoryTokenStorage();
    handler = new AuthErrorHandler(storage);
    mockRefresh = vi.fn();
    handler.setRefreshFunction(mockRefresh);
  });

  afterEach(() => {
    handler.destroy();
    vi.clearAllMocks();
  });

  describe('401 triggers token refresh', () => {
    it('should attempt token refresh on 401', async () => {
      handler.setAuth('access-token', 'refresh-token');

      mockRefresh.mockResolvedValueOnce({
        success: true,
        context: {
          userId: 'user-123',
          roles: ['user'],
          permissions: ['read'],
        },
        metadata: {
          token: 'new-access-token',
          refreshToken: 'new-refresh-token',
        },
      });

      const error = new HttpError('Unauthorized', 401);
      const request: RequestConfig = {
        method: 'GET',
        url: '/api/data',
        headers: { Authorization: 'Bearer access-token' },
      };

      await handler.handleError(error, request);

      expect(mockRefresh).toHaveBeenCalledTimes(1);
    });

    it('should update token after successful refresh', async () => {
      handler.setAuth('old-token', 'refresh-token');

      mockRefresh.mockResolvedValueOnce({
        success: true,
        context: {
          userId: 'user-123',
          roles: ['user'],
          permissions: ['read'],
        },
        metadata: {
          token: 'new-access-token',
          refreshToken: 'new-refresh-token',
        },
      });

      const error = new HttpError('Unauthorized', 401);
      await handler.handleError(error, { method: 'GET', url: '/api/data' });

      expect(handler.getToken()).toBe('new-access-token');
      expect(handler.getRefreshToken()).toBe('new-refresh-token');
    });

    it('should emit token-refreshed event on success', async () => {
      handler.setAuth('token', 'refresh-token');

      const refreshHandler = vi.fn();
      handler.on('token-refreshed', refreshHandler);

      mockRefresh.mockResolvedValueOnce({
        success: true,
        context: {
          userId: 'user-123',
          roles: ['user'],
          permissions: ['read'],
        },
        metadata: { token: 'new-token' },
      });

      const error = new HttpError('Unauthorized', 401);
      await handler.handleError(error, { method: 'GET', url: '/api/data' });

      expect(refreshHandler).toHaveBeenCalledWith({ success: true });
    });

    it('should persist new token to storage', async () => {
      handler.setAuth('old-token', 'refresh-token');

      mockRefresh.mockResolvedValueOnce({
        success: true,
        context: {
          userId: 'user-123',
          roles: ['user'],
          permissions: ['read'],
        },
        metadata: { token: 'persisted-token' },
      });

      const error = new HttpError('Unauthorized', 401);
      await handler.handleError(error, { method: 'GET', url: '/api/data' });

      expect(storage.getToken()).toBe('persisted-token');
    });
  });

  describe('401 with failed refresh clears auth', () => {
    it('should clear auth when refresh fails', async () => {
      handler.setAuth('token', 'refresh-token');

      mockRefresh.mockResolvedValueOnce({
        success: false,
        error: 'Refresh token expired',
      });

      const error = new HttpError('Unauthorized', 401);

      await expect(handler.handleError(error, { method: 'GET', url: '/api/data' })).rejects.toThrow('Unauthorized');

      expect(handler.isAuthenticated()).toBe(false);
      expect(handler.getToken()).toBeNull();
    });

    it('should emit auth-error event on refresh failure', async () => {
      handler.setAuth('token', 'refresh-token');

      const errorHandler = vi.fn();
      handler.on('auth-error', errorHandler);

      mockRefresh.mockResolvedValueOnce({
        success: false,
        error: 'Invalid refresh token',
      });

      const error = new HttpError('Unauthorized', 401);
      await expect(handler.handleError(error)).rejects.toThrow();

      expect(errorHandler).toHaveBeenCalledWith({
        status: 401,
        error: 'Invalid refresh token',
      });
    });

    it('should clear auth when refresh throws', async () => {
      handler.setAuth('token', 'refresh-token');

      mockRefresh.mockRejectedValueOnce(new Error('Network error'));

      const error = new HttpError('Unauthorized', 401);
      await expect(handler.handleError(error)).rejects.toThrow();

      expect(handler.isAuthenticated()).toBe(false);
    });

    it('should clear auth when no refresh token exists', async () => {
      handler.setAuth('token', ''); // No refresh token

      const errorHandler = vi.fn();
      handler.on('auth-error', errorHandler);

      const error = new HttpError('Unauthorized', 401);
      await expect(handler.handleError(error)).rejects.toThrow();

      expect(handler.isAuthenticated()).toBe(false);
      expect(errorHandler).toHaveBeenCalledWith({
        status: 401,
        error: 'No refresh token available',
      });
    });

    it('should remove token from storage on failure', async () => {
      handler.setAuth('token', 'refresh-token');
      expect(storage.hasToken()).toBe(true);

      mockRefresh.mockResolvedValueOnce({
        success: false,
        error: 'Expired',
      });

      const error = new HttpError('Unauthorized', 401);
      await expect(handler.handleError(error)).rejects.toThrow();

      expect(storage.hasToken()).toBe(false);
    });
  });

  describe('403 emits access denied event', () => {
    it('should emit access-denied event on 403', async () => {
      handler.setAuth('token', 'refresh-token');

      const accessDeniedHandler = vi.fn();
      handler.on('access-denied', accessDeniedHandler);

      const error = new HttpError('Forbidden: Insufficient permissions', 403);

      await expect(handler.handleError(error)).rejects.toThrow('Forbidden');

      expect(accessDeniedHandler).toHaveBeenCalledWith({
        status: 403,
        message: 'Forbidden: Insufficient permissions',
      });
    });

    it('should not attempt refresh on 403', async () => {
      handler.setAuth('token', 'refresh-token');

      const error = new HttpError('Forbidden', 403);

      await expect(handler.handleError(error)).rejects.toThrow();

      expect(mockRefresh).not.toHaveBeenCalled();
    });

    it('should not clear auth on 403', async () => {
      handler.setAuth('token', 'refresh-token');

      const error = new HttpError('Forbidden', 403);

      await expect(handler.handleError(error)).rejects.toThrow();

      expect(handler.isAuthenticated()).toBe(true);
      expect(handler.getToken()).toBe('token');
    });

    it('should re-throw 403 error', async () => {
      handler.setAuth('token', 'refresh-token');

      const error = new HttpError('Access denied', 403);

      await expect(handler.handleError(error)).rejects.toThrow('Access denied');
    });
  });

  describe('429 emits rate limited event', () => {
    it('should emit rate-limited event on 429', async () => {
      handler.setAuth('token', 'refresh-token');

      const rateLimitHandler = vi.fn();
      handler.on('rate-limited', rateLimitHandler);

      const error = new HttpError('Too Many Requests', 429, 60);

      await expect(handler.handleError(error)).rejects.toThrow('Too Many Requests');

      expect(rateLimitHandler).toHaveBeenCalledWith({
        status: 429,
        message: 'Too Many Requests',
        retryAfter: 60,
      });
    });

    it('should include retry-after in event', async () => {
      handler.setAuth('token', 'refresh-token');

      const rateLimitHandler = vi.fn();
      handler.on('rate-limited', rateLimitHandler);

      const error = new HttpError('Rate limited', 429, 120);

      await expect(handler.handleError(error)).rejects.toThrow();

      expect(rateLimitHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          retryAfter: 120,
        })
      );
    });

    it('should not attempt refresh on 429', async () => {
      handler.setAuth('token', 'refresh-token');

      const error = new HttpError('Rate limited', 429);

      await expect(handler.handleError(error)).rejects.toThrow();

      expect(mockRefresh).not.toHaveBeenCalled();
    });

    it('should handle 429 without retry-after', async () => {
      handler.setAuth('token', 'refresh-token');

      const rateLimitHandler = vi.fn();
      handler.on('rate-limited', rateLimitHandler);

      const error = new HttpError('Rate limited', 429);

      await expect(handler.handleError(error)).rejects.toThrow();

      expect(rateLimitHandler).toHaveBeenCalledWith({
        status: 429,
        message: 'Rate limited',
        retryAfter: undefined,
      });
    });
  });

  describe('retry after refresh works', () => {
    it('should retry original request after refresh', async () => {
      handler.setAuth('old-token', 'refresh-token');

      mockRefresh.mockResolvedValueOnce({
        success: true,
        context: {
          userId: 'user-123',
          roles: ['user'],
          permissions: ['read'],
        },
        metadata: { token: 'new-token' },
      });

      const retryHandler = vi.fn();
      handler.on('request-retry', retryHandler);

      const error = new HttpError('Unauthorized', 401);
      const originalRequest: RequestConfig = {
        method: 'POST',
        url: '/api/resource',
        headers: { Authorization: 'Bearer old-token' },
        body: { data: 'test' },
      };

      const result = await handler.handleError(error, originalRequest);

      expect(retryHandler).toHaveBeenCalledWith({
        method: 'POST',
        url: '/api/resource',
      });

      expect(result.headers.Authorization).toBe('Bearer new-token');
    });

    it('should update authorization header in retry', async () => {
      handler.setAuth('expired-token', 'refresh-token');

      mockRefresh.mockResolvedValueOnce({
        success: true,
        context: {
          userId: 'user-123',
          roles: ['user'],
          permissions: ['read'],
        },
        metadata: { token: 'valid-token' },
      });

      const error = new HttpError('Unauthorized', 401);
      const originalRequest: RequestConfig = {
        method: 'GET',
        url: '/api/protected',
        headers: {
          Authorization: 'Bearer expired-token',
          'Content-Type': 'application/json',
        },
      };

      const result = await handler.handleError(error, originalRequest);

      expect(result.headers.Authorization).toBe('Bearer valid-token');
      expect(result.headers['Content-Type']).toBe('application/json');
    });

    it('should preserve request body in retry', async () => {
      handler.setAuth('token', 'refresh-token');

      mockRefresh.mockResolvedValueOnce({
        success: true,
        context: {
          userId: 'user-123',
          roles: ['user'],
          permissions: ['read'],
        },
        metadata: { token: 'new-token' },
      });

      const error = new HttpError('Unauthorized', 401);
      const requestBody = { action: 'update', id: 123 };
      const originalRequest: RequestConfig = {
        method: 'PUT',
        url: '/api/items/123',
        body: requestBody,
      };

      const result = await handler.handleError(error, originalRequest);

      expect(result.body).toEqual(requestBody);
    });

    it('should coalesce multiple 401 errors during refresh', async () => {
      handler.setAuth('token', 'refresh-token');

      let resolveRefresh: (result: AuthResult) => void;
      mockRefresh.mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveRefresh = resolve;
          })
      );

      const error = new HttpError('Unauthorized', 401);

      // Start multiple error handling simultaneously
      const promise1 = handler.handleError(error, { method: 'GET', url: '/api/1' });
      const promise2 = handler.handleError(error, { method: 'GET', url: '/api/2' });
      const promise3 = handler.handleError(error, { method: 'GET', url: '/api/3' });

      // Resolve refresh
      resolveRefresh!({
        success: true,
        context: {
          userId: 'user-123',
          roles: ['user'],
          permissions: ['read'],
        },
        metadata: { token: 'shared-new-token' },
      });

      const [result1, result2, result3] = await Promise.all([promise1, promise2, promise3]);

      // Only one refresh call should have been made
      expect(mockRefresh).toHaveBeenCalledTimes(1);

      // All results should have the new token
      expect(result1.headers.Authorization).toBe('Bearer shared-new-token');
      expect(result2.headers.Authorization).toBe('Bearer shared-new-token');
      expect(result3.headers.Authorization).toBe('Bearer shared-new-token');
    });
  });

  describe('request queue management', () => {
    it('should queue requests during refresh', async () => {
      handler.setAuth('token', 'refresh-token');

      const request1: RequestConfig = { method: 'GET', url: '/api/1' };
      const request2: RequestConfig = { method: 'GET', url: '/api/2' };

      const queuedPromise1 = handler.queueRequest(request1);
      const queuedPromise2 = handler.queueRequest(request2);

      // Process queue
      await handler.processQueue();

      const [result1, result2] = await Promise.all([queuedPromise1, queuedPromise2]);

      expect(result1.url).toBe('/api/1');
      expect(result2.url).toBe('/api/2');
    });

    it('should clear queue on auth failure', async () => {
      handler.setAuth('token', 'refresh-token');

      const request: RequestConfig = { method: 'GET', url: '/api/data' };
      const queuedPromise = handler.queueRequest(request);

      handler.clearQueue(new Error('Auth failed'));

      await expect(queuedPromise).rejects.toThrow('Auth failed');
    });
  });

  describe('other error codes', () => {
    it('should pass through non-auth errors', async () => {
      handler.setAuth('token', 'refresh-token');

      const error = new HttpError('Not Found', 404);

      await expect(handler.handleError(error)).rejects.toThrow('Not Found');

      expect(mockRefresh).not.toHaveBeenCalled();
    });

    it('should pass through 500 errors', async () => {
      handler.setAuth('token', 'refresh-token');

      const error = new HttpError('Internal Server Error', 500);

      await expect(handler.handleError(error)).rejects.toThrow('Internal Server Error');
    });
  });
});
