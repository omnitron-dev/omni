/**
 * Resolution logic for Nexus DI Container
 *
 * Handles dependency resolution, module access checking, and error message building.
 *
 * @internal
 * @since 0.1.0
 */

import { getTokenName } from '../token.js';
import { Errors } from '../../errors/factories.js';
import { InjectionToken, ResolutionContext } from '../types.js';
import type { Registration, ModuleProviderInfo } from './types.js';
import type { Dependency } from './injection-plan.js';
import { generateResolutionId } from '../../utils/id.js';
import { getResolvingModule, runInModuleScope } from './module-scope.js';

// Re-export for backward compatibility
export { generateResolutionId };

/**
 * ResolutionService handles all dependency resolution logic
 */
export class ResolutionService {
  /**
   * Resolve dependencies for a registration
   */
  resolveDependencies(
    registration: Registration,
    context: ResolutionContext,
    moduleProviders: Map<string, Map<string, ModuleProviderInfo>> | undefined,
    getTokenKeyFn: (token: InjectionToken<any>) => string,
    resolveFn: <T>(token: InjectionToken<T>) => T,
    resolveOptionalFn: <T>(token: InjectionToken<T>) => T | undefined,
    getTokenModuleInfoFn?: (
      tokenKey: string
    ) => { moduleName: string; isGlobal: boolean; isExported: boolean } | undefined,
    /**
     * Optional callback used for descriptor-shaped dependencies emitted by
     * {@link RegistrationService.extractClassDependencies} (e.g. `@Value`,
     * `@InjectAll`, `@InjectEnv`, `@InjectConfig`, `@ConditionalInject`).
     * The container provides this so resolution stays a pure data-driven
     * operation here.
     */
    resolveRichDependencyFn?: (dep: Dependency) => unknown
  ): any[] {
    if (!registration.dependencies || registration.dependencies.length === 0) {
      return [];
    }

    // Find which module this registration belongs to using O(1) lookup
    const tokenKey = getTokenKeyFn(registration.token);
    let currentModule: string | undefined;

    if (getTokenModuleInfoFn) {
      // Use O(1) flat index lookup
      const moduleInfo = getTokenModuleInfoFn(tokenKey);
      currentModule = moduleInfo?.moduleName;
    } else if (moduleProviders) {
      // Fallback to O(m) iteration for backwards compatibility
      for (const [moduleName, providerMap] of moduleProviders) {
        if (providerMap.has(tokenKey)) {
          currentModule = moduleName;
          break;
        }
      }
    }

    return registration.dependencies.map((dep) => {
      // Rich descriptor emitted by extractClassDependencies for
      // @InjectAll / @Value / @InjectConfig / @InjectEnv / @ConditionalInject
      if (typeof dep === 'object' && dep !== null && '__dep' in (dep as any)) {
        if (!resolveRichDependencyFn) {
          throw Errors.badRequest(
            'Rich injection descriptor encountered without a resolver. This indicates an internal misconfiguration.'
          );
        }
        return resolveRichDependencyFn((dep as any).__dep as Dependency);
      }

      // Handle optional dependencies and context injection
      if (typeof dep === 'object' && dep !== null && 'token' in dep) {
        const depObj = dep as any;

        // Handle context injection
        if (depObj.token === 'CONTEXT' && depObj.type === 'context') {
          return (context as any)['resolveContext'] || context;
        }

        if (depObj.optional) {
          return resolveOptionalFn(depObj.token);
        }

        // Resolve inside a fresh module-scope frame. AsyncLocalStorage
        // restores the previous scope automatically when `runInModuleScope`
        // returns — unlike the old "mutate-then-restore" pattern on the
        // context object, this is exception-safe and isolated across
        // concurrent async chains.
        return currentModule
          ? runInModuleScope(currentModule, () => resolveFn(depObj.token))
          : resolveFn(depObj.token);
      }

      // Handle string context token directly
      if (dep === 'CONTEXT') {
        return (context as any)['resolveContext'] || context;
      }

      // Regular token — same module-scope handling as above.
      return currentModule
        ? runInModuleScope(currentModule, () => resolveFn(dep))
        : resolveFn(dep);
    });
  }

  /**
   * Check module access for a token
   */
  checkModuleAccess(
    token: InjectionToken<any>,
    context: ResolutionContext,
    moduleProviders: Map<string, Map<string, ModuleProviderInfo>> | undefined,
    moduleImports: Map<string, Set<string>>,
    getTokenKeyFn: (token: InjectionToken<any>) => string,
    getTokenModuleInfoFn?: (
      tokenKey: string
    ) => { moduleName: string; isGlobal: boolean; isExported: boolean } | undefined
  ): void {
    if (!moduleProviders) return;

    const tokenKey = getTokenKeyFn(token);
    let tokenModule: string | undefined;
    let isGlobal = false;
    let isExported = false;

    if (getTokenModuleInfoFn) {
      // Use O(1) flat index lookup
      const moduleInfo = getTokenModuleInfoFn(tokenKey);
      if (moduleInfo) {
        tokenModule = moduleInfo.moduleName;
        isGlobal = moduleInfo.isGlobal;
        isExported = moduleInfo.isExported;
      }
    } else {
      // Fallback to O(m) iteration for backwards compatibility
      for (const [moduleName, providerMap] of moduleProviders) {
        if (providerMap.has(tokenKey)) {
          tokenModule = moduleName;
          const providerInfo = providerMap.get(tokenKey)!;
          isGlobal = providerInfo.global;
          isExported = providerInfo.exported;
          break;
        }
      }
    }

    if (tokenModule) {
      // Read the currently-resolving module from AsyncLocalStorage so we
      // see the value scoped to OUR chain (not whatever an unrelated
      // concurrent resolution might have written on a shared context
      // object). `context` parameter is no longer consulted for this.
      const resolvingModule = getResolvingModule();
      const isSameModule = resolvingModule && resolvingModule === tokenModule;

      // Check if resolving module imports the token's module
      let canAccessFromImport = false;
      if (resolvingModule && moduleImports.has(resolvingModule)) {
        canAccessFromImport = moduleImports.get(resolvingModule)!.has(tokenModule) && isExported;
      }

      // If no resolving module (resolving from main container), allow if exported or global
      const isFromMainContainer = !resolvingModule;
      const canAccessFromMain = isFromMainContainer && (isExported || isGlobal);

      // Access rules:
      // 1. Global providers are accessible everywhere
      // 2. Exported providers are accessible to importing modules and main container
      // 3. Non-exported providers are only accessible within the same module
      const hasAccess = isGlobal || isSameModule || canAccessFromImport || canAccessFromMain;

      if (!hasAccess) {
        const tokenName = getTokenName(token);
        throw Errors.forbidden('Token not accessible: ' + tokenName, { token: tokenName, module: tokenModule });
      }
    }
  }

  /**
   * Build async resolution error message
   */
  buildAsyncErrorMessage(
    token: InjectionToken<any>,
    registration: Registration,
    registrations: Map<InjectionToken<any>, Registration | Registration[]>
  ): string {
    const tokenName = getTokenName(token);
    let reason = '';

    // Check if this provider itself is async
    if (
      'useFactory' in registration.provider &&
      registration.provider.useFactory?.constructor.name === 'AsyncFunction'
    ) {
      reason = 'it uses an async factory function';
    } else if (registration.dependencies && registration.dependencies.length > 0) {
      // Check which dependencies are async
      const asyncDeps: string[] = [];
      for (const dep of registration.dependencies) {
        const depToken = typeof dep === 'object' && dep !== null && 'token' in dep ? (dep as any).token : dep;
        if (depToken === 'CONTEXT' || (typeof dep === 'object' && (dep as any).type === 'context')) {
          continue;
        }
        const depRegistration = registrations.get(depToken);
        const depReg = Array.isArray(depRegistration) ? depRegistration[0] : depRegistration;
        if (depReg?.isAsync) {
          asyncDeps.push(getTokenName(depToken));
        }
      }
      if (asyncDeps.length > 0) {
        reason = 'it depends on async provider(s): ' + asyncDeps.join(', ');
      }
    }

    return (
      "Cannot resolve '" +
      tokenName +
      "' synchronously because " +
      (reason || 'it is registered as async') +
      ". Use 'await container.resolveAsync(" +
      tokenName +
      ")' instead."
    );
  }
}
