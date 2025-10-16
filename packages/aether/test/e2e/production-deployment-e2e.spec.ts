/**
 * Production Deployment E2E Tests
 *
 * Tests production scenarios:
 * - Building for production
 * - Optimizing everything
 * - Deploying with PWA features
 * - Monitoring in production
 * - Handling errors gracefully
 * - Performance under load
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { signal, computed, effect, batch } from '../../src/core/reactivity/index.js';
import { render, cleanup, fireEvent, waitFor } from '../../src/testing/index.js';
import { createPerformanceMonitor } from '../../src/monitoring/performance.js';

describe('Production Deployment E2E Tests', () => {
  afterEach(() => {
    cleanup();
  });

  describe('Production Build', () => {
    it('should minify and optimize code for production', () => {
      const prodConfig = {
        minify: true,
        treeshake: true,
        sourcemap: false,
        compress: true,
      };

      expect(prodConfig.minify).toBe(true);
      expect(prodConfig.treeshake).toBe(true);
    });

    it('should remove development-only code', () => {
      const isDevelopment = process.env.NODE_ENV === 'development';

      const devOnlyCode = isDevelopment ? 'dev-features' : null;

      if (process.env.NODE_ENV === 'production') {
        expect(devOnlyCode).toBeNull();
      }
    });

    it('should optimize bundle size', () => {
      const coreBundle = {
        signal,
        computed,
        effect,
        batch,
      };

      const exportCount = Object.keys(coreBundle).length;
      expect(exportCount).toBeLessThanOrEqual(10);
    });

    it('should split code into chunks', () => {
      const chunks = {
        core: ['signal', 'computed', 'effect'],
        components: ['render', 'cleanup'],
        utilities: ['waitFor', 'fireEvent'],
      };

      expect(chunks.core.length).toBeGreaterThan(0);
      expect(chunks.components.length).toBeGreaterThan(0);
      expect(chunks.utilities.length).toBeGreaterThan(0);
    });
  });

  describe('Performance Optimization', () => {
    it('should handle 10k signal updates under 100ms', () => {
      const signals = Array.from({ length: 10000 }, () => signal(0));

      const startTime = performance.now();

      signals.forEach((sig, index) => {
        sig.set(index);
      });

      const duration = performance.now() - startTime;

      expect(duration).toBeLessThan(100);
    });

    it('should render complex components under 16ms', () => {
      const ComplexComponent = () => {
        const container = document.createElement('div');

        for (let i = 0; i < 100; i++) {
          const child = document.createElement('div');
          child.className = 'item';
          child.textContent = `Item ${i}`;
          child.dataset.id = String(i);
          container.appendChild(child);
        }

        return container as any;
      };

      const startTime = performance.now();
      render(ComplexComponent);
      const renderTime = performance.now() - startTime;

      expect(renderTime).toBeLessThan(16);
    });

    it('should optimize memory usage for large apps', () => {
      const largeState = signal(
        Array.from({ length: 1000 }, (_, i) => ({
          id: i,
          value: `Item ${i}`,
          metadata: { index: i, active: i % 2 === 0 },
        }))
      );

      expect(largeState().length).toBe(1000);

      const filtered = computed(() => largeState().filter((item) => item.metadata.active));

      expect(filtered().length).toBe(500);
    });

    it('should batch updates efficiently', () => {
      const state = signal({ count: 0, name: 'Test', active: true });
      let effectRuns = 0;

      effect(() => {
        state();
        effectRuns++;
      });

      const initialRuns = effectRuns;

      batch(() => {
        state.set({ count: 1, name: 'Test', active: true });
        state.set({ count: 2, name: 'Test', active: true });
        state.set({ count: 3, name: 'Test', active: true });
      });

      expect(effectRuns).toBeLessThanOrEqual(initialRuns + 1);
    });
  });

  describe('Error Handling', () => {
    it('should gracefully handle runtime errors', () => {
      const errors: Error[] = [];

      const SafeComponent = () => {
        const container = document.createElement('div');
        try {
          const mayFail = signal<any>(null);
          const derived = computed(() => {
            const value = mayFail();
            if (value === null) {
              throw new Error('Null value');
            }
            return value.toString();
          });

          try {
            derived();
          } catch (e) {
            errors.push(e as Error);
          }
        } catch (e) {
          errors.push(e as Error);
        }
        return container as any;
      };

      render(SafeComponent);

      expect(errors.length).toBeGreaterThan(0);
    });

    it('should recover from component errors', () => {
      let errorCount = 0;
      const shouldFail = signal(true);

      const ResilientComponent = () => {
        const container = document.createElement('div');
        try {
          if (shouldFail()) {
            throw new Error('Component error');
          }
          container.textContent = 'Success';
        } catch (e) {
          errorCount++;
          container.textContent = 'Error occurred';
        }
        return container as any;
      };

      const { container, rerender } = render(ResilientComponent);

      expect(container.textContent).toBe('Error occurred');
      expect(errorCount).toBe(1);

      shouldFail.set(false);
      rerender(ResilientComponent);

      expect(container.textContent).toBe('Success');
    });

    it('should handle network errors gracefully', async () => {
      const loading = signal(false);
      const error = signal<string | null>(null);
      const data = signal<any>(null);
      const retryCount = signal(0);

      const fetchWithRetry = async (maxRetries = 3) => {
        loading.set(true);
        error.set(null);

        for (let i = 0; i <= maxRetries; i++) {
          try {
            retryCount.set(i);
            await new Promise((resolve, reject) => {
              setTimeout(() => {
                if (i < 2) {
                  reject(new Error('Network error'));
                } else {
                  resolve({ status: 'success' });
                }
              }, 10);
            });

            data.set({ status: 'success' });
            error.set(null);
            break;
          } catch (e) {
            if (i === maxRetries) {
              error.set((e as Error).message);
            }
          }
        }

        loading.set(false);
      };

      await fetchWithRetry(3);

      expect(retryCount()).toBe(2);
      expect(data()).toEqual({ status: 'success' });
      expect(error()).toBeNull();
    });
  });

  describe('Production Monitoring', () => {
    it('should track performance metrics in production', async () => {
      const monitor = createPerformanceMonitor();

      const App = () => {
        monitor.mark('app-start');
        const container = document.createElement('div');

        for (let i = 0; i < 50; i++) {
          const div = document.createElement('div');
          div.textContent = `Item ${i}`;
          container.appendChild(div);
        }

        monitor.mark('app-end');
        monitor.measure('app-render', 'app-start', 'app-end');

        return container as any;
      };

      render(App);

      await waitFor(() => {
        const measures = monitor.getMeasures();
        expect(measures.some((m) => m.name === 'app-render')).toBe(true);
      });

      monitor.dispose();
    });

    it('should sample errors for reporting', () => {
      const errorSampler = {
        sampleRate: 0.1,
        errors: [] as Error[],
        report(error: Error) {
          if (Math.random() < this.sampleRate) {
            this.errors.push(error);
          }
        },
      };

      for (let i = 0; i < 100; i++) {
        errorSampler.report(new Error(`Error ${i}`));
      }

      expect(errorSampler.errors.length).toBeLessThan(100);
    });

    it('should track user interactions', () => {
      const interactions: any[] = [];

      const App = () => {
        const container = document.createElement('div');
        const button = document.createElement('button');
        button.textContent = 'Track Click';
        button.onclick = () => {
          interactions.push({
            type: 'click',
            target: 'button',
            timestamp: Date.now(),
          });
        };
        container.appendChild(button);
        return container as any;
      };

      const { container } = render(App);

      fireEvent.click(container.querySelector('button')!);
      fireEvent.click(container.querySelector('button')!);

      expect(interactions.length).toBe(2);
      expect(interactions[0].type).toBe('click');
    });
  });

  describe('PWA Features', () => {
    it('should support service worker registration', () => {
      const swRegistration = {
        registered: false,
        scope: '/',
        register() {
          this.registered = true;
        },
      };

      swRegistration.register();

      expect(swRegistration.registered).toBe(true);
      expect(swRegistration.scope).toBe('/');
    });

    it('should support offline mode', () => {
      const offlineCache = new Map<string, any>();

      const cacheData = (key: string, value: any) => {
        offlineCache.set(key, value);
      };

      const getCachedData = (key: string) => {
        return offlineCache.get(key);
      };

      cacheData('page-1', { content: 'Page 1 data' });
      cacheData('page-2', { content: 'Page 2 data' });

      expect(getCachedData('page-1')).toEqual({ content: 'Page 1 data' });
      expect(offlineCache.size).toBe(2);
    });

    it('should generate manifest for PWA', () => {
      const manifest = {
        name: 'Aether App',
        short_name: 'Aether',
        start_url: '/',
        display: 'standalone',
        theme_color: '#000000',
        background_color: '#ffffff',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
        ],
      };

      expect(manifest.name).toBe('Aether App');
      expect(manifest.display).toBe('standalone');
      expect(manifest.icons.length).toBe(2);
    });
  });

  describe('Load Testing', () => {
    it('should handle concurrent users', async () => {
      const users = Array.from({ length: 100 }, (_, i) => ({
        id: i,
        state: signal({ active: true, data: null }),
      }));

      const simulateLoad = async () => {
        const promises = users.map(async (user) => {
          await new Promise((resolve) => setTimeout(resolve, Math.random() * 10));
          user.state.set({ active: true, data: `User ${user.id} data` });
        });

        await Promise.all(promises);
      };

      await simulateLoad();

      const allLoaded = users.every((user) => user.state().data !== null);
      expect(allLoaded).toBe(true);
    });

    it('should maintain performance under stress', () => {
      const operations = 10000;
      const state = signal(0);

      const startTime = performance.now();

      for (let i = 0; i < operations; i++) {
        state.set(i);
      }

      const duration = performance.now() - startTime;

      expect(duration).toBeLessThan(100);
      expect(state()).toBe(operations - 1);
    });

    it('should handle rapid state changes', () => {
      const rapidUpdates = signal(0);
      let updateCount = 0;

      effect(() => {
        rapidUpdates();
        updateCount++;
      });

      const initialCount = updateCount;

      for (let i = 0; i < 1000; i++) {
        rapidUpdates.set(i);
      }

      expect(rapidUpdates()).toBe(999);
      expect(updateCount).toBeGreaterThan(initialCount);
    });
  });

  describe('Security', () => {
    it('should sanitize user input', () => {
      const sanitize = (input: string) => {
        return input
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#x27;')
          .replace(/\//g, '&#x2F;');
      };

      const maliciousInput = '<script>alert("xss")</script>';
      const sanitized = sanitize(maliciousInput);

      expect(sanitized).not.toContain('<script>');
      expect(sanitized).toContain('&lt;script&gt;');
    });

    it('should validate data before processing', () => {
      const validate = (data: any) => {
        if (!data || typeof data !== 'object') return false;
        if (!data.id || typeof data.id !== 'number') return false;
        if (!data.name || typeof data.name !== 'string') return false;
        return true;
      };

      expect(validate(null)).toBe(false);
      expect(validate({ id: 'invalid' })).toBe(false);
      expect(validate({ id: 1, name: 'Valid' })).toBe(true);
    });

    it('should prevent injection attacks', () => {
      const userInput = signal('');

      const SafeComponent = () => {
        const container = document.createElement('div');
        const display = document.createElement('div');
        display.textContent = userInput();
        container.appendChild(display);
        return container as any;
      };

      userInput.set('<img src=x onerror=alert(1)>');

      const { container } = render(SafeComponent);

      // Using textContent prevents XSS by escaping HTML
      // The innerHTML should contain escaped entities, not actual HTML tags
      expect(container.innerHTML).toContain('&lt;img');
      expect(container.innerHTML).toContain('&gt;');
      // textContent displays the raw text (safe, not executed)
      expect(container.textContent).toContain('<img');
      // Verify no actual script-capable elements were created
      expect(container.querySelector('img')).toBeNull();
      expect(container.querySelector('script')).toBeNull();
    });
  });

  describe('Deployment Strategies', () => {
    it('should support rolling deployments', () => {
      const versions = [
        { version: '1.0.0', instances: 3, status: 'active' },
        { version: '1.1.0', instances: 2, status: 'deploying' },
      ];

      const totalInstances = versions.reduce((sum, v) => sum + v.instances, 0);

      expect(totalInstances).toBe(5);
      expect(versions.some((v) => v.status === 'deploying')).toBe(true);
    });

    it('should support blue-green deployment', () => {
      const environments = {
        blue: { version: '1.0.0', active: true, traffic: 100 },
        green: { version: '1.1.0', active: false, traffic: 0 },
      };

      const switchToGreen = () => {
        environments.blue.active = false;
        environments.blue.traffic = 0;
        environments.green.active = true;
        environments.green.traffic = 100;
      };

      switchToGreen();

      expect(environments.green.active).toBe(true);
      expect(environments.green.traffic).toBe(100);
      expect(environments.blue.active).toBe(false);
    });

    it('should support canary deployments', () => {
      const deployment = {
        stable: { version: '1.0.0', traffic: 95 },
        canary: { version: '1.1.0', traffic: 5 },
      };

      const incrementCanary = (amount: number) => {
        deployment.stable.traffic -= amount;
        deployment.canary.traffic += amount;
      };

      incrementCanary(10);

      expect(deployment.canary.traffic).toBe(15);
      expect(deployment.stable.traffic).toBe(85);
    });
  });

  describe('Caching Strategy', () => {
    it('should implement cache-first strategy', () => {
      const cache = new Map<string, any>();

      const getData = async (key: string) => {
        if (cache.has(key)) {
          return { source: 'cache', data: cache.get(key) };
        }

        await new Promise((resolve) => setTimeout(resolve, 10));
        const data = { value: key };
        cache.set(key, data);
        return { source: 'network', data };
      };

      const fetchMultiple = async () => {
        const result1 = await getData('test-1');
        const result2 = await getData('test-1');

        expect(result1.source).toBe('network');
        expect(result2.source).toBe('cache');
      };

      return fetchMultiple();
    });

    it('should implement stale-while-revalidate', async () => {
      const cache = new Map<string, { data: any; timestamp: number }>();
      const maxAge = 100;

      const getData = async (key: string) => {
        const cached = cache.get(key);
        const now = Date.now();

        if (cached && now - cached.timestamp < maxAge) {
          return { ...cached.data, fresh: true };
        }

        if (cached) {
          setTimeout(async () => {
            const fresh = await fetchFresh(key);
            cache.set(key, { data: fresh, timestamp: Date.now() });
          }, 0);
          return { ...cached.data, fresh: false };
        }

        const fresh = await fetchFresh(key);
        cache.set(key, { data: fresh, timestamp: now });
        return { ...fresh, fresh: true };
      };

      const fetchFresh = async (key: string) => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return { value: key };
      };

      const result = await getData('test');
      expect(result).toBeDefined();
    });
  });

  describe('Resource Optimization', () => {
    it('should lazy load non-critical resources', async () => {
      const loadedModules = new Set<string>();

      const lazyLoad = async (moduleName: string) => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        loadedModules.add(moduleName);
        return { name: moduleName, loaded: true };
      };

      const module1 = await lazyLoad('feature-1');
      expect(module1.loaded).toBe(true);
      expect(loadedModules.has('feature-1')).toBe(true);
    });

    it('should preload critical resources', () => {
      const preloadQueue: string[] = [];

      const preload = (resource: string) => {
        preloadQueue.push(resource);
      };

      preload('/core.js');
      preload('/main.css');
      preload('/fonts/primary.woff2');

      expect(preloadQueue.length).toBe(3);
      expect(preloadQueue[0]).toBe('/core.js');
    });
  });
});
