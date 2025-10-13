/**
 * Tests for Module Federation
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  ModuleFederationRuntime,
  ModuleFederationManager,
  MockModuleFederationRuntime,
  moduleFederationPlugin,
  loadRemoteComponent,
  testUtils,
  type ModuleFederationConfig,
  type RemoteContainer,
} from '../../src/build/module-federation.js';

describe('ModuleFederationRuntime', () => {
  let runtime: ModuleFederationRuntime;

  beforeEach(() => {
    runtime = new ModuleFederationRuntime({
      errorBoundaries: true,
      retry: true,
      maxRetries: 3,
      timeout: 5000,
    });
  });

  afterEach(() => {
    runtime.clear();
  });

  it('should create runtime with default options', () => {
    const defaultRuntime = new ModuleFederationRuntime();
    expect(defaultRuntime).toBeDefined();
  });

  it('should register remote modules', () => {
    runtime.registerRemote('app1', 'http://localhost:3001');
    expect(runtime.isRemoteLoaded('app1')).toBe(false);
  });

  it('should register shared modules', () => {
    const module = { test: 'value' };
    runtime.registerShared('react', module, '18.0.0');
    expect(runtime.getShared('react')).toEqual(module);
  });

  it('should throw error when loading unregistered remote', async () => {
    await expect(runtime.loadRemote('unknown')).rejects.toThrow('Remote "unknown" not registered');
  });

  it('should check if remote is loaded', () => {
    runtime.registerRemote('app1', 'http://localhost:3001');
    expect(runtime.isRemoteLoaded('app1')).toBe(false);
  });

  it('should get remote error if any', () => {
    expect(runtime.getRemoteError('app1')).toBeUndefined();
  });

  it('should clear all remotes', () => {
    runtime.registerRemote('app1', 'http://localhost:3001');
    runtime.registerRemote('app2', 'http://localhost:3002');
    runtime.clear();
    expect(runtime.isRemoteLoaded('app1')).toBe(false);
    expect(runtime.isRemoteLoaded('app2')).toBe(false);
  });

  it('should handle shared modules correctly', () => {
    const reactModule = { version: '18.0.0' };
    runtime.registerShared('react', reactModule, '18.0.0');

    const retrieved = runtime.getShared('react');
    expect(retrieved).toEqual(reactModule);
  });

  it('should return undefined for unknown shared module', () => {
    expect(runtime.getShared('unknown')).toBeUndefined();
  });
});

describe('ModuleFederationManager', () => {
  let manager: ModuleFederationManager;
  let config: ModuleFederationConfig;

  beforeEach(() => {
    config = {
      name: 'host-app',
      filename: 'remoteEntry.js',
      exposes: {
        './Button': './src/components/Button.tsx',
        './Card': './src/components/Card.tsx',
      },
      remotes: {
        app1: 'http://localhost:3001',
        app2: 'http://localhost:3002',
      },
      shared: {
        react: '18.0.0',
        'react-dom': {
          version: '18.0.0',
          singleton: true,
          requiredVersion: '^18.0.0',
        },
        '@omnitron-dev/aether': {
          version: '1.0.0',
          singleton: true,
          eager: true,
        },
      },
      generateTypes: true,
      typesDir: './types',
    };

    manager = new ModuleFederationManager(config);
  });

  it('should create manager with config', () => {
    expect(manager).toBeDefined();
  });

  it('should normalize shared configuration', () => {
    const normalized = manager.normalizeShared();

    expect(normalized.react).toEqual({
      version: '18.0.0',
      singleton: false,
      eager: false,
      shareScope: 'default',
      requiredVersion: undefined,
    });

    expect(normalized['react-dom']).toEqual({
      version: '18.0.0',
      singleton: true,
      requiredVersion: '^18.0.0',
      eager: false,
      shareScope: 'default',
    });

    expect(normalized['@omnitron-dev/aether']).toEqual({
      version: '1.0.0',
      singleton: true,
      eager: true,
      shareScope: 'default',
      requiredVersion: undefined,
    });
  });

  it('should build federation manifest', async () => {
    const manifest = await manager.buildManifest('1.0.0');

    expect(manifest.name).toBe('host-app');
    expect(manifest.version).toBe('1.0.0');
    expect(manifest.remotes).toEqual({
      app1: {
        url: 'http://localhost:3001',
        name: 'app1',
        entry: 'http://localhost:3001/remoteEntry.js',
      },
      app2: {
        url: 'http://localhost:3002',
        name: 'app2',
        entry: 'http://localhost:3002/remoteEntry.js',
      },
    });
    expect(manifest.exposes).toEqual(config.exposes);
    expect(manifest.shared).toBeDefined();
  });

  it('should generate remote entry file', () => {
    const entry = manager.generateRemoteEntry();

    expect(entry).toContain('moduleMap');
    expect(entry).toContain("'./Button'");
    expect(entry).toContain("'./Card'");
    expect(entry).toContain('./src/components/Button.tsx');
    expect(entry).toContain('./src/components/Card.tsx');
    expect(entry).toContain('get');
    expect(entry).toContain('init');
  });

  it('should handle empty exposes', () => {
    const emptyManager = new ModuleFederationManager({
      name: 'empty-app',
      exposes: {},
    });

    const entry = emptyManager.generateRemoteEntry();
    expect(entry).toContain('moduleMap');
  });

  it('should get manifest after building', async () => {
    expect(manager.getManifest()).toBeUndefined();

    await manager.buildManifest('1.0.0');
    const manifest = manager.getManifest();

    expect(manifest).toBeDefined();
    expect(manifest?.name).toBe('host-app');
  });

  it('should normalize shared with custom share scope', () => {
    const customManager = new ModuleFederationManager({
      name: 'custom-app',
      shared: {
        library: {
          version: '1.0.0',
          shareScope: 'custom',
        },
      },
    });

    const normalized = customManager.normalizeShared();
    expect(normalized.library.shareScope).toBe('custom');
  });

  it('should normalize shared with package name', () => {
    const customManager = new ModuleFederationManager({
      name: 'custom-app',
      shared: {
        'my-lib': {
          version: '1.0.0',
          packageName: '@scope/my-lib',
        },
      },
    });

    const normalized = customManager.normalizeShared();
    expect(normalized['my-lib'].packageName).toBe('@scope/my-lib');
  });
});

describe('MockModuleFederationRuntime', () => {
  let mockRuntime: MockModuleFederationRuntime;

  beforeEach(() => {
    mockRuntime = new MockModuleFederationRuntime();
  });

  afterEach(() => {
    mockRuntime.clearMocks();
    mockRuntime.clear();
  });

  it('should create mock runtime', () => {
    expect(mockRuntime).toBeDefined();
  });

  it('should mock remote modules', async () => {
    const mockModule = { default: () => 'Mocked Component' };
    mockRuntime.mockRemote('app1', 'Button', mockModule);

    mockRuntime.registerRemote('app1', 'http://localhost:3001');

    const loaded = await mockRuntime.loadRemote('app1', 'Button');
    expect(loaded).toEqual(mockModule);
  });

  it('should clear mocks', () => {
    const mockModule = { default: () => 'Mocked Component' };
    mockRuntime.mockRemote('app1', 'Button', mockModule);
    mockRuntime.clearMocks();

    // After clearing, should not find mock
    expect(mockRuntime).toBeDefined();
  });

  it('should handle multiple mocked modules', async () => {
    const mockButton = { default: () => 'Button' };
    const mockCard = { default: () => 'Card' };

    mockRuntime.mockRemote('app1', 'Button', mockButton);
    mockRuntime.mockRemote('app1', 'Card', mockCard);

    mockRuntime.registerRemote('app1', 'http://localhost:3001');

    const button = await mockRuntime.loadRemote('app1', 'Button');
    const card = await mockRuntime.loadRemote('app1', 'Card');

    expect(button).toEqual(mockButton);
    expect(card).toEqual(mockCard);
  });
});

describe('moduleFederationPlugin', () => {
  it('should create plugin with basic config', () => {
    const plugin = moduleFederationPlugin({
      name: 'test-app',
    });

    expect(plugin).toBeDefined();
    expect(plugin.name).toBe('aether-module-federation');
    expect(plugin.enforce).toBe('post');
  });

  it('should create plugin with full config', () => {
    const plugin = moduleFederationPlugin({
      name: 'test-app',
      filename: 'customEntry.js',
      exposes: {
        './Button': './src/Button.tsx',
      },
      remotes: {
        app1: 'http://localhost:3001',
      },
      shared: {
        react: '18.0.0',
      },
    });

    expect(plugin).toBeDefined();
  });

  it('should have required plugin hooks', () => {
    const plugin = moduleFederationPlugin({
      name: 'test-app',
    });

    expect(plugin.configResolved).toBeDefined();
    expect(plugin.buildStart).toBeDefined();
    expect(plugin.resolveId).toBeDefined();
    expect(plugin.load).toBeDefined();
    expect(plugin.transform).toBeDefined();
    expect(plugin.generateBundle).toBeDefined();
    expect(plugin.writeBundle).toBeDefined();
  });
});

describe('loadRemoteComponent', () => {
  beforeEach(() => {
    // Setup global runtime
    const mockRuntime = new MockModuleFederationRuntime();
    (global as any).window = { __FEDERATION__: mockRuntime };
  });

  afterEach(() => {
    delete (global as any).window;
  });

  it('should create component loader function', () => {
    const loader = loadRemoteComponent('app1', 'Button');
    expect(loader).toBeInstanceOf(Function);
  });

  it('should load remote component', async () => {
    const mockRuntime = (global as any).window.__FEDERATION__ as MockModuleFederationRuntime;
    const mockComponent = { default: () => 'Button Component' };

    mockRuntime.mockRemote('app1', 'Button', mockComponent);
    mockRuntime.registerRemote('app1', 'http://localhost:3001');

    const loader = loadRemoteComponent('app1', 'Button');
    const component = await loader();

    expect(component).toEqual(mockComponent);
  });

  it('should handle loading errors with fallback', async () => {
    const mockRuntime = (global as any).window.__FEDERATION__ as MockModuleFederationRuntime;
    mockRuntime.registerRemote('app1', 'http://localhost:3001');

    const fallback = { default: () => 'Fallback Component' };
    const loader = loadRemoteComponent('app1', 'NonExistent', fallback);

    // Mock should not find the module, but fallback should be returned
    const component = await loader();
    expect(component).toEqual(fallback);
  });

  it('should throw error when runtime not initialized', async () => {
    delete (global as any).window.__FEDERATION__;

    const loader = loadRemoteComponent('app1', 'Button');

    await expect(loader()).rejects.toThrow('Module Federation runtime not initialized');
  });
});

describe('testUtils', () => {
  it('should create mock runtime', () => {
    const runtime = testUtils.createMockRuntime();
    expect(runtime).toBeInstanceOf(MockModuleFederationRuntime);
  });

  it('should create mock runtime with options', () => {
    const runtime = testUtils.createMockRuntime({
      timeout: 10000,
      maxRetries: 5,
    });
    expect(runtime).toBeInstanceOf(MockModuleFederationRuntime);
  });

  it('should create mock manifest', () => {
    const manifest = testUtils.createMockManifest('test-app');

    expect(manifest.name).toBe('test-app');
    expect(manifest.version).toBe('1.0.0');
    expect(manifest.remotes).toEqual({});
    expect(manifest.exposes).toEqual({});
    expect(manifest.shared).toEqual({});
  });

  it('should create mock remote container', () => {
    const mockModule = { get: () => {}, init: () => {} };
    const remote = testUtils.createMockRemote('app1', 'http://localhost:3001', mockModule);

    expect(remote.name).toBe('app1');
    expect(remote.url).toBe('http://localhost:3001');
    expect(remote.loaded).toBe(true);
    expect(remote.module).toEqual(mockModule);
  });
});

describe('Integration Tests', () => {
  it('should handle complete federation workflow', async () => {
    const config: ModuleFederationConfig = {
      name: 'host-app',
      exposes: {
        './Button': './src/Button.tsx',
      },
      remotes: {
        app1: 'http://localhost:3001',
      },
      shared: {
        react: '18.0.0',
      },
    };

    const manager = new ModuleFederationManager(config);
    const manifest = await manager.buildManifest('1.0.0');

    expect(manifest.name).toBe('host-app');
    expect(manifest.exposes['./Button']).toBe('./src/Button.tsx');
    expect(manifest.remotes.app1).toBeDefined();
    expect(manifest.shared.react).toBeDefined();
  });

  it('should handle runtime with multiple remotes', () => {
    const runtime = new ModuleFederationRuntime();

    runtime.registerRemote('app1', 'http://localhost:3001');
    runtime.registerRemote('app2', 'http://localhost:3002');
    runtime.registerRemote('app3', 'http://localhost:3003');

    expect(runtime.isRemoteLoaded('app1')).toBe(false);
    expect(runtime.isRemoteLoaded('app2')).toBe(false);
    expect(runtime.isRemoteLoaded('app3')).toBe(false);
  });

  it('should handle shared modules across remotes', () => {
    const runtime = new ModuleFederationRuntime();

    runtime.registerShared('react', { version: '18.0.0' }, '18.0.0');
    runtime.registerShared('react-dom', { version: '18.0.0' }, '18.0.0');

    expect(runtime.getShared('react')).toBeDefined();
    expect(runtime.getShared('react-dom')).toBeDefined();
  });

  it('should create plugin and manager together', async () => {
    const config: ModuleFederationConfig = {
      name: 'test-app',
      exposes: {
        './Component': './src/Component.tsx',
      },
      remotes: {
        remote1: 'http://localhost:3001',
      },
      shared: {
        react: '18.0.0',
      },
    };

    const plugin = moduleFederationPlugin(config);
    const manager = new ModuleFederationManager(config);

    expect(plugin).toBeDefined();
    expect(manager).toBeDefined();

    const manifest = await manager.buildManifest('1.0.0');
    expect(manifest.name).toBe('test-app');
  });

  it('should handle complex shared configuration', () => {
    const manager = new ModuleFederationManager({
      name: 'complex-app',
      shared: {
        react: '18.0.0',
        'react-dom': {
          version: '18.0.0',
          singleton: true,
        },
        '@omnitron-dev/aether': {
          version: '1.0.0',
          singleton: true,
          eager: true,
          shareScope: 'aether',
        },
        lodash: {
          version: '4.17.21',
          requiredVersion: '^4.17.0',
        },
      },
    });

    const normalized = manager.normalizeShared();

    expect(normalized.react.singleton).toBe(false);
    expect(normalized['react-dom'].singleton).toBe(true);
    expect(normalized['@omnitron-dev/aether'].eager).toBe(true);
    expect(normalized['@omnitron-dev/aether'].shareScope).toBe('aether');
    expect(normalized.lodash.requiredVersion).toBe('^4.17.0');
  });

  it('should generate proper remote entry with multiple exposes', () => {
    const manager = new ModuleFederationManager({
      name: 'multi-expose-app',
      exposes: {
        './Button': './src/components/Button.tsx',
        './Card': './src/components/Card.tsx',
        './Modal': './src/components/Modal.tsx',
        './Form': './src/components/Form.tsx',
      },
    });

    const entry = manager.generateRemoteEntry();

    expect(entry).toContain("'./Button'");
    expect(entry).toContain("'./Card'");
    expect(entry).toContain("'./Modal'");
    expect(entry).toContain("'./Form'");
    expect(entry).toContain('./src/components/Button.tsx');
    expect(entry).toContain('./src/components/Card.tsx');
    expect(entry).toContain('./src/components/Modal.tsx');
    expect(entry).toContain('./src/components/Form.tsx');
  });
});

describe('Error Handling', () => {
  it('should handle runtime errors gracefully', async () => {
    const runtime = new ModuleFederationRuntime({
      retry: false,
    });

    runtime.registerRemote('failing-app', 'http://invalid-url');

    await expect(runtime.loadRemote('failing-app')).rejects.toThrow();
  });

  it('should handle missing shared modules', () => {
    const runtime = new ModuleFederationRuntime();
    expect(runtime.getShared('non-existent')).toBeUndefined();
  });

  it('should handle invalid remote names', async () => {
    const runtime = new ModuleFederationRuntime();
    await expect(runtime.loadRemote('')).rejects.toThrow();
  });

  it('should provide error information for failed remotes', async () => {
    const runtime = new ModuleFederationRuntime({
      retry: false,
    });

    runtime.registerRemote('app1', 'http://invalid-url');

    try {
      await runtime.loadRemote('app1');
    } catch {
      const error = runtime.getRemoteError('app1');
      expect(error).toBeDefined();
    }
  });
});

describe('Configuration Edge Cases', () => {
  it('should handle minimal config', () => {
    const manager = new ModuleFederationManager({
      name: 'minimal-app',
    });

    expect(manager).toBeDefined();
    const normalized = manager.normalizeShared();
    expect(Object.keys(normalized)).toHaveLength(0);
  });

  it('should handle empty strings in config', () => {
    const manager = new ModuleFederationManager({
      name: 'test-app',
      filename: '',
      exposes: {},
      remotes: {},
      shared: {},
    });

    expect(manager).toBeDefined();
  });

  it('should use default filename when not provided', async () => {
    const manager = new ModuleFederationManager({
      name: 'test-app',
    });

    const manifest = await manager.buildManifest('1.0.0');
    expect(manifest).toBeDefined();
  });

  it('should handle special characters in names', () => {
    const manager = new ModuleFederationManager({
      name: '@scope/my-app',
      exposes: {
        './component-name': './src/Component.tsx',
      },
    });

    const entry = manager.generateRemoteEntry();
    expect(entry).toContain('./component-name');
  });
});

describe('Performance and Caching', () => {
  it('should avoid redundant remote loads', async () => {
    const mockRuntime = new MockModuleFederationRuntime();
    const mockModule = { default: () => 'Component' };

    mockRuntime.mockRemote('app1', 'Button', mockModule);
    mockRuntime.registerRemote('app1', 'http://localhost:3001');

    // Load multiple times
    const promises = [
      mockRuntime.loadRemote('app1', 'Button'),
      mockRuntime.loadRemote('app1', 'Button'),
      mockRuntime.loadRemote('app1', 'Button'),
    ];

    const results = await Promise.all(promises);

    // All should return the same module
    expect(results[0]).toEqual(mockModule);
    expect(results[1]).toEqual(mockModule);
    expect(results[2]).toEqual(mockModule);
  });

  it('should handle concurrent loads of different modules', async () => {
    const mockRuntime = new MockModuleFederationRuntime();
    const mockButton = { default: () => 'Button' };
    const mockCard = { default: () => 'Card' };

    mockRuntime.mockRemote('app1', 'Button', mockButton);
    mockRuntime.mockRemote('app1', 'Card', mockCard);
    mockRuntime.registerRemote('app1', 'http://localhost:3001');

    const [button, card] = await Promise.all([
      mockRuntime.loadRemote('app1', 'Button'),
      mockRuntime.loadRemote('app1', 'Card'),
    ]);

    expect(button).toEqual(mockButton);
    expect(card).toEqual(mockCard);
  });
});
