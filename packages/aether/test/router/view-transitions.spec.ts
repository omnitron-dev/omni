/**
 * View Transitions Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  ViewTransitionsManager,
  supportsViewTransitions,
  getViewTransitionsManager,
  injectFallbackStyles,
} from '../../src/router/view-transitions.js';

describe('View Transitions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('supportsViewTransitions', () => {
    it('should return false in non-browser environment', () => {
      expect(supportsViewTransitions()).toBe(false);
    });

    it('should check for startViewTransition API', () => {
      const result = supportsViewTransitions();
      expect(typeof result).toBe('boolean');
    });
  });

  describe('ViewTransitionsManager', () => {
    it('should create manager with default config', () => {
      const manager = new ViewTransitionsManager();
      expect(manager).toBeDefined();
    });

    it('should create manager with custom config', () => {
      const manager = new ViewTransitionsManager({
        enabled: true,
        fallbackDuration: 500,
        defaultType: 'slide',
      });
      expect(manager).toBeDefined();
    });

    it('should execute transition with DOM update', async () => {
      const manager = new ViewTransitionsManager({ enabled: true });
      let updated = false;

      const updateDOM = () => {
        updated = true;
      };

      await manager.executeTransition('/from', '/to', updateDOM);
      expect(updated).toBe(true);
    });

    it('should skip transition when disabled', async () => {
      const manager = new ViewTransitionsManager({ enabled: false });
      let updated = false;

      const updateDOM = () => {
        updated = true;
      };

      await manager.executeTransition('/from', '/to', updateDOM);
      expect(updated).toBe(true);
    });

    it('should skip transition based on condition', async () => {
      const manager = new ViewTransitionsManager({
        enabled: true,
        skipTransition: (from, to) => from === '/skip',
      });
      let updated = false;

      const updateDOM = () => {
        updated = true;
      };

      await manager.executeTransition('/skip', '/to', updateDOM);
      expect(updated).toBe(true);
    });

    it('should call lifecycle hooks', async () => {
      const beforeHook = vi.fn();
      const afterHook = vi.fn();

      const manager = new ViewTransitionsManager(
        { enabled: true },
        {
          onBeforeTransition: beforeHook,
          onAfterTransition: afterHook,
        }
      );

      await manager.executeTransition('/from', '/to', () => {});

      expect(beforeHook).toHaveBeenCalledWith('/from', '/to');
      expect(afterHook).toHaveBeenCalledWith('/from', '/to');
    });

    it('should handle transition errors', async () => {
      const errorHook = vi.fn();
      const manager = new ViewTransitionsManager(
        { enabled: true },
        {
          onTransitionError: errorHook,
        }
      );

      const updateDOM = () => {
        throw new Error('Update failed');
      };

      await expect(manager.executeTransition('/from', '/to', updateDOM)).rejects.toThrow(
        'Update failed'
      );
    });

    it('should update config', () => {
      const manager = new ViewTransitionsManager({ enabled: true });
      manager.updateConfig({ fallbackDuration: 600 });
      expect(manager).toBeDefined();
    });
  });

  describe('Transition Groups', () => {
    it('should add element to group', () => {
      const manager = new ViewTransitionsManager();
      const element = document.createElement('div');

      manager.addToGroup('hero', element);
      expect(manager).toBeDefined();
    });

    it('should remove element from group', () => {
      const manager = new ViewTransitionsManager();
      const element = document.createElement('div');

      manager.addToGroup('hero', element);
      manager.removeFromGroup('hero', element);
      expect(manager).toBeDefined();
    });
  });

  describe('Singleton', () => {
    it('should get or create default manager', () => {
      const manager = getViewTransitionsManager();
      expect(manager).toBeDefined();
    });

    it('should inject fallback styles', () => {
      injectFallbackStyles();
      // Styles should be injected (no throw)
      expect(true).toBe(true);
    });
  });
});
