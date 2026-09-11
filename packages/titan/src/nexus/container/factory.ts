/**
 * Factory creation logic for Nexus DI Container
 *
 * Creates factory functions from provider definitions for dependency instantiation.
 *
 * @internal
 * @since 0.1.0
 */

import { DependencyNotFoundError } from '../errors.js';
import { Errors } from '../../errors/index.js';
import { InjectionToken, ProviderDefinition, ResolutionContext, ConditionalProviderWithWhen } from '../types.js';
import type { ContainerStore } from './store.js';

/**
 * FactoryService handles creation of factory functions from providers.
 *
 * NX-9: the container's recursive `resolve` (needed for `useToken`/`useExisting`
 * alias providers) is read from the injected {@link ContainerStore} instead of a
 * per-call `resolveFn` argument.
 */
export class FactoryService {
  constructor(private readonly store: ContainerStore) {}

  /**
   * Create a factory function from a provider
   */
  createFactory(
    token: InjectionToken<any>,
    provider: ProviderDefinition<any>,
    context: ResolutionContext
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
            const fallbackFactory = this.createFactory(token, conditionalProvider.fallback, context);
            return fallbackFactory();
          }
          throw error;
        }

        if (conditionalProvider.fallback) {
          const fallbackFactory = this.createFactory(token, conditionalProvider.fallback, context);
          return fallbackFactory();
        }
        throw new DependencyNotFoundError(token);
      };
    }

    if ('useFactory' in provider && provider.useFactory) {
      return provider.useFactory;
    }

    if ('useToken' in provider && provider.useToken) {
      return this.createAliasFactory(provider.useToken);
    }

    // Handle useExisting (NestJS-style alias provider)
    if ('useExisting' in provider && provider.useExisting) {
      return this.createAliasFactory(provider.useExisting as InjectionToken<any>);
    }

    throw Errors.badRequest('Unable to create factory from provider for token ' + String(token));
  }

  /**
   * An alias (`useToken` / `useExisting`) resolves whatever its target
   * resolves to — including the target's SYNCHRONY.
   *
   * This used to be `() => this.store.resolve(aliasToken)` unconditionally,
   * so an alias to an async provider forced a synchronous resolution from
   * inside an asynchronous one. It did not look like a failure: the sync path
   * returned the un-settled Promise, the consumer stored it, and the first
   * query through it threw somewhere else entirely. Downstream hit this as
   * `[TransactionAwareRepository] executor has no selectFrom` on every org
   * audit write in main's delivery module, via `ORG_PGP_KEY_SERVICE` — a
   * `useExisting` alias the scheduler resolves.
   *
   * Returning the promise is correct here: `resolveAsyncInternalCreate`
   * awaits the factory's result for an async registration, and
   * `createRegistration` marks an alias to an async target async, so the
   * sync path refuses it instead of unwrapping nothing.
   */
  private createAliasFactory(aliasToken: InjectionToken<any>): () => any {
    return () => {
      const target = this.store.getRegistration(aliasToken);
      if (target?.isAsync) {
        return this.store.resolveAsyncInternal(aliasToken);
      }
      return this.store.resolve(aliasToken);
    };
  }
}
