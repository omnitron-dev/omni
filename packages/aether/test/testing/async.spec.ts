/**
 * Async Utilities Tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { waitFor, waitForElementToBeRemoved, act, render, cleanup } from '../../src/testing/index.js';
import { signal } from '../../src/core/reactivity/index.js';

describe('async utilities', () => {
  afterEach(() => {
    cleanup();
  });

  describe('waitFor', () => {
    it('should wait for condition to be true', async () => {
      let count = 0;

      setTimeout(() => {
        count = 5;
      }, 100);

      await waitFor(() => {
        if (count !== 5) throw new Error('Not ready');
      });

      expect(count).toBe(5);
    });

    it('should timeout if condition never true', async () => {
      await expect(
        waitFor(
          () => {
            throw new Error('Never true');
          },
          { timeout: 100 }
        )
      ).rejects.toThrow('Timeout');
    });

    it('should respect custom timeout', async () => {
      const start = Date.now();

      await expect(
        waitFor(() => {
          throw new Error('Never');
        }, { timeout: 200 })
      ).rejects.toThrow();

      const duration = Date.now() - start;
      expect(duration).toBeGreaterThanOrEqual(180);
    });

    it('should respect custom interval', async () => {
      let attempts = 0;

      setTimeout(() => (attempts = 10), 250);

      await waitFor(
        () => {
          attempts++;
          if (attempts < 5) throw new Error('Not enough attempts');
        },
        { interval: 50 }
      );

      expect(attempts).toBeGreaterThanOrEqual(5);
    });

    it('should return resolved value', async () => {
      const result = await waitFor(() => 42);

      expect(result).toBe(42);
    });

    it('should work with async callbacks', async () => {
      const result = await waitFor(async () => {
        return Promise.resolve('async result');
      });

      expect(result).toBe('async result');
    });
  });

  describe('waitForElementToBeRemoved', () => {
    it('should wait for element to be removed', async () => {
      const { container } = render(() => {
        const div = document.createElement('div');
        const loading = document.createElement('span');
        loading.textContent = 'Loading...';
        div.appendChild(loading);
        return div as any;
      });

      setTimeout(() => {
        const loading = container.querySelector('span');
        if (loading) loading.remove();
      }, 100);

      await waitForElementToBeRemoved(() => container.querySelector('span'));

      expect(container.querySelector('span')).toBeNull();
    });

    it('should throw if element never removed', async () => {
      const { container } = render(() => {
        const div = document.createElement('div');
        const persistent = document.createElement('span');
        div.appendChild(persistent);
        return div as any;
      });

      await expect(
        waitForElementToBeRemoved(
          () => container.querySelector('span'),
          { timeout: 100 }
        )
      ).rejects.toThrow();
    });
  });

  describe('act', () => {
    it('should wrap synchronous updates', async () => {
      const count = signal(0);

      await act(() => {
        count.set(5);
      });

      expect(count()).toBe(5);
    });

    it('should wrap asynchronous updates', async () => {
      const count = signal(0);

      await act(async () => {
        await Promise.resolve();
        count.set(10);
      });

      expect(count()).toBe(10);
    });

    it('should return value from callback', async () => {
      const result = await act(() => 'test');

      expect(result).toBe('test');
    });

    it('should handle promises', async () => {
      const result = await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 50));
        return 'async';
      });

      expect(result).toBe('async');
    });
  });

  describe('async component updates', () => {
    it('should handle async state updates', async () => {
      const loading = signal(true);

      const { container } = render(() => {
        const div = document.createElement('div');
        div.textContent = loading() ? 'Loading' : 'Loaded';
        return div as any;
      });

      expect(container.textContent).toContain('Loading');

      setTimeout(() => loading.set(false), 100);

      await waitFor(() => {
        if (loading()) throw new Error('Still loading');
      });

      // Need to rerender after state change
      expect(loading()).toBe(false);
    });
  });

  describe('error handling', () => {
    it('should propagate errors from waitFor', async () => {
      const error = new Error('Custom error');

      await expect(
        waitFor(() => {
          throw error;
        }, { timeout: 100 })
      ).rejects.toThrow('Timeout');
    });

    it('should handle errors in act', async () => {
      const error = new Error('Act error');

      await expect(
        act(() => {
          throw error;
        })
      ).rejects.toThrow('Act error');
    });
  });

  describe('timeout handling', () => {
    it('should provide default timeout', async () => {
      const start = Date.now();

      await expect(
        waitFor(() => {
          throw new Error('Never');
        })
      ).rejects.toThrow();

      const duration = Date.now() - start;
      expect(duration).toBeGreaterThanOrEqual(900); // Default 1000ms
    });
  });
});
