/**
 * Mock for @kysera/soft-delete package
 */

export function withSoftDelete(_config?: any) {
  return function withSoftDeleteDecorator(target: any) {
    return target;
  };
}

export interface SoftDeleteOptions {
  deletedAtColumn?: string;
  includeDeleted?: boolean;
  tables?: string[];
}

export class SoftDeletePlugin {
  name = 'soft-delete';
  extendRepository: (repository: any) => any;

  constructor(private options: SoftDeleteOptions = {}) {
    const column = this.options.deletedAtColumn || 'deleted_at';
    const includeDeleted = this.options.includeDeleted || false;

    // Define extendRepository as an own property so it survives object spread
    this.extendRepository = (repository: any): any => {
      // Store original methods
      const originalFindById = repository.findById?.bind(repository);
      const originalFindOne = repository.findOne?.bind(repository);
      const originalFindAll = repository.findAll?.bind(repository);
      const originalFindMany = repository.findMany?.bind(repository);

      // Add soft delete methods to repository
      return {
        ...repository,
        // Override findById to filter soft-deleted records
        findById: async (id: any) => {
          if (!originalFindById) {
            return null;
          }

          const entity = await originalFindById(id);
          if (!entity) {
            return null;
          }

          // Filter out soft-deleted records unless includeDeleted is true
          if (!includeDeleted && entity[column] != null) {
            return null;
          }

          return entity;
        },

        // Override findOne to filter soft-deleted records
        findOne: async (conditions: any) => {
          if (!originalFindOne) {
            return null;
          }

          const entity = await originalFindOne(conditions);
          if (!entity) {
            return null;
          }

          // Filter out soft-deleted records unless includeDeleted is true
          if (!includeDeleted && entity[column] != null) {
            return null;
          }

          return entity;
        },

        // Override findAll to filter soft-deleted records
        findAll: async (options: any = {}) => {
          if (!originalFindAll) {
            return [];
          }

          const entities = await originalFindAll(options);

          // Filter out soft-deleted records unless includeDeleted is true
          if (includeDeleted) {
            return entities;
          }

          return entities.filter((entity: any) => entity[column] == null);
        },

        // Override findMany to filter soft-deleted records
        findMany: async (conditions: any) => {
          if (!originalFindMany) {
            return [];
          }

          const entities = await originalFindMany(conditions);

          // Filter out soft-deleted records unless includeDeleted is true
          if (includeDeleted) {
            return entities;
          }

          return entities.filter((entity: any) => entity[column] == null);
        },

        softDelete: async (id: any) => {
          // Actually update the database to set deleted_at
          const tableName = repository.tableName || repository.config?.tableName;
          if (!tableName) {
            throw new Error('Cannot perform softDelete: tableName not found on repository');
          }

          const db = repository.db || repository.qb || repository.executor;
          if (!db) {
            throw new Error('Cannot perform softDelete: database connection not found on repository');
          }

          await db
            .updateTable(tableName)
            .set({ [column]: new Date().toISOString() })
            .where('id', '=', id)
            .execute();

          return { id, [column]: new Date() };
        },
        restore: async (id: any) => {
          const tableName = repository.tableName || repository.config?.tableName;
          const db = repository.db || repository.qb || repository.executor;

          await db
            .updateTable(tableName)
            .set({ [column]: null })
            .where('id', '=', id)
            .execute();

          return { id, [column]: null };
        },
        hardDelete: async (id: any) => repository.delete(id),
        findWithDeleted: async () => [],
        findDeleted: async () => [],
      };
    };

    // Store options for use in transformQuery
    this.options = { ...options, deletedAtColumn: column, includeDeleted };
  }

  transformQuery(args: any) {
    // Filter out soft-deleted records unless includeDeleted is true
    if (this.options.includeDeleted) {
      return args.node;
    }

    const column = this.options.deletedAtColumn || 'deleted_at';

    // Add WHERE deleted_at IS NULL to queries
    // This is a simplified implementation - a real plugin would inspect the query node
    if (args.node && typeof args.node.where === 'function') {
      return args.node.where(column, 'is', null);
    }

    return args.node;
  }

  async transformResult(args: any) {
    return args;
  }
}

/**
 * Factory function to create SoftDeletePlugin instance
 * This is the primary export used by repository.factory.ts and plugin.manager.ts
 */
export function softDeletePlugin(options?: SoftDeleteOptions): SoftDeletePlugin {
  return new SoftDeletePlugin(options);
}

// Default export for compatibility
export default {
  withSoftDelete,
  SoftDeletePlugin,
  softDeletePlugin,
};
