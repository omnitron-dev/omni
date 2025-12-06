/**
 * Mock for @kysera/repository package
 */

export function repository(config: any) {
  return function (target: any) {
    return target;
  };
}

export class BaseRepository {
  constructor(protected db: any, protected config: any) {}
}

/**
 * Plugin interface
 */
export interface Plugin {
  name?: string;
  transformQuery?: (args: any) => any;
  transformResult?: (args: any) => Promise<any>;
}

/**
 * Creates a repository factory
 * Returns an object with a `create` method (for Kysera compatibility)
 */
export function createRepositoryFactory(executor: any) {
  return {
    create: (config: any) => new BaseRepository(executor, config),
    createRepository: (config: any) => new BaseRepository(executor, config),
    getExecutor: () => executor,
  };
}

/**
 * Creates repositories factory (batch)
 */
export function createRepositoriesFactory(factories: Record<string, any>) {
  return (executor: any) => {
    const repos: Record<string, any> = {};
    for (const [name, factory] of Object.entries(factories)) {
      repos[name] = factory(executor);
    }
    return repos;
  };
}

/**
 * Creates ORM with plugins
 */
export async function createORM(db: any, plugins: Plugin[] = []) {
  return {
    db,
    plugins,
    createRepository: (config: any) => new BaseRepository(db, config),
  };
}

/**
 * Creates a simple repository
 */
export function createSimpleRepository(executor: any, tableName: string) {
  return new BaseRepository(executor, { tableName });
}

/**
 * Creates base repository
 */
export function createBaseRepository(executor: any, config: any) {
  return new BaseRepository(executor, config);
}

/**
 * Creates table operations
 */
export function createTableOperations(executor: any, tableName: string) {
  return {
    findById: async (id: any) => null,
    findAll: async () => [],
    create: async (data: any) => data,
    update: async (id: any, data: any) => data,
    delete: async (id: any) => true,
  };
}

/**
 * Creates validator
 */
export function createValidator(schema: any) {
  return {
    validate: (data: any) => ({ success: true, data }),
    safeParse: (data: any) => ({ success: true, data }),
  };
}

/**
 * With plugins helper
 */
export function withPlugins(repository: any, plugins: Plugin[]) {
  return repository;
}

// Validation utilities
export type ValidationOptions = {
  mode?: 'always' | 'never' | 'development' | 'production';
};

export function getValidationMode(): 'development' {
  return 'development';
}

export function shouldValidate(_options?: ValidationOptions): boolean {
  return true;
}

export function safeParse<T>(schema: unknown, data: unknown, _options?: unknown): T | null {
  return data as T;
}

// Plugin ORM types
export interface PluginOrm<DB> {
  executor: DB;
  createRepository: <T extends object>(factory: unknown) => T;
  applyPlugins: (plugins: string[]) => void;
  plugins: Plugin[];
}

export interface QueryBuilderContext {
  operation: 'select' | 'insert' | 'update' | 'delete';
  table: string;
  metadata: Record<string, unknown>;
}

export interface QueryContext extends QueryBuilderContext {
  sql: string;
  params: unknown[];
}

// Repository types
export interface Repository<Entity> {
  tableName: string;
  executor: unknown;
  findById(id: number): Promise<Entity | null>;
  findAll(): Promise<Entity[]>;
  create(data: unknown): Promise<Entity>;
  update(id: number, data: unknown): Promise<Entity>;
  delete(id: number): Promise<boolean>;
}

export interface RepositoryConfig<Table = unknown, Entity = unknown> {
  tableName: string;
  mapRow?: (row: Table) => Entity;
  schemas?: {
    entity?: unknown;
    create?: unknown;
    update?: unknown;
  };
  validateDbResults?: boolean;
  validationStrategy?: 'none' | 'strict';
}

export interface TableOperations<Table = unknown> {
  selectAll(): Promise<Table[]>;
  selectById(id: number): Promise<Table | undefined>;
  insert(data: unknown): Promise<Table>;
  updateById(id: number, data: unknown): Promise<Table | undefined>;
  deleteById(id: number): Promise<boolean>;
}

// Default export for compatibility
export default {
  repository,
  BaseRepository,
  createRepositoryFactory,
  createRepositoriesFactory,
  createORM,
  createSimpleRepository,
  createBaseRepository,
  createTableOperations,
  createValidator,
  withPlugins,
  getValidationMode,
  shouldValidate,
  safeParse,
};
