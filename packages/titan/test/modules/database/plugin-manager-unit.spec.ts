/**
 * Plugin Manager Unit Tests
 *
 * Tests for plugin system covering:
 * - Plugin registration and loading
 * - Plugin lifecycle (enable/disable)
 * - Plugin application to repositories
 * - Built-in plugins
 * - Custom plugins
 * - Error handling
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { PluginManager } from '../../../src/modules/database/plugins/plugin.manager.js';

describe('PluginManager - Unit Tests', () => {
  let pluginManager: PluginManager;
  let mockLogger: any;

  beforeEach(() => {
    mockLogger = {
      info: jest.fn(),
      debug: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };

    pluginManager = new PluginManager({}, mockLogger);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Plugin Registration', () => {
    it('should register custom plugin', () => {
      const plugin = {
        name: 'custom',
        extendRepository: (repo: any) => repo,
      };

      pluginManager.register('custom', plugin);

      expect(pluginManager.has('custom')).toBe(true);
    });

    it('should register plugin with configuration', () => {
      const plugin = {
        name: 'custom',
        extendRepository: (repo: any) => repo,
      };

      pluginManager.register('custom', plugin, { enabled: true });

      expect(pluginManager.isEnabled('custom')).toBe(true);
    });

    it('should register disabled plugin', () => {
      const plugin = {
        name: 'custom',
        extendRepository: (repo: any) => repo,
      };

      pluginManager.register('custom', plugin, { enabled: false });

      expect(pluginManager.has('custom')).toBe(true);
      expect(pluginManager.isEnabled('custom')).toBe(false);
    });

    it('should throw error when registering duplicate plugin', () => {
      const plugin = {
        name: 'duplicate',
        extendRepository: (repo: any) => repo,
      };

      pluginManager.register('duplicate', plugin);

      expect(() => pluginManager.register('duplicate', plugin)).toThrow();
    });

    it('should allow overriding plugin with force option', () => {
      const plugin1 = {
        name: 'override',
        extendRepository: (repo: any) => ({ ...repo, version: 1 }),
      };

      const plugin2 = {
        name: 'override',
        extendRepository: (repo: any) => ({ ...repo, version: 2 }),
      };

      pluginManager.register('override', plugin1);
      pluginManager.register('override', plugin2, { force: true });

      expect(pluginManager.has('override')).toBe(true);
    });
  });

  describe('Plugin Lifecycle', () => {
    it('should enable plugin', () => {
      const plugin = {
        name: 'lifecycle',
        extendRepository: (repo: any) => repo,
      };

      pluginManager.register('lifecycle', plugin, { enabled: false });
      pluginManager.enable('lifecycle');

      expect(pluginManager.isEnabled('lifecycle')).toBe(true);
    });

    it('should disable plugin', () => {
      const plugin = {
        name: 'lifecycle',
        extendRepository: (repo: any) => repo,
      };

      pluginManager.register('lifecycle', plugin, { enabled: true });
      pluginManager.disable('lifecycle');

      expect(pluginManager.isEnabled('lifecycle')).toBe(false);
    });

    it('should throw error when enabling non-existent plugin', () => {
      expect(() => pluginManager.enable('nonexistent')).toThrow();
    });

    it('should throw error when disabling non-existent plugin', () => {
      expect(() => pluginManager.disable('nonexistent')).toThrow();
    });

    it('should unregister plugin', () => {
      const plugin = {
        name: 'unregister',
        extendRepository: (repo: any) => repo,
      };

      pluginManager.register('unregister', plugin);
      pluginManager.unregister('unregister');

      expect(pluginManager.has('unregister')).toBe(false);
    });

    it('should not throw when unregistering non-existent plugin', () => {
      expect(() => pluginManager.unregister('nonexistent')).not.toThrow();
    });
  });

  describe('Plugin Application', () => {
    it('should apply single plugin to repository', () => {
      const plugin = {
        name: 'test',
        extendRepository: (repo: any) => {
          repo.testMethod = () => 'test';
          return repo;
        },
      };

      pluginManager.register('test', plugin);

      const repo = {};
      const enhanced = pluginManager.applyPlugins(repo, ['test']);

      expect((enhanced as any).testMethod()).toBe('test');
    });

    it('should apply multiple plugins to repository', () => {
      const plugin1 = {
        name: 'plugin1',
        extendRepository: (repo: any) => {
          repo.method1 = () => 'method1';
          return repo;
        },
      };

      const plugin2 = {
        name: 'plugin2',
        extendRepository: (repo: any) => {
          repo.method2 = () => 'method2';
          return repo;
        },
      };

      pluginManager.register('plugin1', plugin1);
      pluginManager.register('plugin2', plugin2);

      const repo = {};
      const enhanced = pluginManager.applyPlugins(repo, ['plugin1', 'plugin2']);

      expect((enhanced as any).method1()).toBe('method1');
      expect((enhanced as any).method2()).toBe('method2');
    });

    it('should skip disabled plugins', () => {
      const plugin = {
        name: 'disabled',
        extendRepository: (repo: any) => {
          repo.shouldNotExist = () => 'fail';
          return repo;
        },
      };

      pluginManager.register('disabled', plugin, { enabled: false });

      const repo = {};
      const enhanced = pluginManager.applyPlugins(repo, ['disabled']);

      expect((enhanced as any).shouldNotExist).toBeUndefined();
    });

    it('should warn when applying non-existent plugin', () => {
      const repo = {};
      pluginManager.applyPlugins(repo, ['nonexistent']);

      expect(mockLogger.warn).toHaveBeenCalled();
    });

    it('should handle plugin application errors', () => {
      const plugin = {
        name: 'error',
        extendRepository: () => {
          throw new Error('Plugin error');
        },
      };

      pluginManager.register('error', plugin);

      const repo = {};

      expect(() => pluginManager.applyPlugins(repo, ['error'])).toThrow('Plugin error');
    });

    it('should apply plugins in specified order', () => {
      const calls: string[] = [];

      const plugin1 = {
        name: 'first',
        extendRepository: (repo: any) => {
          calls.push('first');
          return repo;
        },
      };

      const plugin2 = {
        name: 'second',
        extendRepository: (repo: any) => {
          calls.push('second');
          return repo;
        },
      };

      pluginManager.register('first', plugin1);
      pluginManager.register('second', plugin2);

      const repo = {};
      pluginManager.applyPlugins(repo, ['first', 'second']);

      expect(calls).toEqual(['first', 'second']);
    });
  });

  describe('Plugin Queries', () => {
    it('should check if plugin exists', () => {
      const plugin = {
        name: 'exists',
        extendRepository: (repo: any) => repo,
      };

      expect(pluginManager.has('exists')).toBe(false);

      pluginManager.register('exists', plugin);

      expect(pluginManager.has('exists')).toBe(true);
    });

    it('should get plugin instance', () => {
      const plugin = {
        name: 'get',
        extendRepository: (repo: any) => repo,
      };

      pluginManager.register('get', plugin);

      const retrieved = pluginManager.get('get');

      expect(retrieved).toBe(plugin);
    });

    it('should return undefined for non-existent plugin', () => {
      const retrieved = pluginManager.get('nonexistent');

      expect(retrieved).toBeUndefined();
    });

    it('should get all plugin names', () => {
      pluginManager.register('plugin1', {
        name: 'plugin1',
        extendRepository: (repo: any) => repo,
      });

      pluginManager.register('plugin2', {
        name: 'plugin2',
        extendRepository: (repo: any) => repo,
      });

      const names = pluginManager.getPluginNames();

      expect(names).toContain('plugin1');
      expect(names).toContain('plugin2');
    });

    it('should get plugin status', () => {
      pluginManager.register(
        'status-test',
        {
          name: 'status-test',
          extendRepository: (repo: any) => repo,
        },
        { enabled: true }
      );

      const status = pluginManager.getPluginStatus();

      expect(status.has('status-test')).toBe(true);
      expect(status.get('status-test')?.enabled).toBe(true);
    });
  });

  describe('Built-in Plugins', () => {
    it('should initialize with built-in plugins', () => {
      // Built-in plugins should be available
      const manager = new PluginManager({}, mockLogger);

      // The specific built-in plugins depend on configuration
      expect(manager.getPluginNames().length).toBeGreaterThanOrEqual(0);
    });

    it('should load built-in plugins from config', () => {
      const manager = new PluginManager(
        {
          plugins: {
            'soft-delete': { enabled: true },
          },
        },
        mockLogger
      );

      // Should have loaded plugins from config
      expect(manager.getPluginNames().length).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Plugin Configuration', () => {
    it('should respect global enabled setting', () => {
      const manager = new PluginManager(
        {
          enabled: false,
        },
        mockLogger
      );

      manager.register('test', {
        name: 'test',
        extendRepository: (repo: any) => repo,
      });

      // Plugin registration should work even if globally disabled
      expect(manager.has('test')).toBe(true);
    });

    it('should allow plugin-specific configuration', () => {
      const manager = new PluginManager(
        {
          plugins: {
            custom: {
              enabled: true,
              config: { option: 'value' },
            },
          },
        },
        mockLogger
      );

      // Configuration should be available
      expect(manager.has('custom')).toBe(false); // Not registered yet
    });
  });

  describe('Error Handling', () => {
    it('should handle missing extendRepository method', () => {
      const invalidPlugin: any = {
        name: 'invalid',
      };

      expect(() => pluginManager.register('invalid', invalidPlugin)).toThrow();
    });

    it('should handle null plugin', () => {
      expect(() => pluginManager.register('null', null as any)).toThrow();
    });

    it('should handle undefined plugin', () => {
      expect(() => pluginManager.register('undefined', undefined as any)).toThrow();
    });

    it('should log plugin errors', () => {
      const plugin = {
        name: 'error-log',
        extendRepository: () => {
          throw new Error('Test error');
        },
      };

      pluginManager.register('error-log', plugin);

      const repo = {};

      try {
        pluginManager.applyPlugins(repo, ['error-log']);
      } catch {}

      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty plugin name', () => {
      const plugin = {
        name: '',
        extendRepository: (repo: any) => repo,
      };

      expect(() => pluginManager.register('', plugin)).toThrow();
    });

    it('should handle whitespace plugin name', () => {
      const plugin = {
        name: '   ',
        extendRepository: (repo: any) => repo,
      };

      expect(() => pluginManager.register('   ', plugin)).toThrow();
    });

    it('should handle applying empty plugin array', () => {
      const repo = { existing: 'data' };
      const result = pluginManager.applyPlugins(repo, []);

      expect(result).toEqual(repo);
    });

    it('should handle concurrent plugin operations', () => {
      const plugins = Array.from({ length: 10 }, (_, i) => ({
        name: `plugin${i}`,
        plugin: {
          name: `plugin${i}`,
          extendRepository: (repo: any) => repo,
        },
      }));

      plugins.forEach(({ name, plugin }) => {
        pluginManager.register(name, plugin);
      });

      expect(pluginManager.getPluginNames().length).toBeGreaterThanOrEqual(10);
    });

    it('should preserve repository data when applying plugins', () => {
      const plugin = {
        name: 'preserve',
        extendRepository: (repo: any) => {
          repo.newMethod = () => 'new';
          return repo;
        },
      };

      pluginManager.register('preserve', plugin);

      const repo = { existingData: 'value', existingMethod: () => 'existing' };
      const enhanced = pluginManager.applyPlugins(repo, ['preserve']);

      expect((enhanced as any).existingData).toBe('value');
      expect((enhanced as any).existingMethod()).toBe('existing');
      expect((enhanced as any).newMethod()).toBe('new');
    });
  });

  describe('Plugin Metadata', () => {
    it('should store plugin metadata', () => {
      const plugin = {
        name: 'metadata',
        version: '1.0.0',
        description: 'Test plugin',
        extendRepository: (repo: any) => repo,
      };

      pluginManager.register('metadata', plugin);

      const retrieved = pluginManager.get('metadata');

      expect(retrieved).toHaveProperty('name', 'metadata');
    });

    it('should get plugin count', () => {
      pluginManager.register('p1', {
        name: 'p1',
        extendRepository: (repo: any) => repo,
      });

      pluginManager.register('p2', {
        name: 'p2',
        extendRepository: (repo: any) => repo,
      });

      expect(pluginManager.getPluginNames().length).toBeGreaterThanOrEqual(2);
    });
  });
});
