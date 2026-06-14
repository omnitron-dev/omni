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
import type { Registration } from './types.js';
import type { Dependency } from './injection-plan.js';
import type { ContainerStore } from './store.js';
import { generateResolutionId } from '../../utils/id.js';
import { getResolvingModule, runInModuleScope } from './module-scope.js';

// Re-export for backward compatibility
export { generateResolutionId };

/**
 * ResolutionService handles all dependency resolution logic.
 *
 * NX-9: the container's resolution hooks (resolve / resolveOptional /
 * resolveDependency), module-membership queries (getTokenKey /
 * getTokenModuleInfo / getModuleProviders / moduleImports) and the
 * registration table are all read from the injected {@link ContainerStore}
 * instead of being threaded through every method as positional callbacks.
 * Only the per-resolution `registration`/`token`/`context` are passed per call.
 */
export class ResolutionService {
  constructor(private readonly store: ContainerStore) {}

  /**
   * Resolve dependencies for a registration
   */
  resolveDependencies(registration: Registration, context: ResolutionContext): any[] {
    if (!registration.dependencies || registration.dependencies.length === 0) {
      return [];
    }

    // Find which module this registration belongs to using O(1) lookup
    const tokenKey = this.store.getTokenKey(registration.token);
    const currentModule: string | undefined = this.store.getTokenModuleInfo(tokenKey)?.moduleName;

    return registration.dependencies.map((dep) => {
      // Rich descriptor emitted by extractClassDependencies for
      // @InjectAll / @Value / @InjectConfig / @InjectEnv / @ConditionalInject
      if (typeof dep === 'object' && dep !== null && '__dep' in (dep as any)) {
        return this.store.resolveDependency((dep as any).__dep as Dependency);
      }

      // Handle optional dependencies and context injection
      if (typeof dep === 'object' && dep !== null && 'token' in dep) {
        const depObj = dep as any;

        // Handle context injection
        if (depObj.token === 'CONTEXT' && depObj.type === 'context') {
          return (context as any)['resolveContext'] || context;
        }

        if (depObj.optional) {
          return this.store.resolveOptional(depObj.token);
        }

        // Resolve inside a fresh module-scope frame. AsyncLocalStorage
        // restores the previous scope automatically when `runInModuleScope`
        // returns — unlike the old "mutate-then-restore" pattern on the
        // context object, this is exception-safe and isolated across
        // concurrent async chains.
        return currentModule
          ? runInModuleScope(currentModule, () => this.store.resolve(depObj.token))
          : this.store.resolve(depObj.token);
      }

      // Handle string context token directly
      if (dep === 'CONTEXT') {
        return (context as any)['resolveContext'] || context;
      }

      // Regular token — same module-scope handling as above.
      return currentModule
        ? runInModuleScope(currentModule, () => this.store.resolve(dep))
        : this.store.resolve(dep);
    });
  }

  /**
   * Check module access for a token
   */
  checkModuleAccess(token: InjectionToken<any>, _context: ResolutionContext): void {
    const moduleProviders = this.store.getModuleProviders();
    if (!moduleProviders) return;

    const tokenKey = this.store.getTokenKey(token);
    let tokenModule: string | undefined;
    let isGlobal = false;
    let isExported = false;

    // O(1) flat index lookup (the container always provides the index).
    const moduleInfo = this.store.getTokenModuleInfo(tokenKey);
    if (moduleInfo) {
      tokenModule = moduleInfo.moduleName;
      isGlobal = moduleInfo.isGlobal;
      isExported = moduleInfo.isExported;
    }

    if (tokenModule) {
      // Read the currently-resolving module from AsyncLocalStorage so we
      // see the value scoped to OUR chain (not whatever an unrelated
      // concurrent resolution might have written on a shared context
      // object). `context` parameter is no longer consulted for this.
      const resolvingModule = getResolvingModule();
      const isSameModule = resolvingModule && resolvingModule === tokenModule;

      // Check if resolving module imports the token's module
      const moduleImports = this.store.moduleImports;
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
  buildAsyncErrorMessage(token: InjectionToken<any>, registration: Registration): string {
    const registrations = this.store.registrations;
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
