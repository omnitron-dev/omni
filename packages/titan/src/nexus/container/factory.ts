/**
 * Factory creation logic for Nexus DI Container
 */

import {
  DependencyNotFoundError,
} from '../errors.js';
import { Errors } from '../../errors/index.js';
import {
  InjectionToken,
  ProviderDefinition,
  ResolutionContext,
  ConditionalProviderWithWhen,
  Constructor,
} from '../types.js';

/**
 * FactoryService handles creation of factory functions from providers
 */
export class FactoryService {
  /**
   * Create a factory function from a provider
   */
  createFactory(
    token: InjectionToken<any>,
    provider: ProviderDefinition<any>,
    context: ResolutionContext,
    resolveFn: <T>(token: InjectionToken<T>) => T
  ): (...args: any[]) => any {
    if ('useValue' in provider) {
      return () => provider.useValue;
    }

    if ('useClass' in provider && provider.useClass) {
      const ClassConstructor = provider.useClass;
      return (...args: any[]) => new ClassConstructor(...args);
    }

    if ('when' in provider && 'useFactory' in provider) {
      const conditionalProvider = provider as ConditionalProviderWithWhen<unknown>;
      return () => {
        try {
          const conditionResult = conditionalProvider.when(context);
          if (conditionResult) {
            // ConditionalProvider always expects context
            return conditionalProvider.useFactory(context);
          }
        } catch (error) {
          // If condition evaluation fails, try fallback
          if (conditionalProvider.fallback) {
            const fallbackFactory = this.createFactory(token, conditionalProvider.fallback, context, resolveFn);
            return fallbackFactory();
          }
          throw error;
        }

        if (conditionalProvider.fallback) {
          const fallbackFactory = this.createFactory(token, conditionalProvider.fallback, context, resolveFn);
          return fallbackFactory();
        }
        throw new DependencyNotFoundError(token);
      };
    }

    if ('useFactory' in provider && provider.useFactory) {
      return provider.useFactory;
    }

    if ('useToken' in provider && provider.useToken) {
      const aliasToken = provider.useToken;
      return () => resolveFn(aliasToken);
    }

    // Handle useExisting (NestJS-style alias provider)
    if ('useExisting' in provider && provider.useExisting) {
      const aliasToken = provider.useExisting as InjectionToken<any>;
      return () => resolveFn(aliasToken);
    }

    throw Errors.badRequest('Unable to create factory from provider for token ' + String(token));
  }
}
