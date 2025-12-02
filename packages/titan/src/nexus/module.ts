/**
 * Advanced module system for Nexus DI Container
 */

import {
  IModule,
  Provider,
  ProviderDefinition,
  ProviderInput,
  IContainer,
  Constructor,
  DynamicModule,
  InjectionToken,
  ServiceIdentifier,
  ModuleMetadata,
} from './types.js';
import { Errors, ValidationError } from '../errors/index.js';

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
  readonly providers: Map<InjectionToken<any>, ProviderDefinition<any> | Provider<any>>;

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
        name: baseMetadata.name,
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
      exports: [],
    };
  }

  /**
   * Create module reference
   */
  private createModuleRef(name: string, metadata: ModuleMetadata): ModuleRef {
    const providers = new Map<InjectionToken<any>, ProviderDefinition<any> | Provider<any>>();
    const exports = new Set<InjectionToken<any>>();
    const imports = new Set<ModuleRef>();

    // Process providers
    if (metadata.providers) {
      for (const provider of metadata.providers) {
        if (Array.isArray(provider) && provider.length === 2) {
          // Handle [token, provider] tuples
          providers.set(provider[0], provider[1]);
        } else if (typeof provider === 'function') {
          // Constructor
          providers.set(provider, { useClass: provider });
        } else {
          // Handle regular providers with 'provide' field
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
          throw Errors.internal('Module container not initialized');
        }
        return this.container.resolve(token);
      },

      async resolveAsync<T>(token: InjectionToken<T>): Promise<T> {
        if (!this.container) {
          throw Errors.internal('Module container not initialized');
        }
        return this.container.resolveAsync(token);
      },
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
    providers: metadata.providers?.map((p): Provider<any> | ProviderInput<any> => {
      if (typeof p === 'function') {
        // Constructor - return as-is (it's a valid ProviderInput)
        return p;
      }
      // Handle Provider format { provide: token, useValue/useClass/useFactory/useToken: ... }
      if (p && typeof p === 'object' && 'provide' in p) {
        // It's already a Provider, return as-is
        return p as Provider<any>;
      }
      // Handle tuple format [token, provider]
      if (Array.isArray(p) && p.length === 2) {
        return p as [InjectionToken<any>, ProviderDefinition<any>];
      }
      // Unknown format, return as-is
      return p;
    }),
    exports: metadata.exports as InjectionToken<any>[],
    global: metadata.global,
    requires: (metadata as any).requires,
    metadata: {
      version: (metadata as any).version,
      description: (metadata as any).description,
      author: (metadata as any).author,
      tags: (metadata as any).tags,
    },
    onModuleInit: (metadata as any).onModuleInit,
    onModuleDestroy: (metadata as any).onModuleDestroy,
  };

  return module;
}

/**
 * Create a dynamic module
 */
export function createDynamicModule(metadata: ModuleMetadata & { name: string }): DynamicModule {
  const module = createModule(metadata);
  return {
    module,
    providers: metadata.providers,
    imports: metadata.imports as IModule[] | undefined,
    exports: metadata.exports as ServiceIdentifier<any>[] | undefined,
    global: metadata.global,
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
  providers(
    ...providers: Array<Provider<any> | Constructor<any> | [InjectionToken<any>, ProviderDefinition<any>]>
  ): this {
    const processedProviders = providers.map(
      (p): Provider<any> | Constructor<any> | [InjectionToken<any>, ProviderDefinition<any>] =>
        // Provider format is already valid, return as-is
        // (Provider objects with 'provide' field and other formats are all valid)
        p
    );

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
  provide<T>(token: InjectionToken<T>, provider: ProviderDefinition<T>): this {
    if (!this.metadata.providers) {
      this.metadata.providers = [];
    }
    this.metadata.providers.push([token, provider] as [InjectionToken<any>, ProviderDefinition<any>]);
    return this;
  }

  /**
   * Conditionally provide a token
   */
  provideIf<T>(
    condition: (container?: unknown) => boolean,
    token: InjectionToken<T>,
    provider: ProviderDefinition<T> | Provider<T>
  ): this {
    if (!this.metadata.providers) {
      this.metadata.providers = [];
    }

    // Create a conditional provider
    const conditionalProvider: Provider<T> = {
      provide: token,
      ...('provide' in provider ? { ...provider, provide: token } : provider),
      conditional: true,
      condition,
      originalProvider: provider,
    } as Provider<T> & {
      conditional?: boolean;
      condition?: (container?: unknown) => boolean;
      originalProvider?: Provider<T> | ProviderDefinition<T>;
    };

    this.metadata.providers.push(conditionalProvider);
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
            throw ValidationError.fromFieldErrors([
              { field: 'config', message: `Validation failed for ${options.name}` },
            ]);
          }
        } catch (error) {
          throw ValidationError.fromFieldErrors([{ field: 'config', message: `Validation failed: ${error}` }]);
        }
      }

      // Update the config property
      this.config = config;
    },
  };

  return module;
}

/**
 * Create a feature module
 */
export function createFeatureModule(
  name: string,
  providers: Array<[InjectionToken<any>, ProviderDefinition<any>]>
): ModuleFactory {
  const extractToken = (provider: [InjectionToken<any>, ProviderDefinition<any>]): InjectionToken<any> => provider[0];

  return {
    forRoot(options: ModuleOptions): DynamicModule {
      return {
        module: { name },
        providers: providers.map(([token, provider]) => {
          if (typeof provider === 'object' && 'useFactory' in provider) {
            return [
              token,
              {
                ...provider,
                useFactory: ((...args: any[]) => {
                  const instance = (provider as any).useFactory(...args);
                  if (typeof instance === 'object' && instance !== null) {
                    Object.assign(instance, options);
                  }
                  return instance;
                }) as any,
              },
            ] as [InjectionToken<any>, ProviderDefinition<any>];
          }
          return [token, provider] as [InjectionToken<any>, ProviderDefinition<any>];
        }),
        exports: providers.map((p) => extractToken(p)),
      };
    },

    forFeature(options: ModuleOptions): DynamicModule {
      const filteredProviders = providers.filter((p) => {
        const token = extractToken(p);
        return !options['exclude'] || !options['exclude'].includes(token);
      });

      return {
        module: { name: `${name}:feature` },
        providers: filteredProviders,
        exports: filteredProviders.map((p) => extractToken(p)),
      };
    },
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

// ============================================================================
// Module Async Options Helpers
// ============================================================================

/**
 * Interface for factory-based async options
 */
export interface AsyncOptionsFactory<TOptions> {
  createOptions(): Promise<TOptions> | TOptions;
}

/**
 * Common async module options pattern used across all modules
 */
export interface ModuleAsyncOptions<TOptions, TFactory extends AsyncOptionsFactory<TOptions> = AsyncOptionsFactory<TOptions>> {
  /**
   * Factory function to create options
   */
  useFactory?: (...args: any[]) => Promise<TOptions> | TOptions;

  /**
   * Dependencies to inject into factory
   */
  inject?: InjectionToken<any>[];

  /**
   * Existing factory to use
   */
  useExisting?: InjectionToken<TFactory>;

  /**
   * Class to instantiate as factory
   */
  useClass?: Constructor<TFactory>;

  /**
   * Modules to import
   */
  imports?: (IModule | DynamicModule | Constructor<any>)[];

  /**
   * Mark module as global
   */
  isGlobal?: boolean;
}

/**
 * Creates async options providers from common async options pattern.
 * This helper reduces boilerplate across all modules that use forRootAsync().
 *
 * @example
 * ```typescript
 * static forRootAsync(options: RedisModuleAsyncOptions): DynamicModule {
 *   const providers = createAsyncOptionsProvider(REDIS_MODULE_OPTIONS, options);
 *   // ... rest of module configuration
 * }
 * ```
 */
export function createAsyncOptionsProvider<TOptions>(
  optionsToken: InjectionToken<TOptions>,
  asyncOptions: ModuleAsyncOptions<TOptions>
): Array<[InjectionToken<any>, ProviderDefinition<any>]> {
  const providers: Array<[InjectionToken<any>, ProviderDefinition<any>]> = [];

  if (asyncOptions.useFactory) {
    // Factory function provided directly
    providers.push([
      optionsToken,
      {
        useFactory: async (...args: any[]) =>
          Promise.resolve(asyncOptions.useFactory!(...args)),
        inject: (asyncOptions.inject || []) as any,
      },
    ]);
  } else if (asyncOptions.useExisting) {
    // Use existing factory instance
    providers.push([
      optionsToken,
      {
        useFactory: async (factory: AsyncOptionsFactory<TOptions>) =>
          factory.createOptions(),
        inject: [asyncOptions.useExisting],
      },
    ]);
  } else if (asyncOptions.useClass) {
    // Instantiate a factory class
    providers.push([
      asyncOptions.useClass as any,
      {
        useClass: asyncOptions.useClass,
      },
    ]);
    providers.push([
      optionsToken,
      {
        useFactory: async (factory: AsyncOptionsFactory<TOptions>) =>
          factory.createOptions(),
        inject: [asyncOptions.useClass as any],
      },
    ]);
  } else {
    // No options provided - use empty object as default
    providers.push([
      optionsToken,
      {
        useValue: {} as TOptions,
      },
    ]);
  }

  return providers;
}

/**
 * Helper type for defining module provider tuples
 */
export type ModuleProviderTuple<T = any> = [InjectionToken<T>, ProviderDefinition<T>];

/**
 * Helper type for defining module provider tuples with registration options
 */
export type ModuleProviderWithOptions<T = any> = [
  InjectionToken<T>,
  ProviderDefinition<T>,
  Partial<{ override: boolean; scope: string }>
];

/**
 * Creates a service provider tuple with a factory that depends on other services.
 * Reduces boilerplate for common factory patterns.
 *
 * @example
 * ```typescript
 * const providers = [
 *   createServiceProvider(
 *     MY_SERVICE_TOKEN,
 *     MyService,
 *     [DEP1_TOKEN, DEP2_TOKEN]
 *   ),
 * ];
 * ```
 */
export function createServiceProvider<T, TDeps extends any[]>(
  token: InjectionToken<T>,
  ServiceClass: Constructor<T>,
  inject: { [K in keyof TDeps]: InjectionToken<TDeps[K]> }
): ModuleProviderTuple<T> {
  return [
    token,
    {
      useFactory: (...deps: TDeps) => new ServiceClass(...deps),
      inject: inject as InjectionToken<any>[],
    },
  ];
}

/**
 * Creates an alias provider that resolves to the same instance as another token.
 * Useful for allowing resolution by class type when the primary token is a symbol.
 *
 * @example
 * ```typescript
 * // After registering DATABASE_MANAGER token:
 * createAliasProvider(DatabaseManager, DATABASE_MANAGER)
 * // Now container.resolve(DatabaseManager) works
 * ```
 */
export function createAliasProvider<T>(
  aliasToken: InjectionToken<T>,
  targetToken: InjectionToken<T>
): ModuleProviderTuple<T> {
  return [
    aliasToken,
    {
      useFactory: (instance: T) => instance,
      inject: [targetToken],
    },
  ];
}

// ============================================================================
// Type-Safe Provider Definition Helpers
// ============================================================================

/**
 * Provider definition with factory function.
 * Use this helper to create type-safe factory providers for module definitions.
 *
 * @example
 * ```typescript
 * const providers = [
 *   defineFactory(MY_SERVICE_TOKEN, {
 *     useFactory: (dep) => new MyService(dep),
 *     inject: [DEP_TOKEN],
 *     scope: 'singleton',
 *   }),
 * ];
 * ```
 */
export function defineFactory<T>(
  token: InjectionToken<T>,
  provider: {
    useFactory: (...args: any[]) => T | Promise<T>;
    inject?: InjectionToken<any>[];
    scope?: 'singleton' | 'transient' | 'scoped' | 'request';
    async?: boolean;
  }
): ModuleProviderTuple<T> {
  return [token, provider as ProviderDefinition<T>];
}

/**
 * Provider definition with class.
 * Use this helper to create type-safe class providers for module definitions.
 *
 * @example
 * ```typescript
 * const providers = [
 *   defineClass(MY_SERVICE_TOKEN, {
 *     useClass: MyServiceImpl,
 *     inject: [DEP_TOKEN],
 *     scope: 'singleton',
 *   }),
 * ];
 * ```
 */
export function defineClass<T>(
  token: InjectionToken<T>,
  provider: {
    useClass: Constructor<T>;
    inject?: InjectionToken<any>[];
    scope?: 'singleton' | 'transient' | 'scoped' | 'request';
  }
): ModuleProviderTuple<T> {
  return [token, provider as ProviderDefinition<T>];
}

/**
 * Provider definition with value.
 * Use this helper to create type-safe value providers for module definitions.
 *
 * @example
 * ```typescript
 * const providers = [
 *   defineValue(CONFIG_TOKEN, { useValue: myConfig }),
 * ];
 * ```
 */
export function defineValue<T>(
  token: InjectionToken<T>,
  provider: { useValue: T }
): ModuleProviderTuple<T> {
  return [token, provider as ProviderDefinition<T>];
}

/**
 * Provider definition with existing token (alias).
 * Use this helper to create type-safe token alias providers.
 *
 * @example
 * ```typescript
 * const providers = [
 *   defineExisting(MyService, { useExisting: MY_SERVICE_TOKEN }),
 * ];
 * ```
 */
export function defineExisting<T>(
  token: InjectionToken<T>,
  provider: { useExisting: InjectionToken<T> }
): ModuleProviderTuple<T> {
  return [
    token,
    {
      useFactory: (instance: T) => instance,
      inject: [provider.useExisting],
    } as ProviderDefinition<T>,
  ];
}

/**
 * Type for a providers array that can be used in DynamicModule.
 * This type accepts the common tuple format without requiring 'as any'.
 */
export type ModuleProviders = Array<ModuleProviderTuple<any> | ModuleProviderWithOptions<any> | Constructor<any>>;

/**
 * Helper to define a complete providers array with correct types.
 * Use this to avoid 'as any' casts in module provider arrays.
 *
 * @example
 * ```typescript
 * const providers = defineProviders([
 *   defineFactory(SERVICE_TOKEN, { useFactory: () => new Service(), scope: 'singleton' }),
 *   defineClass(OTHER_TOKEN, { useClass: OtherService }),
 *   defineValue(CONFIG_TOKEN, { useValue: config }),
 * ]);
 * ```
 */
export function defineProviders(providers: ModuleProviders): ModuleProviders {
  return providers;
}
