/**
 * Event Validation Service
 * 
 * Validates event data against schemas
 */

import { Injectable } from '../../nexus/index.js';

import type {
  EventData,
  EventValidator,
  EventTransformer
} from './event.types.js';
import type { IEventValidationResult } from './types.js';
import type { ILogger } from '../logger/logger.types.js';

/**
 * Schema validator interface
 */
export interface ISchemaValidator {
  validate(data: EventData): { valid: boolean; errors?: string[] };
}

/**
 * Service for validating event data
 */
@Injectable()
export class EventValidationService {
  private schemas: Map<string, ISchemaValidator> = new Map();
  private validators: Map<string, EventValidator> = new Map();
  private initialized = false;
  private destroyed = false;
  private logger: ILogger | null = null;

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
  async health(): Promise<{ status: 'healthy' | 'degraded' | 'unhealthy'; details?: Record<string, unknown> }> {
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
    data: EventData
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
    properties?: Record<string, unknown>;
    required?: string[];
    additionalProperties?: boolean;
  }): ISchemaValidator {
    // This would create a proper schema object
    // For now, return a simple validator
    return {
      validate: (data: EventData) => {
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
  private createValidator(schema: unknown): ISchemaValidator {
    if (schema && typeof schema === 'object' && 'validate' in schema && typeof (schema as any).validate === 'function') {
      return schema as ISchemaValidator;
    }

    // Create a JSON schema validator
    const schemaObj = schema as any;
    return {
      validate: (data: EventData) => {
        const errors: string[] = [];

        // Check type
        if (schemaObj?.type) {
          const expectedType = schemaObj.type;
          const actualType = Array.isArray(data) ? 'array' : typeof data;

          if (expectedType !== actualType) {
            return {
              valid: false,
              errors: [`Expected type ${expectedType}, got ${actualType}`]
            };
          }
        }

        // Check required fields
        if (schemaObj?.required && Array.isArray(schemaObj.required) && typeof data === 'object') {
          for (const field of schemaObj.required) {
            if (!(field in data) || data[field] === undefined) {
              errors.push(`Missing required property: ${field}`);
            }
          }
        }

        // Check properties
        if (schemaObj?.properties && typeof data === 'object') {
          for (const [prop, propSchema] of Object.entries(schemaObj.properties)) {
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
  private getTransformer(event: string): EventTransformer | undefined {
    // This would return a registered transformer
    // For now, return undefined
    return undefined;
  }
}