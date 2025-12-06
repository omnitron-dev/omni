/**
 * Mock for @kysera/timestamps package
 */

export interface TimestampsOptions {
  createdAtColumn?: string;
  updatedAtColumn?: string;
}

export function withTimestamps(config?: any) {
  return function (target: any) {
    return target;
  };
}

export class TimestampsPlugin {
  name = 'timestamps';
  extendRepository: (repository: any) => any;

  constructor(private options: TimestampsOptions = {}) {
    const createdAt = this.options.createdAtColumn || 'created_at';
    const updatedAt = this.options.updatedAtColumn || 'updated_at';

    // Define extendRepository as an own property so it survives object spread
    this.extendRepository = (repository: any): any => {
      return {
        ...repository,
        // Timestamp methods are typically handled via query transformation
        // but we expose them for compatibility
        setCreatedAt: (entity: any) => ({ ...entity, [createdAt]: new Date() }),
        setUpdatedAt: (entity: any) => ({ ...entity, [updatedAt]: new Date() }),
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
 * Factory function to create TimestampsPlugin instance
 * This is the primary export used by repository.factory.ts and plugin.manager.ts
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
