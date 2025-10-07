/**
 * Contract system for defining service validation schemas
 */

import { z } from 'zod';
import { ValidationOptions } from './validation-engine.js';

/**
 * HTTP-specific options for method contracts
 * Simplified for RPC-style invocation without REST routing
 */
export interface HttpMethodOptions {
  /** Response configuration */
  responseHeaders?: Record<string, string>;
  contentType?: string;
  status?: number; // HTTP status code for success (default 200)
  streaming?: boolean; // Enable streaming response (SSE, WebSocket, etc.)

  /** OpenAPI documentation metadata */
  openapi?: {
    summary?: string;
    description?: string;
    tags?: string[];
    deprecated?: boolean;
    examples?: Record<string, any>;
  };
}

/**
 * Method contract definition
 */
export interface MethodContract {
  input?: z.ZodSchema<any>;
  output?: z.ZodSchema<any>;
  errors?: Record<number, z.ZodSchema<any>>;
  stream?: boolean;
  options?: ValidationOptions;

  /** New optional HTTP extension */
  http?: HttpMethodOptions;
}

/**
 * Contract metadata
 */
export interface ContractMetadata {
  name?: string;
  version?: string;
  description?: string;
  [key: string]: any;
}

/**
 * Service contract definition
 */
export type ContractDefinition = Record<string, MethodContract>;

/**
 * Contract class for managing service validation contracts
 */
export class Contract<T extends ContractDefinition = ContractDefinition> {
  constructor(
    public readonly definition: T,
    public readonly metadata: ContractMetadata = {}
  ) { }

  /**
   * Check if contract has a method
   */
  hasMethod(method: string): boolean {
    return method in this.definition;
  }

  /**
   * Get method contract
   */
  getMethod(method: string): MethodContract | undefined {
    return this.definition[method];
  }

  /**
   * Create a new contract with additional methods
   */
  extend<U extends ContractDefinition>(additional: U): Contract<T & U> {
    return new Contract(
      { ...this.definition, ...additional },
      this.metadata
    );
  }

  /**
   * Create a new contract with updated metadata
   */
  withMetadata(metadata: ContractMetadata): Contract<T> {
    return new Contract(this.definition, { ...this.metadata, ...metadata });
  }

  /**
   * Get all method names
   */
  getMethods(): string[] {
    return Object.keys(this.definition);
  }

  /**
   * Validate that a service implements all contract methods
   */
  validateImplementation(service: any): boolean {
    for (const method of this.getMethods()) {
      if (typeof service[method] !== 'function') {
        return false;
      }
    }
    return true;
  }
}

/**
 * Helper function to create a contract
 */
export function contract<T extends ContractDefinition>(
  definition: T,
  metadata?: ContractMetadata
): Contract<T> {
  return new Contract(definition, metadata || {});
}

/**
 * Type helpers for extracting types from contracts
 */
export namespace ContractTypes {
  /**
   * Extract input type from a method contract
   */
  export type Input<T extends MethodContract> = T['input'] extends z.ZodSchema<infer U> ? U : any;

  /**
   * Extract output type from a method contract
   */
  export type Output<T extends MethodContract> = T['output'] extends z.ZodSchema<infer U> ? U : any;

  /**
   * Extract error types from a method contract
   */
  export type Errors<T extends MethodContract> = T['errors'] extends Record<number, z.ZodSchema<any>>
    ? {
      [K in keyof T['errors']]: T['errors'][K] extends z.ZodSchema<infer U> ? U : any;
    }
    : never;

  /**
   * Extract service interface from contract
   */
  export type Service<T extends Contract> = T extends Contract<infer D>
    ? {
      [K in keyof D]: D[K]['stream'] extends true
      ? (input: Input<D[K]>) => AsyncGenerator<Output<D[K]>, void, unknown>
      : (input: Input<D[K]>) => Promise<Output<D[K]>>;
    }
    : never;
}

/**
 * Predefined contracts for common patterns
 */
export namespace Contracts {
  /**
   * CRUD contract template
   */
  export function crud<T extends z.ZodObject<any>>(
    entitySchema: T,
    idSchema: z.ZodSchema<any> = z.string().uuid()
  ) {
    type Entity = z.infer<T>;

    return contract({
      create: {
        input: entitySchema,
        output: entitySchema,
        errors: {
          409: z.object({ code: z.literal('ALREADY_EXISTS'), message: z.string() })
        }
      },
      read: {
        input: idSchema,
        output: entitySchema.nullable() as z.ZodSchema<Entity | null>
      },
      update: {
        input: z.object({
          id: idSchema,
          data: entitySchema.partial() as any
        }),
        output: entitySchema,
        errors: {
          404: z.object({ code: z.literal('NOT_FOUND'), message: z.string() })
        }
      },
      delete: {
        input: idSchema,
        output: z.boolean(),
        errors: {
          404: z.object({ code: z.literal('NOT_FOUND'), message: z.string() })
        }
      },
      list: {
        input: z.object({
          offset: z.number().int().min(0).default(0),
          limit: z.number().int().min(1).max(100).default(20),
          filter: z.record(z.string(), z.any()).optional()
        }),
        output: z.object({
          items: z.array(entitySchema),
          total: z.number(),
          offset: z.number(),
          limit: z.number()
        })
      }
    });
  }

  /**
   * Streaming contract template
   */
  export function streaming<T extends z.ZodSchema<any>>(
    itemSchema: T,
    filterSchema: z.ZodSchema<any> = z.any()
  ) {
    return contract({
      subscribe: {
        input: filterSchema,
        output: itemSchema,
        stream: true
      },
      unsubscribe: {
        input: z.string(), // subscription ID
        output: z.boolean()
      }
    });
  }

  /**
   * RPC contract template
   */
  export function rpc<
    TInput extends z.ZodSchema<any>,
    TOutput extends z.ZodSchema<any>
  >(input: TInput, output: TOutput) {
    return contract({
      execute: {
        input,
        output
      }
    });
  }
}

/**
 * Contract builder for fluent API
 */
export class ContractBuilder<T extends ContractDefinition = {}> {
  private definition: T = {} as T;
  private metadata: ContractMetadata = {};

  /**
   * Add a method to the contract
   */
  method<K extends string, M extends MethodContract>(
    name: K,
    contract: M
  ): ContractBuilder<T & Record<K, M>> {
    (this.definition as any)[name] = contract;
    return this as any;
  }

  /**
   * Add metadata
   */
  withMetadata(metadata: ContractMetadata): this {
    this.metadata = { ...this.metadata, ...metadata };
    return this;
  }

  /**
   * Build the contract
   */
  build(): Contract<T> {
    return new Contract(this.definition, this.metadata);
  }
}

/**
 * Create a contract builder
 */
export function contractBuilder(): ContractBuilder {
  return new ContractBuilder();
}