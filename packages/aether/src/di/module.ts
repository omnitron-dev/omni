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

  // Collect all providers from this module
  const allModuleProviders = [
    ...(module.definition.providers || []),
    ...(additionalProviders || []),
  ];

  // Attach dependency metadata to classes (for constructor injection without decorators)
  if (allModuleProviders.length > 0) {
    attachDependencyMetadata(allModuleProviders);
  }

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
    // First pass: collect all imported providers for dependency detection
    const importedProviders: Provider[] = [];
    module.definition.imports.forEach((importedModule) => {
      // Collect all providers from imported module for dependency analysis
      if (importedModule.definition.providers) {
        importedProviders.push(...importedModule.definition.providers);
      }
      if (importedModule.definition.exportProviders) {
        importedProviders.push(...importedModule.definition.exportProviders);
      }
    });

    // Include imported providers in dependency analysis
    if (importedProviders.length > 0) {
      attachDependencyMetadata([...allModuleProviders, ...importedProviders]);
    }

    // Second pass: compile imported modules and make their providers available
    module.definition.imports.forEach((importedModule) => {
      const importedContainer = compileModule(importedModule, container);

      // Make ALL providers from imported modules available in this container
      // This allows the importing module to use any provider from imported modules
      if (importedModule.definition.providers) {
        importedModule.definition.providers.forEach((provider) => {
          const token = getProviderToken(provider);
          if (importedContainer.has(token)) {
            const instance = importedContainer.get(token);
            container.register(token, { provide: token, useValue: instance });
          }
        });
      }

      // Also register explicitly exported providers
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
 * Analyze constructor to extract parameter names and count
 */
function analyzeConstructor(Class: any): { paramCount: number; paramNames: string[] } {
  // Check if metadata already exists
  const existingDeps = Reflect.getMetadata?.('injectable:options', Class)?.deps;
  if (existingDeps && existingDeps.length > 0) {
    return { paramCount: existingDeps.length, paramNames: [] };
  }

  const reflectDeps = Reflect.getMetadata?.('design:paramtypes', Class);
  if (reflectDeps && reflectDeps.length > 0) {
    return { paramCount: reflectDeps.length, paramNames: [] };
  }

  // Get constructor as string to analyze
  const classStr = Class.toString();
  const constructorMatch = classStr.match(/constructor\s*\(([^)]*)\)/);

  if (!constructorMatch || !constructorMatch[1].trim()) {
    return { paramCount: 0, paramNames: [] };
  }

  // Extract parameter names (handles both "logger" and "private logger")
  const paramsStr = constructorMatch[1].trim();
  const paramNames = paramsStr
    .split(',')
    .map((param: string) => {
      // Remove visibility modifiers and get the parameter name
      const cleaned = param.trim().replace(/^(private|public|protected|readonly)\s+/, '');
      // Get just the name (before any type annotation or assignment)
      const nameMatch = cleaned.match(/^(\w+)/);
      return nameMatch ? nameMatch[1] : '';
    })
    .filter((name: string) => name.length > 0);

  return { paramCount: paramNames.length, paramNames };
}

/**
 * Analyze providers and attach dependency metadata to classes.
 *
 * This function enables constructor injection for classes without decorators by:
 * 1. Using reflect-metadata when available (decorator-based classes)
 * 2. Matching constructor parameter names with provider class names
 * 3. Using order-based heuristics as fallback
 *
 * This solves the issue where Vitest/esbuild doesn't emit decorator metadata,
 * causing constructor parameters to be undefined at runtime.
 */
function attachDependencyMetadata(providers: Provider[]): void {
  // Build a map of all available provider classes indexed by name
  const providerByName = new Map<string, any>();
  const classProviders: Array<{ Class: any; analysis: ReturnType<typeof analyzeConstructor> }> = [];

  providers.forEach((provider) => {
    let Class: any;
    if (typeof provider === 'function') {
      Class = provider;
    } else if ('useClass' in provider) {
      Class = provider.useClass;
    } else {
      return; // Skip non-class providers
    }

    providerByName.set(Class.name, Class);
    classProviders.push({ Class, analysis: analyzeConstructor(Class) });
  });

  // Sort by parameter count (classes with fewer params first - likely dependencies)
  classProviders.sort((a, b) => a.analysis.paramCount - b.analysis.paramCount);

  // Track which classes we've successfully resolved
  const resolvedClasses: any[] = [];

  classProviders.forEach(({ Class, analysis }) => {
    // Check if already has reflect-metadata
    const reflectDeps = Reflect.getMetadata?.('design:paramtypes', Class);
    if (reflectDeps && reflectDeps.length > 0) {
      (Class as any).__aether_deps__ = reflectDeps;
      resolvedClasses.push(Class);
      return;
    }

    if (analysis.paramCount === 0) {
      // No dependencies
      resolvedClasses.push(Class);
      return;
    }

    // Try to match parameter names with provider class names
    const deps: any[] = [];
    for (const paramName of analysis.paramNames) {
      let foundProvider: any = null;

      // Try to find matching provider by fuzzy matching
      // e.g., "logger" matches "LoggerService", "payment" matches "PaymentService"
      for (const [className, providerClass] of providerByName.entries()) {
        const classNameLower = className.toLowerCase();
        const paramNameLower = paramName.toLowerCase();

        if (
          classNameLower.includes(paramNameLower) ||
          paramNameLower.includes(classNameLower) ||
          classNameLower.replace('service', '').replace('provider', '') === paramNameLower ||
          paramNameLower.replace('service', '').replace('provider', '') === classNameLower
        ) {
          foundProvider = providerClass;
          break;
        }
      }

      deps.push(foundProvider);
    }

    // Only attach if we found all dependencies
    if (deps.length > 0 && deps.every((dep) => dep !== null && dep !== undefined)) {
      (Class as any).__aether_deps__ = deps;
      resolvedClasses.push(Class);
    } else if (analysis.paramCount > 0 && resolvedClasses.length >= analysis.paramCount) {
      // Fallback: use already-resolved classes in order
      // This works when providers are listed in dependency order
      const fallbackDeps = resolvedClasses.slice(-analysis.paramCount);
      (Class as any).__aether_deps__ = fallbackDeps;
      resolvedClasses.push(Class);
    }
  });
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
