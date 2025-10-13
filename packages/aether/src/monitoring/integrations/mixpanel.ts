/**
 * Mixpanel Integration
 *
 * Integrates with Mixpanel for advanced product analytics.
 */

import type { MixpanelConfig, AnalyticsEvent, UserInfo } from '../types.js';

/**
 * Mixpanel client interface
 */
interface MixpanelClient {
  init(token: string, config?: any): void;
  track(eventName: string, properties?: any): void;
  identify(userId: string): void;
  people: {
    set(properties: any): void;
    set_once(properties: any): void;
    increment(property: string, by?: number): void;
    append(property: string, value: any): void;
    union(property: string, values: any[]): void;
    unset(property: string): void;
  };
  register(properties: any): void;
  register_once(properties: any): void;
  unregister(property: string): void;
  reset(): void;
  get_distinct_id(): string;
  track_pageview(properties?: any): void;
  time_event(eventName: string): void;
  get_property(propertyName: string): any;
}

/**
 * Mixpanel integration class
 */
export class MixpanelIntegration {
  private config: MixpanelConfig;
  private client: MixpanelClient | null = null;
  private initialized = false;

  constructor(config: MixpanelConfig) {
    this.config = {
      enabled: true,
      trackPageViews: true,
      persistence: 'cookie',
      crossSubdomainCookie: true,
      ...config,
    };
  }

  /**
   * Initialize Mixpanel
   */
  async init(): Promise<void> {
    if (this.initialized || !this.config.enabled) return;

    try {
      await this.loadMixpanelScript();
      this.setupMixpanel();
      this.initialized = true;

      if (this.config.trackPageViews) {
        this.trackPageViews();
      }
    } catch (error) {
      console.error('Failed to initialize Mixpanel:', error);
    }
  }

  /**
   * Load Mixpanel script
   */
  private async loadMixpanelScript(): Promise<void> {
    return new Promise((resolve, reject) => {
      if ((window as any).mixpanel) {
        resolve();
        return;
      }

      const script = document.createElement('script');
      script.async = true;
      script.src = 'https://cdn.mxpnl.com/libs/mixpanel-2-latest.min.js';

      script.onload = () => resolve();
      script.onerror = () => reject(new Error('Failed to load Mixpanel script'));

      document.head.appendChild(script);
    });
  }

  /**
   * Setup Mixpanel client
   */
  private setupMixpanel(): void {
    const mixpanel = (window as any).mixpanel;
    if (!mixpanel) return;

    mixpanel.init(this.config.token, {
      api_host: this.config.apiHost || 'https://api.mixpanel.com',
      persistence: this.config.persistence,
      cross_subdomain_cookie: this.config.crossSubdomainCookie,
      loaded: (mx: any) => {
        this.client = mx;
      },
    });

    this.client = mixpanel;
  }

  /**
   * Track page views automatically
   */
  private trackPageViews(): void {
    if (!this.client) return;

    // Track initial page view
    this.client.track_pageview();

    // Track navigation
    const originalPushState = history.pushState;
    const originalReplaceState = history.replaceState;

    history.pushState = (...args) => {
      originalPushState.apply(history, args);
      this.client?.track_pageview();
    };

    history.replaceState = (...args) => {
      originalReplaceState.apply(history, args);
      this.client?.track_pageview();
    };

    window.addEventListener('popstate', () => {
      this.client?.track_pageview();
    });
  }

  /**
   * Track event
   */
  trackEvent(event: AnalyticsEvent): void {
    if (!this.client || !this.initialized) return;

    try {
      const properties = {
        ...event.properties,
        $page_url: event.pageUrl,
        $referrer: event.referrer,
        timestamp: event.timestamp,
      };

      this.client.track(event.name, properties);
    } catch (error) {
      console.error('Failed to track event in Mixpanel:', error);
    }
  }

  /**
   * Set user
   */
  setUser(user: UserInfo | null): void {
    if (!this.client || !this.initialized) return;

    try {
      if (user && user.id) {
        this.client.identify(user.id);

        const properties: any = {};

        if (user.email) properties.$email = user.email;
        if (user.username) properties.$name = user.username;

        if (user.properties) {
          Object.assign(properties, user.properties);
        }

        this.client.people.set(properties);
      } else {
        this.client.reset();
      }
    } catch (error) {
      console.error('Failed to set user in Mixpanel:', error);
    }
  }

  /**
   * Set user property
   */
  setUserProperty(key: string, value: any): void {
    if (!this.client || !this.initialized) return;

    try {
      this.client.people.set({ [key]: value });
    } catch (error) {
      console.error('Failed to set user property in Mixpanel:', error);
    }
  }

  /**
   * Set user property once (only if not already set)
   */
  setUserPropertyOnce(key: string, value: any): void {
    if (!this.client || !this.initialized) return;

    try {
      this.client.people.set_once({ [key]: value });
    } catch (error) {
      console.error('Failed to set user property once in Mixpanel:', error);
    }
  }

  /**
   * Increment user property
   */
  incrementUserProperty(key: string, by = 1): void {
    if (!this.client || !this.initialized) return;

    try {
      this.client.people.increment(key, by);
    } catch (error) {
      console.error('Failed to increment user property in Mixpanel:', error);
    }
  }

  /**
   * Append to list property
   */
  appendToListProperty(key: string, value: any): void {
    if (!this.client || !this.initialized) return;

    try {
      this.client.people.append(key, value);
    } catch (error) {
      console.error('Failed to append to list property in Mixpanel:', error);
    }
  }

  /**
   * Register super property (sent with all events)
   */
  registerSuperProperty(key: string, value: any): void {
    if (!this.client || !this.initialized) return;

    try {
      this.client.register({ [key]: value });
    } catch (error) {
      console.error('Failed to register super property in Mixpanel:', error);
    }
  }

  /**
   * Register super property once
   */
  registerSuperPropertyOnce(key: string, value: any): void {
    if (!this.client || !this.initialized) return;

    try {
      this.client.register_once({ [key]: value });
    } catch (error) {
      console.error('Failed to register super property once in Mixpanel:', error);
    }
  }

  /**
   * Unregister super property
   */
  unregisterSuperProperty(key: string): void {
    if (!this.client || !this.initialized) return;

    try {
      this.client.unregister(key);
    } catch (error) {
      console.error('Failed to unregister super property in Mixpanel:', error);
    }
  }

  /**
   * Start timing an event
   */
  timeEvent(eventName: string): void {
    if (!this.client || !this.initialized) return;

    try {
      this.client.time_event(eventName);
    } catch (error) {
      console.error('Failed to time event in Mixpanel:', error);
    }
  }

  /**
   * Get distinct ID
   */
  getDistinctId(): string | null {
    if (!this.client || !this.initialized) return null;

    try {
      return this.client.get_distinct_id();
    } catch (error) {
      console.error('Failed to get distinct ID from Mixpanel:', error);
      return null;
    }
  }

  /**
   * Reset Mixpanel (clear user identity)
   */
  reset(): void {
    if (!this.client || !this.initialized) return;

    try {
      this.client.reset();
    } catch (error) {
      console.error('Failed to reset Mixpanel:', error);
    }
  }
}

/**
 * Create Mixpanel integration
 */
export function createMixpanelIntegration(config: MixpanelConfig): MixpanelIntegration {
  return new MixpanelIntegration(config);
}
