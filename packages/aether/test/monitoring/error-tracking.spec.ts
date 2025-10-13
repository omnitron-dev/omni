/**
 * @vitest-environment happy-dom
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ErrorTracker, getErrorTracker, resetErrorTracker } from '../../src/monitoring/error-tracking.js';
import type { ErrorInfo } from '../../src/monitoring/types.js';

describe('ErrorTracker', () => {
  let tracker: ErrorTracker;

  beforeEach(() => {
    resetErrorTracker();
    tracker = getErrorTracker({
      autoCapture: false, // Disable auto-capture for tests
      maxBreadcrumbs: 50,
    });
  });

  afterEach(() => {
    tracker.reset();
    resetErrorTracker();
  });

  describe('error tracking', () => {
    it('should track errors', () => {
      const error = new Error('Test error');
      const callback = vi.fn();

      tracker.onError(callback);
      tracker.trackError(error);

      expect(callback).toHaveBeenCalledWith(
        error,
        expect.objectContaining({
          message: 'Test error',
          name: 'Error',
        })
      );
    });

    it('should include stack trace', () => {
      const error = new Error('Test error');
      const callback = vi.fn();

      tracker.onError(callback);
      tracker.trackError(error);

      expect(callback).toHaveBeenCalledWith(
        error,
        expect.objectContaining({
          stack: expect.stringContaining('Error'),
        })
      );
    });

    it('should include custom info', () => {
      const error = new Error('Test error');
      const callback = vi.fn();

      tracker.onError(callback);
      tracker.trackError(error, {
        severity: 'warning',
        tags: { environment: 'test' },
        context: { user: 'test-user' },
      });

      expect(callback).toHaveBeenCalledWith(
        error,
        expect.objectContaining({
          severity: 'warning',
          tags: { environment: 'test' },
          context: expect.objectContaining({ user: 'test-user' }),
        })
      );
    });
  });

  describe('breadcrumbs', () => {
    it('should add breadcrumbs', () => {
      tracker.addBreadcrumb({
        type: 'default',
        message: 'Test breadcrumb',
        level: 'info',
        timestamp: Date.now(),
      });

      const breadcrumbs = tracker.getBreadcrumbs();
      expect(breadcrumbs).toHaveLength(1);
      expect(breadcrumbs[0].message).toBe('Test breadcrumb');
    });

    it('should limit breadcrumbs', () => {
      const maxBreadcrumbs = 50;

      for (let i = 0; i < maxBreadcrumbs + 10; i++) {
        tracker.addBreadcrumb({
          type: 'default',
          message: `Breadcrumb ${i}`,
          level: 'info',
          timestamp: Date.now(),
        });
      }

      const breadcrumbs = tracker.getBreadcrumbs();
      expect(breadcrumbs).toHaveLength(maxBreadcrumbs);
    });

    it('should clear breadcrumbs', () => {
      tracker.addBreadcrumb({
        type: 'default',
        message: 'Test',
        level: 'info',
        timestamp: Date.now(),
      });

      tracker.clearBreadcrumbs();

      expect(tracker.getBreadcrumbs()).toHaveLength(0);
    });
  });

  describe('user context', () => {
    it('should set user', () => {
      tracker.setUser({
        id: 'user-123',
        email: 'test@example.com',
      });

      const callback = vi.fn();
      tracker.onError(callback);

      const error = new Error('Test');
      tracker.trackError(error);

      expect(callback).toHaveBeenCalledWith(
        error,
        expect.objectContaining({
          user: expect.objectContaining({
            id: 'user-123',
            email: 'test@example.com',
          }),
        })
      );
    });

    it('should clear user', () => {
      tracker.setUser({
        id: 'user-123',
      });

      tracker.setUser(null);

      const callback = vi.fn();
      tracker.onError(callback);

      const error = new Error('Test');
      tracker.trackError(error);

      expect(callback).toHaveBeenCalledWith(
        error,
        expect.objectContaining({
          user: null,
        })
      );
    });
  });

  describe('context', () => {
    it('should set context', () => {
      tracker.setContext('page', 'checkout');
      tracker.setContext('experiment', 'variant-a');

      const callback = vi.fn();
      tracker.onError(callback);

      const error = new Error('Test');
      tracker.trackError(error);

      expect(callback).toHaveBeenCalledWith(
        error,
        expect.objectContaining({
          context: expect.objectContaining({
            page: 'checkout',
            experiment: 'variant-a',
          }),
        })
      );
    });

    it('should remove context', () => {
      tracker.setContext('test', 'value');
      tracker.removeContext('test');

      const callback = vi.fn();
      tracker.onError(callback);

      const error = new Error('Test');
      tracker.trackError(error);

      expect(callback).toHaveBeenCalledWith(
        error,
        expect.objectContaining({
          context: expect.not.objectContaining({
            test: expect.anything(),
          }),
        })
      );
    });

    it('should clear all context', () => {
      tracker.setContext('key1', 'value1');
      tracker.setContext('key2', 'value2');
      tracker.clearContext();

      const callback = vi.fn();
      tracker.onError(callback);

      const error = new Error('Test');
      tracker.trackError(error);

      expect(callback).toHaveBeenCalledWith(
        error,
        expect.objectContaining({
          context: expect.not.objectContaining({
            key1: expect.anything(),
            key2: expect.anything(),
          }),
        })
      );
    });
  });

  describe('error fingerprinting', () => {
    it('should generate fingerprint', () => {
      const callback = vi.fn();
      tracker.onError(callback);

      const error = new Error('Test error');
      tracker.trackError(error);

      expect(callback).toHaveBeenCalledWith(
        error,
        expect.objectContaining({
          fingerprint: expect.arrayContaining(['Error']),
        })
      );
    });

    it('should use custom fingerprint', () => {
      const callback = vi.fn();
      tracker.onError(callback);

      const error = new Error('Test error');
      tracker.trackError(error, {
        fingerprint: ['custom', 'fingerprint'],
      });

      expect(callback).toHaveBeenCalledWith(
        error,
        expect.objectContaining({
          fingerprint: ['custom', 'fingerprint'],
        })
      );
    });
  });

  describe('error counting', () => {
    it('should count errors', () => {
      const error = new Error('Test error');

      tracker.trackError(error);
      tracker.trackError(error);
      tracker.trackError(error);

      expect(tracker.getErrorCount()).toBe(3);
    });
  });
});
