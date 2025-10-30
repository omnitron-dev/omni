/**
 * Internal type definitions for the database module
 *
 * This file contains types used internally within the database module
 * to ensure type safety and eliminate the use of 'any' types.
 */

import type { Kysely, Transaction, SelectQueryBuilder, InsertQueryBuilder, UpdateQueryBuilder, DeleteQueryBuilder } from 'kysely';
import type { RepositoryConfig } from './repository/repository.types.js';

/**
 * Logger interface for consistent logging across the module
 */
export interface Logger {
  info(...args: unknown[]): void;
  error(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  debug(...args: unknown[]): void;
  trace(...args: unknown[]): void;
  fatal(...args: unknown[]): void;
}

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
  return error instanceof Error && (
    'code' in error ||
    'sqlState' in error ||
    'errno' in error
  );
}

/**
 * Type guard for transaction
 */
export function isTransaction(db: Kysely<unknown> | Transaction<unknown>): db is Transaction<unknown> {
  return 'isTransaction' in db && (db as any).isTransaction === true;
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
    typeof (value as any).name === 'string'
  );
}