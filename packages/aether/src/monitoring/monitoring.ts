/**
 * Core Monitoring System
 *
 * Central monitoring system that coordinates error tracking, performance monitoring,
 * analytics, and integrations.
 */

import type {
  MonitoringConfig,
  MonitoringInstance,
  ErrorInfo,
  Breadcrumb,
  UserInfo,
  CustomMetric,
  PageView,
  WebVitals,
} from './types.js';

import { ErrorTracker, getErrorTracker } from './error-tracking.js';
import { PerformanceMonitor, getPerformanceMonitor } from './performance.js';
import { Analytics, getAnalytics } from './analytics.js';
import { PrivacyManager, getPrivacyManager } from './privacy.js';
import { DevTools, getDevTools } from './devtools.js';

import { SentryIntegration } from './integrations/sentry.js';
import { GoogleAnalyticsIntegration } from './integrations/google-analytics.js';
import { MixpanelIntegration } from './integrations/mixpanel.js';
import { CustomBackendIntegration, WebhookIntegration } from './integrations/custom-backend.js';

/**
 * Monitoring class
 */
export class Monitoring implements MonitoringInstance {
  private config: MonitoringConfig;
  private errorTracker: ErrorTracker | null = null;
  private performanceMonitor: PerformanceMonitor | null = null;
  private analytics: Analytics | null = null;
  private privacyManager: PrivacyManager | null = null;
  private devtools: DevTools | null = null;

  // Integrations
  private sentryIntegration: SentryIntegration | null = null;
  private googleAnalyticsIntegration: GoogleAnalyticsIntegration | null = null;
  private mixpanelIntegration: MixpanelIntegration | null = null;
  private customBackendIntegration: CustomBackendIntegration | null = null;
  private webhookIntegration: WebhookIntegration | null = null;

  private initialized = false;

  constructor() {
    this.config = {
      enabled: true,
      environment: 'production',
      performance: true,
      errorTracking: true,
      analytics: true,
      rum: true,
      sampleRate: 1,
      debug: false,
    };
  }

  /**
   * Initialize monitoring
   */
  init(config: MonitoringConfig): void {
    if (this.initialized) {
      console.warn('[Aether Monitoring] Already initialized');
      return;
    }

    this.config = { ...this.config, ...config };

    if (!this.config.enabled) {
      return;
    }

    // Check sample rate
    if (!this.shouldSample()) {
      return;
    }

    // Initialize privacy manager first
    if (this.config.privacy) {
      this.privacyManager = getPrivacyManager(this.config.privacy);
    }

    // Initialize core modules
    if (this.config.errorTracking) {
      const errorConfig = typeof this.config.errorTracking === 'object'
        ? this.config.errorTracking
        : {};
      this.errorTracker = getErrorTracker(errorConfig);
      this.setupErrorTracking();
    }

    if (this.config.performance) {
      const perfConfig = typeof this.config.performance === 'object'
        ? this.config.performance
        : {};
      this.performanceMonitor = getPerformanceMonitor(perfConfig);
      this.setupPerformanceMonitoring();
    }

    if (this.config.analytics) {
      this.analytics = getAnalytics();
      this.setupAnalytics();
    }

    // Initialize integrations
    this.initIntegrations();

    // Initialize devtools in development
    if (this.config.devtools && process.env.NODE_ENV === 'development') {
      const devtoolsConfig = typeof this.config.devtools === 'object'
        ? this.config.devtools
        : {};
      this.devtools = getDevTools(devtoolsConfig);
    }

    this.initialized = true;

    if (this.config.debug) {
      console.log('[Aether Monitoring] Initialized', this.config);
    }
  }

  /**
   * Check if should sample
   */
  private shouldSample(): boolean {
    return Math.random() < (this.config.sampleRate || 1);
  }

  /**
   * Setup error tracking
   */
  private setupErrorTracking(): void {
    if (!this.errorTracker) return;

    this.errorTracker.onError((error, info) => {
      // Check privacy consent
      if (this.privacyManager && !this.privacyManager.hasConsentFor('errorTracking')) {
        return;
      }

      // Call before send hook
      if (this.config.beforeSend) {
        const result = this.config.beforeSend({ error, info });
        if (!result) return;
      }

      // Send to integrations
      this.sentryIntegration?.trackError(error, info);
      this.googleAnalyticsIntegration?.trackException(error.message, info.severity === 'fatal');
      this.customBackendIntegration?.trackError(error, info);
      this.webhookIntegration?.trackError(error, info);
    });
  }

  /**
   * Setup performance monitoring
   */
  private setupPerformanceMonitoring(): void {
    if (!this.performanceMonitor) return;

    // Listen for performance events
    window.addEventListener('aether:metric', ((event: CustomEvent) => {
      // Check privacy consent
      if (this.privacyManager && !this.privacyManager.hasConsentFor('performance')) {
        return;
      }

      const { name, value } = event.detail;
      this.trackMetric({ name, value });
    }) as EventListener);
  }

  /**
   * Setup analytics
   */
  private setupAnalytics(): void {
    if (!this.analytics) return;

    this.analytics.onEvent((event) => {
      // Check privacy consent
      if (this.privacyManager && !this.privacyManager.hasConsentFor('analytics')) {
        return;
      }

      // Send to integrations
      this.googleAnalyticsIntegration?.trackEvent(event);
      this.mixpanelIntegration?.trackEvent(event);
      this.customBackendIntegration?.trackEvent(event);
      this.webhookIntegration?.trackEvent(event);
    });
  }

  /**
   * Initialize integrations
   */
  private async initIntegrations(): Promise<void> {
    // Sentry
    if (this.config.sentry?.enabled && this.config.sentry.dsn) {
      this.sentryIntegration = new SentryIntegration(this.config.sentry);
      await this.sentryIntegration.init();
    }

    // Google Analytics
    if (this.config.googleAnalytics?.enabled && this.config.googleAnalytics.measurementId) {
      this.googleAnalyticsIntegration = new GoogleAnalyticsIntegration(
        this.config.googleAnalytics
      );
      await this.googleAnalyticsIntegration.init();
    }

    // Mixpanel
    if (this.config.mixpanel?.enabled && this.config.mixpanel.token) {
      this.mixpanelIntegration = new MixpanelIntegration(this.config.mixpanel);
      await this.mixpanelIntegration.init();
    }

    // Custom Backend
    if (this.config.customBackend?.enabled && this.config.customBackend.endpoint) {
      this.customBackendIntegration = new CustomBackendIntegration(this.config.customBackend);
    }

    // Webhook
    if (this.config.webhook?.enabled && this.config.webhook.url) {
      this.webhookIntegration = new WebhookIntegration(this.config.webhook);
    }
  }

  /**
   * Track error
   */
  trackError(error: Error, info?: Partial<ErrorInfo>): void {
    if (!this.initialized || !this.errorTracker) return;

    this.errorTracker.trackError(error, info);
  }

  /**
   * Track event
   */
  trackEvent(name: string, properties?: Record<string, any>): void {
    if (!this.initialized || !this.analytics) return;

    this.analytics.trackEvent(name, properties);
  }

  /**
   * Track page view
   */
  trackPageView(view: Partial<PageView>): void {
    if (!this.initialized || !this.analytics) return;

    this.analytics.trackPageView(view);
  }

  /**
   * Track custom metric
   */
  trackMetric(metric: CustomMetric): void {
    if (!this.initialized) return;

    if (this.analytics) {
      this.analytics.trackMetric(metric);
    }

    // Send to integrations
    this.customBackendIntegration?.trackMetric(metric.name, metric.value, metric.tags);
  }

  /**
   * Set user
   */
  setUser(user: UserInfo | null): void {
    if (!this.initialized) return;

    // Get user info from provider if needed
    if (!user && this.config.userInfoProvider) {
      Promise.resolve(this.config.userInfoProvider()).then((providedUser) => {
        this.setUserInternal(providedUser);
      });
    } else {
      this.setUserInternal(user);
    }
  }

  /**
   * Set user internal
   */
  private setUserInternal(user: UserInfo | null): void {
    this.errorTracker?.setUser(user);
    this.analytics?.setUser(user);
    this.sentryIntegration?.setUser(user);
    this.googleAnalyticsIntegration?.setUser(user);
    this.mixpanelIntegration?.setUser(user);
  }

  /**
   * Add breadcrumb
   */
  addBreadcrumb(breadcrumb: Breadcrumb): void {
    if (!this.initialized || !this.errorTracker) return;

    this.errorTracker.addBreadcrumb(breadcrumb);
    this.sentryIntegration?.addBreadcrumb(breadcrumb);
  }

  /**
   * Start performance mark
   */
  startMark(name: string, metadata?: Record<string, any>): void {
    if (!this.initialized || !this.performanceMonitor) return;

    this.performanceMonitor.startMark(name, metadata);
  }

  /**
   * End performance mark
   */
  endMark(name: string): void {
    if (!this.initialized || !this.performanceMonitor) return;

    this.performanceMonitor.endMark(name);
  }

  /**
   * Measure performance
   */
  measure(name: string, startMark: string, endMark?: string): number {
    if (!this.initialized || !this.performanceMonitor) return 0;

    return this.performanceMonitor.measure(name, startMark, endMark);
  }

  /**
   * Get Web Vitals
   */
  getWebVitals(): WebVitals {
    if (!this.initialized || !this.performanceMonitor) return {};

    return this.performanceMonitor.getWebVitals();
  }

  /**
   * Flush pending events
   */
  async flush(): Promise<void> {
    if (!this.initialized) return;

    const promises: Promise<void>[] = [];

    if (this.analytics) {
      promises.push(this.analytics.flush());
    }

    if (this.sentryIntegration) {
      promises.push(this.sentryIntegration.flush());
    }

    if (this.customBackendIntegration) {
      promises.push(this.customBackendIntegration.flush());
    }

    await Promise.all(promises);
  }

  /**
   * Shutdown monitoring
   */
  async shutdown(): Promise<void> {
    if (!this.initialized) return;

    await this.flush();

    if (this.analytics) {
      this.analytics.shutdown();
    }

    if (this.performanceMonitor) {
      this.performanceMonitor.disconnect();
    }

    if (this.sentryIntegration) {
      await this.sentryIntegration.close();
    }

    if (this.customBackendIntegration) {
      await this.customBackendIntegration.shutdown();
    }

    this.initialized = false;
  }
}

/**
 * Global monitoring instance
 */
let globalMonitoring: Monitoring | null = null;

/**
 * Get or create global monitoring instance
 */
export function getMonitoring(): Monitoring {
  if (!globalMonitoring) {
    globalMonitoring = new Monitoring();
  }
  return globalMonitoring;
}

/**
 * Initialize monitoring (convenience function)
 */
export function initMonitoring(config: MonitoringConfig): void {
  getMonitoring().init(config);
}

/**
 * Global monitor API
 */
export const monitor = getMonitoring();

/**
 * Default export
 */
export default monitor;
