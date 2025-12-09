/**
 * Async resolution logic for Nexus DI Container
 *
 * Handles asynchronous dependency resolution with retry and timeout support.
 *
 * @internal
 * @since 0.1.0
 */

import { CircularDependencyError } from '../errors.js';
import { Errors, toTitanError } from '../../errors/factories.js';
import {
  InjectionToken,
  ResolutionContext,
  ResolutionContextInternal,
} from '../types.js';
import type { Registration, ModuleProviderInfo } from './types.js';

/**
 * AsyncResolutionService handles all async resolution logic
 */
export class AsyncResolutionService {
  /**
   * Resolve async dependencies
   * Uses isolated resolution state from context to prevent race conditions
   */
  async resolveAsyncDependencies(
    registration: Registration,
    context: ResolutionContext,
    moduleProviders: Map<string, Map<string, ModuleProviderInfo>> | undefined,
    pendingPromises: Map<InjectionToken<any>, Promise<any>>,
    registrations: Map<InjectionToken<any>, Registration | Registration[]>,
    getTokenKeyFn: (token: InjectionToken<any>) => string,
    getRegistrationFn: (token: InjectionToken<any>) => Registration | undefined,
    resolveAsyncInternalFn: <T>(token: InjectionToken<T>) => Promise<T>,
    hasTokenFn: (token: InjectionToken<any>) => boolean,
    getTokenModuleInfoFn?: (tokenKey: string) => { moduleName: string; isGlobal: boolean; isExported: boolean } | undefined
  ): Promise<any[]> {
    if (!registration.dependencies || registration.dependencies.length === 0) {
      return [];
    }

    // Get resolution state from context (isolated per resolution tree)
    const resolutionState = context.resolutionState;

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

    // Resolve dependencies sequentially to maintain resolution chain integrity
    const resolvedDeps = [];
    for (const dep of registration.dependencies) {
      // Extract actual token from dependency object (same as sync version)
      let depToken: InjectionToken<any> = dep;
      let isOptional = false;

      // Handle optional dependencies and context injection
      if (typeof dep === 'object' && dep !== null && 'token' in dep) {
        const depObj = dep as any;

        // Handle context injection
        if (depObj.token === 'CONTEXT' && depObj.type === 'context') {
          resolvedDeps.push((context as any)['resolveContext'] || context);
          continue;
        }

        depToken = depObj.token;
        isOptional = depObj.optional || false;
      } else if (dep === 'CONTEXT') {
        // Handle string context token directly
        resolvedDeps.push((context as any)['resolveContext'] || context);
        continue;
      }

      // Check for circular dependency in async context too
      if (resolutionState?.chain.includes(depToken)) {
        throw new CircularDependencyError([...resolutionState.chain, depToken]);
      }

      const depReg = getRegistrationFn(depToken);
      if (depReg?.isAsync) {
        // Check if already being resolved (pending promise)
        if (pendingPromises.has(depToken)) {
          resolvedDeps.push(await pendingPromises.get(depToken)!);
        } else {
          // Resolve the dependency directly within current resolution context
          // The context already contains the correct resolutionState
          resolutionState?.chain.push(depToken);
          const prevModule = (context as ResolutionContextInternal).__resolvingModule;
          try {
            (context as ResolutionContextInternal).__resolvingModule = currentModule;
            const result = await resolveAsyncInternalFn(depToken);
            resolvedDeps.push(result);
          } finally {
            // Remove from chain after resolution
            resolutionState?.chain.pop();
            (context as ResolutionContextInternal).__resolvingModule = prevModule;
          }
        }
      } else {
        // Handle optional dependencies
        if (isOptional) {
          // Try async resolution first, fallback to optional behavior
          const prevModule = (context as ResolutionContextInternal).__resolvingModule;
          try {
            (context as ResolutionContextInternal).__resolvingModule = currentModule;
            // Check if registered - if not, push undefined for optional
            if (!getRegistrationFn(depToken) && !hasTokenFn(depToken)) {
              resolvedDeps.push(undefined);
            } else {
              // Use async resolution to handle nested async dependencies
              resolutionState?.chain.push(depToken);
              try {
                const result = await resolveAsyncInternalFn(depToken);
                resolvedDeps.push(result);
              } finally {
                resolutionState?.chain.pop();
              }
            }
          } finally {
            (context as ResolutionContextInternal).__resolvingModule = prevModule;
          }
        } else {
          // Set module context and resolve asynchronously
          // Always use async resolution to handle nested async dependencies
          resolutionState?.chain.push(depToken);
          const prevModule = (context as ResolutionContextInternal).__resolvingModule;
          try {
            (context as ResolutionContextInternal).__resolvingModule = currentModule;
            const result = await resolveAsyncInternalFn(depToken);
            resolvedDeps.push(result);
          } finally {
            resolutionState?.chain.pop();
            (context as ResolutionContextInternal).__resolvingModule = prevModule;
          }
        }
      }
    }

    return resolvedDeps;
  }

  /**
   * Apply retry logic to async operations
   */
  async applyRetryLogic<T>(operation: () => Promise<T>, maxAttempts: number, delay: number): Promise<T> {
    let lastError: Error;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = toTitanError(error);

        if (attempt === maxAttempts) {
          break;
        }

        // Wait before retrying
        if (delay > 0) {
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    throw lastError!;
  }

  /**
   * Apply timeout to a promise
   */
  async applyTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(Errors.timeout('async resolution', timeoutMs)), timeoutMs);
    });
    return Promise.race([promise, timeoutPromise]);
  }
}
