/**
 * Event Validation Service
 * 
 * Validates event data against schemas
 */

import { Inject, Optional, Injectable } from '@omnitron-dev/nexus';



import type { IEventValidationResult } from './types.js';

/**
 * Schema validator interface
 */
export interface ISchemaValidator {
  validate(data: any): { valid: boolean; errors?: string[] };
}

/**
 * Service for validating event data
 */
@Injectable()
export class EventValidationService {
  private schemas: Map<string, ISchemaValidator> = new Map();
  private validators: Map<string, (...args: any[]) => any> = new Map();
  private initialized = false;
  private destroyed = false;
  private logger: any = null;

  constructor(
    
  ) { }

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

    // Clear all schemas and validators
    this.schemas.clear();
    this.validators.clear();

    this.logger?.info('EventValidationService destroyed');
  }

  /**
   * Get health status
   */
  async health(): Promise<{ status: 'healthy' | 'degraded' | 'unhealthy'; details?: any }> {
    return {
      status: this.initialized && !this.destroyed ? 'healthy' : 'unhealthy',
      details: {
        initialized: this.initialized,
        destroyed: this.destroyed,
        registeredSchemas: this.schemas.size,
        registeredValidators: this.validators.size
      }
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
  validateData(event: string, data: any): boolean {
    const result = this.validate(event, data);
    return result.valid;
  }

  /**
   * Validate handler function signature
   */
  isValidHandler(handler: any): boolean {
    return typeof handler === 'function';
  }

  /**
   * Sanitize event data by removing sensitive information
   */
  sanitizeData(data: any): any {
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
  registerSchema(event: string, schema: any): void {
    // Convert schema to validator if needed
    const validator = this.createValidator(schema);
    this.schemas.set(event, validator);
  }

  /**
   * Register a custom validator function
   */
  registerValidator(event: string, validator: (...args: any[]) => any): void {
    this.validators.set(event, validator);
  }

  /**
   * Validate event data
   */
  validate(event: string, data: any): IEventValidationResult {
    // Check for custom validator first
    const customValidator = this.validators.get(event);
    if (customValidator) {
      try {
        const result = customValidator(data);
        if (typeof result === 'boolean') {
          return { valid: result };
        }
        return result;
      } catch (error) {
        return {
          valid: false,
          errors: [(error as Error).message]
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
        if (!result.valid && result.errors) {
          errors.push(...result.errors);
        }
      }

      return {
        valid: errors.length === 0,
        errors: errors.length > 0 ? errors : undefined
      };
    }

    // No validation configured
    return { valid: true };
  }

  /**
   * Validate and transform event data
   */
  validateAndTransform(
    event: string,
    data: any
  ): IEventValidationResult {
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
          data: transformed
        };
      } catch (error) {
        return {
          valid: false,
          errors: [`Transformation failed: ${(error as Error).message}`]
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
    return [
      ...Array.from(this.schemas.keys()),
      ...Array.from(this.validators.keys())
    ];
  }

  /**
   * Create a schema object
   */
  createSchema(definition: {
    type?: string;
    properties?: Record<string, any>;
    required?: string[];
    additionalProperties?: boolean;
  }): any {
    // This would create a proper schema object
    // For now, return a simple validator
    return {
      validate: (data: any) => {
        const errors: string[] = [];

        // Check type
        if (definition.type && typeof data !== definition.type) {
          errors.push(`Expected type ${definition.type}, got ${typeof data}`);
        }

        // Check required properties
        if (definition.required && typeof data === 'object') {
          for (const prop of definition.required) {
            if (!(prop in data)) {
              errors.push(`Missing required property: ${prop}`);
            }
          }
        }

        return {
          valid: errors.length === 0,
          errors: errors.length > 0 ? errors : undefined
        };
      }
    };
  }

  /**
   * Create validator from schema
   */
  private createValidator(schema: any): ISchemaValidator {
    if (typeof schema.validate === 'function') {
      return schema;
    }

    // Create a JSON schema validator
    return {
      validate: (data: any) => {
        const errors: string[] = [];

        // Check type
        if (schema.type) {
          const expectedType = schema.type;
          const actualType = Array.isArray(data) ? 'array' : typeof data;

          if (expectedType !== actualType) {
            return {
              valid: false,
              errors: [`Expected type ${expectedType}, got ${actualType}`]
            };
          }
        }

        // Check required fields
        if (schema.required && Array.isArray(schema.required) && typeof data === 'object') {
          for (const field of schema.required) {
            if (!(field in data) || data[field] === undefined) {
              errors.push(`Missing required property: ${field}`);
            }
          }
        }

        // Check properties
        if (schema.properties && typeof data === 'object') {
          for (const [prop, propSchema] of Object.entries(schema.properties)) {
            if (prop in data) {
              const propType = (propSchema as any).type;
              const actualType = Array.isArray(data[prop]) ? 'array' : typeof data[prop];

              if (propType && actualType !== propType) {
                errors.push(`Property '${prop}' should be ${propType}, got ${actualType}`);
              }
            }
          }
        }

        return {
          valid: errors.length === 0,
          errors: errors.length > 0 ? errors : undefined
        };
      }
    };
  }

  /**
   * Get wildcard validators for an event
   */
  private getWildcardValidators(event: string): ((...args: any[]) => any)[] {
    const validators: ((...args: any[]) => any)[] = [];

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
      const regex = new RegExp(
        '^' + pattern.replace(/\*/g, '.*').replace(/\./g, '\\.') + '$'
      );
      return regex.test(event);
    }

    return false;
  }

  /**
   * Get transformer for an event
   */
  private getTransformer(event: string): ((...args: any[]) => any) | undefined {
    // This would return a registered transformer
    // For now, return undefined
    return undefined;
  }
}