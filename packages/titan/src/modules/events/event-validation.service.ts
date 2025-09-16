/**
 * Event Validation Service
 * 
 * Validates event data against schemas
 */

import { Injectable } from '@omnitron-dev/nexus';

import type { EventValidationResult } from './types';

/**
 * Schema validator interface
 */
export interface SchemaValidator {
  validate(data: any): { valid: boolean; errors?: string[] };
}

/**
 * Service for validating event data
 */
@Injectable()
export class EventValidationService {
  private schemas: Map<string, SchemaValidator> = new Map();
  private validators: Map<string, Function> = new Map();

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
  registerValidator(event: string, validator: Function): void {
    this.validators.set(event, validator);
  }

  /**
   * Validate event data
   */
  validate(event: string, data: any): EventValidationResult {
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
  ): EventValidationResult {
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
  private createValidator(schema: any): SchemaValidator {
    if (typeof schema.validate === 'function') {
      return schema;
    }

    // If it's a plain object, create a simple validator
    return {
      validate: (data: any) => {
        // Simple validation logic
        if (schema.type && typeof data !== schema.type) {
          return {
            valid: false,
            errors: [`Expected type ${schema.type}, got ${typeof data}`]
          };
        }

        return { valid: true };
      }
    };
  }

  /**
   * Get wildcard validators for an event
   */
  private getWildcardValidators(event: string): Function[] {
    const validators: Function[] = [];

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
  private getTransformer(event: string): Function | undefined {
    // This would return a registered transformer
    // For now, return undefined
    return undefined;
  }
}