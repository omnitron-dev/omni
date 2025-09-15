/**
 * Advanced module system for Nexus DI Container
 */

import {
  IModule,
  Provider,
  IContainer,
  Constructor,
  DynamicModule,
  InjectionToken,
  ServiceIdentifier
} from '../types/core';

/**
 * Module metadata decorator options
 */
export interface ModuleMetadata {
  name?: string;
  imports?: Array<Constructor<any> | IModule | DynamicModule>;
  providers?: Array<Provider<any> | Constructor<any> | [InjectionToken<any>, Provider<any>]>;
  exports?: Array<InjectionToken<any> | Provider<any>>;
  controllers?: Constructor<any>[];
  global?: boolean;
}

/**
 * Module options for forRoot pattern
 */
export interface ModuleOptions {
  [key: string]: any;
}

/**
 * Module factory for creating modules
 */
export interface ModuleFactory {
  forRoot(options: ModuleOptions): DynamicModule;
  forFeature?(options: ModuleOptions): DynamicModule;
}

/**
 * Module reference for accessing module internals
 */
export interface ModuleRef {
  /**
   * Module name
   */
  readonly name: string;
  
  /**
   * Module providers
   */
  readonly providers: Map<InjectionToken<any>, Provider<any>>;
  
  /**
   * Module exports
   */
  readonly exports: Set<InjectionToken<any>>;
  
  /**
   * Module imports
   */
  readonly imports: Set<ModuleRef>;
  
  /**
   * Module container
   */
  readonly container: IContainer;
  
  /**
   * Check if provider is exported
   */
  isExported(token: InjectionToken<any>): boolean;
  
  /**
   * Get provider
   */
  getProvider<T>(token: InjectionToken<T>): Provider<T> | undefined;
  
  /**
   * Resolve provider
   */
  resolve<T>(token: InjectionToken<T>): T;
  
  /**
   * Resolve async provider
   */
  resolveAsync<T>(token: InjectionToken<T>): Promise<T>;
}

/**
 * Module compiler for processing module metadata
 */
export class ModuleCompiler {
  private compiledModules = new Map<string, ModuleRef>();
  private globalModules = new Set<ModuleRef>();
  
  /**
   * Compile a module
   */
  compile(module: IModule | Constructor<any> | DynamicModule): ModuleRef {
    const metadata = this.extractMetadata(module);
    const name = metadata.name || this.generateModuleName(module);
    
    // Check if already compiled
    if (this.compiledModules.has(name)) {
      return this.compiledModules.get(name)!;
    }
    
    // Create module reference
    const moduleRef = this.createModuleRef(name, metadata);
    
    // Register as global if needed
    if (metadata.global) {
      this.globalModules.add(moduleRef);
    }
    
    // Store compiled module
    this.compiledModules.set(name, moduleRef);
    
    // Compile imports
    if (metadata.imports) {
      for (const imported of metadata.imports) {
        const importedRef = this.compile(imported);
        (moduleRef.imports as Set<ModuleRef>).add(importedRef);
      }
    }
    
    return moduleRef;
  }
  
  /**
   * Extract metadata from module
   */
  private extractMetadata(module: any): ModuleMetadata & { name: string } {
    // Handle dynamic module
    if (this.isDynamicModule(module)) {
      const dynamic = module as DynamicModule;
      const baseMetadata = this.extractMetadata(dynamic.module);
      return {
        ...baseMetadata,
        ...dynamic,
        name: baseMetadata.name
      } as ModuleMetadata & { name: string };
    }
    
    // Handle module with metadata
    if (this.isModuleWithMetadata(module)) {
      return module as ModuleMetadata & { name: string };
    }
    
    // Handle class constructor with decorator metadata
    if (typeof module === 'function') {
      // Try Reflect metadata first (if available)
      if (typeof Reflect !== 'undefined' && Reflect.getMetadata) {
        const metadata = Reflect.getMetadata('module:metadata', module);
        if (metadata) {
          return { name: module.name, ...metadata };
        }
      }
      // Fallback to stored metadata on constructor
      if ((module as any).__moduleMetadata) {
        return { name: module.name, ...(module as any).__moduleMetadata };
      }
    }
    
    // Default module structure
    return {
      name: this.generateModuleName(module),
      providers: [],
      exports: []
    };
  }
  
  /**
   * Create module reference
   */
  private createModuleRef(name: string, metadata: ModuleMetadata): ModuleRef {
    const providers = new Map<InjectionToken<any>, Provider<any>>();
    const exports = new Set<InjectionToken<any>>();
    const imports = new Set<ModuleRef>();
    
    // Process providers
    if (metadata.providers) {
      for (const provider of metadata.providers) {
        if (Array.isArray(provider) && provider.length === 2) {
          // Handle [token, provider] tuples
          providers.set(provider[0], provider[1]);
        } else {
          // Handle regular providers
          const token = this.extractToken(provider);
          providers.set(token, provider as Provider<any>);
        }
      }
    }
    
    // Process exports
    if (metadata.exports) {
      for (const exported of metadata.exports) {
        const token = this.extractToken(exported);
        exports.add(token);
      }
    }
    
    // Create container for this module
    const container = null as any; // Will be set by the container
    
    return {
      name,
      providers,
      exports,
      imports,
      container,
      
      isExported(token: InjectionToken<any>): boolean {
        return exports.has(token);
      },
      
      getProvider<T>(token: InjectionToken<T>): Provider<T> | undefined {
        return providers.get(token) as Provider<T> | undefined;
      },
      
      resolve<T>(token: InjectionToken<T>): T {
        if (!this.container) {
          throw new Error('Module container not initialized');
        }
        return this.container.resolve(token);
      },
      
      async resolveAsync<T>(token: InjectionToken<T>): Promise<T> {
        if (!this.container) {
          throw new Error('Module container not initialized');
        }
        return this.container.resolveAsync(token);
      }
    };
  }
  
  /**
   * Extract token from provider
   */
  private extractToken(provider: any): InjectionToken<any> {
    // Handle [token, provider] tuples
    if (Array.isArray(provider) && provider.length === 2) {
      return provider[0];
    }
    
    if (typeof provider === 'function') {
      return provider;
    }
    
    if (typeof provider === 'object' && provider !== null) {
      if ('provide' in provider) {
        return provider.provide;
      }
      if ('useClass' in provider) {
        return provider.useClass;
      }
    }
    
    return provider;
  }
  
  /**
   * Check if dynamic module
   */
  private isDynamicModule(module: any): module is DynamicModule {
    return module && typeof module === 'object' && 'module' in module;
  }
  
  /**
   * Check if module with metadata
   */
  private isModuleWithMetadata(module: any): boolean {
    return module && typeof module === 'object' && 'name' in module;
  }
  
  /**
   * Get module name
   */
  private getModuleName(module: any): string {
    if (typeof module === 'string') return module;
    if (typeof module === 'function') return module.name;
    if (module && typeof module === 'object' && 'name' in module) return module.name;
    return this.generateModuleName(module);
  }
  
  /**
   * Generate unique module name
   */
  private generateModuleName(module: any): string {
    return `Module_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
  
  /**
   * Get all global modules
   */
  getGlobalModules(): ModuleRef[] {
    return Array.from(this.globalModules);
  }
  
  /**
   * Get compiled module
   */
  getModule(name: string): ModuleRef | undefined {
    return this.compiledModules.get(name);
  }
  
  /**
   * Clear compiled modules
   */
  clear(): void {
    this.compiledModules.clear();
    this.globalModules.clear();
  }
}

/**
 * Create a module
 */
export function createModule(metadata: ModuleMetadata & { name: string }): IModule {
  const module: IModule = {
    name: metadata.name,
    imports: metadata.imports as IModule[],
    providers: metadata.providers?.map(p => {
      if (typeof p === 'function') {
        return [p, { useClass: p }] as [InjectionToken<any>, Provider<any>];
      }
      // Handle TestProvider format { provide: token, useValue/useClass/useFactory/useToken: ... }
      if (p && typeof p === 'object' && 'provide' in p) {
        const token = (p as any).provide;
        const provider: any = {};
        if ('useValue' in p) provider.useValue = (p as any).useValue;
        if ('useClass' in p) provider.useClass = (p as any).useClass;
        if ('useFactory' in p) provider.useFactory = (p as any).useFactory;
        if ('useToken' in p) provider.useToken = (p as any).useToken;
        if ('inject' in p) provider.inject = (p as any).inject;
        if ('scope' in p) provider.scope = (p as any).scope;
        return [token, provider] as [InjectionToken<any>, Provider<any>];
      }
      return p;
    }),
    exports: metadata.exports as InjectionToken<any>[],
    global: metadata.global,
    requires: (metadata as any).requires,
    metadata: {
      version: (metadata as any).version,
      description: (metadata as any).description,
      author: (metadata as any).author,
      tags: (metadata as any).tags
    },
    onModuleInit: (metadata as any).onModuleInit,
    onModuleDestroy: (metadata as any).onModuleDestroy
  };
  
  return module;
}

/**
 * Create a dynamic module
 */
export function createDynamicModule(
  metadata: ModuleMetadata & { name: string }
): DynamicModule {
  const module = createModule(metadata);
  return {
    module,
    providers: metadata.providers,
    imports: metadata.imports as IModule[] | undefined,
    exports: metadata.exports as ServiceIdentifier<any>[] | undefined,
    global: metadata.global
  };
}

/**
 * Module builder for fluent API
 */
export class ModuleBuilder {
  private metadata: ModuleMetadata = {};
  
  constructor(private name: string) {}
  
  /**
   * Add imports
   */
  imports(...modules: Array<Constructor<any> | IModule | DynamicModule>): this {
    this.metadata.imports = [...(this.metadata.imports || []), ...modules];
    return this;
  }
  
  /**
   * Add providers
   */
  providers(...providers: Array<Provider<any> | Constructor<any> | [InjectionToken<any>, Provider<any>]>): this {
    const processedProviders = providers.map(p => {
      // Handle TestProvider format { provide: token, useValue/useClass/useFactory/useToken: ... }
      if (p && typeof p === 'object' && 'provide' in p) {
        const token = (p as any).provide;
        const provider: any = {};
        if ('useValue' in p) provider.useValue = (p as any).useValue;
        if ('useClass' in p) provider.useClass = (p as any).useClass;
        if ('useFactory' in p) provider.useFactory = (p as any).useFactory;
        if ('useToken' in p) provider.useToken = (p as any).useToken;
        if ('inject' in p) provider.inject = (p as any).inject;
        if ('scope' in p) provider.scope = (p as any).scope;
        return [token, provider] as [InjectionToken<any>, Provider<any>];
      }
      return p;
    });
    
    this.metadata.providers = [...(this.metadata.providers || []), ...processedProviders];
    return this;
  }
  
  /**
   * Add exports
   */
  exports(...tokens: Array<InjectionToken<any> | Provider<any> | InjectionToken<any>[]>): this {
    // Flatten any arrays passed in
    const flatTokens = tokens.flat();
    this.metadata.exports = [...(this.metadata.exports || []), ...flatTokens];
    return this;
  }
  
  /**
   * Add controllers
   */
  controllers(...controllers: Constructor<any>[]): this {
    this.metadata.controllers = [...(this.metadata.controllers || []), ...controllers];
    return this;
  }
  
  /**
   * Set as global module
   */
  global(isGlobal = true): this {
    this.metadata.global = isGlobal;
    return this;
  }
  
  /**
   * Provide a single token
   */
  provide<T>(token: InjectionToken<T>, provider: Provider<T>): this {
    if (!this.metadata.providers) {
      this.metadata.providers = [];
    }
    this.metadata.providers.push([token, provider] as [InjectionToken<any>, Provider<any>]);
    return this;
  }
  
  /**
   * Conditionally provide a token
   */
  provideIf<T>(
    condition: (container?: any) => boolean, 
    token: InjectionToken<T>, 
    provider: Provider<T>
  ): this {
    if (!this.metadata.providers) {
      this.metadata.providers = [];
    }
    
    // Mark the provider as conditional for later evaluation during module loading
    const conditionalProvider: [InjectionToken<T>, Provider<T> & { conditional?: boolean; condition?: Function; originalProvider?: Provider<T> }] = [
      token,
      {
        conditional: true,
        condition,
        originalProvider: provider,
        useFactory: () => {
          throw new Error(`Conditional provider for ${String(token)} should not be resolved directly`);
        }
      }
    ];
    
    this.metadata.providers.push(conditionalProvider as [InjectionToken<any>, Provider<any>]);
    return this;
  }
  
  /**
   * Build the module
   */
  build(): IModule {
    return createModule({ name: this.name, ...this.metadata });
  }
}

/**
 * Create a module builder
 */
export function moduleBuilder(name: string): ModuleBuilder {
  return new ModuleBuilder(name);
}

/**
 * Common module patterns
 */

/**
 * Create a config module
 */
export function createConfigModule<T = any>(options: {
  name: string;
  load: () => T | Promise<T>;
  validate?: (config: T) => boolean | void;
}): IModule & { config?: T } {
  let config: T | undefined;
  
  const module: IModule & { config?: T } = {
    name: options.name,
    providers: [],
    imports: [],
    exports: [],
    config,
    
    async onModuleInit() {
      // Load configuration
      config = await options.load();
      
      // Validate if validator provided
      if (options.validate) {
        try {
          const isValid = options.validate(config);
          if (isValid === false) {
            throw new Error(`Configuration validation failed for ${options.name}`);
          }
        } catch (error) {
          throw new Error(`Configuration validation failed for ${options.name}: ${error}`);
        }
      }
      
      // Update the config property
      this.config = config;
    }
  };
  
  return module;
}

/**
 * Create a feature module
 */
export function createFeatureModule(
  name: string,
  providers: Array<[InjectionToken<any>, Provider<any>]>
): ModuleFactory {
  const extractToken = (provider: [InjectionToken<any>, Provider<any>]): InjectionToken<any> => provider[0];
  
  return {
    forRoot(options: ModuleOptions): DynamicModule {
      return {
        module: { name },
        providers: providers.map(([token, provider]) => {
          if (typeof provider === 'object' && 'useFactory' in provider) {
            return [token, {
              ...provider,
              useFactory: ((...args: any[]) => {
                const instance = (provider as any).useFactory(...args);
                if (typeof instance === 'object' && instance !== null) {
                  Object.assign(instance, options);
                }
                return instance;
              }) as any
            }] as [InjectionToken<any>, Provider<any>];
          }
          return [token, provider] as [InjectionToken<any>, Provider<any>];
        }),
        exports: providers.map(p => extractToken(p))
      };
    },
    
    forFeature(options: ModuleOptions): DynamicModule {
      const filteredProviders = providers.filter(p => {
        const token = extractToken(p);
        return !options['exclude'] || !options['exclude'].includes(token);
      });
      
      return {
        module: { name: `${name}:feature` },
        providers: filteredProviders,
        exports: filteredProviders.map(p => extractToken(p))
      };
    }
  };
}

/**
 * Module decorator (for decorator support)
 */
export function Module(metadata: ModuleMetadata): ClassDecorator {
  return (target: any) => {
    if (typeof Reflect !== 'undefined' && Reflect.defineMetadata) {
      Reflect.defineMetadata('module:metadata', metadata, target);
    } else {
      // Store metadata on the constructor itself as fallback
      (target as any).__moduleMetadata = metadata;
    }
    return target;
  };
}

/**
 * Forward reference interface
 */
export interface ForwardRef<T> {
  (): T;
}

/**
 * Create a forward reference
 */
export function forwardRef<T>(fn: () => T): ForwardRef<T> {
  return fn as ForwardRef<T>;
}