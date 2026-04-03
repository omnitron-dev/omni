/**
 * Type Guards for Database Module
 *
 * Runtime type checking utilities for type safety
 */

import type { Transaction, Kysely } from 'kysely';
import type { DatabaseConnection, DatabaseDialect, PaginatedResult, ConnectionConfig } from '../database.types.js';
import { Errors } from '@omnitron-dev/titan/errors';

/**
 * Transaction state values (inlined — was in transaction.types.ts)
 */
type TransactionState = 'ACTIVE' | 'COMMITTING' | 'COMMITTED' | 'ROLLING_BACK' | 'ROLLED_BACK' | 'FAILED';

/**
 * Transaction context shape (inlined — was in transaction.types.ts)
 */
interface TransactionContext {
  id: string;
  connection: string;
  startedAt: Date;
  state: TransactionState;
}

export function isDatabaseDialect(value: unknown): value is DatabaseDialect {
  return typeof value === 'string' && ['postgres', 'mysql', 'sqlite'].includes(value);
}

export function isTransaction<T>(value: Kysely<T> | Transaction<T>): value is Transaction<T> {
  return 'isTransaction' in value && value.isTransaction === true;
}

export function isDatabaseConnection(value: unknown): value is DatabaseConnection {
  if (typeof value !== 'object' || value === null) return false;
  const conn = value as Record<string, unknown>;
  return isDatabaseDialect(conn['dialect']) && (typeof conn['connection'] === 'string' || isConnectionConfig(conn['connection']));
}

export function isConnectionConfig(value: unknown): value is ConnectionConfig {
  if (typeof value !== 'object' || value === null) return false;
  return typeof (value as Record<string, unknown>)['database'] === 'string';
}

export function isPaginatedResult<T>(value: unknown): value is PaginatedResult<T> {
  if (typeof value !== 'object' || value === null) return false;
  const result = value as Record<string, unknown>;
  return Array.isArray(result['data']) && typeof result['pagination'] === 'object' && result['pagination'] !== null;
}

export function isTransactionContext(value: unknown): value is TransactionContext {
  if (typeof value !== 'object' || value === null) return false;
  const ctx = value as Record<string, unknown>;
  return typeof ctx['id'] === 'string' && typeof ctx['connection'] === 'string' && ctx['startedAt'] instanceof Date && isTransactionState(ctx['state']);
}

export function isTransactionState(value: unknown): value is TransactionState {
  return typeof value === 'string' && ['ACTIVE', 'COMMITTING', 'COMMITTED', 'ROLLING_BACK', 'ROLLED_BACK', 'FAILED'].includes(value);
}

export function isDeadlockError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const err = error as Record<string, unknown>;
  const message = (err['message'] as string)?.toLowerCase() || '';
  const code = err['code'];
  return message.includes('deadlock') || message.includes('lock wait timeout') || code === '40P01' || code === '1213' || code === '40001';
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isDefined<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined;
}

export function isValidId(value: unknown): value is number | string {
  return typeof value === 'number' || typeof value === 'string';
}

export function hasProperty<T extends string>(obj: unknown, prop: T): obj is Record<T, unknown> {
  return isRecord(obj) && prop in obj;
}

export function isConstructor(value: unknown): value is new (...args: unknown[]) => unknown {
  return typeof value === 'function';
}

export function isError(error: unknown): error is Error {
  return error instanceof Error;
}

export function isDatabaseRow(value: unknown): value is Record<string, unknown> {
  return isRecord(value);
}

export function assertDefined<T>(value: T | null | undefined, message = 'Value must be defined'): asserts value is T {
  if (!isDefined(value)) throw Errors.badRequest(message);
}

export function assertValidId(value: unknown, message = 'Invalid ID: must be a number or string'): asserts value is number | string {
  if (!isValidId(value)) throw Errors.badRequest(message);
}

export function assertRecord(value: unknown, message = 'Value must be a plain object'): asserts value is Record<string, unknown> {
  if (!isRecord(value)) throw Errors.badRequest(message);
}
