/**
 * Mock for @kysera/soft-delete package
 */

export function withSoftDelete(config?: any) {
  return function (target: any) {
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

    // Define extendRepository as an own property so it survives object spread
    this.extendRepository = (repository: any): any => {
      // Add soft delete methods to repository
      return {
        ...repository,
        softDelete: async (id: any) => {
          return { id, [column]: new Date() };
        },
        restore: async (id: any) => {
          return { id, [column]: null };
        },
        hardDelete: async (id: any) => {
          return true;
        },
        findWithDeleted: async () => {
          return [];
        },
        findDeleted: async () => {
          return [];
        },
      };
    };
  }

  transformQuery(args: any) {
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
