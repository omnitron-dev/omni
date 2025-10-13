/**
 * Privacy and GDPR Compliance Module
 *
 * Handles cookie consent, data anonymization, and privacy regulations.
 * Supports GDPR, CCPA, and other privacy frameworks.
 */

import type { PrivacyConfig, ConsentState } from './types.js';

/**
 * Consent change callback
 */
type ConsentCallback = (consent: ConsentState) => void;

/**
 * Privacy manager class
 */
export class PrivacyManager {
  private config: PrivacyConfig;
  private consent: ConsentState;
  private callbacks: Set<ConsentCallback> = new Set();
  private consentCookieName = 'aether_consent';

  constructor(config: PrivacyConfig = {}) {
    this.config = {
      cookieConsent: true,
      respectDoNotTrack: true,
      anonymizeIp: true,
      dataRetention: 90,
      gdprCompliance: true,
      ...config,
    };

    // Load existing consent or use defaults
    this.consent = this.loadConsent() || {
      analytics: false,
      performance: false,
      errorTracking: false,
      marketing: false,
    };

    if (this.shouldBlockTracking()) {
      this.revokeAllConsent();
    }
  }

  /**
   * Check if tracking should be blocked
   */
  private shouldBlockTracking(): boolean {
    if (typeof window === 'undefined') return false;

    // Check Do Not Track
    if (this.config.respectDoNotTrack) {
      const dnt = navigator.doNotTrack || (window as any).doNotTrack || (navigator as any).msDoNotTrack;
      if (dnt === '1' || dnt === 'yes') {
        return true;
      }
    }

    return false;
  }

  /**
   * Request consent
   */
  async requestConsent(options?: {
    analytics?: boolean;
    performance?: boolean;
    errorTracking?: boolean;
    marketing?: boolean;
  }): Promise<ConsentState> {
    // If consent already given, return it
    if (this.hasConsent()) {
      return this.consent;
    }

    // Show consent UI (implementation would be in the app)
    return new Promise((resolve) => {
      // Emit event for app to show consent UI
      window.dispatchEvent(
        new CustomEvent('aether:consent:request', {
          detail: {
            options,
            callback: (consent: ConsentState) => {
              this.setConsent(consent);
              resolve(consent);
            },
          },
        })
      );
    });
  }

  /**
   * Set consent
   */
  setConsent(consent: Partial<ConsentState>): void {
    this.consent = {
      ...this.consent,
      ...consent,
    };

    this.saveConsent();
    this.notifyCallbacks();

    // Emit event
    window.dispatchEvent(
      new CustomEvent('aether:consent:change', {
        detail: this.consent,
      })
    );

    if (this.config.onConsentChange) {
      this.config.onConsentChange(this.consent);
    }
  }

  /**
   * Get consent
   */
  getConsent(): ConsentState {
    return { ...this.consent };
  }

  /**
   * Check if has consent for category
   */
  hasConsentFor(category: keyof ConsentState): boolean {
    return this.consent[category] === true;
  }

  /**
   * Check if any consent given
   */
  hasConsent(): boolean {
    return Object.values(this.consent).some((value) => value === true);
  }

  /**
   * Grant all consent
   */
  grantAllConsent(): void {
    this.setConsent({
      analytics: true,
      performance: true,
      errorTracking: true,
      marketing: true,
    });
  }

  /**
   * Revoke all consent
   */
  revokeAllConsent(): void {
    this.setConsent({
      analytics: false,
      performance: false,
      errorTracking: false,
      marketing: false,
    });
  }

  /**
   * Load consent from storage
   */
  private loadConsent(): ConsentState | null {
    try {
      const stored = localStorage.getItem(this.consentCookieName);
      if (stored) {
        return JSON.parse(stored);
      }
    } catch (error) {
      // Ignore
    }
    return null;
  }

  /**
   * Save consent to storage
   */
  private saveConsent(): void {
    try {
      localStorage.setItem(this.consentCookieName, JSON.stringify(this.consent));

      // Also set expiry cookie
      if (this.config.dataRetention) {
        const expires = new Date();
        expires.setDate(expires.getDate() + this.config.dataRetention);
        document.cookie = `${this.consentCookieName}=1; expires=${expires.toUTCString()}; path=/`;
      }
    } catch (error) {
      console.error('Failed to save consent:', error);
    }
  }

  /**
   * Clear consent
   */
  clearConsent(): void {
    try {
      localStorage.removeItem(this.consentCookieName);
      document.cookie = `${this.consentCookieName}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/`;
    } catch (error) {
      console.error('Failed to clear consent:', error);
    }
  }

  /**
   * Subscribe to consent changes
   */
  onConsentChange(callback: ConsentCallback): () => void {
    this.callbacks.add(callback);
    return () => this.callbacks.delete(callback);
  }

  /**
   * Notify callbacks
   */
  private notifyCallbacks(): void {
    this.callbacks.forEach((callback) => {
      try {
        callback(this.consent);
      } catch (error) {
        console.error('Consent callback error:', error);
      }
    });
  }

  /**
   * Anonymize IP address
   */
  anonymizeIp(ip: string): string {
    if (!this.config.anonymizeIp) return ip;

    const parts = ip.split('.');
    if (parts.length === 4) {
      // IPv4: mask last octet
      parts[3] = '0';
      return parts.join('.');
    }

    // IPv6: mask last 80 bits
    const ipv6Parts = ip.split(':');
    if (ipv6Parts.length > 4) {
      return ipv6Parts.slice(0, 4).join(':') + '::';
    }

    return ip;
  }

  /**
   * Anonymize user data
   */
  anonymizeUserData<T extends Record<string, any>>(data: T, fields: string[] = []): T {
    const anonymized = { ...data };
    const sensitiveFields = [...fields, 'email', 'name', 'username', 'phone', 'address'];

    for (const field of sensitiveFields) {
      if (field in anonymized) {
        delete anonymized[field];
      }
    }

    return anonymized;
  }

  /**
   * Check if GDPR applies
   */
  isGdprRequired(): boolean {
    if (!this.config.gdprCompliance) return false;

    // Check if user is in EU (simplified check via timezone)
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const euTimezones = ['Europe/', 'GMT', 'UTC'];

    return euTimezones.some((tz) => timezone.startsWith(tz));
  }

  /**
   * Export user data (GDPR right to data portability)
   */
  async exportUserData(): Promise<any> {
    // Emit event for app to gather user data
    return new Promise((resolve) => {
      window.dispatchEvent(
        new CustomEvent('aether:privacy:export', {
          detail: {
            callback: (data: any) => resolve(data),
          },
        })
      );
    });
  }

  /**
   * Delete user data (GDPR right to be forgotten)
   */
  async deleteUserData(): Promise<void> {
    // Clear consent
    this.clearConsent();

    // Clear all stored data
    this.clearAllData();

    // Emit event for app to delete user data
    window.dispatchEvent(new CustomEvent('aether:privacy:delete'));
  }

  /**
   * Clear all monitoring data
   */
  private clearAllData(): void {
    try {
      // Clear session storage
      sessionStorage.clear();

      // Clear relevant localStorage keys
      const keysToRemove: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith('aether_')) {
          keysToRemove.push(key);
        }
      }
      keysToRemove.forEach((key) => localStorage.removeItem(key));

      // Clear cookies
      const cookies = document.cookie.split(';');
      for (const cookie of cookies) {
        const name = cookie.split('=')[0].trim();
        if (name.startsWith('aether_')) {
          document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/`;
        }
      }
    } catch (error) {
      console.error('Failed to clear data:', error);
    }
  }
}

/**
 * Cookie consent banner helper
 */
export class ConsentBanner {
  private privacyManager: PrivacyManager;
  private bannerElement: HTMLElement | null = null;

  constructor(privacyManager: PrivacyManager) {
    this.privacyManager = privacyManager;
  }

  /**
   * Show consent banner
   */
  show(options?: {
    position?: 'top' | 'bottom';
    message?: string;
    acceptLabel?: string;
    declineLabel?: string;
    settingsLabel?: string;
  }): void {
    if (this.bannerElement || this.privacyManager.hasConsent()) {
      return;
    }

    const {
      position = 'bottom',
      message = 'We use cookies to improve your experience and analyze site usage.',
      acceptLabel = 'Accept All',
      declineLabel = 'Decline',
      settingsLabel = 'Settings',
    } = options || {};

    this.bannerElement = this.createBannerElement(
      position,
      message,
      acceptLabel,
      declineLabel,
      settingsLabel
    );

    document.body.appendChild(this.bannerElement);
  }

  /**
   * Create banner element
   */
  private createBannerElement(
    position: string,
    message: string,
    acceptLabel: string,
    declineLabel: string,
    settingsLabel: string
  ): HTMLElement {
    const banner = document.createElement('div');
    banner.className = `aether-consent-banner aether-consent-banner-${position}`;
    banner.innerHTML = `
      <div class="aether-consent-content">
        <p class="aether-consent-message">${message}</p>
        <div class="aether-consent-actions">
          <button class="aether-consent-button aether-consent-accept">${acceptLabel}</button>
          <button class="aether-consent-button aether-consent-decline">${declineLabel}</button>
          <button class="aether-consent-button aether-consent-settings">${settingsLabel}</button>
        </div>
      </div>
    `;

    // Add event listeners
    const acceptBtn = banner.querySelector('.aether-consent-accept') as HTMLElement;
    const declineBtn = banner.querySelector('.aether-consent-decline') as HTMLElement;
    const settingsBtn = banner.querySelector('.aether-consent-settings') as HTMLElement;

    acceptBtn?.addEventListener('click', () => {
      this.privacyManager.grantAllConsent();
      this.hide();
    });

    declineBtn?.addEventListener('click', () => {
      this.privacyManager.revokeAllConsent();
      this.hide();
    });

    settingsBtn?.addEventListener('click', () => {
      this.showSettings();
    });

    return banner;
  }

  /**
   * Show settings modal
   */
  private showSettings(): void {
    // Emit event for app to show settings modal
    window.dispatchEvent(new CustomEvent('aether:consent:settings'));
  }

  /**
   * Hide banner
   */
  hide(): void {
    if (this.bannerElement) {
      this.bannerElement.remove();
      this.bannerElement = null;
    }
  }
}

/**
 * Global privacy manager instance
 */
let globalPrivacyManager: PrivacyManager | null = null;

/**
 * Get or create global privacy manager
 */
export function getPrivacyManager(config?: PrivacyConfig): PrivacyManager {
  if (!globalPrivacyManager) {
    globalPrivacyManager = new PrivacyManager(config);
  }
  return globalPrivacyManager;
}

/**
 * Reset global privacy manager
 */
export function resetPrivacyManager(): void {
  globalPrivacyManager = null;
}
