/**
 * Transaction Scope Provider
 *
 * Provides transaction-scoped repositories and services for dependency injection
 */

import { Injectable } from '../../../decorators/index.js';
import { Transaction } from 'kysely';
import type { IDatabaseManager } from '../database.types.js';
import type { RepositoryFactory } from '../repository/repository.factory.js';
import type { ITransactionScope, TransactionContext } from './transaction.types.js';
import { TransactionManager } from './transaction.manager.js';

/**
 * Transaction scope implementation
 */
@Injectable()
export class TransactionScope implements ITransactionScope {
  private scopedRepositories = new Map<any, any>();
  private scopedServices = new Map<any, any>();

  constructor(
    private transaction: Transaction<any>,
    private context: TransactionContext,
    private repositoryFactory: RepositoryFactory,
    private dbManager: IDatabaseManager
  ) {}

  /**
   * Get repository scoped to current transaction
   */
  getRepository<T>(repositoryClass: any): T {
    // Check if already created for this scope
    if (this.scopedRepositories.has(repositoryClass)) {
      return this.scopedRepositories.get(repositoryClass);
    }

    // Create new repository with transaction
    const metadata = this.repositoryFactory.getMetadata(repositoryClass);
    if (!metadata) {
      throw new Error(`Repository ${repositoryClass.name} not registered`);
    }

    // Create repository with transaction connection
    const repository = this.repositoryFactory.createWithTransaction(
      repositoryClass,
      this.transaction
    );

    // Cache for this scope
    this.scopedRepositories.set(repositoryClass, repository);

    return repository as T;
  }

  /**
   * Get service scoped to current transaction
   */
  getService<T>(serviceClass: any): T {
    // Check if already created for this scope
    if (this.scopedServices.has(serviceClass)) {
      return this.scopedServices.get(serviceClass);
    }

    // Create new service instance
    // This would need integration with Nexus DI to properly inject dependencies
    const service = new serviceClass();

    // Inject transaction-scoped dependencies
    this.injectTransactionDependencies(service);

    // Cache for this scope
    this.scopedServices.set(serviceClass, service);

    return service as T;
  }

  /**
   * Get transaction connection
   */
  getTransaction(): Transaction<any> {
    return this.transaction;
  }

  /**
   * Execute function within this transaction scope
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    // Execute function with current transaction context
    return fn();
  }

  /**
   * Inject transaction-scoped dependencies into service
   */
  private injectTransactionDependencies(service: any): void {
    // Inject transaction manager if property exists
    if ('transactionManager' in service) {
      service.transactionManager = this.createScopedTransactionManager();
    }

    // Inject transaction if property exists
    if ('transaction' in service) {
      service.transaction = this.transaction;
    }

    // Inject transaction context if property exists
    if ('transactionContext' in service) {
      service.transactionContext = this.context;
    }
  }

  /**
   * Create transaction manager that operates within current scope
   */
  private createScopedTransactionManager(): any {
    return {
      getCurrentTransaction: () => this.context,
      getCurrentTransactionConnection: () => this.transaction,
      isInTransaction: () => true,
      getTransactionDepth: () => {
        let depth = 0;
        let ctx: TransactionContext | undefined = this.context;
        while (ctx) {
          depth++;
          ctx = ctx.parent;
        }
        return depth;
      },
      // Other methods would delegate to main transaction manager
    };
  }
}

/**
 * Transaction scope factory
 */
@Injectable()
export class TransactionScopeFactory {
  constructor(
    private repositoryFactory: RepositoryFactory,
    private dbManager: IDatabaseManager,
    private transactionManager: TransactionManager
  ) {}

  /**
   * Create new transaction scope
   */
  createScope(transaction: Transaction<any>, context: TransactionContext): TransactionScope {
    return new TransactionScope(
      transaction,
      context,
      this.repositoryFactory,
      this.dbManager
    );
  }

  /**
   * Execute function with new transaction scope
   */
  async executeInScope<T>(
    fn: (scope: TransactionScope) => Promise<T>,
    options?: any
  ): Promise<T> {
    return this.transactionManager.executeInTransaction(async (trx) => {
      const context = this.transactionManager.getCurrentTransaction();
      if (!context) {
        throw new Error('No transaction context available');
      }

      const scope = this.createScope(trx, context);
      return fn(scope);
    }, options);
  }
}

/**
 * Decorator to inject transaction scope
 */
export function InjectTransactionScope(): ParameterDecorator {
  return (target: any, propertyKey: string | symbol | undefined, parameterIndex: number) => {
    // Store metadata about transaction scope injection
    const existingMetadata = Reflect.getMetadata('transaction:scope', target) || [];
    existingMetadata.push({
      propertyKey,
      parameterIndex,
    });
    Reflect.defineMetadata('transaction:scope', existingMetadata, target);
  };
}

/**
 * Decorator to mark a method as requiring transaction scope
 */
export function RequiresTransactionScope(): MethodDecorator {
  return (target: any, propertyKey: string | symbol, descriptor: PropertyDescriptor) => {
    const originalMethod = descriptor.value;

    descriptor.value = async function (...args: any[]) {
      const transactionManager = (this as any).transactionManager;
      const repositoryFactory = (this as any).repositoryFactory;
      const dbManager = (this as any).dbManager;

      if (!transactionManager) {
        throw new Error(
          `@RequiresTransactionScope requires TransactionManager to be injected in ${target.constructor.name}`
        );
      }

      // Check if already in transaction
      if (transactionManager.isInTransaction()) {
        // Already in transaction, just call method
        return originalMethod.apply(this, args);
      }

      // Create new transaction scope
      return transactionManager.executeInTransaction(async (trx: any) => {
        const context = transactionManager.getCurrentTransaction();
        const scope = new TransactionScope(trx, context, repositoryFactory, dbManager);

        // Inject scope into method arguments if needed
        const scopeMetadata = Reflect.getMetadata('transaction:scope', target) || [];
        for (const { propertyKey: key, parameterIndex } of scopeMetadata) {
          if (key === propertyKey) {
            args[parameterIndex] = scope;
          }
        }

        // Call original method
        return originalMethod.apply(this, args);
      });
    };

    return descriptor;
  };
}