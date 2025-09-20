/**
 * Enhanced module system with automatic provider management
 */

import { Token, Container, InjectionToken, getTokenName, Provider } from '@omnitron-dev/nexus';

import {
  IModule,
  ModuleInput,
  IApplication,
  IHealthStatus,
  IDynamicModule,
  ApplicationModule as BaseApplicationModule
} from './types.js';

/**
 * Module metadata interface
 */
export interface IModuleMetadata {
  name?: string;
  version?: string;
  imports?: ModuleInput[];
  providers?: Array<[InjectionToken<any>, Provider<any>]>;
  exports?: Token<any>[];
  dependencies?: (Token<any> | string)[];
}

/**
 * Provider instance with lifecycle
 */
interface IProviderInstance {
  token: InjectionToken<any>;
  instance: any;
  metadata: [InjectionToken<any>, Provider<any>];
}

/**
 * Enhanced application module with automatic provider management
 */
export abstract class EnhancedApplicationModule extends BaseApplicationModule {
  private _providers: IProviderInstance[] = [];
  private _imports: IModule[] = [];
  private _exports: Set<Token<any>> = new Set();
  private _moduleContainer?: Container;
  private _parentContainer?: Container;
  private _app?: IApplication;

  // Override properties from base class
  override readonly name: string;
  override readonly version?: string;
  override readonly dependencies?: (Token<any> | string)[];

  constructor(protected metadata: IModuleMetadata = {}) {
    super();
    // Set properties from metadata
    this.name = metadata.name || this.constructor.name;
    this.version = metadata.version;
    this.dependencies = metadata.dependencies;

    if (metadata.exports) {
      metadata.exports.forEach(token => this._exports.add(token));
    }
  }

  /**
   * Register module - handles provider registration
   */
  override async onRegister(app: IApplication): Promise<void> {
    this._app = app;
    // Use parent container directly for simplicity
    // All providers are registered in the parent container
    this._parentContainer = app.container;
    this._moduleContainer = this._parentContainer;

    // Process imports first
    if (this.metadata.imports) {
      for (const importModule of this.metadata.imports) {
        const module = await this.resolveModule(importModule, app);
        this._imports.push(module);
      }
    }

    // Register all providers in the container
    if (this.metadata.providers) {
      for (const providerDef of this.metadata.providers) {
        await this.registerProvider(providerDef, app);
      }
    }

    // No need to re-register exports since all providers are in the parent container
    // Export configuration is preserved for documentation and potential future module isolation

    // Call child class onRegister if exists
    await this.onModuleRegister?.(app);
  }

  /**
   * Start module - handles provider initialization
   */
  override async onStart(app: IApplication): Promise<void> {
    // Initialize all providers that implement OnInit
    for (const provider of this._providers) {
      // Resolve instance if not yet resolved (for class providers)
      const [, providerDef] = provider.metadata;
      if (!provider.instance && 'useClass' in providerDef && this._parentContainer) {
        try {
          provider.instance = this._parentContainer.resolve(provider.token);
        } catch (error) {
          // Continue if resolution fails - let it fail later when actually needed
          continue;
        }
      }

      if (provider.instance && typeof provider.instance.onInit === 'function') {
        try {
          await provider.instance.onInit();
        } catch (error) {
          // Log error but don't fail startup - graceful degradation
          const logger = (app as any).logger;
          if (logger) {
            logger.error({ error, provider: getTokenName(provider.token) }, 'Provider initialization failed');
          }
        }
      }
    }

    // Call child class onStart if exists
    await this.onModuleStart?.(app);
  }

  /**
   * Stop module - handles provider cleanup
   */
  override async onStop(app: IApplication): Promise<void> {
    // Call child class onStop if exists
    await this.onModuleStop?.(app);

    // Destroy all providers in reverse order
    for (let i = this._providers.length - 1; i >= 0; i--) {
      const provider = this._providers[i];
      if (provider?.instance && typeof provider.instance.onDestroy === 'function') {
        await provider.instance.onDestroy();
      }
    }

    // Clear references
    this._providers = [];
    this._imports = [];
    this._moduleContainer = undefined;
    this._parentContainer = undefined;
  }

  /**
   * Health check with provider checks
   */
  override async health(): Promise<IHealthStatus> {
    const providerHealthChecks = await Promise.all(
      this._providers.map(async (provider) => {
        if (provider.instance && typeof provider.instance.health === 'function') {
          try {
            return await provider.instance.health();
          } catch (error) {
            return {
              status: 'unhealthy' as const,
              message: `Provider ${getTokenName(provider.token)} health check failed`,
              details: error
            };
          }
        }
        return null;
      })
    );

    const failedChecks = providerHealthChecks.filter(
      check => check && check.status === 'unhealthy'
    );

    const degradedChecks = providerHealthChecks.filter(
      check => check && check.status === 'degraded'
    );

    // Return the most severe status
    if (failedChecks.length > 0) {
      return {
        status: 'unhealthy',
        message: `Module ${this.name} has unhealthy providers`,
        details: failedChecks
      };
    }

    if (degradedChecks.length > 0) {
      return {
        status: 'degraded',
        message: `Module ${this.name} has degraded providers`,
        details: degradedChecks
      };
    }

    return {
      status: 'healthy',
      message: `Module ${this.name} is healthy`
    };
  }

  /**
   * Hook methods for child classes
   */
  protected onModuleRegister?(app: IApplication): Promise<void> | void;
  protected onModuleStart?(app: IApplication): Promise<void> | void;
  protected onModuleStop?(app: IApplication): Promise<void> | void;

  /**
   * Register a provider
   */
  private async registerProvider(providerDef: [InjectionToken<any>, Provider<any>], app: IApplication): Promise<void> {
    const [token, provider] = providerDef;

    // Register in parent container directly
    if (!this._parentContainer) {
      throw new Error('Parent container not initialized');
    }

    let instance: any;

    if ('useClass' in provider) {
      // Class provider - register with container and let Nexus handle DI
      this._parentContainer.register(token, {
        useClass: provider.useClass,
        scope: provider.scope || 'singleton'
      } as any);

      // Don't resolve immediately - let it be resolved lazily
      // This allows registration to succeed even if dependencies are missing
      instance = null;
    } else if ('useValue' in provider) {
      // Value provider
      this._parentContainer.register(token, {
        useValue: provider.useValue
      } as any);
      instance = provider.useValue;
    } else if ('useFactory' in provider) {
      // Factory provider
      const deps = provider.inject?.map((depToken: any) =>
        this._parentContainer!.resolve(depToken)
      ) || [];
      instance = await provider.useFactory(...deps);
      this._parentContainer.register(token, {
        useValue: instance
      } as any);
    }

    // Store provider instance
    this._providers.push({
      token,
      instance,
      metadata: providerDef
    });
  }

  /**
   * Resolve a module from various input types
   */
  private async resolveModule(input: ModuleInput, app: IApplication): Promise<IModule> {
    if (typeof input === 'function') {
      // Check if it's a constructor or factory function
      if (input.prototype) {
        // Module class constructor
        const ModuleClass = input as any;
        return new ModuleClass();
      } else {
        // Factory function
        const result = await (input as any)();
        return result as IModule;
      }
    } else if ('module' in (input as any)) {
      // Dynamic module
      const dynamic = input as IDynamicModule;
      const ModuleClass = dynamic.module;
      return new ModuleClass();
    } else {
      // Module instance
      return input as IModule;
    }
  }

  /**
   * Get a provider from this module or its dependencies
   */
  protected getProvider<T>(token: Token<T>): T | undefined {
    // First check local providers
    const provider = this._providers.find(p => p.token === token);
    if (provider) {
      // Resolve instance if not yet resolved
      const [, providerDef] = provider.metadata;
      if (!provider.instance && 'useClass' in providerDef && this._parentContainer) {
        try {
          provider.instance = this._parentContainer.resolve(token);
        } catch {
          return undefined;
        }
      }
      return provider.instance;
    }

    // Check parent container (all providers are there now)
    if (this._parentContainer?.has(token)) {
      return this._parentContainer.resolve(token);
    }

    return undefined;
  }

  /**
   * Check if module has access to a provider
   */
  protected hasProvider(token: Token<any>): boolean {
    // Check local providers
    if (this._providers.some(p => p.token === token)) {
      return true;
    }

    // Check module container
    if (this._moduleContainer?.has(token)) {
      return true;
    }

    // Check parent container
    if (this._parentContainer?.has(token)) {
      return true;
    }

    return false;
  }
}

/**
 * Module decorator for declarative module configuration
 */
export function Module(metadata: IModuleMetadata): ClassDecorator {
  return function (target: any) {
    // Store metadata on the class
    Reflect.defineMetadata('module:metadata', metadata, target);

    // Create a wrapper class that extends EnhancedApplicationModule
    return class extends EnhancedApplicationModule {
      private moduleInstance: any;

      constructor() {
        // Pass metadata with name to base constructor
        super({
          ...metadata,
          name: metadata.name || target.name
        });
        // Create instance of the original class
        this.moduleInstance = new target();
      }

      // Delegate lifecycle methods to the original instance if they exist
      protected override async onModuleRegister(app: IApplication): Promise<void> {
        if (typeof this.moduleInstance.onRegister === 'function') {
          await this.moduleInstance.onRegister(app);
        }
      }

      protected override async onModuleStart(app: IApplication): Promise<void> {
        if (typeof this.moduleInstance.onStart === 'function') {
          await this.moduleInstance.onStart(app);
        }
      }

      protected override async onModuleStop(app: IApplication): Promise<void> {
        if (typeof this.moduleInstance.onStop === 'function') {
          await this.moduleInstance.onStop(app);
        }
      }

      // Proxy any additional methods from the original class
      [key: string]: any;
    } as any;
  };
}

/**
 * Create module with providers helper
 */
export function createModuleWithProviders(
  name: string,
  providers: Array<[InjectionToken<any>, Provider<any>]>,
  options?: Partial<IModuleMetadata>
): EnhancedApplicationModule {
  return new (class extends EnhancedApplicationModule {
    constructor() {
      super({
        name,
        providers,
        ...options
      });
    }
  })();
}