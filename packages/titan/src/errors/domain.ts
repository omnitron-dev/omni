/**
 * Domain-Specific Error System
 *
 * Utilities for defining application-specific error codes and factories
 * that integrate seamlessly with Titan's TitanError system.
 *
 * @example
 * ```typescript
 * // Define domain error codes
 * const PaymentErrorCode = defineDomainCodes('PAYMENT', {
 *   INSUFFICIENT_FUNDS: { status: 409, message: 'Insufficient funds' },
 *   PAYMENT_DECLINED: { status: 402, message: 'Payment was declined' },
 *   ACCOUNT_LOCKED: { status: 403, message: 'Account is locked' },
 * } as const);
 *
 * // Create domain errors
 * const error = new DomainError({
 *   code: PaymentErrorCode.INSUFFICIENT_FUNDS,
 *   httpStatus: 409,
 *   details: { available: '100.00', required: '150.00' }
 * });
 *
 * // Or use the factory helper
 * const errors = createDomainErrorFactory(PaymentErrorCode, {
 *   insufficientFunds: (available, required) => ({
 *     code: 'INSUFFICIENT_FUNDS',
 *     message: `Insufficient funds: ${available} available, ${required} required`,
 *     details: { available, required },
 *   }),
 * });
 *
 * throw errors.insufficientFunds('100.00', '150.00');
 * ```
 *
 * @module @omnitron-dev/titan/errors/domain
 */

import { TitanError, type ErrorOptions } from './core.js';
import { ErrorCode } from './codes.js';

/**
 * Configuration for a single domain error code
 */
export interface DomainCodeConfig {
  /** HTTP status code (400, 404, 409, 500, etc.) */
  status: number;
  /** Default error message */
  message: string;
  /** Whether this error is retryable */
  retryable?: boolean;
}

/**
 * Configuration map for domain error codes
 */
export type DomainCodeMap = Record<string, DomainCodeConfig>;

/**
 * Result type for defineDomainCodes - provides type-safe code strings
 */
export type DomainCodes<T extends DomainCodeMap> = {
  readonly [K in keyof T]: K extends string ? `${string}_${K}` : never;
} & {
  /** Get configuration for a code */
  getConfig(code: string): DomainCodeConfig | undefined;
  /** Get all codes */
  readonly codes: readonly (keyof T)[];
  /** Domain prefix */
  readonly prefix: string;
};

/**
 * Options for creating a domain error
 */
export interface DomainErrorOptions extends Omit<ErrorOptions, 'code'> {
  /** Domain-specific error code string */
  domainCode: string;
  /** HTTP status code (defaults to 500 if not specified) */
  httpStatus?: number;
}

/**
 * Domain-specific error class that wraps TitanError with additional domain context
 */
export class DomainError extends TitanError {
  /** The domain-specific error code */
  public readonly domainCode: string;

  constructor(options: DomainErrorOptions) {
    super({
      code: (options.httpStatus ?? ErrorCode.INTERNAL_ERROR) as ErrorCode,
      message: options.message,
      details: {
        ...options.details,
        domainCode: options.domainCode,
      },
      context: options.context,
      cause: options.cause,
      requestId: options.requestId,
      correlationId: options.correlationId,
      spanId: options.spanId,
      traceId: options.traceId,
    });

    this.domainCode = options.domainCode;
    this.name = 'DomainError';
  }

  /**
   * Check if a value is a DomainError
   */
  static isDomainError(error: unknown): error is DomainError {
    return error instanceof DomainError;
  }

  /**
   * Check if error has specific domain code
   */
  static hasDomainCode(error: unknown, code: string): boolean {
    return DomainError.isDomainError(error) && error.domainCode === code;
  }
}

/**
 * Define domain-specific error codes with a prefix
 *
 * @param prefix - Domain prefix (e.g., 'PAYMENT', 'USER', 'PRICING')
 * @param codes - Map of error codes and their configurations
 * @returns Object with prefixed code constants and utility methods
 *
 * @example
 * ```typescript
 * const PaymentCodes = defineDomainCodes('PAYMENT', {
 *   INSUFFICIENT_FUNDS: { status: 409, message: 'Insufficient funds' },
 *   DECLINED: { status: 402, message: 'Payment declined' },
 * } as const);
 *
 * PaymentCodes.INSUFFICIENT_FUNDS // => 'PAYMENT_INSUFFICIENT_FUNDS'
 * PaymentCodes.getConfig('PAYMENT_INSUFFICIENT_FUNDS')?.status // => 409
 * ```
 */
export function defineDomainCodes<T extends DomainCodeMap>(prefix: string, codes: T): DomainCodes<T> {
  const codeMap = new Map<string, DomainCodeConfig>();
  const result: Record<string, string> = {};

  for (const [key, config] of Object.entries(codes)) {
    const fullCode = `${prefix}_${key}`;
    result[key] = fullCode;
    codeMap.set(fullCode, config);
  }

  return Object.assign(result, {
    getConfig: (code: string) => codeMap.get(code),
    codes: Object.keys(codes) as readonly (keyof T)[],
    prefix,
  }) as DomainCodes<T>;
}

/**
 * Factory function specification for domain errors
 */
export type DomainErrorFactorySpec<T extends DomainCodeMap> = {
  [K in keyof T]?: (...args: any[]) => {
    code: K;
    message?: string;
    details?: Record<string, any>;
  };
};

/**
 * Result type for createDomainErrorFactory
 */
export type DomainErrorFactory<T extends DomainCodeMap, F extends DomainErrorFactorySpec<T>> = {
  [K in keyof F]: F[K] extends (...args: infer Args) => any ? (...args: Args) => DomainError : never;
} & {
  /** Create an error directly from a code */
  create<Code extends keyof T>(code: Code, message?: string, details?: Record<string, any>): DomainError;
};

/**
 * Create a domain error factory with typed factory methods
 *
 * @param codes - Domain codes created by defineDomainCodes
 * @param factories - Factory function specifications
 * @returns Factory object with methods for each error type
 *
 * @example
 * ```typescript
 * const PaymentCodes = defineDomainCodes('PAYMENT', {
 *   INSUFFICIENT_FUNDS: { status: 409, message: 'Insufficient funds' },
 *   DECLINED: { status: 402, message: 'Payment declined' },
 * } as const);
 *
 * const PaymentErrors = createDomainErrorFactory(PaymentCodes, {
 *   insufficientFunds: (available: string, required: string) => ({
 *     code: 'INSUFFICIENT_FUNDS',
 *     message: `Insufficient funds: ${available} available, ${required} required`,
 *     details: { available, required },
 *   }),
 *   declined: (reason: string) => ({
 *     code: 'DECLINED',
 *     message: `Payment declined: ${reason}`,
 *     details: { reason },
 *   }),
 * });
 *
 * throw PaymentErrors.insufficientFunds('100.00', '150.00');
 * throw PaymentErrors.declined('Card expired');
 * throw PaymentErrors.create('INSUFFICIENT_FUNDS', 'Custom message');
 * ```
 */
export function createDomainErrorFactory<T extends DomainCodeMap, F extends DomainErrorFactorySpec<T>>(
  codes: DomainCodes<T>,
  factories: F
): DomainErrorFactory<T, F> {
  const result: Record<string, (...args: any[]) => DomainError> = {};

  for (const [name, factory] of Object.entries(factories)) {
    if (typeof factory === 'function') {
      result[name] = (...args: any[]) => {
        const spec = factory(...args);
        const fullCode = codes[spec.code as keyof T] as string;
        const config = codes.getConfig(fullCode);

        return new DomainError({
          domainCode: fullCode,
          httpStatus: config?.status ?? ErrorCode.INTERNAL_ERROR,
          message: spec.message ?? config?.message ?? `Error: ${fullCode}`,
          details: spec.details,
        });
      };
    }
  }

  // Add generic create method
  result['create'] = <Code extends keyof T>(
    code: Code,
    message?: string,
    details?: Record<string, any>
  ): DomainError => {
    const fullCode = codes[code] as string;
    const config = codes.getConfig(fullCode);

    return new DomainError({
      domainCode: fullCode,
      httpStatus: config?.status ?? ErrorCode.INTERNAL_ERROR,
      message: message ?? config?.message ?? `Error: ${fullCode}`,
      details,
    });
  };

  return result as DomainErrorFactory<T, F>;
}

/**
 * Type guard to check if error has a specific domain code from a codes object
 */
export function isDomainCode<T extends DomainCodeMap>(
  error: unknown,
  codes: DomainCodes<T>,
  code: keyof T
): error is DomainError {
  const fullCode = codes[code];
  return DomainError.isDomainError(error) && error.domainCode === fullCode;
}

/**
 * Type guard to check if error belongs to a specific domain
 */
export function isDomainError<T extends DomainCodeMap>(error: unknown, codes: DomainCodes<T>): error is DomainError {
  if (!DomainError.isDomainError(error)) return false;
  return error.domainCode.startsWith(`${codes.prefix}_`);
}

/**
 * Extract domain code from error if present
 */
export function getDomainCode(error: unknown): string | undefined {
  if (DomainError.isDomainError(error)) {
    return error.domainCode;
  }
  if (TitanError.isTitanError(error)) {
    return error.details?.domainCode;
  }
  return undefined;
}

/**
 * Create a simple domain error factory without predefined factories
 *
 * @param prefix - Domain prefix
 * @param codes - Error code configurations
 * @returns Simple factory with create method
 *
 * @example
 * ```typescript
 * const UserErrors = createSimpleDomainFactory('USER', {
 *   NOT_FOUND: { status: 404, message: 'User not found' },
 *   ALREADY_EXISTS: { status: 409, message: 'User already exists' },
 * } as const);
 *
 * throw UserErrors.create('NOT_FOUND', 'User with id 123 not found');
 * throw UserErrors.notFound('User', '123'); // Auto-generated helper
 * throw UserErrors.alreadyExists('user@example.com'); // Auto-generated helper
 * ```
 */
export function createSimpleDomainFactory<T extends DomainCodeMap>(
  prefix: string,
  config: T
): {
  readonly codes: DomainCodes<T>;
  create<Code extends keyof T>(code: Code, message?: string, details?: Record<string, any>): DomainError;
} & {
  [K in keyof T as K extends string ? Uncapitalize<CamelCase<K>> : never]: (
    ...args: T[K] extends { status: 404 } ? [resource: string, id?: string] : [details?: Record<string, any>]
  ) => DomainError;
} {
  const codes = defineDomainCodes(prefix, config);

  const factory: Record<string, any> = {
    codes,
    create: <Code extends keyof T>(code: Code, message?: string, details?: Record<string, any>): DomainError => {
      const fullCode = codes[code] as string;
      const codeConfig = codes.getConfig(fullCode);

      return new DomainError({
        domainCode: fullCode,
        httpStatus: codeConfig?.status ?? ErrorCode.INTERNAL_ERROR,
        message: message ?? codeConfig?.message ?? `Error: ${fullCode}`,
        details,
      });
    },
  };

  // Generate helpers for each code
  for (const [key, codeConfig] of Object.entries(config)) {
    const methodName = snakeToCamel(key);
    const fullCode = `${prefix}_${key}`;

    if (codeConfig.status === 404) {
      // Not found helper: (resource, id?) => DomainError
      factory[methodName] = (resource: string, id?: string): DomainError => {
        const message = id ? `${resource} with id ${id} not found` : `${resource} not found`;
        return new DomainError({
          domainCode: fullCode,
          httpStatus: 404,
          message,
          details: { resource, id },
        });
      };
    } else {
      // Generic helper: (details?) => DomainError
      factory[methodName] = (details?: Record<string, any>): DomainError =>
        new DomainError({
          domainCode: fullCode,
          httpStatus: codeConfig.status,
          message: codeConfig.message,
          details,
        });
    }
  }

  return factory as any;
}

// Helper type for converting SNAKE_CASE to camelCase
type CamelCase<S extends string> = S extends `${infer First}_${infer Rest}`
  ? `${Lowercase<First>}${Capitalize<CamelCase<Rest>>}`
  : Lowercase<S>;

/**
 * Convert SNAKE_CASE to camelCase
 */
function snakeToCamel(str: string): string {
  return str.toLowerCase().replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
}
