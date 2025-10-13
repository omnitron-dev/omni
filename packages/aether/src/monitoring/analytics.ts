/**
 * Analytics Module
 *
 * Tracks user events, page views, conversions, and custom metrics.
 * Supports A/B testing and custom dimensions.
 */

import type { AnalyticsEvent, PageView, UserInfo, SessionInfo, CustomMetric } from './types.js';

/**
 * Analytics callback
 */
type AnalyticsCallback = (event: AnalyticsEvent) => void;

/**
 * Analytics class
 */
export class Analytics {
  private callbacks: Set<AnalyticsCallback> = new Set();
  private userInfo: UserInfo | null = null;
  private sessionInfo: SessionInfo | null = null;
  private customDimensions: Map<string, string> = new Map();
  private eventQueue: AnalyticsEvent[] = [];
  private flushInterval: NodeJS.Timeout | null = null;

  constructor() {
    if (typeof window !== 'undefined') {
      this.init();
    }
  }

  /**
   * Initialize analytics
   */
  private init(): void {
    this.initSession();
    this.trackPageViewsAutomatically();
    this.trackUserActivity();

    // Flush queue periodically
    this.flushInterval = setInterval(() => this.flush(), 10000);
  }

  /**
   * Initialize session
   */
  private initSession(): void {
    const sessionId = this.getOrCreateSessionId();
    this.sessionInfo = {
      id: sessionId,
      startTime: Date.now(),
      lastActivity: Date.now(),
      pageViews: 0,
      events: 0,
    };
  }

  /**
   * Get or create session ID
   */
  private getOrCreateSessionId(): string {
    const key = 'aether_session_id';
    let sessionId = sessionStorage.getItem(key);
    if (!sessionId) {
      sessionId = this.generateId();
      sessionStorage.setItem(key, sessionId);
    }
    return sessionId;
  }

  /**
   * Generate unique ID
   */
  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
  }

  /**
   * Track page views automatically
   */
  private trackPageViewsAutomatically(): void {
    // Track navigation
    const originalPushState = history.pushState;
    const originalReplaceState = history.replaceState;

    history.pushState = (...args) => {
      originalPushState.apply(history, args);
      this.trackPageView({
        url: window.location.href,
        title: document.title,
      });
    };

    history.replaceState = (...args) => {
      originalReplaceState.apply(history, args);
      this.trackPageView({
        url: window.location.href,
        title: document.title,
      });
    };

    window.addEventListener('popstate', () => {
      this.trackPageView({
        url: window.location.href,
        title: document.title,
      });
    });
  }

  /**
   * Track user activity
   */
  private trackUserActivity(): void {
    const updateActivity = () => {
      if (this.sessionInfo) {
        this.sessionInfo.lastActivity = Date.now();
      }
    };

    window.addEventListener('click', updateActivity);
    window.addEventListener('keydown', updateActivity);
    window.addEventListener('scroll', updateActivity);
    window.addEventListener('mousemove', updateActivity);
  }

  /**
   * Track event
   */
  trackEvent(name: string, properties?: Record<string, any>): void {
    const event: AnalyticsEvent = {
      name,
      properties: {
        ...properties,
        ...Object.fromEntries(this.customDimensions),
      },
      timestamp: Date.now(),
      userId: this.userInfo?.id,
      sessionId: this.sessionInfo?.id,
      pageUrl: window.location.href,
      referrer: document.referrer,
    };

    this.eventQueue.push(event);

    if (this.sessionInfo) {
      this.sessionInfo.events++;
    }

    this.notifyCallbacks(event);

    // Emit event
    window.dispatchEvent(
      new CustomEvent('aether:analytics', {
        detail: event,
      })
    );
  }

  /**
   * Track page view
   */
  trackPageView(view: Partial<PageView>): void {
    const pageView: PageView = {
      url: view.url || window.location.href,
      title: view.title || document.title,
      referrer: view.referrer || document.referrer,
      timestamp: Date.now(),
      userId: this.userInfo?.id,
      sessionId: this.sessionInfo?.id,
      properties: view.properties,
    };

    if (this.sessionInfo) {
      this.sessionInfo.pageViews++;
      // Decrement events count as page views are tracked separately
      // This prevents double-counting since trackEvent increments it
      this.sessionInfo.events--;
    }

    // Track as event
    this.trackEvent('page_view', {
      url: pageView.url,
      title: pageView.title,
      referrer: pageView.referrer,
    });
  }

  /**
   * Track custom metric
   */
  trackMetric(metric: CustomMetric): void {
    this.trackEvent('custom_metric', {
      metric_name: metric.name,
      metric_value: metric.value,
      metric_unit: metric.unit,
      ...metric.tags,
    });
  }

  /**
   * Set user
   */
  setUser(user: UserInfo | null): void {
    this.userInfo = user;

    if (user) {
      this.trackEvent('user_identified', {
        user_id: user.id,
        email: user.email,
        username: user.username,
      });
    }
  }

  /**
   * Get user
   */
  getUser(): UserInfo | null {
    return this.userInfo;
  }

  /**
   * Set custom dimension
   */
  setCustomDimension(key: string, value: string): void {
    this.customDimensions.set(key, value);
  }

  /**
   * Remove custom dimension
   */
  removeCustomDimension(key: string): void {
    this.customDimensions.delete(key);
  }

  /**
   * Get session info
   */
  getSession(): SessionInfo | null {
    if (this.sessionInfo) {
      return {
        ...this.sessionInfo,
        duration: Date.now() - this.sessionInfo.startTime,
      };
    }
    return null;
  }

  /**
   * End session
   */
  endSession(): void {
    if (this.sessionInfo) {
      this.trackEvent('session_end', {
        duration: Date.now() - this.sessionInfo.startTime,
        page_views: this.sessionInfo.pageViews,
        events: this.sessionInfo.events,
      });

      sessionStorage.removeItem('aether_session_id');
      this.sessionInfo = null;
    }
  }

  /**
   * Subscribe to analytics events
   */
  onEvent(callback: AnalyticsCallback): () => void {
    this.callbacks.add(callback);
    return () => this.callbacks.delete(callback);
  }

  /**
   * Notify callbacks
   */
  private notifyCallbacks(event: AnalyticsEvent): void {
    this.callbacks.forEach((callback) => {
      try {
        callback(event);
      } catch (error) {
        console.error('Analytics callback error:', error);
      }
    });
  }

  /**
   * Flush event queue
   */
  async flush(): Promise<void> {
    if (this.eventQueue.length === 0) return;

    const events = [...this.eventQueue];
    this.eventQueue = [];

    // Emit flush event for integrations to handle
    window.dispatchEvent(
      new CustomEvent('aether:analytics:flush', {
        detail: { events },
      })
    );
  }

  /**
   * Shutdown analytics
   */
  shutdown(): void {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
      this.flushInterval = null;
    }

    this.flush();
    this.endSession();
    this.callbacks.clear();
  }
}

/**
 * A/B Testing support
 */
export class ABTest {
  private experiments: Map<string, string> = new Map();
  private analytics: Analytics;

  constructor(analytics: Analytics) {
    this.analytics = analytics;
  }

  /**
   * Create experiment variant
   */
  variant(experimentId: string, variants: string[], weights?: number[]): string {
    // Check if user already has a variant
    let variant = this.experiments.get(experimentId);
    if (variant) return variant;

    // Assign variant based on weights
    if (weights && weights.length === variants.length) {
      const random = Math.random();
      let sum = 0;
      for (let i = 0; i < weights.length; i++) {
        const weight = weights[i];
        if (weight !== undefined) {
          sum += weight;
          if (random <= sum) {
            variant = variants[i];
            break;
          }
        }
      }
    } else {
      // Equal distribution
      const index = Math.floor(Math.random() * variants.length);
      variant = variants[index];
    }

    if (!variant) {
      variant = variants[0];
    }

    // Ensure variant is defined (fallback to first variant)
    const finalVariant = variant || variants[0] || 'default';

    // Store variant
    this.experiments.set(experimentId, finalVariant);

    // Track experiment exposure
    this.analytics.trackEvent('experiment_view', {
      experiment_id: experimentId,
      variant: finalVariant,
    });

    // Store in session
    sessionStorage.setItem(`ab_test_${experimentId}`, finalVariant);

    return finalVariant;
  }

  /**
   * Get current variant
   */
  getVariant(experimentId: string): string | null {
    return this.experiments.get(experimentId) || null;
  }

  /**
   * Track conversion
   */
  trackConversion(experimentId: string, conversionGoal: string, value?: number): void {
    const variant = this.getVariant(experimentId);
    if (variant) {
      this.analytics.trackEvent('experiment_conversion', {
        experiment_id: experimentId,
        variant,
        conversion_goal: conversionGoal,
        value,
      });
    }
  }
}

/**
 * Conversion tracking
 */
export class ConversionTracker {
  private analytics: Analytics;
  private conversions: Set<string> = new Set();

  constructor(analytics: Analytics) {
    this.analytics = analytics;
  }

  /**
   * Track conversion
   */
  trackConversion(conversionId: string, value?: number, properties?: Record<string, any>): void {
    if (this.conversions.has(conversionId)) {
      return; // Already tracked
    }

    this.conversions.add(conversionId);

    this.analytics.trackEvent('conversion', {
      conversion_id: conversionId,
      value,
      ...properties,
    });
  }

  /**
   * Check if conversion was tracked
   */
  hasConversion(conversionId: string): boolean {
    return this.conversions.has(conversionId);
  }

  /**
   * Reset conversions
   */
  reset(): void {
    this.conversions.clear();
  }
}

/**
 * Global analytics instance
 */
let globalAnalytics: Analytics | null = null;

/**
 * Get or create global analytics
 */
export function getAnalytics(): Analytics {
  if (!globalAnalytics) {
    globalAnalytics = new Analytics();
  }
  return globalAnalytics;
}

/**
 * Reset global analytics
 */
export function resetAnalytics(): void {
  if (globalAnalytics) {
    globalAnalytics.shutdown();
    globalAnalytics = null;
  }
}
