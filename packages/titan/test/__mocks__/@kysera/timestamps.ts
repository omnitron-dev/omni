/**
 * Mock for @kysera/timestamps package
 *
 * Adds timestamps as ISO strings for SQLite compatibility.
 * SQLite's better-sqlite3 driver only supports primitive types.
 */

export interface TimestampsOptions {
  createdAtColumn?: string;
  updatedAtColumn?: string;
  dateFormat?: 'iso' | 'unix' | 'date';
}

export function withTimestamps(_config?: any) {
  return function withTimestampsDecorator(target: any) {
    return target;
  };
}

export class TimestampsPlugin {
  name = 'timestamps';

  constructor(private options: TimestampsOptions = {}) {}

  // Wrap create and update methods to add timestamps as ISO strings
  extendRepository = (repository: any): any => {
    // Check if repository has the expected structure
    if (!repository || !('tableName' in repository)) {
      return repository;
    }

    const createdAtColumn = this.options.createdAtColumn || 'created_at';
    const updatedAtColumn = this.options.updatedAtColumn || 'updated_at';

    // Get timestamp as ISO string
    const getTimestamp = () => new Date().toISOString();

    // Check if create method exists before binding
    if (typeof repository.create !== 'function') {
      return repository;
    }

    // Bind original methods
    const originalCreate = repository.create.bind(repository);
    const originalUpdate = typeof repository.update === 'function' ? repository.update.bind(repository) : undefined;

    // Return new object with wrapped methods and timestamp utilities
    return {
      ...repository,
      async create(data: any) {
        const timestamp = getTimestamp();
        const dataWithTimestamps = {
          ...data,
          [createdAtColumn]: data[createdAtColumn] ?? timestamp,
          [updatedAtColumn]: data[updatedAtColumn] ?? timestamp,
        };
        return originalCreate(dataWithTimestamps);
      },
      ...(originalUpdate && {
        async update(id: any, data: any) {
          const timestamp = getTimestamp();
          const dataWithTimestamp = {
            ...data,
            [updatedAtColumn]: data[updatedAtColumn] ?? timestamp,
          };
          return originalUpdate(id, dataWithTimestamp);
        },
      }),
      // Utility methods for timestamp-based queries
      async findRecentlyCreated(limit = 10): Promise<any[]> {
        const executor = repository.executor;
        if (!executor) return [];
        return executor
          .selectFrom(repository.tableName)
          .selectAll()
          .orderBy(createdAtColumn, 'desc')
          .limit(limit)
          .execute();
      },
      async findRecentlyUpdated(limit = 10): Promise<any[]> {
        const executor = repository.executor;
        if (!executor) return [];
        return executor
          .selectFrom(repository.tableName)
          .selectAll()
          .orderBy(updatedAtColumn, 'desc')
          .limit(limit)
          .execute();
      },
      async touch(id: any): Promise<any> {
        const timestamp = getTimestamp();
        const executor = repository.executor;
        if (!executor) return null;
        return executor
          .updateTable(repository.tableName)
          .set({ [updatedAtColumn]: timestamp } as any)
          .where('id', '=', id)
          .returningAll()
          .executeTakeFirst();
      },
    };
  };

  transformQuery(args: any) {
    return args.node;
  }

  async transformResult(args: any) {
    return args;
  }
}

/**
 * Factory function to create TimestampsPlugin instance
 */
export function timestampsPlugin(options?: TimestampsOptions): TimestampsPlugin {
  return new TimestampsPlugin(options);
}

// Default export for compatibility
export default {
  withTimestamps,
  TimestampsPlugin,
  timestampsPlugin,
};
