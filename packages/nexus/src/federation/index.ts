/**
 * Module Federation support for Nexus DI
 * 
 * @module federation
 * @packageDocumentation
 * 
 * Enables sharing modules across applications and microservices
 */

import { IModule, DynamicModule, InjectionToken, Provider } from '../types/core';
import { Container } from '../container/container';
import { createToken } from '../token/token';

/**
 * Remote module configuration
 */
export interface RemoteModuleConfig {
  name: string;
  remoteUrl: string;
  exports: InjectionToken<any>[];
  fallback?: IModule;
  timeout?: number;
  retry?: number;
  cache?: boolean;
  version?: string;
}

/**
 * Federated module metadata
 */
export interface FederatedModuleMetadata {
  name: string;
  version: string;
  exports: Map<string, InjectionToken<any>>;
  remotes: Map<string, RemoteModuleConfig>;
  shared: Map<InjectionToken<any>, string>;
  singleton: boolean;
  requiredVersion?: string;
}

/**
 * Module federation container
 */
export class ModuleFederationContainer {
  private remotes = new Map<string, RemoteModuleConfig>();
  private cache = new Map<string, IModule>();
  private sharedScopes = new Map<string, Map<InjectionToken<any>, Provider<any>>>();
  private loadedModules = new Map<string, Promise<IModule>>();
  
  /**
   * Register a remote module
   */
  registerRemote(config: RemoteModuleConfig): void {
    this.remotes.set(config.name, config);
  }
  
  /**
   * Load a remote module
   */
  async loadRemoteModule(name: string): Promise<IModule> {
    const config = this.remotes.get(name);
    if (!config) {
      throw new Error(`Remote module ${name} not found`);
    }
    
    // Check cache
    if (config.cache && this.cache.has(name)) {
      return this.cache.get(name)!;
    }
    
    // Check if already loading
    if (this.loadedModules.has(name)) {
      return this.loadedModules.get(name)!;
    }
    
    // Start loading
    const loadPromise = this.loadModuleFromRemote(config);
    this.loadedModules.set(name, loadPromise);
    
    try {
      const module = await loadPromise;
      if (config.cache) {
        this.cache.set(name, module);
      }
      return module;
    } finally {
      this.loadedModules.delete(name);
    }
  }
  
  /**
   * Load module from remote URL
   */
  private async loadModuleFromRemote(config: RemoteModuleConfig): Promise<IModule> {
    const { remoteUrl, timeout = 30000, retry = 3, fallback } = config;
    
    for (let attempt = 0; attempt < retry; attempt++) {
      try {
        const module = await this.fetchModule(remoteUrl, timeout);
        return this.validateAndTransformModule(module, config);
      } catch (error) {
        if (attempt === retry - 1) {
          if (fallback) {
            console.warn(`Failed to load remote module ${config.name}, using fallback`);
            return fallback;
          }
          throw new Error(`Failed to load remote module ${config.name}: ${error}`);
        }
        // Exponential backoff
        await this.delay(Math.pow(2, attempt) * 1000);
      }
    }
    
    throw new Error(`Failed to load remote module ${config.name} after ${retry} attempts`);
  }
  
  /**
   * Fetch module from URL
   */
  private async fetchModule(url: string, timeout: number): Promise<any> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          'Accept': 'application/javascript'
        }
      });
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const text = await response.text();
      return this.evaluateModule(text);
    } finally {
      clearTimeout(timeoutId);
    }
  }
  
  /**
   * Evaluate module code
   */
  private evaluateModule(code: string): any {
    // In a real implementation, this would use a sandboxed environment
    // For demonstration, we'll use Function constructor
    const moduleFactory = new Function('exports', 'require', code);
    const exports: any = {};
    const require = (id: string) => {
      // Handle requires for shared dependencies
      const shared = this.sharedScopes.get('default');
      if (shared?.has(id as any)) {
        return shared.get(id as any);
      }
      throw new Error(`Module ${id} not found in shared scope`);
    };
    
    moduleFactory(exports, require);
    return exports.default || exports;
  }
  
  /**
   * Validate and transform remote module
   */
  private validateAndTransformModule(
    remoteModule: any,
    config: RemoteModuleConfig
  ): IModule {
    // Validate exports
    for (const exportToken of config.exports) {
      if (!remoteModule.providers?.some((p: any) => p.provide === exportToken)) {
        console.warn(`Export ${String(exportToken)} not found in remote module ${config.name}`);
      }
    }
    
    return {
      name: config.name,
      providers: remoteModule.providers || [],
      exports: config.exports,
      imports: remoteModule.imports || []
    };
  }
  
  /**
   * Share a module's exports
   */
  shareModule(module: IModule, scope: string = 'default'): void {
    if (!this.sharedScopes.has(scope)) {
      this.sharedScopes.set(scope, new Map());
    }
    
    const sharedScope = this.sharedScopes.get(scope)!;
    
    // Share all exported providers
    if (module.exports) {
      for (const token of module.exports) {
        const provider = module.providers?.find(p => 
          (p as any).provide === token || (p as any).token === token
        );
        if (provider) {
          sharedScope.set(token, provider as Provider<any>);
        }
      }
    }
  }
  
  /**
   * Initialize shared scope
   */
  initSharedScope(
    scopeName: string,
    shared: Map<InjectionToken<any>, Provider<any>>
  ): void {
    this.sharedScopes.set(scopeName, shared);
  }
  
  /**
   * Helper delay function
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

/**
 * Create a federated module
 */
export function createFederatedModule(config: RemoteModuleConfig): DynamicModule {
  const federation = new ModuleFederationContainer();
  federation.registerRemote(config);
  
  const module: IModule = {
    name: config.name,
    providers: [],
    imports: [],
    exports: config.exports,
    async onModuleInit() {
      // Load remote module on initialization
      const remoteModule = await federation.loadRemoteModule(config.name);
      Object.assign(this, remoteModule);
    }
  };
  
  return {
    module,
    providers: module.providers,
    imports: module.imports,
    exports: module.exports
  } as DynamicModule;
}

/**
 * Create a lazy-loaded module
 */
export function createLazyModule(
  loader: () => Promise<{ default: IModule } | IModule>
): DynamicModule {
  let loadedModule: IModule | null = null;
  
  const module: IModule = {
    name: 'LazyModule',
    providers: [],
    imports: [],
    exports: [],
    async onModuleInit() {
      const result = await loader();
      loadedModule = 'default' in result ? result.default : result;
      Object.assign(this, loadedModule);
    }
  };
  
  return {
    module,
    providers: module.providers,
    imports: module.imports,
    exports: module.exports
  } as DynamicModule;
}

/**
 * Module federation plugin
 */
export class ModuleFederationPlugin {
  private container: ModuleFederationContainer;
  
  constructor() {
    this.container = new ModuleFederationContainer();
  }
  
  /**
   * Install plugin
   */
  install(container: Container): void {
    // Add federation methods to container
    (container as any).loadRemoteModule = (name: string) => 
      this.container.loadRemoteModule(name);
    
    (container as any).registerRemote = (config: RemoteModuleConfig) =>
      this.container.registerRemote(config);
    
    (container as any).shareModule = (module: IModule, scope?: string) =>
      this.container.shareModule(module, scope);
  }
}

/**
 * Webpack Module Federation integration
 */
export interface WebpackModuleFederationConfig {
  name: string;
  filename: string;
  exposes: Record<string, string>;
  remotes: Record<string, string>;
  shared: Record<string, {
    singleton?: boolean;
    requiredVersion?: string;
    eager?: boolean;
  }>;
}

/**
 * Generate Webpack Module Federation configuration
 */
export function generateWebpackConfig(
  modules: IModule[],
  options: Partial<WebpackModuleFederationConfig> = {}
): WebpackModuleFederationConfig {
  return {
    name: options.name || 'nexusApp',
    filename: options.filename || 'remoteEntry.js',
    exposes: options.exposes || {},
    remotes: options.remotes || {},
    shared: {
      ...options.shared,
      '@omnitron-dev/nexus': {
        singleton: true,
        requiredVersion: '^1.5.0'
      }
    }
  };
}

/**
 * Module federation host
 */
export class FederationHost {
  private remotes = new Map<string, string>();
  private container: Container;
  
  constructor(container: Container) {
    this.container = container;
  }
  
  /**
   * Add remote container
   */
  addRemote(name: string, url: string): void {
    this.remotes.set(name, url);
  }
  
  /**
   * Initialize remotes
   */
  async initializeRemotes(): Promise<void> {
    const promises = Array.from(this.remotes.entries()).map(
      async ([name, url]) => {
        try {
          await this.loadRemoteContainer(name, url);
        } catch (error) {
          console.error(`Failed to load remote ${name} from ${url}:`, error);
        }
      }
    );
    
    await Promise.all(promises);
  }
  
  /**
   * Load remote container
   */
  private async loadRemoteContainer(name: string, url: string): Promise<void> {
    // In a real implementation, this would dynamically load the remote container
    // For now, we'll use the module federation container
    const config: RemoteModuleConfig = {
      name,
      remoteUrl: url,
      exports: []
    };
    
    const federation = new ModuleFederationContainer();
    federation.registerRemote(config);
    
    // Make remote available to container
    (this.container as any)[`remote_${name}`] = federation;
  }
  
  /**
   * Get remote module
   */
  async getRemoteModule<T>(remoteName: string, moduleName: string): Promise<T> {
    const federation = (this.container as any)[`remote_${remoteName}`];
    if (!federation) {
      throw new Error(`Remote ${remoteName} not found`);
    }
    
    const module = await federation.loadRemoteModule(moduleName);
    return module as T;
  }
}

/**
 * Shared dependency configuration
 */
export interface SharedDependency {
  name: string;
  version: string;
  singleton: boolean;
  strictVersion: boolean;
  requiredVersion?: string;
  eager?: boolean;
}

/**
 * Manage shared dependencies
 */
export class SharedDependencyManager {
  private dependencies = new Map<string, SharedDependency>();
  
  /**
   * Register shared dependency
   */
  register(dep: SharedDependency): void {
    if (this.dependencies.has(dep.name)) {
      const existing = this.dependencies.get(dep.name)!;
      if (dep.singleton && existing.version !== dep.version) {
        throw new Error(
          `Singleton dependency ${dep.name} version conflict: ${existing.version} vs ${dep.version}`
        );
      }
    }
    this.dependencies.set(dep.name, dep);
  }
  
  /**
   * Get shared dependency
   */
  get(name: string): SharedDependency | undefined {
    return this.dependencies.get(name);
  }
  
  /**
   * Check version compatibility
   */
  checkCompatibility(name: string, version: string): boolean {
    const dep = this.dependencies.get(name);
    if (!dep) return true;
    
    if (dep.strictVersion) {
      return dep.version === version;
    }
    
    if (dep.requiredVersion) {
      return this.satisfiesVersion(version, dep.requiredVersion);
    }
    
    return true;
  }
  
  /**
   * Simple semver check (simplified)
   */
  private satisfiesVersion(version: string, required: string): boolean {
    // Simplified version check - in production use a proper semver library
    const [major1, minor1] = version.split('.').map(Number);
    const [major2, minor2] = required.replace(/[^0-9.]/g, '').split('.').map(Number);
    
    if (required.startsWith('^')) {
      return major1 === major2 && minor1 >= minor2;
    }
    
    if (required.startsWith('~')) {
      return major1 === major2 && minor1 === minor2;
    }
    
    return version === required;
  }
}

/**
 * Module federation runtime
 */
export class ModuleFederationRuntime {
  private containers = new Map<string, ModuleFederationContainer>();
  private sharedManager = new SharedDependencyManager();
  private initialized = false;
  
  /**
   * Initialize the runtime
   */
  async initialize(config?: {
    remotes?: RemoteModuleConfig[];
    shared?: SharedDependency[];
  }): Promise<void> {
    if (this.initialized) return;
    
    // Register shared dependencies
    if (config?.shared) {
      for (const dep of config.shared) {
        this.sharedManager.register(dep);
      }
    }
    
    // Register remotes
    if (config?.remotes) {
      for (const remote of config.remotes) {
        const container = new ModuleFederationContainer();
        container.registerRemote(remote);
        this.containers.set(remote.name, container);
      }
    }
    
    this.initialized = true;
  }
  
  /**
   * Load a federated module
   */
  async loadModule(containerName: string, moduleName: string): Promise<IModule> {
    const container = this.containers.get(containerName);
    if (!container) {
      throw new Error(`Container ${containerName} not found`);
    }
    
    return container.loadRemoteModule(moduleName);
  }
  
  /**
   * Register a container
   */
  registerContainer(name: string, container: ModuleFederationContainer): void {
    this.containers.set(name, container);
  }
  
  /**
   * Get container
   */
  getContainer(name: string): ModuleFederationContainer | undefined {
    return this.containers.get(name);
  }
  
  /**
   * Expose module for federation
   */
  exposeModule(name: string, module: IModule): void {
    // Create a special container for exposed modules
    let exposedContainer = this.containers.get('__exposed__');
    if (!exposedContainer) {
      exposedContainer = new ModuleFederationContainer();
      this.containers.set('__exposed__', exposedContainer);
    }
    
    exposedContainer.shareModule(module, name);
  }
  
  /**
   * Get exposed module
   */
  getExposedModule(name: string): IModule | undefined {
    const exposedContainer = this.containers.get('__exposed__');
    if (!exposedContainer) return undefined;
    
    // Return from shared scope
    const sharedScope = (exposedContainer as any).sharedScopes.get(name);
    if (!sharedScope) return undefined;
    
    // Convert back to module format
    const providers: Provider<any>[] = [];
    const exports: InjectionToken<any>[] = [];
    
    for (const [token, provider] of sharedScope) {
      providers.push(provider);
      exports.push(token);
    }
    
    return {
      name,
      providers,
      exports,
      imports: []
    };
  }
}

/**
 * Global federation runtime instance
 */
export const federationRuntime = new ModuleFederationRuntime();

/**
 * Module federation tokens
 */
export const ModuleFederationToken = createToken<ModuleFederationContainer>('ModuleFederation');
export const FederationRuntimeToken = createToken<ModuleFederationRuntime>('FederationRuntime');
export const SharedDependencyManagerToken = createToken<SharedDependencyManager>('SharedDependencyManager');
 