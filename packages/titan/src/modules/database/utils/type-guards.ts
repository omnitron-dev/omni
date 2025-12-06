/**
 * Type Guards for Database Module
 *
 * Runtime type checking utilities for type safety
 */

import type { Transaction, Kysely } from 'kysely';
import type {
  DatabaseConnection,
  DatabaseDialect,
  PaginatedResult,
  ConnectionConfig
} from '../database.types.js';
import type { TransactionContext, TransactionState } from '../transaction/transaction.types.js';
import { Errors } from '../../../errors/index.js';

/**
 * Check if value is a valid database dialect
 */
export function isDatabaseDialect(value: unknown): value is DatabaseDialect {
  return typeof value === 'string' && ['postgres', 'mysql', 'sqlite'].includes(value);
}

/**
 * Check if value is a Kysely transaction
 */
export function isTransaction<T>(value: Kysely<T> | Transaction<T>): value is Transaction<T> {
  return 'isTransaction' in value && value.isTransaction === true;
}

/**
 * Check if value is a database connection config
 */
export function isDatabaseConnection(value: unknown): value is DatabaseConnection {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const conn = value as Record<string, unknown>;

  return (
    isDatabaseDialect(conn['dialect']) &&
    (typeof conn['connection'] === 'string' || isConnectionConfig(conn['connection']))
  );
}

/**
 * Check if value is a connection config object
 */
export function isConnectionConfig(value: unknown): value is ConnectionConfig {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const config = value as Record<string, unknown>;

  return typeof config['database'] === 'string';
}

/**
 * Check if value is a paginated result
 */
export function isPaginatedResult<T>(value: unknown): value is PaginatedResult<T> {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const result = value as Record<string, unknown>;

  return (
    Array.isArray(result['data']) &&
    typeof result['pagination'] === 'object' &&
    result['pagination'] !== null
  );
}

/**
 * Check if value is a transaction context
 */
export function isTransactionContext(value: unknown): value is TransactionContext {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const ctx = value as Record<string, unknown>;

  return (
    typeof ctx['id'] === 'string' &&
    typeof ctx['connection'] === 'string' &&
    ctx['startedAt'] instanceof Date &&
    isTransactionState(ctx['state'])
  );
}

/**
 * Check if value is a valid transaction state
 */
export function isTransactionState(value: unknown): value is TransactionState {
  if (typeof value !== 'string') {
    return false;
  }

  return [
    'ACTIVE',
    'COMMITTING',
    'COMMITTED',
    'ROLLING_BACK',
    'ROLLED_BACK',
    'FAILED'
  ].includes(value);
}

/**
 * Check if error is a database deadlock error
 */
export function isDeadlockError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const err = error as Record<string, unknown>;
  const message = (err['message'] as string)?.toLowerCase() || '';
  const code = err['code'];

  return (
    message.includes('deadlock') ||
    message.includes('lock wait timeout') ||
    code === '40P01' || // PostgreSQL deadlock
    code === '1213' ||  // MySQL deadlock
    code === '40001'    // MySQL deadlock alternative
  );
}

/**
 * Check if value is a record (plain object)
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Type guard to assert value is not null or undefined
 */
export function isDefined<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined;
}

/**
 * Check if value is a valid entity ID
 */
export function isValidId(value: unknown): value is number | string {
  return typeof value === 'number' || typeof value === 'string';
}

/**
 * Check if object has a specific property with type checking
 */
export function hasProperty<T extends string>(
  obj: unknown,
  prop: T
): obj is Record<T, unknown> {
  return isRecord(obj) && prop in obj;
}

/**
 * Check if value is a constructor function
 */
export function isConstructor(value: unknown): value is new (...args: unknown[]) => unknown {
  return typeof value === 'function';
}

/**
 * Type predicate to check if error is an Error instance
 */
export function isError(error: unknown): error is Error {
  return error instanceof Error;
}

/**
 * Check if value is a valid database row
 */
export function isDatabaseRow(value: unknown): value is Record<string, unknown> {
  return isRecord(value);
}

/**
 * Assert that value is defined, throwing if not
 */
export function assertDefined<T>(
  value: T | null | undefined,
  message = 'Value must be defined'
): asserts value is T {
  if (!isDefined(value)) {
    throw Errors.badRequest(message);
  }
}

/**
 * Assert that value is a valid ID
 */
export function assertValidId(
  value: unknown,
  message = 'Invalid ID: must be a number or string'
): asserts value is number | string {
  if (!isValidId(value)) {
    throw Errors.badRequest(message);
  }
}

/**
 * Assert that value is a record
 */
export function assertRecord(
  value: unknown,
  message = 'Value must be a plain object'
): asserts value is Record<string, unknown> {
  if (!isRecord(value)) {
    throw Errors.badRequest(message);
  }
}
