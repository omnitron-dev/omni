/**
 * @vitest-environment happy-dom
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Analytics, getAnalytics, resetAnalytics, ABTest, ConversionTracker } from '../../src/monitoring/analytics.js';

describe('Analytics', () => {
  let analytics: Analytics;

  beforeEach(() => {
    resetAnalytics();
    analytics = getAnalytics();
  });

  afterEach(() => {
    analytics.shutdown();
    resetAnalytics();
  });

  describe('event tracking', () => {
    it('should track events', () => {
      const callback = vi.fn();
      analytics.onEvent(callback);

      analytics.trackEvent('button_click', {
        button: 'submit',
        page: 'checkout',
      });

      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'button_click',
          properties: expect.objectContaining({
            button: 'submit',
            page: 'checkout',
          }),
        })
      );
    });

    it('should include timestamp', () => {
      const callback = vi.fn();
      analytics.onEvent(callback);

      analytics.trackEvent('test_event');

      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({
          timestamp: expect.any(Number),
        })
      );
    });

    it('should include session info', () => {
      const callback = vi.fn();
      analytics.onEvent(callback);

      analytics.trackEvent('test_event');

      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: expect.any(String),
        })
      );
    });
  });

  describe('page tracking', () => {
    it('should track page views', () => {
      const callback = vi.fn();
      analytics.onEvent(callback);

      analytics.trackPageView({
        url: '/test-page',
        title: 'Test Page',
      });

      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'page_view',
          properties: expect.objectContaining({
            url: '/test-page',
            title: 'Test Page',
          }),
        })
      );
    });
  });

  describe('user management', () => {
    it('should set user', () => {
      analytics.setUser({
        id: 'user-123',
        email: 'test@example.com',
      });

      const user = analytics.getUser();

      expect(user).toEqual({
        id: 'user-123',
        email: 'test@example.com',
      });
    });

    it('should track user identification', () => {
      const callback = vi.fn();
      analytics.onEvent(callback);

      analytics.setUser({
        id: 'user-123',
        email: 'test@example.com',
      });

      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'user_identified',
          properties: expect.objectContaining({
            user_id: 'user-123',
            email: 'test@example.com',
          }),
        })
      );
    });
  });

  describe('custom dimensions', () => {
    it('should set custom dimensions', () => {
      analytics.setCustomDimension('plan', 'premium');

      const callback = vi.fn();
      analytics.onEvent(callback);

      analytics.trackEvent('test_event');

      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({
          properties: expect.objectContaining({
            plan: 'premium',
          }),
        })
      );
    });

    it('should remove custom dimensions', () => {
      analytics.setCustomDimension('test', 'value');
      analytics.removeCustomDimension('test');

      const callback = vi.fn();
      analytics.onEvent(callback);

      analytics.trackEvent('test_event');

      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({
          properties: expect.not.objectContaining({
            test: expect.anything(),
          }),
        })
      );
    });
  });

  describe('session management', () => {
    it('should create session', () => {
      const session = analytics.getSession();

      expect(session).toBeDefined();
      expect(session?.id).toBeDefined();
      expect(session?.startTime).toBeDefined();
    });

    it('should track session events', () => {
      analytics.trackEvent('event1');
      analytics.trackEvent('event2');

      const session = analytics.getSession();

      expect(session?.events).toBe(2);
    });

    it('should track page views in session', () => {
      analytics.trackPageView({ url: '/page1' });
      analytics.trackPageView({ url: '/page2' });

      const session = analytics.getSession();

      expect(session?.pageViews).toBe(2);
    });

    it('should end session', () => {
      const callback = vi.fn();
      analytics.onEvent(callback);

      analytics.endSession();

      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'session_end',
        })
      );
    });
  });

  describe('metric tracking', () => {
    it('should track metrics', () => {
      const callback = vi.fn();
      analytics.onEvent(callback);

      analytics.trackMetric({
        name: 'load_time',
        value: 1234,
        unit: 'ms',
      });

      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'custom_metric',
          properties: expect.objectContaining({
            metric_name: 'load_time',
            metric_value: 1234,
            metric_unit: 'ms',
          }),
        })
      );
    });
  });
});

describe('ABTest', () => {
  let analytics: Analytics;
  let abTest: ABTest;

  beforeEach(() => {
    resetAnalytics();
    analytics = getAnalytics();
    abTest = new ABTest(analytics);
  });

  afterEach(() => {
    analytics.shutdown();
  });

  it('should assign variant', () => {
    const variant = abTest.variant('test-experiment', ['control', 'variant-a', 'variant-b']);

    expect(['control', 'variant-a', 'variant-b']).toContain(variant);
  });

  it('should return same variant on multiple calls', () => {
    const variant1 = abTest.variant('test-experiment', ['control', 'variant-a']);
    const variant2 = abTest.variant('test-experiment', ['control', 'variant-a']);

    expect(variant1).toBe(variant2);
  });

  it('should track experiment view', () => {
    const callback = vi.fn();
    analytics.onEvent(callback);

    abTest.variant('test-experiment', ['control', 'variant-a']);

    expect(callback).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'experiment_view',
        properties: expect.objectContaining({
          experiment_id: 'test-experiment',
        }),
      })
    );
  });

  it('should track conversion', () => {
    const callback = vi.fn();
    analytics.onEvent(callback);

    abTest.variant('test-experiment', ['control', 'variant-a']);
    abTest.trackConversion('test-experiment', 'signup', 100);

    expect(callback).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'experiment_conversion',
        properties: expect.objectContaining({
          experiment_id: 'test-experiment',
          conversion_goal: 'signup',
          value: 100,
        }),
      })
    );
  });
});

describe('ConversionTracker', () => {
  let analytics: Analytics;
  let conversionTracker: ConversionTracker;

  beforeEach(() => {
    resetAnalytics();
    analytics = getAnalytics();
    conversionTracker = new ConversionTracker(analytics);
  });

  afterEach(() => {
    analytics.shutdown();
  });

  it('should track conversion', () => {
    const callback = vi.fn();
    analytics.onEvent(callback);

    conversionTracker.trackConversion('signup', 100, {
      plan: 'premium',
    });

    expect(callback).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'conversion',
        properties: expect.objectContaining({
          conversion_id: 'signup',
          value: 100,
          plan: 'premium',
        }),
      })
    );
  });

  it('should not track same conversion twice', () => {
    const callback = vi.fn();
    analytics.onEvent(callback);

    conversionTracker.trackConversion('signup');
    conversionTracker.trackConversion('signup');

    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('should check if conversion was tracked', () => {
    conversionTracker.trackConversion('signup');

    expect(conversionTracker.hasConversion('signup')).toBe(true);
    expect(conversionTracker.hasConversion('other')).toBe(false);
  });
});
