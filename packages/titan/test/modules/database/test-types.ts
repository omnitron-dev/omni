/**
 * Shared type definitions for database tests
 * Provides type-safe alternatives to 'any' for common test patterns
 */

import type { ExpressionBuilder } from 'kysely';

/**
 * Address interface for shipping and billing
 */
export interface Address {
  street: string;
  city: string;
  state: string;
  zip_code: string;
  country: string;
}

/**
 * Payment details interface
 */
export interface PaymentDetails {
  method: string;
  card_last_four?: string;
  transaction_id?: string;
  provider?: string;
}

/**
 * Generic metadata type for extensible JSON fields
 */
export type Metadata = Record<string, unknown>;

/**
 * SQL raw query result with rows
 */
export interface RawQueryResult<T = unknown> {
  rows: T[];
  rowCount?: number;
  command?: string;
}

/**
 * Type-safe expression builder for Kysely updates
 * Use for .set() callbacks that reference table columns
 */
export type UpdateExpressionBuilder<DB, TB extends keyof DB> = ExpressionBuilder<DB, TB>;

/**
 * Type-safe expression builder for Kysely where clauses
 */
export type WhereExpressionBuilder<DB, TB extends keyof DB> = ExpressionBuilder<DB, TB>;

/**
 * Generic database row type for tests
 */
export interface TestRow {
  [key: string]: unknown;
}
