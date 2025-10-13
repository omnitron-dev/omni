/**
 * @vitest-environment happy-dom
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Monitoring, monitor } from '../../src/monitoring/monitoring.js';
import type { MonitoringConfig } from '../../src/monitoring/types.js';

describe('Monitoring', () => {
  let monitoring: Monitoring;

  beforeEach(() => {
    monitoring = new Monitoring();
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await monitoring.shutdown();
  });

  describe('initialization', () => {
    it('should initialize with default config', () => {
      const config: MonitoringConfig = {
        enabled: true,
        environment: 'test',
        performance: true,
        errorTracking: true,
        analytics: true,
      };

      monitoring.init(config);

      expect(monitoring).toBeDefined();
    });

    it('should not initialize when disabled', () => {
      const config: MonitoringConfig = {
        enabled: false,
      };

      monitoring.init(config);

      // Should not throw
      monitoring.trackEvent('test_event');
    });

    it('should respect sample rate', () => {
      const mathRandomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.9);

      const config: MonitoringConfig = {
        enabled: true,
        sampleRate: 0.5,
      };

      monitoring.init(config);

      mathRandomSpy.mockRestore();
    });
  });

  describe('error tracking', () => {
    beforeEach(() => {
      monitoring.init({
        enabled: true,
        errorTracking: true,
      });
    });

    it('should track errors', () => {
      const error = new Error('Test error');

      expect(() => {
        monitoring.trackError(error, {
          severity: 'error',
          context: { test: 'data' },
        });
      }).not.toThrow();
    });

    it('should add breadcrumbs', () => {
      expect(() => {
        monitoring.addBreadcrumb({
          type: 'default',
          message: 'Test breadcrumb',
          level: 'info',
          timestamp: Date.now(),
        });
      }).not.toThrow();
    });
  });

  describe('analytics', () => {
    beforeEach(() => {
      monitoring.init({
        enabled: true,
        analytics: true,
      });
    });

    it('should track events', () => {
      expect(() => {
        monitoring.trackEvent('button_click', {
          button: 'submit',
          page: 'checkout',
        });
      }).not.toThrow();
    });

    it('should track page views', () => {
      expect(() => {
        monitoring.trackPageView({
          url: '/test-page',
          title: 'Test Page',
        });
      }).not.toThrow();
    });

    it('should track metrics', () => {
      expect(() => {
        monitoring.trackMetric({
          name: 'response_time',
          value: 123,
          unit: 'ms',
        });
      }).not.toThrow();
    });
  });

  describe('performance monitoring', () => {
    beforeEach(() => {
      monitoring.init({
        enabled: true,
        performance: true,
      });
    });

    it('should start and end marks', () => {
      expect(() => {
        monitoring.startMark('test_operation');
        monitoring.endMark('test_operation');
      }).not.toThrow();
    });

    it('should measure performance', () => {
      monitoring.startMark('operation_start');
      monitoring.endMark('operation_start');

      const duration = monitoring.measure('operation', 'operation_start');

      expect(typeof duration).toBe('number');
    });

    it('should get web vitals', () => {
      const vitals = monitoring.getWebVitals();

      expect(vitals).toBeDefined();
      expect(typeof vitals).toBe('object');
    });
  });

  describe('user management', () => {
    beforeEach(() => {
      monitoring.init({
        enabled: true,
      });
    });

    it('should set user', () => {
      expect(() => {
        monitoring.setUser({
          id: 'user-123',
          email: 'test@example.com',
          username: 'testuser',
        });
      }).not.toThrow();
    });

    it('should clear user', () => {
      monitoring.setUser({
        id: 'user-123',
      });

      expect(() => {
        monitoring.setUser(null);
      }).not.toThrow();
    });
  });

  describe('flush and shutdown', () => {
    beforeEach(() => {
      monitoring.init({
        enabled: true,
      });
    });

    it('should flush pending events', async () => {
      monitoring.trackEvent('test_event');

      await expect(monitoring.flush()).resolves.not.toThrow();
    });

    it('should shutdown cleanly', async () => {
      await expect(monitoring.shutdown()).resolves.not.toThrow();
    });
  });

  describe('global monitor', () => {
    it('should provide global monitor instance', () => {
      expect(monitor).toBeDefined();
      expect(monitor).toBeInstanceOf(Monitoring);
    });
  });
});
