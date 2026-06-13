/**
 * Registration logic for Nexus DI Container
 *
 * Handles provider validation, registration creation, and dependency extraction.
 *
 * @internal
 * @since 0.1.0
 */

import { isToken } from '../token.js';
import { isConstructor } from '../provider-utils.js';
import { InvalidProviderError } from '../errors.js';
import {
  Scope,
  ProviderDefinition,
  InjectionToken,
  InjectionInput,
  RegistrationOptions,
  ClassProvider,
  isConfigToken,
  ConfigToken,
  Constructor,
} from '../types.js';
import type { Registration } from './types.js';
import { buildInjectionPlan } from './injection-plan.js';

/**
 * RegistrationService handles all provider registration logic
 */
export class RegistrationService {
  /**
   * Validate a provider definition
   */
  isValidProvider(provider: any): boolean {
    if (!provider || typeof provider !== 'object') {
      return typeof provider === 'function';
    }

    return (
      'useValue' in provider ||
      'useClass' in provider ||
      'useFactory' in provider ||
      'useToken' in provider ||
      'useExisting' in provider || // NestJS-style alias provider
      ('when' in provider && 'useFactory' in provider)
    );
  }

  /**
   * Create a registration from a provider
   */
  createRegistration(
    token: InjectionToken<any>,
    provider: ProviderDefinition<any>,
    options: RegistrationOptions,
    registrations: Map<InjectionToken<any>, Registration | Registration[]>,
    createFactoryFn: (token: InjectionToken<any>, provider: ProviderDefinition<any>) => (...args: any[]) => any
  ): Registration {
    // Handle class constructor as provider
    if (isConstructor(provider)) {
      provider = { useClass: provider } as ClassProvider<any>;
    }

    // Validate provider
    if (!this.isValidProvider(provider)) {
      throw new InvalidProviderError(token, 'Invalid provider format');
    }

    // Determine scope — default Singleton for backend services (connections, state, caches)
    let scope = options.scope || Scope.Singleton;
    if ('useValue' in provider) {
      scope = Scope.Singleton; // Values are always singleton
    } else if ('scope' in provider && provider.scope) {
      scope = provider.scope;
    } else if ('useClass' in provider) {
      // Validate useClass is a constructor before accessing metadata
      if (typeof provider.useClass !== 'function') {
        throw new InvalidProviderError(token, 'useClass must be a constructor function');
      }
      // Check for scope metadata from decorators
      const scopeMetadata =
        Reflect.getMetadata('nexus:scope', provider.useClass) || Reflect.getMetadata('scope', provider.useClass);
      if (scopeMetadata) {
        scope = scopeMetadata as Scope;
      }
    }

    // Extract dependencies
    let dependencies: InjectionInput<any>[] | undefined;
    if ('inject' in provider && provider.inject) {
      dependencies = provider.inject;
    } else if ('useClass' in provider) {
      dependencies = this.extractClassDependencies(provider.useClass);
    }

    // Create factory function
    const factory = createFactoryFn(token, provider);

    // Determine if this registration should be async
    let isAsync = 'useFactory' in provider && provider.useFactory?.constructor.name === 'AsyncFunction';

    // Check if any injected dependency is async and propagate the async requirement
    if (dependencies && dependencies.length > 0 && !isAsync) {
      for (const dep of dependencies) {
        // Handle optional dependencies and context injection
        const depToken = typeof dep === 'object' && dep !== null && 'token' in dep ? (dep as any).token : dep;

        // Skip context injection
        if (depToken === 'CONTEXT' || (typeof dep === 'object' && (dep as any).type === 'context')) {
          continue;
        }

        const depRegistration = registrations.get(depToken);
        if (depRegistration) {
          const depReg = Array.isArray(depRegistration) ? depRegistration[0] : depRegistration;
          if (depReg?.isAsync) {
            isAsync = true;
            break;
          }
        }
      }
    }

    return {
      token,
      provider,
      options,
      scope,
      factory,
      dependencies,
      isAsync,
    };
  }

  /**
   * Extract dependencies from class metadata.
   *
   * Walks the unified injection plan so every supported decorator (@Inject,
   * @InjectAll, @Value, @InjectConfig, @InjectEnv, @ConditionalInject) is
   * surfaced. Plain @Inject(token) entries are emitted as bare tokens
   * (or `{ token, optional }` for @Optional) for backward compatibility with
   * the rest of the resolution pipeline; richer decorator descriptors are
   * wrapped in `{ __dep: ... }` markers that `ResolutionService` knows how
   * to interpret.
   */
  private extractClassDependencies(classConstructor: Constructor | undefined): any[] | undefined {
    if (!classConstructor) return undefined;

    const plan = buildInjectionPlan(classConstructor);
    if (plan.constructorParams.length > 0) {
      return plan.constructorParams.map((dep) => {
        if (!dep) return undefined;
        if (dep.kind === 'token') {
          return dep.optional ? { token: dep.token, optional: true } : dep.token;
        }
        return { __dep: dep };
      });
    }

    // Final legacy fallback: classes that registered via the older
    // `nexus:inject` array directly.
    const legacy = Reflect.getMetadata('nexus:inject', classConstructor);
    const optionalMetadata = Reflect.getMetadata('nexus:optional', classConstructor) || {};
    if (legacy) {
      return legacy.map((dep: any, index: number) =>
        optionalMetadata[index] ? { token: dep, optional: true } : dep
      );
    }
    return undefined;
  }

  /**
   * Process config token validation and defaults
   */
  processConfigToken<T>(token: InjectionToken<T>, provider: ProviderDefinition<T>): ProviderDefinition<T> {
    if (isToken(token) && isConfigToken(token)) {
      const configToken = token as ConfigToken<T>;
      if ('useValue' in provider) {
        let value = provider.useValue;

        // Apply defaults if available
        if (configToken.defaults) {
          value = { ...configToken.defaults, ...value };
        }

        // Validate the config value if validator exists
        if (configToken.validate) {
          configToken.validate(value);
        }

        // Update the provider with merged value
        return { useValue: value } as any;
      }
    }
    return provider;
  }
}
