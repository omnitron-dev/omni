/**
 * Enhanced module system with automatic provider management
 */

import { Token, Container } from '@omnitron-dev/nexus';

import {
  Module,
  Provider,
  ModuleInput,
  IApplication,
  HealthStatus,
  DynamicModule,
  ApplicationModule as BaseApplicationModule
} from './types';

/**
 * Module metadata interface
 */
export interface ModuleMetadata {
  name?: string;
  version?: string;
  imports?: ModuleInput[];
  providers?: Provider[];
  exports?: Token<any>[];
  dependencies?: Token<any>[];
}

/**
 * Provider instance with lifecycle
 */
interface ProviderInstance {
  token: Token<any>;
  instance: any;
  metadata: Provider;
}

/**
 * Enhanced application module with automatic provider management
 */
export abstract class EnhancedApplicationModule extends BaseApplicationModule {
  private _providers: ProviderInstance[] = [];
  private _imports: Module[] = [];
  private _exports: Set<Token<any>> = new Set();
  private _moduleContainer?: Container;
  private _parentContainer?: Container;
  private _app?: IApplication;

  // Override properties from base class
  override readonly name: string;
  override readonly version?: string;
  override readonly dependencies?: Token<any>[];

  constructor(protected metadata: ModuleMetadata = {}) {
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
    // Use the parent container directly for better compatibility
    // Module scoping is handled through exports configuration
    this._parentContainer = app.container;
    this._moduleContainer = this._parentContainer; // Use parent directly instead of child

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

    // Export tracking for documentation purposes
    // Since we're using the parent container directly, exports are already available
    for (const token of this._exports) {
      if (!this._moduleContainer.has(token)) {
        console.warn(`Module ${this.name} exports ${token.name} but it is not registered`);
      }
    }

    // Call child class onRegister if exists
    await this.onModuleRegister?.(app);
  }

  /**
   * Start module - handles provider initialization
   */
  override async onStart(app: IApplication): Promise<void> {
    // Initialize all providers that implement OnInit
    for (const provider of this._providers) {
      if (provider.instance && typeof provider.instance.onInit === 'function') {
        await provider.instance.onInit();
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
  override async health(): Promise<HealthStatus> {
    const providerHealthChecks = await Promise.all(
      this._providers.map(async (provider) => {
        if (provider.instance && typeof provider.instance.health === 'function') {
          try {
            return await provider.instance.health();
          } catch (error) {
            return {
              status: 'unhealthy' as const,
              message: `Provider ${provider.token.name} health check failed`,
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
  private async registerProvider(providerDef: Provider, app: IApplication): Promise<void> {
    const token = providerDef.provide;

    // Register in container (now using parent directly)
    if (!this._moduleContainer) {
      throw new Error('Module container not initialized');
    }

    let instance: any;

    if (providerDef.useClass) {
      // Class provider - register with container and let Nexus handle DI
      this._moduleContainer.register(token, {
        useClass: providerDef.useClass,
        scope: providerDef.scope || 'singleton'
      } as any);

      // Resolve to create the instance
      instance = this._moduleContainer.resolve(token);
    } else if (providerDef.useValue !== undefined) {
      // Value provider
      this._moduleContainer.register(token, {
        useValue: providerDef.useValue
      } as any);
      instance = providerDef.useValue;
    } else if (providerDef.useFactory) {
      // Factory provider
      const deps = providerDef.inject?.map(depToken =>
        this._moduleContainer!.resolve(depToken)
      ) || [];
      instance = await providerDef.useFactory(...deps);
      this._moduleContainer.register(token, {
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
  private async resolveModule(input: ModuleInput, app: IApplication): Promise<Module> {
    if (typeof input === 'function') {
      // Check if it's a constructor or factory function
      if (input.prototype) {
        // Module class constructor
        const ModuleClass = input as any;
        return new ModuleClass();
      } else {
        // Factory function
        const result = await (input as any)();
        return result as Module;
      }
    } else if ('module' in (input as any)) {
      // Dynamic module
      const dynamic = input as DynamicModule;
      const ModuleClass = dynamic.module;
      return new ModuleClass();
    } else {
      // Module instance
      return input as Module;
    }
  }

  /**
   * Get a provider from this module
   */
  protected getProvider<T>(token: Token<T>): T | undefined {
    const provider = this._providers.find(p => p.token === token);
    return provider?.instance;
  }

  /**
   * Check if module has a provider
   */
  protected hasProvider(token: Token<any>): boolean {
    return this._providers.some(p => p.token === token);
  }
}

/**
 * Module decorator for declarative module configuration
 */
export function Module(metadata: ModuleMetadata): ClassDecorator {
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
  providers: Provider[],
  options?: Partial<ModuleMetadata>
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