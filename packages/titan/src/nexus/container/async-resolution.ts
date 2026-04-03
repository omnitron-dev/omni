/**
 * Async resolution logic for Nexus DI Container
 *
 * Handles asynchronous dependency resolution with retry and timeout support.
 * Optimized for parallel resolution of independent dependencies.
 *
 * @internal
 * @since 0.1.0
 */

import { CircularDependencyError } from '../errors.js';
import { Errors, toTitanError } from '../../errors/factories.js';
import { InjectionToken, ResolutionContext, ResolutionContextInternal } from '../types.js';

/**
 * Dependency resolution task with metadata for parallel processing
 */
interface ResolutionTask {
  index: number;
  depToken: InjectionToken<any>;
  isOptional: boolean;
  isContext: boolean;
  contextValue?: any;
}
import type { Registration, ModuleProviderInfo } from './types.js';

/**
 * AsyncResolutionService handles all async resolution logic
 */
export class AsyncResolutionService {
  /**
   * Resolve async dependencies
   * Uses isolated resolution state from context to prevent race conditions.
   * Optimized to batch pending promises for parallel resolution.
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
    getTokenModuleInfoFn?: (
      tokenKey: string
    ) => { moduleName: string; isGlobal: boolean; isExported: boolean } | undefined
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

    // Phase 1: Classify dependencies and collect already-pending promises
    const tasks: ResolutionTask[] = [];
    const pendingTasks: Array<{ index: number; promise: Promise<any> }> = [];

    for (let i = 0; i < registration.dependencies.length; i++) {
      const dep = registration.dependencies[i];
      if (dep === undefined) continue; // Skip undefined dependencies
      let depToken: InjectionToken<any> = dep;
      let isOptional = false;

      // Handle optional dependencies and context injection
      if (typeof dep === 'object' && dep !== null && 'token' in dep) {
        const depObj = dep as any;

        // Handle context injection - immediate resolution
        if (depObj.token === 'CONTEXT' && depObj.type === 'context') {
          tasks.push({
            index: i,
            depToken: dep,
            isOptional: false,
            isContext: true,
            contextValue: (context as any)['resolveContext'] || context,
          });
          continue;
        }

        depToken = depObj.token;
        isOptional = depObj.optional || false;
      } else if (dep === 'CONTEXT') {
        // Handle string context token directly - immediate resolution
        tasks.push({
          index: i,
          depToken: dep,
          isOptional: false,
          isContext: true,
          contextValue: (context as any)['resolveContext'] || context,
        });
        continue;
      }

      // Check for circular dependency
      if (resolutionState?.chain.includes(depToken)) {
        throw new CircularDependencyError([...resolutionState.chain, depToken]);
      }

      // Check if already pending - can be resolved in parallel
      if (pendingPromises.has(depToken)) {
        pendingTasks.push({ index: i, promise: pendingPromises.get(depToken)! });
        continue;
      }

      // Add to sequential resolution queue
      tasks.push({
        index: i,
        depToken,
        isOptional,
        isContext: false,
      });
    }

    // Phase 2: Resolve pending promises in parallel (optimization)
    const pendingResults: Map<number, any> = new Map();
    if (pendingTasks.length > 0) {
      const results = await Promise.all(pendingTasks.map((t) => t.promise));
      for (let i = 0; i < pendingTasks.length; i++) {
        const task = pendingTasks[i];
        if (task) {
          pendingResults.set(task.index, results[i]);
        }
      }
    }

    // Phase 3: Resolve remaining dependencies sequentially (required for chain tracking)
    const resolvedDeps: any[] = new Array(registration.dependencies.length);

    // Fill in pending results first
    for (const [index, result] of pendingResults) {
      resolvedDeps[index] = result;
    }

    // Resolve tasks sequentially
    for (const task of tasks) {
      // Context values are immediate
      if (task.isContext) {
        resolvedDeps[task.index] = task.contextValue;
        continue;
      }

      const depToken = task.depToken;
      const isOptional = task.isOptional;
      const depReg = getRegistrationFn(depToken);

      // Handle optional unregistered dependencies
      if (isOptional && !depReg && !hasTokenFn(depToken)) {
        resolvedDeps[task.index] = undefined;
        continue;
      }

      // Resolve with chain tracking
      resolutionState?.chain.push(depToken);
      const prevModule = (context as ResolutionContextInternal).__resolvingModule;
      try {
        (context as ResolutionContextInternal).__resolvingModule = currentModule;
        const result = await resolveAsyncInternalFn(depToken);
        resolvedDeps[task.index] = result;
      } catch (error) {
        // Optional deps that fail during resolution should return undefined
        if (isOptional) {
          resolvedDeps[task.index] = undefined;
        } else {
          throw error;
        }
      } finally {
        resolutionState?.chain.pop();
        (context as ResolutionContextInternal).__resolvingModule = prevModule;
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
