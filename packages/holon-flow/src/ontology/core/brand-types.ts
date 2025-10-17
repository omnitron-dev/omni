/**
 * Brand Types - Nominal Typing System for Ontological Safety
 *
 * This module provides the foundation for compile-time ontological constraints.
 * Brand types ensure that only semantically compatible components can be composed.
 *
 * Philosophy:
 * - Types are not just shapes, they carry semantic meaning
 * - Incompatible semantics should be caught at compile-time
 * - Runtime validation supplements compile-time checks
 *
 * @module ontology/core/brand-types
 */

/**
 * Brand<T, B> - Create a nominally typed version of T with brand B
 *
 * This prevents structural compatibility and enforces semantic compatibility.
 *
 * @example
 * ```typescript
 * type UserId = Brand<string, 'UserId'>
 * type ProductId = Brand<string, 'ProductId'>
 *
 * const userId: UserId = 'user-123' as UserId
 * const productId: ProductId = 'prod-456' as ProductId
 *
 * // Compile error: Type 'UserId' is not assignable to type 'ProductId'
 * const invalid: ProductId = userId
 * ```
 */
export type Brand<T, B extends string> = T & { readonly __brand: B };

/**
 * Unbrand<T> - Extract the underlying type from a branded type
 */
export type Unbrand<T> = T extends Brand<infer U, any> ? U : T;

/**
 * GetBrand<T> - Extract the brand from a branded type
 */
export type GetBrand<T> = T extends Brand<any, infer B> ? B : never;

/**
 * IsBranded<T> - Check if a type is branded
 */
export type IsBranded<T> = T extends Brand<any, any> ? true : false;

/**
 * BrandSafe<T, B> - Safely brand a value at runtime
 *
 * @param value - The value to brand
 * @param validator - Optional validator function
 * @returns The branded value if validation passes
 * @throws If validation fails
 */
export function brandSafe<T, B extends string>(
  value: T,
  brand: B,
  validator?: (value: T) => boolean
): Brand<T, B> {
  if (validator && !validator(value)) {
    throw new TypeError(`Value does not satisfy brand constraint: ${brand}`);
  }
  return value as Brand<T, B>;
}

/**
 * Semantic Data Types - Branded types for common semantic concepts
 */

// Identity & References
export type UserId = Brand<string, 'UserId'>;
export type SessionId = Brand<string, 'SessionId'>;
export type ResourceId = Brand<string, 'ResourceId'>;
export type CorrelationId = Brand<string, 'CorrelationId'>;

// Temporal
export type Timestamp = Brand<number, 'Timestamp'>;
export type Duration = Brand<number, 'Duration'>;
export type Interval = Brand<{ start: Timestamp; end: Timestamp }, 'Interval'>;

// Measurements
export type Bytes = Brand<number, 'Bytes'>;
export type Percentage = Brand<number, 'Percentage'>;
export type Temperature = Brand<number, 'Temperature'>;

// Network
export type URL = Brand<string, 'URL'>;
export type IPAddress = Brand<string, 'IPAddress'>;
export type Port = Brand<number, 'Port'>;

// Security
export type SecretToken = Brand<string, 'SecretToken'>;
export type PublicKey = Brand<string, 'PublicKey'>;
export type PrivateKey = Brand<string, 'PrivateKey'>;
export type Hash = Brand<string, 'Hash'>;

// Data Structures
export type JSON = Brand<string, 'JSON'>;
export type Base64 = Brand<string, 'Base64'>;
export type Hex = Brand<string, 'Hex'>;

/**
 * Semantic constructors with validation
 */
export const Semantic = {
  userId: (value: string): UserId => {
    if (!value || value.trim().length === 0) {
      throw new TypeError('UserId cannot be empty');
    }
    return value as UserId;
  },

  timestamp: (value: number): Timestamp => {
    if (!Number.isFinite(value) || value < 0) {
      throw new TypeError('Timestamp must be a non-negative finite number');
    }
    return value as Timestamp;
  },

  duration: (value: number): Duration => {
    if (!Number.isFinite(value) || value < 0) {
      throw new TypeError('Duration must be a non-negative finite number');
    }
    return value as Duration;
  },

  bytes: (value: number): Bytes => {
    if (!Number.isInteger(value) || value < 0) {
      throw new TypeError('Bytes must be a non-negative integer');
    }
    return value as Bytes;
  },

  percentage: (value: number): Percentage => {
    if (!Number.isFinite(value) || value < 0 || value > 100) {
      throw new TypeError('Percentage must be between 0 and 100');
    }
    return value as Percentage;
  },

  url: (value: string): URL => {
    try {
      new globalThis.URL(value);
      return value as URL;
    } catch {
      throw new TypeError(`Invalid URL: ${value}`);
    }
  },

  port: (value: number): Port => {
    if (!Number.isInteger(value) || value < 0 || value > 65535) {
      throw new TypeError('Port must be an integer between 0 and 65535');
    }
    return value as Port;
  },

  json: (value: string): JSON => {
    try {
      globalThis.JSON.parse(value);
      return value as JSON;
    } catch {
      throw new TypeError('Invalid JSON string');
    }
  },

  base64: (value: string): Base64 => {
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(value)) {
      throw new TypeError('Invalid Base64 string');
    }
    return value as Base64;
  },

  hex: (value: string): Hex => {
    if (!/^[0-9a-fA-F]*$/.test(value)) {
      throw new TypeError('Invalid hexadecimal string');
    }
    return value as Hex;
  },
};

/**
 * Type-level utilities for working with branded types
 */

/**
 * CompatibleBrand<A, B> - Check if two brands are compatible
 *
 * Two brands are compatible if:
 * 1. They are the same brand
 * 2. One is a subtype of the other (via brand hierarchy)
 */
export type CompatibleBrand<A, B> = GetBrand<A> extends GetBrand<B>
  ? true
  : GetBrand<B> extends GetBrand<A>
    ? true
    : false;

/**
 * BrandCompatible<A, B> - Check if two branded types are compatible
 */
export type BrandCompatible<A, B> = A extends Brand<infer T1, infer B1>
  ? B extends Brand<infer T2, infer B2>
    ? B1 extends B2
      ? T1 extends T2
        ? true
        : false
      : B2 extends B1
        ? T2 extends T1
          ? true
          : false
        : false
    : false
  : false;

/**
 * Runtime brand compatibility checker
 */
export function isBrandCompatible<A, B>(a: A, b: B): boolean {
  const brandA = (a as any).__brand;
  const brandB = (b as any).__brand;

  if (!brandA || !brandB) {
    return false;
  }

  return brandA === brandB;
}
