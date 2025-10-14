/**
 * Dependency Injection - Module System
 *
 * Define and compose modules with DI
 */

import { DIContainer } from './container.js';
import { InjectionToken } from './tokens.js';
import type { Module, ModuleDefinition, ModuleWithProviders, Provider } from './types.js';

/**
 * Define a module
 *
 * @param definition - Module definition
 * @returns Module instance
 *
 * @example
 * ```typescript
 * export const AuthModule = defineModule({
 *   id: 'auth',
 *   imports: [CommonModule],
 *   components: [LoginComponent, RegisterComponent],
 *   providers: [AuthService, UserService],
 *   exports: [LoginComponent, RegisterComponent],
 *   exportProviders: [AuthService]
 * });
 * ```
 */
export function defineModule(definition: ModuleDefinition): Module {
  return {
    id: definition.id,
    definition,
  };
}

/**
 * Create a module with providers (forRoot/forChild pattern)
 *
 * @param module - Module instance
 * @param providers - Additional providers
 * @returns Module with providers
 *
 * @example
 * ```typescript
 * static forRoot(config: RouterConfig): ModuleWithProviders {
 *   return {
 *     module: defineModule({ id: 'router-root' }),
 *     providers: [{ provide: ROUTER_CONFIG, useValue: config }]
 *   };
 * }
 * ```
 */
export function withProviders(module: Module, providers: Provider[]): ModuleWithProviders {
  return {
    module,
    providers,
  };
}

/**
 * Compile a module tree into a DI container
 *
 * @param rootModule - Root module
 * @param parentContainer - Parent container (optional)
 * @returns DI container with all providers registered
 */
export function compileModule(rootModule: Module | ModuleWithProviders, parentContainer?: DIContainer): DIContainer {
  const container = new DIContainer({ parent: parentContainer });

  // Extract module and providers
  const module = 'module' in rootModule ? rootModule.module : rootModule;
  const additionalProviders = 'providers' in rootModule ? rootModule.providers : [];

  // Register module's own providers
  if (module.definition.providers) {
    module.definition.providers.forEach((provider) => {
      container.register(getProviderToken(provider), provider);
    });
  }

  // Register additional providers
  additionalProviders?.forEach((provider) => {
    container.register(getProviderToken(provider), provider);
  });

  // Register stores as providers (if any)
  if (module.definition.stores) {
    module.definition.stores.forEach((storeFactory, index) => {
      const token = new InjectionToken(`STORE_${module.definition.id}_${index}`);
      container.register(token, {
        provide: token,
        useFactory: storeFactory,
        scope: 'singleton',
      });
    });
  }

  // Process imported modules
  if (module.definition.imports) {
    module.definition.imports.forEach((importedModule) => {
      const importedContainer = compileModule(importedModule, container);

      // Re-export providers from imported modules
      if (importedModule.definition.exportProviders) {
        importedModule.definition.exportProviders.forEach((exportedProvider) => {
          const token = getProviderToken(exportedProvider);
          if (importedContainer.has(token)) {
            const instance = importedContainer.get(token);
            container.register(token, { provide: token, useValue: instance });
          }
        });
      }

      // Re-export stores from imported modules
      if (importedModule.definition.exportStores) {
        importedModule.definition.exportStores.forEach((storeId) => {
          const token = new InjectionToken(`STORE_${storeId}`);
          if (importedContainer.has(token)) {
            const instance = importedContainer.get(token);
            container.register(token, { provide: token, useValue: instance });
          }
        });
      }
    });
  }

  return container;
}

/**
 * Get provider token from provider definition
 */
function getProviderToken(provider: Provider | any): any {
  if (typeof provider === 'function') {
    return provider;
  }
  if ('provide' in provider) {
    return provider.provide;
  }
  throw new Error(`Invalid provider: ${JSON.stringify(provider)}`);
}

/**
 * Bootstrap a module
 *
 * @param rootModule - Root module to bootstrap
 * @returns DI container and bootstrap component instance
 *
 * @example
 * ```typescript
 * const { container, component } = bootstrapModule(AppModule);
 * ```
 */
export function bootstrapModule(rootModule: Module): {
  container: DIContainer;
  component?: any;
} {
  const container = compileModule(rootModule);

  // Instantiate bootstrap component if defined
  let component: any;
  if (rootModule.definition.bootstrap) {
    component = container.get(rootModule.definition.bootstrap);
  }

  return { container, component };
}
