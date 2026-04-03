/**
 * Internal type definitions for the database module
 *
 * This file contains types used internally within the database module
 * to ensure type safety and eliminate the use of 'any' types.
 */

import type {
  Kysely,
  Transaction,
  SelectQueryBuilder,
  InsertQueryBuilder,
  UpdateQueryBuilder,
  DeleteQueryBuilder,
} from 'kysely';
import type { RepositoryConfig } from './database.types.js';

// Re-export ILogger from centralized logger module for backward compatibility
export type { ILogger as Logger } from '@omnitron-dev/titan/module/logger';

/**
 * Repository constructor type
 */
export type RepositoryConstructor<T = unknown> = new (
  db: Kysely<unknown> | Transaction<unknown>,
  config: RepositoryConfig
) => T;

/**
 * Module exports from dynamic imports
 */
export type ModuleExports = Record<string, unknown>;

/**
 * Parsed database connection configuration
 */
export interface ParsedConnectionConfig {
  // Common properties
  database: string;

  // Network database properties (PostgreSQL, MySQL)
  host?: string;
  port?: number;
  user?: string;
  password?: string;
  ssl?: boolean | Record<string, unknown>;

  // Additional PostgreSQL specific
  searchPath?: string;

  // Additional MySQL specific
  charset?: string;
  timezone?: string;
}

/**
 * Database query types
 */
export type AnyQueryBuilder =
  | SelectQueryBuilder<any, any, any>
  | InsertQueryBuilder<any, any, any>
  | UpdateQueryBuilder<any, any, any, any>
  | DeleteQueryBuilder<any, any, any>;

/**
 * Event listener type
 */
export type EventListener<T = unknown> = (data: T) => void | Promise<void>;

/**
 * Migration class type
 */
export type MigrationClass = new () => {
  up(db: Kysely<unknown>): Promise<void>;
  down(db: Kysely<unknown>): Promise<void>;
};

/**
 * Database error with additional properties
 */
export interface DatabaseError extends Error {
  code?: string;
  sqlState?: string;
  errno?: number;
  constraint?: string;
  table?: string;
  column?: string;
  detail?: string;
  hint?: string;
}

/**
 * Plugin instance type
 */
export interface PluginInstance {
  name: string;
  beforeQuery?: (context: unknown) => void | Promise<void>;
  afterQuery?: (context: unknown) => void | Promise<void>;
  transformResult?: (result: unknown) => unknown;
  onError?: (error: Error) => void | Error;
}

/**
 * Seed data types
 */
export type SeedData = Record<string, unknown>;
export type SeedFunction = () => Promise<void>;
export type Seeds = SeedData[] | SeedFunction;

/**
 * Connection pool types
 */
export interface PoolInstance {
  end?: () => Promise<void>;
  destroy?: () => void;
  close?: () => void;
  release?: () => void;
}

/**
 * Type guard for database error
 */
export function isDatabaseError(error: unknown): error is DatabaseError {
  return error instanceof Error && ('code' in error || 'sqlState' in error || 'errno' in error);
}

/**
 * Type guard for transaction
 */
export function isTransaction(db: Kysely<unknown> | Transaction<unknown>): db is Transaction<unknown> {
  return 'isTransaction' in db && (db as { isTransaction?: boolean }).isTransaction === true;
}

/**
 * Type guard for migration class
 */
export function isMigrationClass(value: unknown): value is MigrationClass {
  return (
    typeof value === 'function' &&
    value.prototype &&
    typeof value.prototype.up === 'function' &&
    typeof value.prototype.down === 'function'
  );
}

/**
 * Type guard for repository constructor
 */
export function isRepositoryConstructor(value: unknown): value is RepositoryConstructor {
  return typeof value === 'function' && value.prototype;
}

/**
 * Type guard for plugin instance
 */
export function isPluginInstance(value: unknown): value is PluginInstance {
  return (
    typeof value === 'object' &&
    value !== null &&
    'name' in value &&
    typeof (value as { name: unknown }).name === 'string'
  );
}

/**
 * Error object with optional error code properties.
 * Used for type-safe error code access in deadlock detection.
 */
export interface ErrorWithCode extends Error {
  code?: string;
  errno?: number;
}

/**
 * Type guard for error with code property
 */
export function isErrorWithCode(error: unknown): error is ErrorWithCode {
  return error instanceof Error;
}

/**
 * Type-safe access to error code properties
 */
export function getErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') {
    return undefined;
  }
  const err = error as Record<string, unknown>;
  if (typeof err['code'] === 'string') {
    return err['code'];
  }
  if (typeof err['errno'] === 'number') {
    return String(err['errno']);
  }
  return undefined;
}

/**
 * Expression builder function type for Kysely select operations.
 * This provides type safety for count and exists aggregations.
 */
export interface ExpressionBuilderFn {
  fn: {
    count<C extends string>(column: C): { as<A extends string>(alias: A): unknown };
  };
  lit<V>(value: V): { as<A extends string>(alias: A): unknown };
}

/**
 * Generic table query interface for dynamic table access.
 * This enables type-safe dynamic table operations without `as any` casts.
 */
export interface DynamicTableQuery {
  selectFrom(table: string): DynamicSelectQuery;
}

/**
 * Dynamic select query builder interface
 */
export interface DynamicSelectQuery {
  selectAll(): DynamicSelectQuery;
  select(fn: (eb: ExpressionBuilderFn) => unknown): DynamicSelectQuery;
  where(column: string, operator: string, value: unknown): DynamicSelectQuery;
  orderBy(column: string, direction?: 'asc' | 'desc'): DynamicSelectQuery;
  limit(limit: number): DynamicSelectQuery;
  offset(offset: number): DynamicSelectQuery;
  execute(): Promise<unknown[]>;
  executeTakeFirst(): Promise<unknown | undefined>;
}
