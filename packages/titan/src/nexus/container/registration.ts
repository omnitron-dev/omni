/**
 * Registration logic for Nexus DI Container
 */

import { isToken, isMultiToken, getTokenName, isOptionalToken, createToken } from '../token.js';
import { isConstructor } from '../provider-utils.js';
import {
  InvalidProviderError,
  DuplicateRegistrationError,
} from '../errors.js';
import {
  Scope,
  Provider,
  ProviderDefinition,
  InjectionToken,
  ResolutionContext,
  RegistrationOptions,
  ClassProvider,
  isConfigToken,
  ConfigToken,
  ConditionalProviderWithWhen,
  Constructor,
} from '../types.js';
import type { Registration } from './types.js';
import { DependencyNotFoundError } from '../errors.js';

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
    if (typeof provider === 'function' && provider.prototype) {
      provider = { useClass: provider as Constructor } as ClassProvider;
    }

    // Validate provider
    if (!this.isValidProvider(provider)) {
      throw new InvalidProviderError(token, 'Invalid provider format');
    }

    // Determine scope
    let scope = options.scope || Scope.Transient;
    if ('useValue' in provider) {
      scope = Scope.Singleton; // Values are always singleton
    } else if ('scope' in provider && provider.scope) {
      scope = provider.scope;
    } else if ('useClass' in provider) {
      // Check for scope metadata from decorators
      const scopeMetadata =
        Reflect.getMetadata('nexus:scope', provider.useClass) || Reflect.getMetadata('scope', provider.useClass);
      if (scopeMetadata) {
        scope = scopeMetadata as Scope;
      }
    }

    // Extract dependencies
    let dependencies: InjectionToken<any>[] | undefined;
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
   * Extract dependencies from class metadata
   */
  private extractClassDependencies(classConstructor: Constructor | undefined): InjectionToken<any>[] | undefined {
    if (!classConstructor) return undefined;

    const METADATA_KEYS = {
      INJECT: 'nexus:inject',
      INJECT_PARAMS: 'nexus:inject:params',
      CONSTRUCTOR_PARAMS: 'nexus:constructor-params',
      OPTIONAL: 'nexus:optional',
      PROPERTY_INJECTIONS: 'nexus:property:injections',
    };

    // First try the new decorator metadata (from @Inject decorator)
    const constructorParams = Reflect.getMetadata(METADATA_KEYS.CONSTRUCTOR_PARAMS, classConstructor);
    const optionalMetadata = Reflect.getMetadata(METADATA_KEYS.OPTIONAL, classConstructor) || {};

    if (constructorParams && constructorParams.length > 0) {
      // Use constructor params from @Inject decorator
      return constructorParams.map((dep: any, index: number) => {
        if (optionalMetadata[index]) {
          return { token: dep, optional: true };
        }
        return dep;
      });
    }

    // Fall back to legacy metadata format
    const injectedDependencies = Reflect.getMetadata(METADATA_KEYS.INJECT, classConstructor);
    if (injectedDependencies) {
      // Transform dependencies to include optional flag
      return injectedDependencies.map((dep: any, index: number) => {
        if (optionalMetadata[index]) {
          return { token: dep, optional: true };
        }
        return dep;
      });
    }

    return undefined;
  }

  /**
   * Process config token validation and defaults
   */
  processConfigToken<T>(
    token: InjectionToken<T>,
    provider: ProviderDefinition<T>
  ): ProviderDefinition<T> {
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
