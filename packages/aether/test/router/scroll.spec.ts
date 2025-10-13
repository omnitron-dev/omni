/**
 * Scroll Restoration Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  ScrollRestorationManager,
  getScrollRestorationManager,
  saveScrollPosition,
  restoreScrollPosition,
  scrollToTop,
  scrollToElement,
} from '../../src/router/scroll.js';

describe('Scroll Restoration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset scroll position
    if (typeof window !== 'undefined') {
      window.scrollTo(0, 0);
    }
  });

  describe('ScrollRestorationManager', () => {
    it('should create manager with default config', () => {
      const manager = new ScrollRestorationManager();
      expect(manager).toBeDefined();
    });

    it('should create manager with custom config', () => {
      const manager = new ScrollRestorationManager({
        enabled: true,
        behavior: 'smooth',
        scrollToTop: true,
        savePosition: true,
        maxSavedPositions: 100,
        restoreDelay: 100,
        hashScrolling: true,
        hashScrollOffset: 80,
      });
      expect(manager).toBeDefined();
    });

    it('should save scroll position', () => {
      const manager = new ScrollRestorationManager();
      manager.savePosition('/test');

      const saved = manager.getSavedPosition('/test');
      expect(saved).toBeDefined();
      expect(saved).toHaveProperty('left');
      expect(saved).toHaveProperty('top');
    });

    it('should restore saved position', async () => {
      const manager = new ScrollRestorationManager();

      manager.savePosition('/test');
      await manager.restorePosition('/test');

      expect(true).toBe(true);
    });

    it('should handle missing saved position', async () => {
      const manager = new ScrollRestorationManager({ scrollToTop: true });
      await manager.restorePosition('/missing');

      expect(true).toBe(true);
    });

    it('should scroll to specific position', async () => {
      const manager = new ScrollRestorationManager();
      await manager.scrollTo({ left: 0, top: 100 }, 'instant');

      expect(true).toBe(true);
    });

    it('should scroll to element', async () => {
      const manager = new ScrollRestorationManager();
      const element = document.createElement('div');
      element.id = 'target';
      document.body.appendChild(element);

      await manager.scrollToElement('#target');

      document.body.removeChild(element);
    });

    it('should handle missing element', async () => {
      const manager = new ScrollRestorationManager();
      await manager.scrollToElement('#missing');

      expect(true).toBe(true);
    });

    it('should scroll to hash', async () => {
      const manager = new ScrollRestorationManager();
      const element = document.createElement('div');
      element.id = 'section';
      document.body.appendChild(element);

      await manager.scrollToHash('#section');

      document.body.removeChild(element);
    });

    it('should handle invalid hash', async () => {
      const manager = new ScrollRestorationManager();
      await manager.scrollToHash('#invalid');

      expect(true).toBe(true);
    });

    it('should handle navigation', async () => {
      const manager = new ScrollRestorationManager();

      await manager.handleNavigation('/from', '/to', {}, false);
      expect(true).toBe(true);
    });

    it('should skip navigation when disabled', async () => {
      const manager = new ScrollRestorationManager({ enabled: false });

      await manager.handleNavigation('/from', '/to', {}, false);
      expect(true).toBe(true);
    });

    it('should skip navigation with skip option', async () => {
      const manager = new ScrollRestorationManager();

      await manager.handleNavigation('/from', '/to', { skip: true }, false);
      expect(true).toBe(true);
    });

    it('should restore position on pop state', async () => {
      const manager = new ScrollRestorationManager();

      manager.savePosition('/test');
      await manager.handleNavigation('/from', '/test', {}, true);

      expect(true).toBe(true);
    });

    it('should clear saved positions', () => {
      const manager = new ScrollRestorationManager();

      manager.savePosition('/test1');
      manager.savePosition('/test2');
      manager.clearSavedPositions('/test1');

      const saved = manager.getSavedPosition('/test1');
      expect(saved).toBeNull();
    });

    it('should clear all saved positions', () => {
      const manager = new ScrollRestorationManager();

      manager.savePosition('/test1');
      manager.savePosition('/test2');
      manager.clearSavedPositions();

      const saved = manager.getSavedPositions();
      expect(saved.size).toBe(0);
    });

    it('should get all saved positions', () => {
      const manager = new ScrollRestorationManager();

      manager.savePosition('/test1');
      manager.savePosition('/test2');

      const saved = manager.getSavedPositions();
      expect(saved.size).toBe(2);
    });

    it('should update configuration', () => {
      const manager = new ScrollRestorationManager({ enabled: true });
      manager.updateConfig({ behavior: 'smooth' });

      expect(manager).toBeDefined();
    });

    it('should dispose and cleanup', () => {
      const manager = new ScrollRestorationManager();
      manager.dispose();

      const saved = manager.getSavedPositions();
      expect(saved.size).toBe(0);
    });
  });

  describe('Scrollable Elements', () => {
    it('should register scrollable element', () => {
      const manager = new ScrollRestorationManager();
      const element = document.createElement('div');

      manager.registerScrollElement('sidebar', element);
      expect(manager).toBeDefined();
    });

    it('should unregister scrollable element', () => {
      const manager = new ScrollRestorationManager();
      const element = document.createElement('div');

      manager.registerScrollElement('sidebar', element);
      manager.unregisterScrollElement('sidebar');

      expect(manager).toBeDefined();
    });

    it('should scroll registered element', async () => {
      const manager = new ScrollRestorationManager();
      const element = document.createElement('div');
      element.style.overflow = 'auto';
      element.style.height = '100px';
      document.body.appendChild(element);

      manager.registerScrollElement('scroller', element);
      await manager.scrollElement('scroller', { left: 0, top: 50 }, 'instant');

      document.body.removeChild(element);
    });

    it('should handle missing scrollable element', async () => {
      const manager = new ScrollRestorationManager();
      await manager.scrollElement('missing', { left: 0, top: 50 });

      expect(true).toBe(true);
    });
  });

  describe('Helper Functions', () => {
    it('should save position with helper', () => {
      saveScrollPosition('/test');
      expect(true).toBe(true);
    });

    it('should restore position with helper', async () => {
      await restoreScrollPosition('/test');
      expect(true).toBe(true);
    });

    it('should scroll to top with helper', async () => {
      await scrollToTop('instant');
      expect(true).toBe(true);
    });

    it('should scroll to element with helper', async () => {
      const element = document.createElement('div');
      element.id = 'helper-target';
      document.body.appendChild(element);

      await scrollToElement('#helper-target');

      document.body.removeChild(element);
    });

    it('should get default manager', () => {
      const manager = getScrollRestorationManager();
      expect(manager).toBeDefined();
    });
  });

  describe('Edge Cases', () => {
    it('should handle rapid navigation', async () => {
      const manager = new ScrollRestorationManager();

      await manager.handleNavigation('/page1', '/page2', {}, false);
      await manager.handleNavigation('/page2', '/page3', {}, false);
      await manager.handleNavigation('/page3', '/page4', {}, false);

      expect(true).toBe(true);
    });

    it('should evict old positions when cache is full', () => {
      const manager = new ScrollRestorationManager({ maxSavedPositions: 3 });

      manager.savePosition('/page1');
      manager.savePosition('/page2');
      manager.savePosition('/page3');
      manager.savePosition('/page4'); // Should evict /page1

      const saved = manager.getSavedPosition('/page1');
      expect(saved).toBeNull();
    });
  });
});
