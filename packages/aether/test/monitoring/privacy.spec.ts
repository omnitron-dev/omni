/**
 * @vitest-environment happy-dom
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PrivacyManager, getPrivacyManager, resetPrivacyManager } from '../../src/monitoring/privacy.js';

describe('PrivacyManager', () => {
  let privacyManager: PrivacyManager;

  beforeEach(() => {
    resetPrivacyManager();
    localStorage.clear();
    privacyManager = getPrivacyManager({
      cookieConsent: true,
      respectDoNotTrack: false, // Disable for tests
    });
  });

  afterEach(() => {
    localStorage.clear();
    resetPrivacyManager();
  });

  describe('consent management', () => {
    it('should initialize with no consent', () => {
      const consent = privacyManager.getConsent();

      expect(consent.analytics).toBe(false);
      expect(consent.performance).toBe(false);
      expect(consent.errorTracking).toBe(false);
    });

    it('should set consent', () => {
      privacyManager.setConsent({
        analytics: true,
        performance: true,
      });

      const consent = privacyManager.getConsent();

      expect(consent.analytics).toBe(true);
      expect(consent.performance).toBe(true);
    });

    it('should check consent for category', () => {
      privacyManager.setConsent({
        analytics: true,
      });

      expect(privacyManager.hasConsentFor('analytics')).toBe(true);
      expect(privacyManager.hasConsentFor('performance')).toBe(false);
    });

    it('should grant all consent', () => {
      privacyManager.grantAllConsent();

      expect(privacyManager.hasConsentFor('analytics')).toBe(true);
      expect(privacyManager.hasConsentFor('performance')).toBe(true);
      expect(privacyManager.hasConsentFor('errorTracking')).toBe(true);
    });

    it('should revoke all consent', () => {
      privacyManager.grantAllConsent();
      privacyManager.revokeAllConsent();

      expect(privacyManager.hasConsentFor('analytics')).toBe(false);
      expect(privacyManager.hasConsentFor('performance')).toBe(false);
      expect(privacyManager.hasConsentFor('errorTracking')).toBe(false);
    });
  });

  describe('consent persistence', () => {
    it('should persist consent to localStorage', () => {
      privacyManager.setConsent({
        analytics: true,
      });

      const stored = localStorage.getItem('aether_consent');
      expect(stored).toBeTruthy();

      const parsed = JSON.parse(stored!);
      expect(parsed.analytics).toBe(true);
    });

    it('should load consent from localStorage', () => {
      localStorage.setItem(
        'aether_consent',
        JSON.stringify({
          analytics: true,
          performance: false,
          errorTracking: true,
          marketing: false,
        })
      );

      resetPrivacyManager();
      const newManager = getPrivacyManager();

      expect(newManager.hasConsentFor('analytics')).toBe(true);
      expect(newManager.hasConsentFor('performance')).toBe(false);
      expect(newManager.hasConsentFor('errorTracking')).toBe(true);
    });

    it('should clear consent', () => {
      privacyManager.setConsent({ analytics: true });
      privacyManager.clearConsent();

      const stored = localStorage.getItem('aether_consent');
      expect(stored).toBeNull();
    });
  });

  describe('consent change notifications', () => {
    it('should notify callbacks on consent change', () => {
      const callback = vi.fn();
      privacyManager.onConsentChange(callback);

      privacyManager.setConsent({ analytics: true });

      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({
          analytics: true,
        })
      );
    });

    it('should unsubscribe from consent changes', () => {
      const callback = vi.fn();
      const unsubscribe = privacyManager.onConsentChange(callback);

      unsubscribe();

      privacyManager.setConsent({ analytics: true });

      expect(callback).not.toHaveBeenCalled();
    });

    it('should call config callback on consent change', () => {
      const callback = vi.fn();

      resetPrivacyManager();
      const manager = getPrivacyManager({
        onConsentChange: callback,
      });

      manager.setConsent({ analytics: true });

      expect(callback).toHaveBeenCalled();
    });
  });

  describe('IP anonymization', () => {
    it('should anonymize IPv4 addresses', () => {
      const anonymized = privacyManager.anonymizeIp('192.168.1.100');

      expect(anonymized).toBe('192.168.1.0');
    });

    it('should anonymize IPv6 addresses', () => {
      const anonymized = privacyManager.anonymizeIp('2001:0db8:85a3:0000:0000:8a2e:0370:7334');

      expect(anonymized).toBe('2001:0db8:85a3:0000::');
    });

    it('should not anonymize when disabled', () => {
      resetPrivacyManager();
      const manager = getPrivacyManager({
        anonymizeIp: false,
      });

      const ip = '192.168.1.100';
      const anonymized = manager.anonymizeIp(ip);

      expect(anonymized).toBe(ip);
    });
  });

  describe('data anonymization', () => {
    it('should anonymize user data', () => {
      const data = {
        id: '123',
        email: 'test@example.com',
        name: 'Test User',
        phone: '555-1234',
        country: 'US',
      };

      const anonymized = privacyManager.anonymizeUserData(data);

      expect(anonymized.id).toBe('123');
      expect(anonymized.country).toBe('US');
      expect(anonymized.email).toBeUndefined();
      expect(anonymized.name).toBeUndefined();
      expect(anonymized.phone).toBeUndefined();
    });

    it('should anonymize custom fields', () => {
      const data = {
        id: '123',
        customField: 'sensitive',
        publicField: 'public',
      };

      const anonymized = privacyManager.anonymizeUserData(data, ['customField']);

      expect(anonymized.id).toBe('123');
      expect(anonymized.publicField).toBe('public');
      expect(anonymized.customField).toBeUndefined();
    });
  });

  describe('data export', () => {
    it('should export user data', async () => {
      const eventListener = vi.fn((event: any) => {
        event.detail.callback({ test: 'data' });
      });

      window.addEventListener('aether:privacy:export', eventListener);

      const data = await privacyManager.exportUserData();

      expect(data).toEqual({ test: 'data' });

      window.removeEventListener('aether:privacy:export', eventListener);
    });
  });

  describe('data deletion', () => {
    it('should delete user data', async () => {
      const eventListener = vi.fn();
      window.addEventListener('aether:privacy:delete', eventListener);

      privacyManager.setConsent({ analytics: true });

      await privacyManager.deleteUserData();

      expect(eventListener).toHaveBeenCalled();

      const stored = localStorage.getItem('aether_consent');
      expect(stored).toBeNull();

      window.removeEventListener('aether:privacy:delete', eventListener);
    });
  });
});
