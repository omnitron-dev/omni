/**
 * Configuration Validator Service
 *
 * Handles configuration validation using Zod schemas
 */

import { ZodType, ZodError } from 'zod';
import { Injectable } from '../../decorators/index.js';

import type { IConfigValidator, IConfigValidationResult } from './types.js';

@Injectable()
export class ConfigValidatorService implements IConfigValidator {
  /**
   * Validate entire configuration against schema
   */
  validate(config: Record<string, any>, schema?: ZodType): IConfigValidationResult {
    if (!schema) {
      return { success: true };
    }

    try {
      schema.parse(config);
      return { success: true };
    } catch (error) {
      if (error instanceof ZodError) {
        return this.formatZodError(error);
      }
      return {
        success: false,
        errors: [{
          path: '',
          message: error instanceof Error ? error.message : 'Unknown validation error'
        }]
      };
    }
  }

  /**
   * Validate a specific configuration path
   */
  validatePath(path: string, value: any, schema?: ZodType): IConfigValidationResult {
    if (!schema) {
      return { success: true };
    }

    try {
      schema.parse(value);
      return { success: true };
    } catch (error) {
      if (error instanceof ZodError) {
        const result = this.formatZodError(error);
        // Prepend path to error paths
        if (result.errors) {
          result.errors = result.errors.map(err => ({
            ...err,
            path: path + (err.path ? '.' + err.path : '')
          }));
        }
        return result;
      }
      return {
        success: false,
        errors: [{
          path,
          message: error instanceof Error ? error.message : 'Unknown validation error'
        }]
      };
    }
  }

  /**
   * Format Zod error into validation result
   */
  private formatZodError(error: ZodError): IConfigValidationResult {
    const errors = error.issues.map((issue: any) => ({
      path: issue.path.join('.'),
      message: issue.message,
      expected: issue.expected,
      received: issue.received
    }));

    return {
      success: false,
      errors
    };
  }
}