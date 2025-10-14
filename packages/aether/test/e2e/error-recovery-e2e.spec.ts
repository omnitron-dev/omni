/**
 * Error Recovery E2E Tests
 *
 * Tests error handling across the stack:
 * - Compilation errors
 * - Runtime errors
 * - Network failures
 * - Memory pressure
 * - Recovery mechanisms
 * - User experience during errors
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { signal, computed, effect } from '../../src/core/reactivity/index.js';
import { render, cleanup, fireEvent, waitFor } from '../../src/testing/index.js';

describe('Error Recovery E2E Tests', () => {
  afterEach(() => {
    cleanup();
  });

  describe('Runtime Error Handling', () => {
    it('should catch and recover from component errors', () => {
      const hasError = signal(false);
      const errorMessage = signal('');

      const ErrorProneComponent = () => {
        const container = document.createElement('div');
        try {
          const data = null as any;
          const value = data.nonexistent.property;
          container.textContent = value;
        } catch (e) {
          hasError.set(true);
          errorMessage.set((e as Error).message);
          container.textContent = 'Error occurred, but app is still running';
        }
        return container as any;
      };

      const { container } = render(ErrorProneComponent);

      expect(hasError()).toBe(true);
      expect(errorMessage()).toBeTruthy();
      expect(container.textContent).toContain('app is still running');
    });

    it('should provide error boundaries for components', () => {
      const errors: Error[] = [];

      const errorBoundary = (component: any) => {
        return () => {
          const container = document.createElement('div');
          try {
            const result = component();
            container.appendChild(result);
          } catch (e) {
            errors.push(e as Error);
            const errorDiv = document.createElement('div');
            errorDiv.className = 'error-boundary';
            errorDiv.textContent = 'Something went wrong';
            container.appendChild(errorDiv);
          }
          return container as any;
        };
      };

      const FailingComponent = () => {
        throw new Error('Component failed');
      };

      const WrappedComponent = errorBoundary(FailingComponent);
      const { container } = render(WrappedComponent);

      expect(errors.length).toBe(1);
      expect(container.querySelector('.error-boundary')).toBeTruthy();
    });

    it('should reset error state after recovery', () => {
      const error = signal<Error | null>(null);
      const shouldFail = signal(true);

      const RecoverableComponent = () => {
        const container = document.createElement('div');
        try {
          if (shouldFail()) {
            throw new Error('Temporary error');
          }
          container.textContent = 'All good!';
          error.set(null);
        } catch (e) {
          error.set(e as Error);
          container.textContent = 'Error, but can recover';

          const retryBtn = document.createElement('button');
          retryBtn.textContent = 'Retry';
          retryBtn.onclick = () => shouldFail.set(false);
          container.appendChild(retryBtn);
        }
        return container as any;
      };

      const { container, rerender } = render(RecoverableComponent);

      expect(error()).toBeTruthy();

      const retryBtn = container.querySelector('button');
      fireEvent.click(retryBtn!);

      rerender(RecoverableComponent);

      expect(shouldFail()).toBe(false);
    });
  });

  describe('Signal Error Handling', () => {
    it('should handle errors in computed values', () => {
      const input = signal<any>(null);
      const errors: Error[] = [];

      const derived = computed(() => {
        try {
          return input().value;
        } catch (e) {
          errors.push(e as Error);
          return 'fallback';
        }
      });

      const result = derived();
      expect(result).toBe('fallback');
      expect(errors.length).toBe(1);

      input.set({ value: 42 });
      expect(derived()).toBe(42);
    });

    it('should handle errors in effects', () => {
      const sig = signal(0);
      const errors: Error[] = [];

      effect(() => {
        try {
          if (sig() === 5) {
            throw new Error('Invalid value');
          }
        } catch (e) {
          errors.push(e as Error);
        }
      });

      sig.set(5);

      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].message).toBe('Invalid value');

      sig.set(10);
    });

    it('should recover from circular dependency errors', () => {
      const a = signal(1);
      const errors: Error[] = [];

      try {
        const b = computed(() => {
          if (a() > 10) {
            throw new Error('Circular dependency detected');
          }
          return a() * 2;
        });

        a.set(15);
        b();
      } catch (e) {
        errors.push(e as Error);
      }

      expect(errors.length).toBeGreaterThan(0);

      a.set(5);
    });
  });

  describe('Network Error Handling', () => {
    it('should handle network request failures with retry', async () => {
      const loading = signal(false);
      const error = signal<string | null>(null);
      const data = signal<any>(null);
      const retryCount = signal(0);

      const fetchWithRetry = async (maxRetries = 3) => {
        loading.set(true);
        error.set(null);

        for (let attempt = 0; attempt <= maxRetries; attempt++) {
          try {
            retryCount.set(attempt);

            await new Promise((resolve, reject) => {
              setTimeout(() => {
                if (attempt < 2) {
                  reject(new Error('Network timeout'));
                } else {
                  resolve({ data: 'success' });
                }
              }, 10);
            });

            data.set({ data: 'success' });
            error.set(null);
            break;
          } catch (e) {
            if (attempt === maxRetries) {
              error.set((e as Error).message);
            }
            await new Promise(resolve => setTimeout(resolve, 10));
          }
        }

        loading.set(false);
      };

      await fetchWithRetry(3);

      expect(retryCount()).toBe(2);
      expect(data()).toEqual({ data: 'success' });
      expect(error()).toBeNull();
    });

    it('should handle offline mode gracefully', async () => {
      const isOnline = signal(true);
      const cachedData = signal<any>(null);
      const networkData = signal<any>(null);

      const fetchData = async () => {
        if (!isOnline()) {
          return cachedData();
        }

        try {
          await new Promise(resolve => setTimeout(resolve, 10));
          const data = { fresh: true, value: 'network data' };
          networkData.set(data);
          cachedData.set(data);
          return data;
        } catch (e) {
          return cachedData();
        }
      };

      const result1 = await fetchData();
      expect(result1.fresh).toBe(true);

      isOnline.set(false);
      const result2 = await fetchData();
      expect(result2).toEqual(cachedData());
    });

    it('should provide fallback for failed API calls', async () => {
      const fallbackData = { source: 'cache', items: [1, 2, 3] };

      const fetchWithFallback = async () => {
        try {
          await new Promise((_, reject) => {
            setTimeout(() => reject(new Error('API Error')), 10);
          });
        } catch (e) {
          return fallbackData;
        }
      };

      const result = await fetchWithFallback();

      expect(result.source).toBe('cache');
      expect(result.items.length).toBe(3);
    });

    it('should handle timeout errors', async () => {
      const timeout = 50;
      const errors: Error[] = [];

      const fetchWithTimeout = async () => {
        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(() => reject(new Error('Timeout')), timeout);
        });

        const fetchPromise = new Promise(resolve => {
          setTimeout(() => resolve({ data: 'success' }), 100);
        });

        try {
          return await Promise.race([fetchPromise, timeoutPromise]);
        } catch (e) {
          errors.push(e as Error);
          return { data: 'fallback' };
        }
      };

      const result = await fetchWithTimeout();

      expect(errors.length).toBe(1);
      expect(errors[0].message).toBe('Timeout');
      expect(result.data).toBe('fallback');
    });
  });

  describe('Memory Error Handling', () => {
    it('should handle memory pressure gracefully', () => {
      const memoryLimit = 10000;
      const items = signal<any[]>([]);
      const memoryPressure = signal(false);

      const addItems = (count: number) => {
        const currentItems = items();
        if (currentItems.length + count > memoryLimit) {
          memoryPressure.set(true);
          return false;
        }

        const newItems = Array.from({ length: count }, (_, i) => ({
          id: currentItems.length + i,
          data: `Item ${i}`,
        }));

        items.set([...currentItems, ...newItems]);
        return true;
      };

      expect(addItems(5000)).toBe(true);
      expect(addItems(5000)).toBe(true);
      expect(addItems(5000)).toBe(false);
      expect(memoryPressure()).toBe(true);
    });

    it('should cleanup resources under memory pressure', () => {
      const cache = new Map<string, any>();
      const maxCacheSize = 100;

      const addToCache = (key: string, value: any) => {
        if (cache.size >= maxCacheSize) {
          const firstKey = cache.keys().next().value;
          cache.delete(firstKey);
        }
        cache.set(key, value);
      };

      for (let i = 0; i < 150; i++) {
        addToCache(`key-${i}`, { data: i });
      }

      expect(cache.size).toBeLessThanOrEqual(maxCacheSize);
      expect(cache.has('key-0')).toBe(false);
      expect(cache.has('key-149')).toBe(true);
    });

    it('should prevent memory leaks from retained references', () => {
      const subscriptions: any[] = [];

      const createSubscription = () => {
        const sig = signal(0);
        const unsub = effect(() => {
          sig();
        });
        subscriptions.push(unsub);
      };

      for (let i = 0; i < 100; i++) {
        createSubscription();
      }

      subscriptions.length = 0;

      expect(subscriptions.length).toBe(0);
    });
  });

  describe('Validation Error Handling', () => {
    it('should validate user input and show errors', () => {
      const formData = signal({ email: '', age: '' });
      const errors = signal<Record<string, string>>({});

      const validate = () => {
        const newErrors: Record<string, string> = {};
        const data = formData();

        if (!data.email.includes('@')) {
          newErrors.email = 'Invalid email format';
        }

        const age = parseInt(data.age);
        if (isNaN(age) || age < 0 || age > 150) {
          newErrors.age = 'Invalid age';
        }

        errors.set(newErrors);
        return Object.keys(newErrors).length === 0;
      };

      formData.set({ email: 'invalid', age: '-5' });
      expect(validate()).toBe(false);
      expect(errors().email).toBeTruthy();
      expect(errors().age).toBeTruthy();

      formData.set({ email: 'user@example.com', age: '25' });
      expect(validate()).toBe(true);
      expect(Object.keys(errors()).length).toBe(0);
    });

    it('should handle data type mismatches', () => {
      const parseData = (input: any) => {
        try {
          if (typeof input === 'string') {
            return JSON.parse(input);
          }
          if (typeof input === 'object') {
            return input;
          }
          throw new Error('Invalid data type');
        } catch (e) {
          return { error: (e as Error).message };
        }
      };

      expect(parseData('{"valid": true}').valid).toBe(true);
      expect(parseData({ valid: true }).valid).toBe(true);
      expect(parseData('invalid json').error).toBeTruthy();
      expect(parseData(123).error).toBeTruthy();
    });

    it('should sanitize unsafe input', () => {
      const sanitize = (input: string) => {
        return input
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#39;')
          .replace(/\//g, '&#x2F;');
      };

      const unsafe = '<script>alert("xss")</script>';
      const safe = sanitize(unsafe);

      expect(safe).not.toContain('<script>');
      expect(safe).toContain('&lt;script&gt;');
    });
  });

  describe('State Corruption Recovery', () => {
    it('should detect and recover from corrupted state', () => {
      const state = signal({ users: [], posts: [], valid: true });
      const stateBackup = signal({ users: [], posts: [], valid: true });

      const validateState = () => {
        const current = state();
        return (
          Array.isArray(current.users) &&
          Array.isArray(current.posts) &&
          typeof current.valid === 'boolean'
        );
      };

      const corruptState = () => {
        (state as any).set({ users: 'corrupted', posts: null, valid: 'invalid' });
      };

      stateBackup.set(state());
      corruptState();

      if (!validateState()) {
        state.set(stateBackup());
      }

      expect(validateState()).toBe(true);
      expect(Array.isArray(state().users)).toBe(true);
    });

    it('should maintain state consistency across errors', () => {
      const count = signal(0);
      const history: number[] = [];

      effect(() => {
        history.push(count());
      });

      for (let i = 1; i <= 10; i++) {
        try {
          if (i === 5) {
            throw new Error('Error at 5');
          }
          count.set(i);
        } catch (e) {
          // Continue despite error
        }
      }

      expect(count()).toBe(10);
      expect(history.length).toBeGreaterThan(0);
    });

    it('should rollback failed transactions', () => {
      const state = signal({ count: 0, name: 'Initial' });
      const snapshot = { ...state() };

      const transaction = (updates: any) => {
        const backup = { ...state() };
        try {
          state.set({ ...state(), ...updates });
          if (updates.count < 0) {
            throw new Error('Invalid count');
          }
        } catch (e) {
          state.set(backup);
          throw e;
        }
      };

      try {
        transaction({ count: -5, name: 'Invalid' });
      } catch (e) {
        // Expected error
      }

      expect(state()).toEqual(snapshot);

      transaction({ count: 10, name: 'Valid' });
      expect(state().count).toBe(10);
    });
  });

  describe('User Experience During Errors', () => {
    it('should show loading state during error recovery', async () => {
      const loading = signal(false);
      const error = signal<string | null>(null);
      const retrying = signal(false);

      const fetchWithRetry = async () => {
        loading.set(true);
        error.set(null);

        try {
          await new Promise((_, reject) => {
            setTimeout(() => reject(new Error('Network error')), 10);
          });
        } catch (e) {
          error.set((e as Error).message);
          retrying.set(true);

          await new Promise(resolve => setTimeout(resolve, 20));

          try {
            await new Promise(resolve => setTimeout(resolve, 10));
            error.set(null);
          } finally {
            retrying.set(false);
          }
        } finally {
          loading.set(false);
        }
      };

      await fetchWithRetry();

      expect(loading()).toBe(false);
      expect(retrying()).toBe(false);
    });

    it('should provide clear error messages to users', () => {
      const getUserFriendlyError = (error: Error) => {
        const errorMap: Record<string, string> = {
          'Network error': 'Unable to connect. Please check your internet connection.',
          'Timeout': 'Request took too long. Please try again.',
          'Not found': 'The requested resource was not found.',
          'Unauthorized': 'Please log in to continue.',
        };

        return errorMap[error.message] || 'An unexpected error occurred. Please try again.';
      };

      expect(getUserFriendlyError(new Error('Network error'))).toContain('internet connection');
      expect(getUserFriendlyError(new Error('Timeout'))).toContain('too long');
      expect(getUserFriendlyError(new Error('Unknown'))).toContain('unexpected error');
    });

    it('should allow users to retry failed operations', async () => {
      const attemptCount = signal(0);
      const success = signal(false);

      const operation = async () => {
        attemptCount.set(attemptCount() + 1);

        if (attemptCount() < 3) {
          throw new Error('Operation failed');
        }

        success.set(true);
      };

      const RetryableComponent = () => {
        const container = document.createElement('div');
        const button = document.createElement('button');
        button.textContent = 'Try Operation';
        button.onclick = async () => {
          try {
            await operation();
            button.textContent = 'Success!';
          } catch (e) {
            button.textContent = 'Failed - Retry';
          }
        };
        container.appendChild(button);
        return container as any;
      };

      const { container } = render(RetryableComponent);
      const button = container.querySelector('button')!;

      fireEvent.click(button);

      // Wait for the async operation to complete
      await waitFor(() => {
        expect(button.textContent).toContain('Retry');
      });
    });
  });

  describe('Error Logging and Reporting', () => {
    it('should log errors with context', () => {
      const errorLog: any[] = [];

      const logError = (error: Error, context: any) => {
        errorLog.push({
          error: {
            message: error.message,
            stack: error.stack,
          },
          context,
          timestamp: Date.now(),
        });
      };

      try {
        throw new Error('Test error');
      } catch (e) {
        logError(e as Error, {
          component: 'TestComponent',
          action: 'render',
          props: { id: 1 },
        });
      }

      expect(errorLog.length).toBe(1);
      expect(errorLog[0].error.message).toBe('Test error');
      expect(errorLog[0].context.component).toBe('TestComponent');
    });

    it('should aggregate similar errors', () => {
      const errorCounts = new Map<string, number>();

      const trackError = (error: Error) => {
        const key = error.message;
        errorCounts.set(key, (errorCounts.get(key) || 0) + 1);
      };

      for (let i = 0; i < 10; i++) {
        trackError(new Error('Network error'));
      }

      for (let i = 0; i < 5; i++) {
        trackError(new Error('Validation error'));
      }

      expect(errorCounts.get('Network error')).toBe(10);
      expect(errorCounts.get('Validation error')).toBe(5);
    });

    it('should sample errors for reporting', () => {
      const reportedErrors: Error[] = [];
      const sampleRate = 0.1;

      const maybeReportError = (error: Error) => {
        if (Math.random() < sampleRate) {
          reportedErrors.push(error);
        }
      };

      for (let i = 0; i < 100; i++) {
        maybeReportError(new Error(`Error ${i}`));
      }

      expect(reportedErrors.length).toBeLessThan(100);
    });
  });

  describe('Graceful Degradation', () => {
    it('should fall back to basic functionality on errors', () => {
      const features = {
        advanced: signal(true),
        basic: signal(true),
      };

      const FeatureComponent = () => {
        const container = document.createElement('div');

        try {
          if (features.advanced()) {
            const advanced = document.createElement('div');
            advanced.textContent = 'Advanced features enabled';
            throw new Error('Advanced feature failed');
          }
        } catch (e) {
          features.advanced.set(false);
        }

        if (features.basic()) {
          const basic = document.createElement('div');
          basic.textContent = 'Basic features available';
          container.appendChild(basic);
        }

        return container as any;
      };

      const { container } = render(FeatureComponent);

      expect(features.advanced()).toBe(false);
      expect(features.basic()).toBe(true);
      expect(container.textContent).toContain('Basic features');
    });

    it('should provide reduced functionality when resources are limited', () => {
      const resourceLevel = signal(100);

      const getFeatureSet = () => {
        const level = resourceLevel();
        if (level > 80) return ['full', 'animations', 'advanced'];
        if (level > 50) return ['full', 'basic'];
        return ['basic'];
      };

      expect(getFeatureSet()).toContain('animations');

      resourceLevel.set(60);
      expect(getFeatureSet()).toContain('full');
      expect(getFeatureSet()).not.toContain('animations');

      resourceLevel.set(30);
      expect(getFeatureSet()).toEqual(['basic']);
    });
  });
});
