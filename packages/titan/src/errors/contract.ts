/**
 * Contract-based error system with type inference
 */

import { z } from 'zod';
import { TitanError, ErrorOptions } from './core.js';
import { ErrorCode } from './codes.js';
import type { Contract, MethodContract } from '../validation/contract.js';

/**
 * Contract error that validates against method contracts
 */
export class ContractError<TContract extends Contract = Contract> extends TitanError {
  public readonly contractMethod: string;
  public readonly payload: any;

  constructor(
    options: ErrorOptions & {
      contractMethod: string;
      payload: any;
    }
  ) {
    super(options);
    this.name = 'ContractError';
    this.contractMethod = options.contractMethod;
    this.payload = options.payload;
  }

  /**
   * Create a contract error with validation
   */
  static create<
    TContract extends Contract,
    TMethod extends keyof TContract['definition'],
    TCode extends keyof NonNullable<TContract['definition'][TMethod]['errors']>
  >(
    contract: TContract,
    method: TMethod,
    code: TCode,
    payload: z.infer<NonNullable<TContract['definition'][TMethod]['errors']>[TCode]>
  ): ContractError<TContract> {
    const methodContract = contract.getMethod(String(method));

    if (!methodContract) {
      throw new Error(`Method ${String(method)} not found in contract`);
    }

    if (!methodContract.errors) {
      throw new Error(`Method ${String(method)} has no error definitions`);
    }

    const errorSchema = methodContract.errors[code as any];
    if (!errorSchema) {
      throw new Error(`Error code ${String(code)} not defined in contract for method ${String(method)}`);
    }

    // Validate the payload
    const result = errorSchema.safeParse(payload);
    if (!result.success) {
      throw new Error(`Invalid error payload for contract: ${result.error.message}`);
    }

    return new ContractError({
      code: code as any,
      message: payload.message || `Error ${String(code)}`,
      details: payload,
      contractMethod: String(method),
      payload: result.data
    });
  }

  /**
   * Check if an error matches a contract error
   */
  static isContractError(error: any): error is ContractError {
    return error instanceof ContractError;
  }
}

/**
 * Error contract type for defining method errors
 */
export type ErrorContract<TErrors extends Record<number, z.ZodSchema<any>>> = {
  [K in keyof TErrors]: z.infer<TErrors[K]>;
};

/**
 * Infer error types from a contract method
 */
export type inferErrorTypes<
  TContract extends Contract,
  TMethod extends keyof TContract['definition']
> = TContract['definition'][TMethod]['errors'] extends Record<number, z.ZodSchema<any>>
  ? {
      [K in keyof TContract['definition'][TMethod]['errors']]: z.infer<
        TContract['definition'][TMethod]['errors'][K]
      >;
    }
  : never;

/**
 * Type-safe error handler for contract methods
 */
export type ErrorHandler<
  TContract extends Contract,
  TMethod extends keyof TContract['definition']
> = TContract['definition'][TMethod]['errors'] extends Record<number, z.ZodSchema<any>>
  ? (
      code: keyof TContract['definition'][TMethod]['errors'],
      payload: inferErrorTypes<TContract, TMethod>[keyof inferErrorTypes<TContract, TMethod>]
    ) => never
  : never;

/**
 * Create a type-safe error handler for a contract method
 */
export function createErrorHandler<
  TContract extends Contract,
  TMethod extends keyof TContract['definition']
>(contract: TContract, method: TMethod): ErrorHandler<TContract, TMethod> {
  return ((code: any, payload: any) => {
    throw ContractError.create(contract, method, code, payload);
  }) as ErrorHandler<TContract, TMethod>;
}

/**
 * Service base class with contract-aware error handling
 */
export abstract class ContractService<TContract extends Contract> {
  constructor(protected readonly contract: TContract) {}

  /**
   * Throw a contract error
   */
  protected throwError<
    TMethod extends keyof TContract['definition'],
    TCode extends keyof NonNullable<TContract['definition'][TMethod]['errors']>
  >(
    method: TMethod,
    code: TCode,
    payload: z.infer<NonNullable<TContract['definition'][TMethod]['errors']>[TCode]>
  ): never {
    throw ContractError.create(this.contract, method, code, payload);
  }

  /**
   * Create an error handler for a specific method
   */
  protected errorHandler<TMethod extends keyof TContract['definition']>(
    method: TMethod
  ): ErrorHandler<TContract, TMethod> {
    return createErrorHandler(this.contract, method);
  }
}

/**
 * Decorator for contract-based error handling
 */
export function ContractMethod<
  TContract extends Contract,
  TMethod extends keyof TContract['definition']
>(contract: TContract, method: TMethod) {
  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    const originalMethod = descriptor.value;

    descriptor.value = async function (...args: any[]) {
      try {
        return await originalMethod.apply(this, args);
      } catch (error) {
        // If it's already a contract error, re-throw
        if (ContractError.isContractError(error)) {
          throw error;
        }

        // Convert to contract error if possible
        if (error instanceof TitanError) {
          const methodContract = contract.getMethod(String(method));
          if (methodContract?.errors && methodContract.errors[error.code]) {
            throw new ContractError({
              code: error.code,
              message: error.message,
              details: error.details,
              contractMethod: String(method),
              payload: error.details
            });
          }
        }

        // Re-throw as-is
        throw error;
      }
    };

    return descriptor;
  };
}

/**
 * Validate error response against contract
 */
export function validateErrorResponse<
  TContract extends Contract,
  TMethod extends keyof TContract['definition']
>(
  contract: TContract,
  method: TMethod,
  code: number,
  payload: any
): boolean {
  const methodContract = contract.getMethod(String(method));

  if (!methodContract?.errors) {
    return false;
  }

  const errorSchema = methodContract.errors[code];
  if (!errorSchema) {
    return false;
  }

  const result = errorSchema.safeParse(payload);
  return result.success;
}

/**
 * Extract all possible error codes from a contract
 */
export function extractErrorCodes<TContract extends Contract>(
  contract: TContract
): Set<number> {
  const codes = new Set<number>();

  for (const method of contract.getMethods()) {
    const methodContract = contract.getMethod(method);
    if (methodContract?.errors) {
      for (const code of Object.keys(methodContract.errors)) {
        codes.add(parseInt(code));
      }
    }
  }

  return codes;
}

/**
 * Create error documentation from contract
 */
export function generateErrorDocs<TContract extends Contract>(
  contract: TContract
): Record<string, Array<{ code: number; schema: z.ZodSchema<any> }>> {
  const docs: Record<string, Array<{ code: number; schema: z.ZodSchema<any> }>> = {};

  for (const method of contract.getMethods()) {
    const methodContract = contract.getMethod(method);
    if (methodContract?.errors) {
      docs[method] = Object.entries(methodContract.errors).map(([code, schema]) => ({
        code: parseInt(code),
        schema: schema as z.ZodSchema<any>
      }));
    }
  }

  return docs;
}