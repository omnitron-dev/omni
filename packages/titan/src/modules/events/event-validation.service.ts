/**
 * Event Validation Service
 *
 * Validates event data against schemas
 */

import { Injectable } from '../../decorators/index.js';
import { z, type ZodSchema, type ZodError } from 'zod';

import type { EventData, EventValidator, EventTransformer } from './event.types.js';
import type { IEventValidationResult } from './types.js';
import type { ILogger } from '../logger/logger.types.js';

/**
 * Schema validator interface
 */
export interface ISchemaValidator {
  validate(data: EventData): { valid: boolean; errors?: string[] };
}

/**
 * JSON Schema type definition
 */
export interface JSONSchema {
  type?: string | string[];
  properties?: Record<string, JSONSchema>;
  required?: string[];
  items?: JSONSchema;
  additionalProperties?: boolean | JSONSchema;
  enum?: unknown[];
  pattern?: string;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  minItems?: number;
  maxItems?: number;
  [key: string]: unknown;
}

/**
 * Service for validating event data
 */
@Injectable()
export class EventValidationService {
  private schemas: Map<string, ISchemaValidator> = new Map();
  private validators: Map<string, EventValidator> = new Map();
  private transformers: Map<string, EventTransformer> = new Map();
  private initialized = false;
  private destroyed = false;
  private logger: ILogger | null = null;

  constructor() {}

  /**
   * Initialize the service
   */
  async onInit(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;
    this.logger?.info('EventValidationService initialized');
  }

  /**
   * Destroy the service
   */
  async onDestroy(): Promise<void> {
    if (this.destroyed) return;
    this.destroyed = true;

    // Clear all schemas, validators, and transformers
    this.schemas.clear();
    this.validators.clear();
    this.transformers.clear();

    this.logger?.info('EventValidationService destroyed');
  }

  /**
   * Get health status
   */
  async health(): Promise<{ status: 'healthy' | 'degraded' | 'unhealthy'; details?: Record<string, unknown> }> {
    return {
      status: this.initialized && !this.destroyed ? 'healthy' : 'unhealthy',
      details: {
        initialized: this.initialized,
        destroyed: this.destroyed,
        registeredSchemas: this.schemas.size,
        registeredValidators: this.validators.size,
        registeredTransformers: this.transformers.size,
      },
    };
  }

  /**
   * Validate event name format
   */
  isValidEventName(eventName: string): boolean {
    if (!eventName || typeof eventName !== 'string') {
      return false;
    }

    // Check for empty string
    if (eventName.trim().length === 0) {
      return false;
    }

    // Check if starts with number
    if (/^\d/.test(eventName)) {
      return false;
    }

    // Check for double dots or other invalid patterns
    if (eventName.includes('..')) {
      return false;
    }

    // Valid pattern: letters, numbers, dots, underscores, hyphens
    return /^[a-zA-Z][a-zA-Z0-9._-]*$/.test(eventName);
  }

  /**
   * Validate event data against registered schema
   */
  validateData(event: string, data: EventData): boolean {
    const result = this.validate(event, data);
    return result.valid;
  }

  /**
   * Validate handler function signature
   */
  isValidHandler(handler: unknown): boolean {
    return typeof handler === 'function';
  }

  /**
   * Sanitize event data by removing sensitive information
   */
  sanitizeData(data: EventData): EventData {
    if (!data || typeof data !== 'object') {
      return data;
    }

    const sanitized = { ...data };
    const sensitiveFields = ['password', 'ssn', 'secret', 'token', 'key'];

    for (const field of sensitiveFields) {
      if (field in sanitized) {
        sanitized[field] = '[REDACTED]';
      }
    }

    return sanitized;
  }

  /**
   * Register a schema for an event
   */
  registerSchema(event: string, schema: unknown): void {
    // Convert schema to validator if needed
    const validator = this.createValidator(schema);
    this.schemas.set(event, validator);
  }

  /**
   * Register a custom validator function
   */
  registerValidator(event: string, validator: EventValidator): void {
    this.validators.set(event, validator);
  }

  /**
   * Register a transformer function for an event
   */
  registerTransformer(event: string, transformer: EventTransformer): void {
    this.transformers.set(event, transformer);
  }

  /**
   * Check if event has a transformer
   */
  hasTransformer(event: string): boolean {
    return this.transformers.has(event);
  }

  /**
   * Remove transformer for an event
   */
  removeTransformer(event: string): void {
    this.transformers.delete(event);
  }

  /**
   * Validate event data
   */
  validate(event: string, data: EventData): IEventValidationResult {
    // Check for custom validator first
    const customValidator = this.validators.get(event);
    if (customValidator) {
      try {
        const result = customValidator(data);
        if (typeof result === 'boolean') {
          return { valid: result };
        }
        if (typeof result === 'string') {
          return { valid: false, errors: [result] };
        }
        if (result instanceof Promise) {
          // Synchronous validation expected, treat promise as invalid
          return { valid: false, errors: ['Async validation not supported in sync context'] };
        }
        if (typeof result === 'object' && result && 'valid' in result) {
          return result as IEventValidationResult;
        }
        return { valid: false, errors: ['Invalid validator result'] };
      } catch (error) {
        return {
          valid: false,
          errors: [(error as Error).message],
        };
      }
    }

    // Check for schema validator
    const schemaValidator = this.schemas.get(event);
    if (schemaValidator) {
      return schemaValidator.validate(data);
    }

    // Check for wildcard validators
    const wildcardValidators = this.getWildcardValidators(event);
    if (wildcardValidators.length > 0) {
      const errors: string[] = [];

      for (const validator of wildcardValidators) {
        const result = validator(data);
        if (typeof result === 'boolean') {
          if (!result) {
            errors.push('Validation failed');
          }
        } else if (typeof result === 'string') {
          errors.push(result);
        } else if (typeof result === 'object' && result && 'valid' in result) {
          const validationResult = result as IEventValidationResult;
          if (!validationResult.valid && validationResult.errors) {
            errors.push(...validationResult.errors);
          }
        }
      }

      return {
        valid: errors.length === 0,
        errors: errors.length > 0 ? errors : undefined,
      };
    }

    // No validation configured
    return { valid: true };
  }

  /**
   * Validate and transform event data
   */
  validateAndTransform(event: string, data: EventData): IEventValidationResult {
    const validation = this.validate(event, data);

    if (!validation.valid) {
      return validation;
    }

    // Apply transformation if configured
    const transformer = this.getTransformer(event);
    if (transformer) {
      try {
        const transformed = transformer(data);
        return {
          valid: true,
          data: transformed,
        };
      } catch (error) {
        return {
          valid: false,
          errors: [`Transformation failed: ${(error as Error).message}`],
        };
      }
    }

    return { valid: true, data };
  }

  /**
   * Check if event has validation
   */
  hasValidation(event: string): boolean {
    return this.schemas.has(event) || this.validators.has(event);
  }

  /**
   * Remove validation for an event
   */
  removeValidation(event: string): void {
    this.schemas.delete(event);
    this.validators.delete(event);
  }

  /**
   * Get all registered validations
   */
  getRegisteredValidations(): string[] {
    return [...Array.from(this.schemas.keys()), ...Array.from(this.validators.keys())];
  }

  /**
   * Create a schema object from JSON Schema definition
   * Converts JSON Schema to Zod schema for validation
   */
  createSchema(definition: JSONSchema): ISchemaValidator {
    const zodSchema = this.jsonSchemaToZod(definition);

    return {
      validate: (data: EventData) => {
        try {
          zodSchema.parse(data);
          return { valid: true };
        } catch (error) {
          if (error instanceof z.ZodError) {
            const issues = (error as any).issues || [];
            const errors = issues.map((issue: any) => {
              const path = issue.path?.join('.') || '';
              return path ? `${path}: ${issue.message}` : issue.message;
            });
            return { valid: false, errors };
          }
          return {
            valid: false,
            errors: [(error as Error).message]
          };
        }
      },
    };
  }

  /**
   * Convert JSON Schema to Zod schema
   */
  private jsonSchemaToZod(schema: JSONSchema): ZodSchema {
    // Handle enum first
    if (schema.enum && Array.isArray(schema.enum) && schema.enum.length > 0) {
      // z.enum requires at least one value in Zod v4
      const enumValues = schema.enum.map(String) as [string, ...string[]];
      return z.enum(enumValues[0] as any, enumValues.slice(1) as any);
    }

    const type = Array.isArray(schema.type) ? schema.type[0] : schema.type;

    let zodSchema: ZodSchema;

    switch (type) {
      case 'string': {
        let stringSchema = z.string();
        if (schema.minLength !== undefined) {
          stringSchema = stringSchema.min(schema.minLength);
        }
        if (schema.maxLength !== undefined) {
          stringSchema = stringSchema.max(schema.maxLength);
        }
        if (schema.pattern) {
          stringSchema = stringSchema.regex(new RegExp(schema.pattern));
        }
        zodSchema = stringSchema;
        break;
      }

      case 'number':
      case 'integer': {
        let numberSchema = type === 'integer' ? z.number().int() : z.number();
        if (schema.minimum !== undefined) {
          numberSchema = numberSchema.min(schema.minimum);
        }
        if (schema.maximum !== undefined) {
          numberSchema = numberSchema.max(schema.maximum);
        }
        zodSchema = numberSchema;
        break;
      }

      case 'boolean':
        zodSchema = z.boolean();
        break;

      case 'null':
        zodSchema = z.null();
        break;

      case 'array': {
        let arraySchema: ZodSchema;
        if (schema.items) {
          const itemSchema = this.jsonSchemaToZod(schema.items);
          arraySchema = z.array(itemSchema);
        } else {
          arraySchema = z.array(z.unknown());
        }

        if (schema.minItems !== undefined) {
          arraySchema = (arraySchema as z.ZodArray<any>).min(schema.minItems);
        }
        if (schema.maxItems !== undefined) {
          arraySchema = (arraySchema as z.ZodArray<any>).max(schema.maxItems);
        }

        zodSchema = arraySchema;
        break;
      }

      case 'object':
      default: {
        if (schema.properties) {
          const shape: Record<string, ZodSchema> = {};

          for (const [key, propSchema] of Object.entries(schema.properties)) {
            let propZodSchema = this.jsonSchemaToZod(propSchema as JSONSchema);

            // Make optional if not in required array
            if (!schema.required?.includes(key)) {
              propZodSchema = propZodSchema.optional();
            }

            shape[key] = propZodSchema;
          }

          let objectSchema = z.object(shape);

          // Handle additionalProperties
          if (schema.additionalProperties === false) {
            objectSchema = objectSchema.strict();
          } else if (schema.additionalProperties === true || schema.additionalProperties === undefined) {
            objectSchema = objectSchema.passthrough();
          }

          zodSchema = objectSchema;
        } else {
          // Generic object without specific properties
          zodSchema = z.record(z.string(), z.unknown());
        }
        break;
      }
    }

    return zodSchema;
  }

  /**
   * Create validator from schema
   * Supports: ISchemaValidator, Zod schema, or JSON Schema
   */
  private createValidator(schema: unknown): ISchemaValidator {
    // Already a validator
    if (
      schema &&
      typeof schema === 'object' &&
      'validate' in schema &&
      typeof (schema as any).validate === 'function'
    ) {
      return schema as ISchemaValidator;
    }

    // Check if it's a Zod schema
    if (schema && typeof schema === 'object' && '_def' in schema) {
      const zodSchema = schema as ZodSchema;
      return {
        validate: (data: EventData) => {
          try {
            zodSchema.parse(data);
            return { valid: true };
          } catch (error) {
            if (error instanceof z.ZodError) {
              const issues = (error as any).issues || [];
              const errors = issues.map((issue: any) => {
                const path = issue.path?.join('.') || '';
                return path ? `${path}: ${issue.message}` : issue.message;
              });
              return { valid: false, errors };
            }
            return {
              valid: false,
              errors: [(error as Error).message]
            };
          }
        },
      };
    }

    // Assume it's a JSON Schema, convert to Zod
    const jsonSchema = schema as JSONSchema;
    return this.createSchema(jsonSchema);
  }

  /**
   * Get wildcard validators for an event
   */
  private getWildcardValidators(event: string): EventValidator[] {
    const validators: EventValidator[] = [];

    for (const [pattern, validator] of this.validators.entries()) {
      if (this.matchesPattern(event, pattern)) {
        validators.push(validator);
      }
    }

    return validators;
  }

  /**
   * Check if event matches pattern
   */
  private matchesPattern(event: string, pattern: string): boolean {
    if (pattern === '*') return true;
    if (pattern === event) return true;

    // Simple wildcard matching
    if (pattern.includes('*')) {
      // Escape dots first, then replace asterisks with .*
      const regex = new RegExp('^' + pattern.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$');
      return regex.test(event);
    }

    return false;
  }

  /**
   * Get transformer for an event
   * Supports exact match and wildcard patterns
   */
  private getTransformer(event: string): EventTransformer | undefined {
    // Check for exact match first
    const exactTransformer = this.transformers.get(event);
    if (exactTransformer) {
      return exactTransformer;
    }

    // Check for wildcard matches
    for (const [pattern, transformer] of this.transformers.entries()) {
      if (this.matchesPattern(event, pattern)) {
        return transformer;
      }
    }

    return undefined;
  }
}
