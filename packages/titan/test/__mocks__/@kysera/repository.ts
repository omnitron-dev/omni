/**
 * Mock for @kysera/repository package
 */

export function repository(_config: any) {
  return function repositoryDecorator(target: any) {
    return target;
  };
}

export class BaseRepository {
  constructor(
    protected db: any,
    protected config: any
  ) {}
}

/**
 * Context-aware repository that supports executor switching for transactions
 */
export abstract class ContextAwareRepository<_DB, Table extends string> {
  public readonly tableName: string;

  constructor(
    protected executor: any,
    config: { tableName: Table } | Table
  ) {
    // Handle both object form { tableName: 'users' } and string form 'users'
    this.tableName = typeof config === 'object' && config !== null ? config.tableName : config;
  }

  /**
   * Get the current executor (db or transaction)
   */
  protected get db(): any {
    return this.executor;
  }

  /**
   * Create a new repository instance with the given executor
   */
  withExecutor(executor: any): this {
    const Constructor = this.constructor as new (executor: any, tableName: Table) => this;
    return new Constructor(executor, this.tableName);
  }

  /**
   * Find one record by criteria
   */
  async findOneBy(criteria: Record<string, any>): Promise<any | null> {
    return null;
  }

  /**
   * Find many records by criteria
   */
  async findManyBy(criteria: Record<string, any>, options?: { limit?: number; offset?: number }): Promise<any[]> {
    return [];
  }
}

/**
 * Check if value is a Kysera executor (Kysely or Transaction)
 */
export function isKyseraExecutor(value: unknown): boolean {
  return value !== null && typeof value === 'object' && 'selectFrom' in value;
}

/**
 * Upsert helper function
 */
export async function upsert<DB, TB extends keyof DB, O>(
  executor: any,
  tableName: TB,
  data: any,
  conflictColumns: string[]
): Promise<O> {
  // Mock implementation - just return the data
  return data as O;
}

/**
 * Upsert many records
 */
export async function upsertMany<DB, TB extends keyof DB, O>(
  executor: any,
  tableName: TB,
  data: any[],
  conflictColumns: string[]
): Promise<O[]> {
  // Mock implementation - just return the data array
  return data as O[];
}

/**
 * Atomic status transition
 */
export async function atomicStatusTransition<DB, TB extends keyof DB, O>(
  executor: any,
  tableName: TB,
  id: any,
  fromStatus: string,
  toStatus: string,
  statusColumn: string = 'status'
): Promise<O | null> {
  // Mock implementation
  return null;
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

// ============================================================================
// Operators (from @kysera/repository/operators)
// ============================================================================

export const COMPARISON_OPERATORS = ['$eq', '$ne', '$gt', '$gte', '$lt', '$lte'] as const;
export const ARRAY_OPERATORS = ['$in', '$nin'] as const;
export const STRING_OPERATORS = ['$like', '$ilike', '$contains', '$startsWith', '$endsWith'] as const;
export const NULL_OPERATORS = ['$isNull', '$isNotNull'] as const;
export const RANGE_OPERATORS = ['$between'] as const;
export const LOGICAL_OPERATORS = ['$or', '$and'] as const;
export const ALL_OPERATORS = [
  ...COMPARISON_OPERATORS,
  ...ARRAY_OPERATORS,
  ...STRING_OPERATORS,
  ...NULL_OPERATORS,
  ...RANGE_OPERATORS,
  ...LOGICAL_OPERATORS,
] as const;

export type OperatorKey = (typeof ALL_OPERATORS)[number];

export const OPERATOR_TO_SQL: Record<string, string> = {
  $eq: '=',
  $ne: '!=',
  $gt: '>',
  $gte: '>=',
  $lt: '<',
  $lte: '<=',
  $in: 'in',
  $nin: 'not in',
  $like: 'like',
  $ilike: 'ilike',
};

export function isOperatorObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function isValidOperator(key: string): key is OperatorKey {
  return (ALL_OPERATORS as readonly string[]).includes(key);
}

export function isLogicalOperator(key: string): key is '$or' | '$and' {
  return key === '$or' || key === '$and';
}

export class InvalidOperatorError extends Error {
  constructor(operator: string) {
    super(`Invalid operator: ${operator}`);
    this.name = 'InvalidOperatorError';
  }
}

export function applyCondition<DB, TB extends keyof DB>(qb: any, column: string, condition: unknown): any {
  if (condition === null || condition === undefined) {
    return qb.where(column, 'is', null);
  }
  if (typeof condition !== 'object' || Array.isArray(condition)) {
    return qb.where(column, '=', condition);
  }
  // Operator object
  let result = qb;
  for (const [op, val] of Object.entries(condition as Record<string, unknown>)) {
    const sqlOp = OPERATOR_TO_SQL[op];
    if (sqlOp) {
      result = result.where(column, sqlOp, val);
    } else if (op === '$isNull') {
      result = val ? result.where(column, 'is', null) : result.where(column, 'is not', null);
    } else if (op === '$isNotNull') {
      result = val ? result.where(column, 'is not', null) : result.where(column, 'is', null);
    } else if (op === '$between') {
      const [min, max] = val as [unknown, unknown];
      result = result.where(column, '>=', min).where(column, '<=', max);
    } else if (op === '$contains') {
      result = result.where(column, 'like', `%${val}%`);
    } else if (op === '$startsWith') {
      result = result.where(column, 'like', `${val}%`);
    } else if (op === '$endsWith') {
      result = result.where(column, 'like', `%${val}`);
    }
  }
  return result;
}

export function applyWhereClause<DB, TB extends keyof DB>(qb: any, where: Record<string, unknown>): any {
  let result = qb;
  for (const [key, value] of Object.entries(where)) {
    if (key === '$or') {
      const conditions = value as Record<string, unknown>[];
      result = result.where((eb: any) =>
        eb.or(
          conditions.map((cond: Record<string, unknown>) => {
            let subQ = eb;
            for (const [col, val] of Object.entries(cond)) {
              subQ = applyCondition(subQ, col, val);
            }
            return subQ;
          })
        )
      );
    } else if (key === '$and') {
      const conditions = value as Record<string, unknown>[];
      for (const cond of conditions) {
        result = applyWhereClause(result, cond);
      }
    } else {
      result = applyCondition(result, key, value);
    }
  }
  return result;
}

export function hasOperators(where: Record<string, unknown>): boolean {
  return Object.keys(where).some((key) => key.startsWith('$'));
}

export function validateOperators(where: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(where)) {
    if (key.startsWith('$') && !isValidOperator(key) && !isLogicalOperator(key)) {
      throw new InvalidOperatorError(key);
    }
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      for (const subKey of Object.keys(value as Record<string, unknown>)) {
        if (subKey.startsWith('$') && !isValidOperator(subKey)) {
          throw new InvalidOperatorError(subKey);
        }
      }
    }
  }
}

export function extractColumns(where: Record<string, unknown>): string[] {
  const columns: string[] = [];
  for (const key of Object.keys(where)) {
    if (!key.startsWith('$')) {
      columns.push(key);
    }
  }
  return columns;
}

// ============================================================================
// Column Validation (from @kysera/repository/column-validation)
// ============================================================================

export interface ColumnValidationOptions {
  allowedColumns?: ReadonlySet<string>;
  throwOnInvalid?: boolean;
}

export function validateColumnNames(
  columns: string[],
  allowedColumns: ReadonlySet<string>,
  _options?: ColumnValidationOptions
): string[] {
  return columns.filter((col) => allowedColumns.has(col));
}

export function getAllowedColumnsFromPkConfig(pkConfig: any): ReadonlySet<string> {
  if (!pkConfig) return new Set<string>();
  const columns =
    typeof pkConfig === 'string' ? [pkConfig] : Array.isArray(pkConfig) ? pkConfig : [pkConfig.column || 'id'];
  return new Set(columns);
}

export function validateConditions(conditions: Record<string, unknown>, allowedColumns: ReadonlySet<string>): void {
  for (const key of Object.keys(conditions)) {
    if (!key.startsWith('$') && !allowedColumns.has(key)) {
      throw new Error(`Invalid column: ${key}`);
    }
  }
}

// ============================================================================
// Primary Key Utils (from @kysera/repository/primary-key-utils)
// ============================================================================

export function extractPrimaryKey<T = unknown>(entity: T, pkColumn: string | string[] = 'id'): any {
  if (!entity || typeof entity !== 'object') return undefined;
  if (typeof pkColumn === 'string') {
    return (entity as any)[pkColumn];
  }
  const result: Record<string, any> = {};
  for (const col of pkColumn) {
    result[col] = (entity as any)[col];
  }
  return result;
}

// ============================================================================
// Re-exports from @kysera/executor (for convenience)
// ============================================================================

export class PluginValidationError extends Error {
  constructor(
    message: string,
    public type: string,
    public details: unknown
  ) {
    super(message);
    this.name = 'PluginValidationError';
  }
}

export function validatePlugins(plugins: readonly any[]): void {
  // Mock - no-op
}

export function resolvePluginOrder(plugins: readonly any[]): any[] {
  return [...plugins];
}

// Default export for compatibility
export default {
  repository,
  BaseRepository,
  ContextAwareRepository,
  isKyseraExecutor,
  upsert,
  upsertMany,
  atomicStatusTransition,
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
  applyWhereClause,
  applyCondition,
  isOperatorObject,
  isValidOperator,
  validateOperators,
  extractColumns,
  InvalidOperatorError,
  validateColumnNames,
  validateConditions,
  getAllowedColumnsFromPkConfig,
  extractPrimaryKey,
};
