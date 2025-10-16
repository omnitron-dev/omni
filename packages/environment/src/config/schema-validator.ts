import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { z } from 'zod';
import { JSONSchema, Schema } from '../types/schema.js';
import { ValidationError, ValidationResult } from '../types/validation.js';

/**
 * Schema validator
 */
export class SchemaValidator {
  private ajv: Ajv;

  constructor() {
    this.ajv = new Ajv({ allErrors: true, strict: false });
    addFormats(this.ajv);
  }

  /**
   * Validate data against schema
   */
  validate(schema: Schema, data: any): ValidationResult {
    // Handle Zod schema
    if (this.isZodSchema(schema)) {
      return this.validateZod(schema, data);
    }

    // Handle JSON Schema
    return this.validateJSONSchema(schema as JSONSchema, data);
  }

  /**
   * Validate with Zod schema
   */
  private validateZod(schema: z.ZodType<any>, data: any): ValidationResult {
    const result = schema.safeParse(data);

    if (result.success) {
      return { valid: true };
    }

    const errors: ValidationError[] = result.error.errors.map((err) => ({
      path: err.path.join('.'),
      message: err.message,
      value: data,
    }));

    return { valid: false, errors };
  }

  /**
   * Validate with JSON Schema
   */
  private validateJSONSchema(schema: JSONSchema, data: any): ValidationResult {
    const validate = this.ajv.compile(schema);
    const valid = validate(data);

    if (valid) {
      return { valid: true };
    }

    const errors: ValidationError[] =
      validate.errors?.map((err) => ({
        path: err.instancePath.substring(1).replace(/\//g, '.'),
        message: err.message || 'Validation error',
        value: data,
        schema: err.schema,
      })) || [];

    return { valid: false, errors };
  }

  /**
   * Check if schema is a Zod schema
   */
  private isZodSchema(schema: Schema): schema is z.ZodType<any> {
    return schema !== null && typeof schema === 'object' && '_def' in schema && 'parse' in schema;
  }
}
