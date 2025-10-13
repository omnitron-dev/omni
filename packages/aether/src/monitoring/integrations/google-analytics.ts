/**
 * Google Analytics Integration
 *
 * Integrates with Google Analytics 4 (GA4) for event and page tracking.
 */

import type { GoogleAnalyticsConfig, AnalyticsEvent, PageView, UserInfo } from '../types.js';

/**
 * GA4 gtag interface
 */
interface Gtag {
  (command: 'config', targetId: string, config?: any): void;
  (command: 'event', eventName: string, eventParams?: any): void;
  (command: 'set', params: any): void;
}

/**
 * Google Analytics integration class
 */
export class GoogleAnalyticsIntegration {
  private config: GoogleAnalyticsConfig;
  private gtag: Gtag | null = null;
  private initialized = false;

  constructor(config: GoogleAnalyticsConfig) {
    this.config = {
      enabled: true,
      sendPageViews: true,
      debug: false,
      ...config,
    };
  }

  /**
   * Initialize Google Analytics
   */
  async init(): Promise<void> {
    if (this.initialized || !this.config.enabled) return;

    try {
      await this.loadGA4Script();
      this.setupGtag();

      // Configure GA4
      if (this.gtag) {
        this.gtag('config', this.config.measurementId, {
          send_page_view: this.config.sendPageViews,
          debug_mode: this.config.debug,
          custom_map: this.config.customDimensions,
        });

        this.initialized = true;
      }
    } catch (error) {
      console.error('Failed to initialize Google Analytics:', error);
    }
  }

  /**
   * Load GA4 script
   */
  private async loadGA4Script(): Promise<void> {
    return new Promise((resolve, reject) => {
      if ((window as any).gtag) {
        resolve();
        return;
      }

      const script = document.createElement('script');
      script.async = true;
      script.src = `https://www.googletagmanager.com/gtag/js?id=${this.config.measurementId}`;

      script.onload = () => resolve();
      script.onerror = () => reject(new Error('Failed to load GA4 script'));

      document.head.appendChild(script);
    });
  }

  /**
   * Setup gtag function
   */
  private setupGtag(): void {
    (window as any).dataLayer = (window as any).dataLayer || [];
    this.gtag = function gtag(...args: any[]) {
      (window as any).dataLayer.push(args);
    } as Gtag;

    // Make gtag globally available
    (window as any).gtag = this.gtag;
  }

  /**
   * Track event
   */
  trackEvent(event: AnalyticsEvent): void {
    if (!this.gtag || !this.initialized) return;

    try {
      const params: any = {
        ...event.properties,
      };

      if (event.userId) {
        params.user_id = event.userId;
      }

      if (event.sessionId) {
        params.session_id = event.sessionId;
      }

      this.gtag('event', event.name, params);
    } catch (error) {
      console.error('Failed to track event in Google Analytics:', error);
    }
  }

  /**
   * Track page view
   */
  trackPageView(view: PageView): void {
    if (!this.gtag || !this.initialized) return;

    try {
      this.gtag('event', 'page_view', {
        page_title: view.title,
        page_location: view.url,
        page_referrer: view.referrer,
        ...view.properties,
      });
    } catch (error) {
      console.error('Failed to track page view in Google Analytics:', error);
    }
  }

  /**
   * Set user
   */
  setUser(user: UserInfo | null): void {
    if (!this.gtag || !this.initialized) return;

    try {
      if (user) {
        this.gtag('set', {
          user_id: user.id,
          user_properties: {
            email: user.email,
            username: user.username,
            ...user.properties,
          },
        });
      }
    } catch (error) {
      console.error('Failed to set user in Google Analytics:', error);
    }
  }

  /**
   * Set custom dimension
   */
  setCustomDimension(key: string, value: string): void {
    if (!this.gtag || !this.initialized) return;

    try {
      this.gtag('set', {
        [key]: value,
      });
    } catch (error) {
      console.error('Failed to set custom dimension in Google Analytics:', error);
    }
  }

  /**
   * Track timing
   */
  trackTiming(category: string, variable: string, value: number, label?: string): void {
    if (!this.gtag || !this.initialized) return;

    try {
      this.gtag('event', 'timing_complete', {
        name: variable,
        value: Math.round(value),
        event_category: category,
        event_label: label,
      });
    } catch (error) {
      console.error('Failed to track timing in Google Analytics:', error);
    }
  }

  /**
   * Track exception
   */
  trackException(description: string, fatal = false): void {
    if (!this.gtag || !this.initialized) return;

    try {
      this.gtag('event', 'exception', {
        description,
        fatal,
      });
    } catch (error) {
      console.error('Failed to track exception in Google Analytics:', error);
    }
  }
}

/**
 * Create Google Analytics integration
 */
export function createGoogleAnalyticsIntegration(
  config: GoogleAnalyticsConfig
): GoogleAnalyticsIntegration {
  return new GoogleAnalyticsIntegration(config);
}
