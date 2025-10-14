/**
 * Module Federation for Aether
 * Enables micro-frontend architecture with module sharing and dynamic loading
 */

import type { Plugin, ResolvedConfig } from 'vite';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as crypto from 'crypto';

/**
 * Configuration for shared dependencies
 */
export interface ShareConfig {
  /**
   * Version of the shared module
   */
  version?: string;

  /**
   * Whether this module should be a singleton
   * @default false
   */
  singleton?: boolean;

  /**
   * Required version range (semver)
   */
  requiredVersion?: string;

  /**
   * Load shared module eagerly
   * @default false
   */
  eager?: boolean;

  /**
   * Package name (if different from share key)
   */
  packageName?: string;

  /**
   * Share scope
   * @default 'default'
   */
  shareScope?: string;
}

/**
 * Module federation configuration
 */
export interface ModuleFederationConfig {
  /**
   * Unique name for this federated module
   */
  name: string;

  /**
   * Filename for the remote entry
   * @default 'remoteEntry.js'
   */
  filename?: string;

  /**
   * Modules to expose to other applications
   * Key: exposed name, Value: module path
   */
  exposes?: Record<string, string>;

  /**
   * Remote modules to consume
   * Key: remote name, Value: remote URL
   */
  remotes?: Record<string, string>;

  /**
   * Shared dependencies
   * Key: package name, Value: share config
   */
  shared?: Record<string, string | ShareConfig>;

  /**
   * Development mode configuration
   */
  dev?: {
    /**
     * Port for dev server
     */
    port?: number;

    /**
     * Host for dev server
     * @default 'localhost'
     */
    host?: string;
  };

  /**
   * Generate TypeScript types for remotes
   * @default true
   */
  generateTypes?: boolean;

  /**
   * Output directory for types
   * @default './types'
   */
  typesDir?: string;

  /**
   * Runtime options
   */
  runtime?: {
    /**
     * Enable error boundaries for remote modules
     * @default true
     */
    errorBoundaries?: boolean;

    /**
     * Retry failed remote loads
     * @default true
     */
    retry?: boolean;

    /**
     * Maximum retry attempts
     * @default 3
     */
    maxRetries?: number;

    /**
     * Timeout for loading remotes (ms)
     * @default 30000
     */
    timeout?: number;
  };
}

/**
 * Normalized share configuration
 */
interface NormalizedShareConfig extends Required<Omit<ShareConfig, 'packageName'>> {
  packageName?: string;
}

/**
 * Module federation manifest
 */
export interface FederationManifest {
  name: string;
  version: string;
  remotes: Record<string, RemoteInfo>;
  exposes: Record<string, string>;
  shared: Record<string, SharedInfo>;
}

/**
 * Remote module information
 */
export interface RemoteInfo {
  url: string;
  name: string;
  entry: string;
}

/**
 * Shared module information
 */
export interface SharedInfo {
  version: string;
  singleton: boolean;
  requiredVersion?: string;
  eager: boolean;
  shareScope: string;
}

/**
 * Remote container
 */
export interface RemoteContainer {
  name: string;
  url: string;
  loaded: boolean;
  module?: any;
  error?: Error;
}

/**
 * Module federation runtime
 */
export class ModuleFederationRuntime {
  private remotes: Map<string, RemoteContainer> = new Map();
  private shared: Map<string, any> = new Map();
  private loading: Map<string, Promise<any>> = new Map();
  private options: Required<ModuleFederationConfig['runtime']>;

  constructor(options: ModuleFederationConfig['runtime'] = {}) {
    this.options = {
      errorBoundaries: true,
      retry: true,
      maxRetries: 3,
      timeout: 30000,
      ...options,
    };
  }

  /**
   * Register a remote module
   */
  registerRemote(name: string, url: string): void {
    this.remotes.set(name, {
      name,
      url,
      loaded: false,
    });
  }

  /**
   * Register a shared module
   */
  registerShared(name: string, module: any, version: string): void {
    this.shared.set(name, { module, version });
  }

  /**
   * Load a remote module
   */
  async loadRemote(remoteName: string, moduleName?: string): Promise<any> {
    const remote = this.remotes.get(remoteName);
    if (!remote) {
      throw new Error(`Remote "${remoteName}" not registered`);
    }

    // Check if already loading
    const loadingKey = `${remoteName}:${moduleName || ''}`;
    if (this.loading.has(loadingKey)) {
      return this.loading.get(loadingKey);
    }

    // Create loading promise
    const loadPromise = this.doLoadRemote(remote, moduleName);
    this.loading.set(loadingKey, loadPromise);

    try {
      const result = await loadPromise;
      this.loading.delete(loadingKey);
      return result;
    } catch (error) {
      this.loading.delete(loadingKey);
      throw error;
    }
  }

  /**
   * Internal remote loading logic
   */
  private async doLoadRemote(remote: RemoteContainer, moduleName?: string): Promise<any> {
    let lastError: Error | undefined;
    const maxAttempts = this.options.retry ? (this.options.maxRetries || 1) : 1;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        // Load remote container if not loaded
        if (!remote.loaded) {
          await this.loadRemoteContainer(remote);
        }

        // Get module from container
        if (moduleName) {
          if (!remote.module) {
            throw new Error(`Remote container "${remote.name}" not initialized`);
          }

          const factory = await remote.module.get(moduleName);
          return factory();
        }

        return remote.module;
      } catch (error) {
        lastError = error as Error;

        // Don't retry on last attempt
        if (attempt < maxAttempts - 1) {
          // Exponential backoff
          const delay = Math.min(1000 * Math.pow(2, attempt), 5000);
          await new Promise((resolve) => setTimeout(resolve, delay));

          // Reset remote for retry
          remote.loaded = false;
          remote.error = undefined;
        }
      }
    }

    // All attempts failed
    remote.error = lastError;
    throw lastError || new Error(`Failed to load remote "${remote.name}"`);
  }

  /**
   * Load remote container
   */
  private async loadRemoteContainer(remote: RemoteContainer): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error(`Timeout loading remote "${remote.name}" from ${remote.url}`));
      }, this.options.timeout || 30000);

      const script = document.createElement('script');
      script.src = remote.url;
      script.type = 'text/javascript';
      script.async = true;

      script.onload = () => {
        clearTimeout(timeoutId);

        // Access the remote container
        const containerName = remote.name;
        const container = (window as any)[containerName];

        if (!container) {
          reject(new Error(`Remote container "${containerName}" not found`));
          return;
        }

        // Initialize container
        container
          .init(__webpack_share_scopes__.default)
          .then(() => {
            remote.module = container;
            remote.loaded = true;
            resolve();
          })
          .catch((error: Error) => {
            reject(new Error(`Failed to initialize remote "${remote.name}": ${error.message}`));
          });
      };

      script.onerror = () => {
        clearTimeout(timeoutId);
        reject(new Error(`Failed to load remote script from ${remote.url}`));
      };

      document.head.appendChild(script);
    });
  }

  /**
   * Get shared module
   */
  getShared(name: string): any {
    return this.shared.get(name)?.module;
  }

  /**
   * Check if remote is loaded
   */
  isRemoteLoaded(name: string): boolean {
    return this.remotes.get(name)?.loaded || false;
  }

  /**
   * Get remote error if any
   */
  getRemoteError(name: string): Error | undefined {
    return this.remotes.get(name)?.error;
  }

  /**
   * Clear all remotes
   */
  clear(): void {
    this.remotes.clear();
    this.loading.clear();
  }
}

/**
 * Module federation manager
 */
export class ModuleFederationManager {
  private config: Required<ModuleFederationConfig>;
  private manifest?: FederationManifest;

  constructor(config: ModuleFederationConfig) {
    this.config = {
      filename: 'remoteEntry.js',
      exposes: {},
      remotes: {},
      shared: {},
      dev: {},
      generateTypes: true,
      typesDir: './types',
      runtime: {},
      ...config,
    };
  }

  /**
   * Normalize shared configuration
   */
  normalizeShared(): Record<string, NormalizedShareConfig> {
    const normalized: Record<string, NormalizedShareConfig> = {};

    for (const [key, value] of Object.entries(this.config.shared)) {
      if (typeof value === 'string') {
        normalized[key] = {
          version: value,
          singleton: false,
          eager: false,
          shareScope: 'default',
          requiredVersion: undefined,
        };
      } else {
        const config: NormalizedShareConfig = {
          version: value.version || '1.0.0',
          singleton: value.singleton || false,
          requiredVersion: value.requiredVersion,
          eager: value.eager || false,
          shareScope: value.shareScope || 'default',
        };

        // Only add packageName if it's defined
        if (value.packageName !== undefined) {
          config.packageName = value.packageName;
        }

        normalized[key] = config;
      }
    }

    return normalized;
  }

  /**
   * Build federation manifest
   */
  async buildManifest(version: string): Promise<FederationManifest> {
    const remotes: Record<string, RemoteInfo> = {};
    const shared: Record<string, SharedInfo> = {};
    const normalizedShared = this.normalizeShared();

    // Process remotes
    for (const [name, url] of Object.entries(this.config.remotes)) {
      remotes[name] = {
        url,
        name,
        entry: `${url}/${this.config.filename}`,
      };
    }

    // Process shared
    for (const [name, config] of Object.entries(normalizedShared)) {
      shared[name] = {
        version: config.version,
        singleton: config.singleton,
        requiredVersion: config.requiredVersion,
        eager: config.eager,
        shareScope: config.shareScope,
      };
    }

    this.manifest = {
      name: this.config.name,
      version,
      remotes,
      exposes: { ...this.config.exposes },
      shared,
    };

    return this.manifest;
  }

  /**
   * Generate remote entry file
   */
  generateRemoteEntry(): string {
    const exposes = Object.entries(this.config.exposes)
      .map(([key, value]) => `  '${key}': () => import('${value}')`)
      .join(',\n');

    return `
const moduleMap = {
${exposes}
};

const get = (module) => {
  return moduleMap[module]?.() || Promise.reject(new Error(\`Module "\${module}" not found\`));
};

const init = (shareScope) => {
  if (typeof __webpack_init_sharing__ !== 'undefined') {
    return __webpack_init_sharing__('default');
  }
  return Promise.resolve();
};

export { get, init };
`.trim();
  }

  /**
   * Generate TypeScript types for remotes
   */
  async generateTypes(outputDir: string): Promise<void> {
    if (!this.config.generateTypes) return;

    const typesDir = path.resolve(outputDir, this.config.typesDir);
    await fs.mkdir(typesDir, { recursive: true });

    // Generate types for each exposed module
    for (const [exposedName, modulePath] of Object.entries(this.config.exposes)) {
      const typesContent = `
// Auto-generated types for ${exposedName}
declare module '${this.config.name}/${exposedName}' {
  const module: any;
  export default module;
}
`.trim();

      const typesFile = path.join(typesDir, `${exposedName.replace(/\//g, '-')}.d.ts`);
      await fs.writeFile(typesFile, typesContent, 'utf-8');
    }

    // Generate index file
    const indexContent = `
// Auto-generated module federation types
${Object.keys(this.config.exposes)
  .map((name) => `export * from './${name.replace(/\//g, '-')}.js';`)
  .join('\n')}
`.trim();

    await fs.writeFile(path.join(typesDir, 'index.d.ts'), indexContent, 'utf-8');
  }

  /**
   * Get manifest
   */
  getManifest(): FederationManifest | undefined {
    return this.manifest;
  }
}

/**
 * Vite plugin for module federation
 */
export function moduleFederationPlugin(config: ModuleFederationConfig): Plugin {
  let resolvedConfig: ResolvedConfig;
  let manager: ModuleFederationManager;
  let isDev = false;

  return {
    name: 'aether-module-federation',
    enforce: 'post',

    async configResolved(resolvedCfg) {
      resolvedConfig = resolvedCfg;
      isDev = resolvedCfg.mode === 'development';
      manager = new ModuleFederationManager(config);
    },

    async buildStart() {
      // Generate manifest
      const version = await getPackageVersion(resolvedConfig.root);
      await manager.buildManifest(version);
    },

    resolveId(id) {
      // Resolve remote imports
      for (const remoteName of Object.keys(config.remotes || {})) {
        if (id.startsWith(`${remoteName}/`)) {
          return {
            id,
            external: true,
          };
        }
      }
      return null;
    },

    async load(id) {
      // Handle exposed modules in dev mode
      if (isDev && config.exposes) {
        for (const [exposedName, modulePath] of Object.entries(config.exposes)) {
          if (id === exposedName) {
            return `export { default } from '${modulePath}';`;
          }
        }
      }
      return null;
    },

    async transform(code, id) {
      // Transform remote imports
      if (config.remotes) {
        let transformedCode = code;

        for (const [remoteName, remoteUrl] of Object.entries(config.remotes)) {
          // Match import statements for remotes
          const importRegex = new RegExp(`import\\s+(.+?)\\s+from\\s+['"]${remoteName}/(.+?)['"]`, 'g');

          transformedCode = transformedCode.replace(importRegex, (match, imports, modulePath) => {
            return `
const __remote_${remoteName} = await window.__FEDERATION__.loadRemote('${remoteName}', '${modulePath}');
const ${imports} = __remote_${remoteName};
`.trim();
          });
        }

        if (transformedCode !== code) {
          return { code: transformedCode };
        }
      }

      return null;
    },

    async generateBundle(options, bundle) {
      // Generate remote entry file
      if (config.exposes && Object.keys(config.exposes).length > 0) {
        const remoteEntry = manager.generateRemoteEntry();
        const fileName = config.filename || 'remoteEntry.js';

        bundle[fileName] = {
          type: 'asset',
          fileName,
          source: remoteEntry,
          needsCodeReference: false,
          name: undefined,
          names: [],
          originalFileName: null,
          originalFileNames: [],
        } as any;
      }

      // Generate manifest file
      const manifest = manager.getManifest();
      if (manifest) {
        bundle['federation-manifest.json'] = {
          type: 'asset',
          fileName: 'federation-manifest.json',
          source: JSON.stringify(manifest, null, 2),
          needsCodeReference: false,
          name: undefined,
          names: [],
          originalFileName: null,
          originalFileNames: [],
        } as any;
      }
    },

    async writeBundle(options, bundle) {
      if (!options.dir) return;

      // Generate TypeScript types
      if (config.generateTypes && config.exposes && Object.keys(config.exposes).length > 0) {
        await manager.generateTypes(options.dir);
      }

      // Generate runtime bootstrap file
      await generateRuntimeBootstrap(config, options.dir);
    },
  };
}

/**
 * Get package version
 */
async function getPackageVersion(root: string): Promise<string> {
  try {
    const packageJsonPath = path.join(root, 'package.json');
    const content = await fs.readFile(packageJsonPath, 'utf-8');
    const pkg = JSON.parse(content);
    return pkg.version || '1.0.0';
  } catch {
    return '1.0.0';
  }
}

/**
 * Generate runtime bootstrap file
 */
async function generateRuntimeBootstrap(config: ModuleFederationConfig, outputDir: string): Promise<void> {
  const remotes = Object.entries(config.remotes || {})
    .map(([name, url]) => `  runtime.registerRemote('${name}', '${url}/${config.filename || 'remoteEntry.js'}');`)
    .join('\n');

  const shared = Object.entries(config.shared || {})
    .map(([name, cfg]) => {
      const version = typeof cfg === 'string' ? cfg : cfg.version || '1.0.0';
      return `  // Shared: ${name}@${version}`;
    })
    .join('\n');

  const bootstrap = `
// Aether Module Federation Runtime Bootstrap
// Auto-generated - do not modify

import { ModuleFederationRuntime } from '@omnitron-dev/aether/build/module-federation';

const runtime = new ModuleFederationRuntime(${JSON.stringify(config.runtime || {}, null, 2)});

// Register remotes
${remotes}

// Shared modules
${shared}

// Make runtime globally available
window.__FEDERATION__ = runtime;

export { runtime };
`.trim();

  const bootstrapPath = path.join(outputDir, 'federation-bootstrap.js');
  await fs.writeFile(bootstrapPath, bootstrap, 'utf-8');
}

/**
 * Helper to load remote component with error boundary
 */
export function loadRemoteComponent(remoteName: string, moduleName: string, fallback?: any): () => Promise<any> {
  return async () => {
    try {
      const runtime = (window as any).__FEDERATION__ as ModuleFederationRuntime;
      if (!runtime) {
        throw new Error('Module Federation runtime not initialized');
      }

      return await runtime.loadRemote(remoteName, moduleName);
    } catch (error) {
      console.error(`Failed to load remote component ${remoteName}/${moduleName}:`, error);
      if (fallback) {
        return fallback;
      }
      throw error;
    }
  };
}

/**
 * Mock runtime for testing
 */
export class MockModuleFederationRuntime extends ModuleFederationRuntime {
  private mocks: Map<string, any> = new Map();

  /**
   * Register a mock module
   */
  mockRemote(remoteName: string, moduleName: string, module: any): void {
    const key = `${remoteName}:${moduleName}`;
    this.mocks.set(key, module);
  }

  /**
   * Clear all mocks
   */
  clearMocks(): void {
    this.mocks.clear();
  }

  /**
   * Override loadRemote to use mocks
   */
  override async loadRemote(remoteName: string, moduleName?: string): Promise<any> {
    const key = `${remoteName}:${moduleName || ''}`;
    if (this.mocks.has(key)) {
      return this.mocks.get(key);
    }
    return super.loadRemote(remoteName, moduleName);
  }
}

/**
 * Test utilities for module federation
 */
export const testUtils = {
  /**
   * Create a mock runtime
   */
  createMockRuntime(options?: ModuleFederationConfig['runtime']): MockModuleFederationRuntime {
    return new MockModuleFederationRuntime(options);
  },

  /**
   * Create a mock manifest
   */
  createMockManifest(name: string): FederationManifest {
    return {
      name,
      version: '1.0.0',
      remotes: {},
      exposes: {},
      shared: {},
    };
  },

  /**
   * Create a mock remote container
   */
  createMockRemote(name: string, url: string, module: any): RemoteContainer {
    return {
      name,
      url,
      loaded: true,
      module,
    };
  },
};

// Declare webpack share scopes (for TypeScript)
declare global {
  interface Window {
    __FEDERATION__: ModuleFederationRuntime;
  }

  // eslint-disable-next-line @typescript-eslint/naming-convention
  var __webpack_init_sharing__: (scope: string) => Promise<void>;
  // eslint-disable-next-line @typescript-eslint/naming-convention
  var __webpack_share_scopes__: {
    default: any;
  };
}
