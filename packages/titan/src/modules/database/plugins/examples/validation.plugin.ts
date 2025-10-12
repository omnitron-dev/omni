/**
 * Validation Plugin
 *
 * Provides data validation using Zod schemas
 */

import { z } from 'zod';
import type { ITitanPlugin } from '../plugin.types.js';
import { Errors } from '../../../../errors/index.js';

export interface ValidationOptions {
  /**
   * Validation mode
   */
  mode?: 'strict' | 'loose';

  /**
   * Strip unknown properties
   */
  stripUnknown?: boolean;

  /**
   * Transform data before validation
   */
  transform?: boolean;

  /**
   * Custom error formatter
   */
  errorFormatter?: (errors: z.ZodIssue[]) => string;

  /**
   * Schema registry
   */
  schemas?: Record<
    string,
    {
      entity?: z.ZodType;
      create?: z.ZodType;
      update?: z.ZodType;
    }
  >;
}

/**
 * Create validation plugin
 */
export function validationPlugin(options: ValidationOptions = {}): ITitanPlugin {
  const mode = options.mode || 'strict';
  const stripUnknown = options.stripUnknown ?? true;
  const transform = options.transform ?? true;

  const formatError =
    options.errorFormatter ||
    ((errors: z.ZodIssue[]) => {
      const messages = errors.map((e) => `${e.path.join('.')}: ${e.message}`);
      return `Validation failed: ${messages.join(', ')}`;
    });

  return {
    name: 'validation',
    version: '1.0.0',
    metadata: {
      description: 'Data validation with Zod schemas',
      category: 'validation',
      author: 'Titan Framework',
      compatibility: {
        dialects: ['postgres', 'mysql', 'sqlite'],
      },
    },

    extendRepository(repository: any) {
      // Store original methods
      const originalCreate = repository.create;
      const originalUpdate = repository.update;
      const originalCreateMany = repository.createMany;
      const originalUpdateMany = repository.updateMany;

      // Get schemas for this repository
      const schemas = options.schemas?.[repository.tableName] || repository.schemas || {};

      // Helper to validate data
      const validateData = (data: any, schema?: z.ZodType) => {
        if (!schema) {
          return data; // No schema, pass through
        }

        try {
          if (stripUnknown) {
            // Parse with stripping
            const parsed = schema.parse(data);
            return transform ? parsed : data;
          } else {
            // Validate without stripping
            schema.parse(data);
            return data;
          }
        } catch (error) {
          if (error instanceof z.ZodError) {
            const fieldErrors = error.issues.map((e) => ({
              field: String(e.path.join('.')),
              message: e.message,
              code: e.code,
            }));
            throw Errors.validation(fieldErrors);
          }
          throw error;
        }
      };

      // Override create
      repository.create = async function (data: any) {
        const validatedData = validateData(data, schemas.create || schemas.entity);
        return originalCreate.call(this, validatedData);
      };

      // Override createMany
      repository.createMany = async function (data: any[]) {
        const schema = schemas.create || schemas.entity;
        const validatedData = data.map((item) => validateData(item, schema));
        return originalCreateMany.call(this, validatedData);
      };

      // Override update
      repository.update = async function (id: number | string, data: any) {
        const validatedData = validateData(data, schemas.update);
        return originalUpdate.call(this, id, validatedData);
      };

      // Override updateMany
      repository.updateMany = async function (conditions: any, data: any) {
        const validatedData = validateData(data, schemas.update);
        return originalUpdateMany.call(this, conditions, validatedData);
      };

      // Add validation methods
      repository.validate = function (data: any, type: 'create' | 'update' | 'entity' = 'entity') {
        const schema =
          type === 'create' ? schemas.create || schemas.entity : type === 'update' ? schemas.update : schemas.entity;

        if (!schema) {
          return { valid: true, data };
        }

        try {
          const validatedData = validateData(data, schema);
          return { valid: true, data: validatedData };
        } catch (error: any) {
          return {
            valid: false,
            errors: error.errors || [{ message: error.message }],
          };
        }
      };

      repository.setSchema = function (type: 'entity' | 'create' | 'update', schema: z.ZodType) {
        if (!repository.schemas) {
          repository.schemas = {};
        }
        repository.schemas[type] = schema;
      };

      return repository;
    },

    init(config?: any) {
      // Merge configuration schemas
      if (config?.schemas) {
        options.schemas = { ...options.schemas, ...config.schemas };
      }
    },

    onRegister() {
      // Validate schema configuration
      if (options.schemas) {
        for (const [table, schemas] of Object.entries(options.schemas)) {
          for (const [type, schema] of Object.entries(schemas)) {
            if (schema && !(schema instanceof z.ZodType)) {
              throw Errors.badRequest(`Invalid schema for ${table}.${type}: must be a Zod schema`);
            }
          }
        }
      }
    },
  };
}

/**
 * Create validation plugin with predefined schemas
 */
export function createValidationPlugin(
  schemas: Record<
    string,
    {
      entity?: z.ZodType;
      create?: z.ZodType;
      update?: z.ZodType;
    }
  >,
  options?: Omit<ValidationOptions, 'schemas'>
): ITitanPlugin {
  return validationPlugin({ ...options, schemas });
}

// Common validation schemas
export const CommonSchemas = {
  id: z.union([z.number().int().positive(), z.string().uuid()]),
  email: z.string().email(),
  url: z.string().url(),
  slug: z.string().regex(/^[a-z0-9-]+$/),
  username: z
    .string()
    .min(3)
    .max(30)
    .regex(/^[a-zA-Z0-9_-]+$/),
  password: z.string().min(8).max(100),
  phone: z.string().regex(/^\+?[1-9]\d{1,14}$/),
  date: z.date(),
  timestamp: z.union([z.date(), z.string().datetime()]),
  json: z.record(z.string(), z.any()),
  enum: <T extends readonly [string, ...string[]]>(values: T) => z.enum(values),
};

// Default export
export default validationPlugin;
